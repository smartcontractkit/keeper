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
  mapping(address => KeeperRegistrations) private keeperRegistrations;

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

  struct KeeperRegistrations {
    uint256[] added;
    uint256[] removed;
  }

  event UpkeepRegistered(
    uint256 indexed id,
    uint32 executeGas,
    address admin,
    address[] keepers
  );
  event FundsAdded(
    uint256 indexed id,
    uint256 amount
  );
  event UpkeepPerformed(
    uint256 indexed id,
    bool indexed success,
    bytes performData
  );
  event UpkeepDeregistered(
    uint256 indexed id
  );
  event FundsWithdrawn(
    uint256 indexed id,
    uint256 amount,
    address to
  );

  constructor(
    address link,
    address linkEth,
    address fastGas
  )
    public
  {
    LINK = IERC20(link);
    LINKETH = AggregatorInterface(linkEth);
    FASTGAS = AggregatorInterface(fastGas);
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

    for (uint256 i = 0; i < keepers.length; i++) {
      address keeper = keepers[i];
      registrations[id].isKeeper[keeper] = true;
      keeperRegistrations[keeper].added.push(id);
    }
    emit UpkeepRegistered(id, gasLimit, admin, keepers);
  }

  function deregisterUpkeep(
    uint256 id
  )
    external
    onlyOwner()
    validateRegistration(id)
  {
    registrations[id].valid = false;

    address[] memory keepers = registrations[id].keepers;
    for (uint256 i = 0; i < keepers.length; i++) {
      address keeper = keepers[i];
      keeperRegistrations[keeper].removed.push(id);
    }

    emit UpkeepDeregistered(id);
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
    uint256 amount
  )
    external
    validateRegistration(id)
  {
    registrations[id].balance = uint96(uint256(registrations[id].balance).add(amount));
    LINK.transferFrom(msg.sender, address(this), amount);
    emit FundsAdded(id, amount);
  }

  function withdrawFunds(
    uint256 id,
    uint256 amount,
    address to
  )
    external
  {
    require(registrations[id].admin == msg.sender, "only callable by admin");

    registrations[id].balance = uint96(uint256(registrations[id].balance).sub(amount));
    LINK.transfer(to, amount);
    emit FundsWithdrawn(id, amount, to);
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

  function registrationsFor(
    address keeper
  )
    external
    returns (
      uint256[] memory added,
      uint256[] memory removed
    )
  {
    KeeperRegistrations memory krs = keeperRegistrations[keeper];
    return (krs.added, krs.removed);
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
    uint256 base = gasPrice.mul(gasLimit).mul(LINK_DIVISIBILITY).div(linkEthPrice);
    return base.add(base.mul(25).div(100));
  }

  function validateQueryFunction(
    address target
  )
    private
    view
    returns (bool)
  {
    bytes memory data;
    (bool success,) = target.staticcall(abi.encodeWithSelector(CHECK_SELECTOR, data));
    return success;
  }

  modifier validateRegistration(
    uint256 id
  ) {
    require(registrations[id].valid, "invalid upkeep id");
    _;
  }

}
