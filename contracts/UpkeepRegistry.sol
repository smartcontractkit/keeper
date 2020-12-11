pragma solidity 0.6.12;

import "@chainlink/contracts/src/v0.6/interfaces/AggregatorInterface.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./UpkeptInterface.sol";

contract UpkeepRegistry {
  using Address for address;
  using SafeERC20 for IERC20;
  using SafeMath for uint256;

  IERC20 public immutable LINK;
  AggregatorInterface public immutable LINKETH;
  AggregatorInterface public immutable FASTGAS;
  uint256 constant private LINK_DIVISIBILITY = 1e18;
  bytes4 constant private CHECK_SELECTOR = UpkeptInterface.checkForUpkeep.selector;
  bytes4 constant private PERFORM_SELECTOR = UpkeptInterface.performUpkeep.selector;

  struct Upkeep {
    address target;
    uint32 executeGas;
    uint96 balance;
    bytes checkData;
    address[] keepers;
    mapping(address => bool) isKeeper;
  }

  Upkeep[] public upkeeps;

  event UpkeepRegistered(
    uint256 indexed id,
    uint32 executeGas,
    address[] keepers
  );
  event AddedFunds(
    uint256 indexed id,
    uint256 amount
  );
  event UpkeepPerformed(
    uint256 indexed id,
    address indexed target,
    bool success
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
    address _target,
    uint32 _gasLimit,
    address[] calldata keepers,
    bytes calldata _queryData
  )
    external
  {
    require(_target.isContract(), "!contract");
    require(_gasLimit > 23000, "!gasLimit");
    require(keepers.length > 0, "minimum of 1 keeper");
    require(_validateQueryFunction(_target), "!query");

    uint256 id = upkeeps.length;
    upkeeps.push(Upkeep({
      target: _target,
      executeGas: _gasLimit,
      balance: 0,
      keepers: keepers,
      checkData: _queryData
    }));
    for (uint256 i = 0; i<keepers.length; i++) {
      upkeeps[id].isKeeper[keepers[i]] = true;
    }
    emit UpkeepRegistered(id, _gasLimit, keepers);
  }

  function checkForUpkeep(
    uint256 id
  )
    external
    view
    returns (
      bool canPerform,
      bytes memory performCalldata
    )
  {
    Upkeep storage upkeep = upkeeps[id];
    uint256 payment = getPaymentAmount(id);
    if (upkeep.balance < payment) {
      return (false, performCalldata);
    }

    bytes memory toCall = abi.encodeWithSelector(CHECK_SELECTOR, upkeep.checkData);
    (bool success, bytes memory result) = upkeep.target.staticcall(toCall);
    if (!success) {
      return (false, performCalldata);
    }

    return abi.decode(result, (bool, bytes));
  }

  function performUpkeep(
    uint256 id
  )
    external
  {
    require(upkeeps.length > id, "!upkeep");

    Upkeep storage s_upkeep = upkeeps[id];
    Upkeep memory upkeep = s_upkeep;
    require(s_upkeep.isKeeper[msg.sender], "only keepers");

    uint256 payment = getPaymentAmount(id);
    require(upkeep.balance >= payment, "!executable");
    s_upkeep.balance = uint96(uint256(upkeep.balance).sub(payment));

    LINK.transfer(msg.sender, payment);

    require(gasleft() > upkeep.executeGas, "!gasleft");
    bytes memory toCall = abi.encodeWithSelector(PERFORM_SELECTOR, upkeep.checkData);
    (bool success,) = upkeep.target.call{gas: upkeep.executeGas}(toCall);

    emit UpkeepPerformed(id, upkeep.target, success);
  }

  function addFunds(
    uint256 id,
    uint256 _amount
  )
    external
  {
    require(upkeeps.length > id, "!upkeep");

    upkeeps[id].balance = uint96(uint256(upkeeps[id].balance).add(_amount));
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
    return upkeeps[id].keepers;
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
    uint256 gasLimit = uint256(upkeeps[id].executeGas);
    uint256 gasPrice = uint256(FASTGAS.latestAnswer());
    uint256 linkEthPrice = uint256(LINKETH.latestAnswer());
    return gasPrice.mul(gasLimit).mul(LINK_DIVISIBILITY).div(linkEthPrice);
  }

  function _validateQueryFunction(
    address _target
  )
    private
    view
    returns (bool)
  {
    UpkeptInterface target = UpkeptInterface(_target);
    bytes memory data;
    (bool success,) = _target.staticcall(abi.encodeWithSelector(target.checkForUpkeep.selector, data));
    return success;
  }

}
