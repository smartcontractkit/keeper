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

  struct Job {
    address target;
    uint32 executeGas;
    uint96 balance;
    bytes queryData;
    address[] keepers;
    mapping(address => bool) isKeeper;
  }

  Job[] public jobs;

  event AddJob(
    uint256 indexed id,
    uint32 executeGas,
    address[] keepers
  );
  event AddedFunds(
    uint256 indexed id,
    uint256 amount
  );
  event Executed(
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

  function addJob(
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

    uint256 id = jobs.length;
    jobs.push(Job({
      target: _target,
      executeGas: _gasLimit,
      balance: 0,
      keepers: keepers,
      queryData: _queryData
    }));
    for (uint256 i = 0; i<keepers.length; i++) {
      jobs[id].isKeeper[keepers[i]] = true;
    }
    emit AddJob(id, _gasLimit, keepers);
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
    return jobs[id].keepers;
  }

  function queryJob(
    uint256 id
  )
    external
    view
    returns (
      bool canPerform
    )
  {
    Job storage job = jobs[id];
    uint256 payment = getPaymentAmount(id);
    if (job.balance < payment) {
      return false;
    }

    UpkeptInterface target = UpkeptInterface(job.target);
    bytes memory queryData = abi.encodeWithSelector(target.checkForUpkeep.selector, job.queryData);
    (, bytes memory result) = job.target.staticcall(queryData);
    ( canPerform ) = abi.decode(result, (bool));

    return canPerform;
  }

  function executeJob(
    uint256 id
  )
    external
  {
    require(jobs.length > id, "!job");

    Job storage s_job = jobs[id];
    Job memory m_job = s_job;

    uint256 payment = getPaymentAmount(id);
    require(m_job.balance >= payment, "!executable");
    s_job.balance = uint96(uint256(m_job.balance).sub(payment));
    LINK.transfer(msg.sender, payment);

    require(gasleft() > m_job.executeGas, "!gasleft");

    UpkeptInterface target = UpkeptInterface(m_job.target);
    (bool success,) = address(target).call{gas: m_job.executeGas}(abi.encodeWithSelector(target.performUpkeep.selector, m_job.queryData));
    emit Executed(id, m_job.target, success);
  }

  function addFunds(
    uint256 id,
    uint256 _amount
  )
    external
  {
    require(jobs.length > id, "!job");

    jobs[id].balance = uint96(uint256(jobs[id].balance).add(_amount));
    LINK.transferFrom(msg.sender, address(this), _amount);
    emit AddedFunds(id, _amount);
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
    uint256 gasLimit = uint256(jobs[id].executeGas);
    uint256 gasPrice = uint256(FASTGAS.latestAnswer());
    uint256 linkEthPrice = uint256(LINKETH.latestAnswer());
    return gasPrice.mul(gasLimit).mul(LINK_DIVISIBILITY).div(linkEthPrice);
  }

  function _validateQueryFunction(
    address _target
  )
    internal
    view
    returns (bool)
  {
    UpkeptInterface target = UpkeptInterface(_target);
    bytes memory data;
    (bool success,) = _target.staticcall(abi.encodeWithSelector(target.checkForUpkeep.selector, data));
    return success;
  }
}
