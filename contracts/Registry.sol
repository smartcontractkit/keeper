pragma solidity 0.6.12;

import "@chainlink/contracts/src/v0.6/interfaces/AggregatorInterface.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./Executor.sol";
import "./IRegistry.sol";

contract Registry is IRegistry {
  using Address for address;
  using SafeERC20 for IERC20;
  using SafeMath for uint256;

  uint256 public constant PRIMARY_CALLER_ADDITIONAL_RATE = 25;
  uint256 public constant SECONDARY_CALLER_DISCOUNT_RATE = 80;

  IERC20 public immutable LINK;
  AggregatorInterface public immutable LINKETH;
  AggregatorInterface public immutable FASTGAS;

  struct Job {
    bytes4 querySelector;
    bytes4 executeSelector;
    uint8 rewardCallers;
    address target;
    uint32 executeGas;
    uint64 lastExecuted;
    uint96 balance;
    bytes executeData;
    // block.number => count
    mapping(uint256 => uint8) count;
    // block.number => caller => called
    mapping(uint256 => mapping(address => bool)) called;
  }

  mapping(address => Job) public jobs;

  event AddJob(
    address indexed executor,
    address target,
    uint32 executeGas
  );
  event AddedFunds(
    address indexed executor,
    uint256 amount
  );
  event Executed(
    address indexed executor,
    address indexed target,
    bytes4 executeSelector,
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
    bytes4 _querySelector,
    bytes4 _executeSelector,
    uint32 _gasLimit,
    uint8 _rewardCallers,
    bytes calldata _executeData
  )
    external
  {
    require(_target.isContract(), "!contract");
    require(_rewardCallers > 0, "!rewardCallers");
    require(_gasLimit > 23000, "!gasLimit");
    require(_validateQueryFunction(_target, _querySelector), "!query");
    Executor executor = new Executor();
    jobs[address(executor)] = Job({
      target: _target,
      querySelector: _querySelector,
      executeSelector: _executeSelector,
      executeGas: _gasLimit,
      rewardCallers: _rewardCallers,
      balance: 0,
      lastExecuted: uint64(block.number),
      executeData: _executeData
    });
    emit AddJob(address(executor), _target, _gasLimit);
  }

  function queryJob()
    external
    view
    override
    returns (
      bool canExecute,
      uint256 totalPayment,
      uint256 primaryPayment,
      uint256 secondaryPayment
    )
  {
    Job storage job = jobs[msg.sender];
    (totalPayment, primaryPayment, secondaryPayment) = getPaymentAmounts(msg.sender);
    if (job.balance >= totalPayment) {
      (, bytes memory result) = job.target.staticcall(abi.encodeWithSelector(job.querySelector));
      ( canExecute ) = abi.decode(result, (bool));
    } else {
      canExecute = false;
    }
  }

  function executeJob(
    address _caller,
    uint256 _primaryPayment,
    uint256 _secondaryPayment
  )
    external
    override
  {
    Job storage s_job = jobs[msg.sender];
    Job memory m_job = s_job;
    uint256 count = s_job.count[block.number];
    require(count <= m_job.rewardCallers, "!count");
    require(!s_job.called[block.number][_caller], "called");
    s_job.called[block.number][_caller] = true;
    if (m_job.lastExecuted == block.number && count < m_job.rewardCallers) {
      s_job.balance = uint96(uint256(m_job.balance).sub(_secondaryPayment));
      LINK.transfer(_caller, _secondaryPayment);
    } else {
      s_job.balance = uint96(uint256(m_job.balance).sub(_primaryPayment));
      LINK.transfer(_caller, _primaryPayment);
    }
    s_job.count[block.number] = uint8(uint256(count).add(1));
    // ensure second+ callers are still supplying enough gas
    require(gasleft() > m_job.executeGas, "!gasleft");
    if (count < 1) {
      s_job.lastExecuted = uint64(block.number);
      (bool success,) = m_job.target.call{gas: m_job.executeGas}(abi.encodeWithSelector(m_job.executeSelector, m_job.executeData));
      emit Executed(msg.sender, m_job.target, m_job.executeSelector, success);
    }
  }

  function addFunds(
    address _executor,
    uint256 _amount
  )
    external
  {
    require(jobs[_executor].rewardCallers > 0, "!job");
    jobs[_executor].balance = uint96(uint256(jobs[_executor].balance).add(_amount));
    LINK.transferFrom(msg.sender, address(this), _amount);
    emit AddedFunds(_executor, _amount);
  }

  function getPaymentAmounts(
    address _executor
  )
    public
    view
    returns (
      uint256 totalPayment,
      uint256 primaryPayment,
      uint256 secondaryPayment
    )
  {
    uint256 gasLimit = uint256(jobs[_executor].executeGas);
    uint256 callers = uint256(jobs[_executor].rewardCallers);
    primaryPayment = getPrimaryPaymentAmount(gasLimit);
    secondaryPayment = getSecondaryPaymentAmount(primaryPayment);
    totalPayment = primaryPayment.add(secondaryPayment.mul(callers));
  }

  function getPrimaryPaymentAmount(
    uint256 _gasLimit
  )
    public
    view
    returns (uint256)
  {
    uint256 gasPrice = uint256(FASTGAS.latestAnswer());
    uint256 linkEthPrice = uint256(LINKETH.latestAnswer());
    uint256 payment = gasPrice.mul(_gasLimit).mul(1e18).div(linkEthPrice);
    return payment.add(payment.div(100).mul(PRIMARY_CALLER_ADDITIONAL_RATE));
  }

  function getSecondaryPaymentAmount(
    uint256 _payment
  )
    public
    view
    returns (uint256)
  {
    return _payment.div(100).mul(SECONDARY_CALLER_DISCOUNT_RATE);
  }

  function _validateQueryFunction(
    address _target,
    bytes4 _querySelector
  )
    internal
    view
    returns (bool)
  {
    (bool success,) = _target.staticcall(abi.encodeWithSelector(_querySelector));
    return success;
  }
}
