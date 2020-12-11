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

  struct Job {
    address target;
    uint32 executeGas;
    uint96 balance;
    bytes queryData;
  }

  Job[] public jobs;

  event AddJob(
    uint256 indexed id,
    uint32 executeGas
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
    bytes calldata _queryData
  )
    external
  {
    require(_target.isContract(), "!contract");
    require(_gasLimit > 23000, "!gasLimit");
    require(_validateQueryFunction(_target), "!query");

    uint256 id = jobs.length;
    jobs.push(Job({
      target: _target,
      executeGas: _gasLimit,
      balance: 0,
      queryData: _queryData
    }));
    emit AddJob(id, _gasLimit);
  }

  function queryJob(
    uint256 id
  )
    external
    view
    returns (
      bool canExecute
    )
  {
    Job storage job = jobs[id];
    (uint256 totalPayment,) = getPaymentAmounts(id);
    if (job.balance >= totalPayment) {
      UpkeptInterface target = UpkeptInterface(job.target);
      bytes memory queryData = abi.encodeWithSelector(target.checkForUpkeep.selector, job.queryData);
      (, bytes memory result) = job.target.staticcall(queryData);
      ( canExecute ) = abi.decode(result, (bool));
    } else {
      canExecute = false;
    }
  }

  function executeJob(
    uint256 id
  )
    external
  {
    require(jobs.length > id, "!job");

    Job storage s_job = jobs[id];
    Job memory m_job = s_job;

    (, uint256 _primaryPayment) = getPaymentAmounts(id);
    require(m_job.balance >= _primaryPayment, "!executable");
    s_job.balance = uint96(uint256(m_job.balance).sub(_primaryPayment));
    LINK.transfer(msg.sender, _primaryPayment);

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

  function getPaymentAmounts(
    uint256 id
  )
    public
    view
    returns (
      uint256 totalPayment,
      uint256 primaryPayment
    )
  {
    uint256 gasLimit = uint256(jobs[id].executeGas);
    primaryPayment = getIndividualPaymentAmount(gasLimit);
    totalPayment = primaryPayment.add(primaryPayment);
  }

  function getIndividualPaymentAmount(
    uint256 _gasLimit
  )
    private
    view
    returns (uint256)
  {
    uint256 gasPrice = uint256(FASTGAS.latestAnswer());
    uint256 linkEthPrice = uint256(LINKETH.latestAnswer());
    uint256 payment = gasPrice.mul(_gasLimit).mul(1e18).div(linkEthPrice);
    return payment;
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
