pragma solidity 0.6.12;

import "@chainlink/contracts/src/v0.6/interfaces/AggregatorInterface.sol";
import "@chainlink/contracts/src/v0.6/Owned.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./UpkeptInterface.sol";

contract UpkeepRegistry is Owned {
  using Address for address;
  using SafeERC20 for IERC20;
  using SafeMath for uint256;

  IERC20 public immutable LINK;
  AggregatorInterface public immutable LINKETH;
  AggregatorInterface public immutable FASTGAS;
  uint256 constant private LINK_DIVISIBILITY = 1e18;
  bytes4 constant private CHECK_SELECTOR = UpkeptInterface.checkForUpkeep.selector;
  bytes4 constant private PERFORM_SELECTOR = UpkeptInterface.performUpkeep.selector;
  uint256 public registrationCount;
  mapping(uint256 => Registration) public registrations;

  struct Registration {
    address target;
    uint32 executeGas;
    uint96 balance;
    address admin;
    bool valid;
    bytes checkData;
    address[] keepers;
    mapping(address => bool) isKeeper;
  }

  event UpkeepRegistered(
    uint256 indexed id,
    uint32 executeGas,
    address admin,
    address[] keepers
  );
  event AddedFunds(
    uint256 indexed id,
    uint256 amount
  );
  event UpkeepPerformed(
    uint256 indexed id,
    bool indexed success,
    bytes performData
  );

  constructor(
    address _link,
    address _linkEth,
    address _fastGas
  )
    public
  {
    LINK = IERC20(_link);
    LINKETH = AggregatorInterface(_linkEth);
    FASTGAS = AggregatorInterface(_fastGas);
  }

  function registerUpkeep(
    address target,
    uint32 gasLimit,
    address admin,
    address[] calldata keepers,
    bytes calldata queryData
  )
    external
    onlyOwner()
  {
    require(target.isContract(), "!contract");
    require(gasLimit > 23000, "!gasLimit");
    require(keepers.length > 0, "minimum of 1 keeper");
    require(validateQueryFunction(target), "!query");

    uint256 id = registrationCount;
    registrations[id] = Registration({
      target: target,
      executeGas: gasLimit,
      balance: 0,
      admin: admin,
      valid: true,
      keepers: keepers,
      checkData: queryData
    });
    registrationCount++;

    for (uint256 i = 0; i<keepers.length; i++) {
      registrations[id].isKeeper[keepers[i]] = true;
    }
    emit UpkeepRegistered(id, gasLimit, admin, keepers);
  }

  function checkForUpkeep(
    uint256 id
  )
    external
    view
    returns (
      bool canPerform,
      bytes memory performData
    )
  {
    Registration storage registration = registrations[id];
    uint256 payment = getPaymentAmount(id);
    if (registration.balance < payment) {
      return (false, performData);
    }

    bytes memory toCall = abi.encodeWithSelector(CHECK_SELECTOR, registration.checkData);
    (bool success, bytes memory result) = registration.target.staticcall(toCall);
    if (!success) {
      return (false, performData);
    }

    return abi.decode(result, (bool, bytes));
  }

  function tryUpkeep(
    address sender,
    uint256 id,
    bytes calldata performData
  )
    external
    validateRegistration(id)
    returns (
      bool success
    )
  {
    Registration storage s_registration = registrations[id];
    require(s_registration.isKeeper[sender], "only keepers");

    uint256 payment = getPaymentAmount(id);
    require(s_registration.balance >= payment, "!executable");

    bytes memory toCall = abi.encodeWithSelector(PERFORM_SELECTOR, performData);
    (success,) = s_registration.target.call{gas: s_registration.executeGas}(toCall);
    require(success, "upkeep failed");
  }

  function performUpkeep(
    uint256 id,
    bytes calldata performData
  )
    external
    validateRegistration(id)
  {
    Registration storage s_registration = registrations[id];
    Registration memory registration = s_registration;
    require(s_registration.isKeeper[msg.sender], "only keepers");

    uint256 payment = getPaymentAmount(id);
    require(registration.balance >= payment, "!executable");
    s_registration.balance = uint96(uint256(registration.balance).sub(payment));

    require(gasleft() > registration.executeGas, "!gasleft");
    bytes memory toCall = abi.encodeWithSelector(PERFORM_SELECTOR, performData);
    (bool success,) = registration.target.call{gas: registration.executeGas}(toCall);

    LINK.transfer(msg.sender, payment);
    emit UpkeepPerformed(id, success, performData);
  }

  function addFunds(
    uint256 id,
    uint256 _amount
  )
    external
    validateRegistration(id)
  {
    registrations[id].balance = uint96(uint256(registrations[id].balance).add(_amount));
    LINK.transferFrom(msg.sender, address(this), _amount);
    emit AddedFunds(id, _amount);
  }

  function keepersFor(
    uint256 id
  )
    external
    view
    returns (
      address[] memory
    )
  {
    return registrations[id].keepers;
  }

  function getPaymentAmount(
    uint256 id
  )
    private
    view
    returns (
      uint256 payment
    )
  {
    uint256 gasLimit = uint256(registrations[id].executeGas);
    uint256 gasPrice = uint256(FASTGAS.latestAnswer());
    uint256 linkEthPrice = uint256(LINKETH.latestAnswer());
    return gasPrice.mul(gasLimit).mul(LINK_DIVISIBILITY).div(linkEthPrice);
  }

  function validateQueryFunction(
    address _target
  )
    private
    view
    returns (bool)
  {
    UpkeptInterface target = UpkeptInterface(_target);
    bytes memory data;
    (bool success,) = _target.staticcall(abi.encodeWithSelector(CHECK_SELECTOR, data));
    return success;
  }

  modifier validateRegistration(
    uint256 id
  ) {
    require(registrations[id].valid, "invalid upkeep id");
    _;
  }

}
