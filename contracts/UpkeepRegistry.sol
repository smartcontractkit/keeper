pragma solidity 0.6.12;

import "@chainlink/contracts/src/v0.6/interfaces/AggregatorV3Interface.sol";
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

  address constant private ZERO_ADDRESS = address(0);
  bytes4 constant private CHECK_SELECTOR = UpkeptInterface.checkForUpkeep.selector;
  bytes4 constant private PERFORM_SELECTOR = UpkeptInterface.performUpkeep.selector;
  uint64 constant private UINT64_MAX = 2**64 - 1;
  uint256 constant private CALL_GAS_MIN = 2_300;
  uint256 constant private CALL_GAS_MAX = 2_500_000;
  uint256 constant private CANCELATION_DELAY = 50;
  uint24 constant private PPT_BASE = 100_000;
  uint256 constant private LINK_DIVISIBILITY = 1e18;
  uint256 constant private REGISTRY_GAS_OVERHEAD = 60_000;

  IERC20 public immutable LINK;
  AggregatorV3Interface public immutable LINKETH;
  AggregatorV3Interface public immutable FASTGAS;

  uint256 public registrationCount;
  uint256[] private s_canceledRegistrations;
  address[] private s_keeperList;
  mapping(uint256 => Registration) private s_registrations;
  mapping(address => KeeperInfo) private s_keeperInfo;
  mapping(address => address) private s_proposedPayee;
  Config private s_config;

  struct Registration {
    address target;
    uint32 executeGas;
    uint96 balance;
    address admin;
    uint64 validUntilHeight;
    bytes checkData;
  }

  struct KeeperInfo {
    address payee;
    uint96 balance;
    bool active;
  }

  struct Config {
    uint24 paymentPremiumPPT;
    uint24 checkFrequencyBlocks;
    uint64 stalenessSeconds;
  }

  event UpkeepRegistered(
    uint256 indexed id,
    uint32 executeGas,
    address admin
  );
  event FundsAdded(
    uint256 indexed id,
    uint256 amount
  );
  event UpkeepPerformed(
    uint256 indexed id,
    bool indexed success,
    uint256 payment,
    bytes performData
  );
  event RegistrationCanceled(
    uint256 indexed id,
    uint64 indexed atBlockHeight
  );
  event FundsWithdrawn(
    uint256 indexed id,
    uint256 amount,
    address to
  );
  event KeeperAdded(
    address indexed keeper,
    address payee
  );
  event KeeperRemoved(
    address indexed keeper
  );
  event PaymentWithdrawn(
    address indexed keeper,
    uint256 indexed amount,
    address indexed to,
    address payee
  );
  event NewPayeeProposed(
    address indexed keeper,
    address indexed from,
    address indexed to
  );
  event PayeeProposalAccepted(
    address indexed keeper,
    address indexed from,
    address indexed to
  );
  event ConfigUpdated(
    uint24 paymentPremiumPPT,
    uint24 checkFrequencyBlocks,
    uint64 stalenessSeconds
  );

  constructor(
    address link,
    address linkEth,
    address fastGas,
    uint24 paymentPremiumPPT,
    uint24 checkFrequencyBlocks,
    uint64 stalenessSeconds
  )
    public
  {
    LINK = IERC20(link);
    LINKETH = AggregatorV3Interface(linkEth);
    FASTGAS = AggregatorV3Interface(fastGas);

    setConfig(paymentPremiumPPT, checkFrequencyBlocks, stalenessSeconds);
  }

  function setConfig(
    uint24 paymentPremiumPPT,
    uint24 checkFrequencyBlocks,
    uint64 stalenessSeconds
  )
    onlyOwner()
    public
  {
    s_config = Config({
      paymentPremiumPPT: paymentPremiumPPT,
      checkFrequencyBlocks: checkFrequencyBlocks,
      stalenessSeconds: stalenessSeconds
    });

    ConfigUpdated(paymentPremiumPPT, checkFrequencyBlocks, stalenessSeconds);
  }

  function config()
    external
    view
    returns (
      uint24 paymentPremiumPPT,
      uint24 checkFrequencyBlocks,
      uint64 stalenessSeconds
    )
  {
    Config memory _config = s_config;
    return (
      _config.paymentPremiumPPT,
      _config.checkFrequencyBlocks,
      _config.stalenessSeconds
    );
  }

  function setKeepers(
    address[] calldata keepers,
    address[] calldata payees
  )
    external
    onlyOwner()
  {
    for (uint256 i = 0; i < s_keeperList.length; i++) {
      address keeper = s_keeperList[i];
      s_keeperInfo[keeper].active = false;
      emit KeeperRemoved(keeper);
    }
    for (uint256 i = 0; i < keepers.length; i++) {
      address keeper = keepers[i];
      KeeperInfo storage s_keeper = s_keeperInfo[keeper];
      address oldPayee = s_keeper.payee;
      address newPayee = payees[i];
      require(oldPayee == ZERO_ADDRESS || oldPayee == newPayee, "cannot change payee");
      s_keeper.payee = newPayee;
      s_keeper.active = true;

      emit KeeperAdded(keeper, newPayee);
    }
    s_keeperList = keepers;
  }

  function keepers()
    external
    view
    returns (
      address[] memory
    )
  {
    return s_keeperList;
  }

  function keeperInfo(
    address query
  )
    external
    view
    returns (
      address payee,
      bool active,
      uint96 balance
    )
  {
    KeeperInfo memory keeper = s_keeperInfo[query];
    return (keeper.payee, keeper.active, keeper.balance);
  }

  function registerUpkeep(
    address target,
    uint32 gasLimit,
    address admin,
    bytes calldata queryData
  )
    external
    onlyOwner()
  {
    require(target.isContract(), "target is not a contract");
    require(gasLimit > CALL_GAS_MIN, "min gas is 2300");
    require(gasLimit <= CALL_GAS_MAX, "max gas is 2500000");

    uint256 id = registrationCount;
    s_registrations[id] = Registration({
      target: target,
      executeGas: gasLimit,
      balance: 0,
      admin: admin,
      validUntilHeight: UINT64_MAX,
      checkData: queryData
    });
    registrationCount++;

    emit UpkeepRegistered(id, gasLimit, admin);
  }

  function cancelRegistration(
    uint256 id
  )
    external
    validateRegistration(id)
  {
    bool isOwner = msg.sender == owner;
    require(isOwner|| msg.sender == s_registrations[id].admin, "only owner or admin");

    uint256 height = block.number;
    if (!isOwner) {
      height = height.add(CANCELATION_DELAY);
    }
    s_registrations[id].validUntilHeight = uint64(height);
    s_canceledRegistrations.push(id);

    emit RegistrationCanceled(id, uint64(height));
  }

  function checkForUpkeep(
    uint256 id
  )
    external
    cannotExecute()
    returns (
      bool canPerform,
      bytes memory performData,
      uint256 maxLinkPayment,
      uint256 gasLimit,
      int256 gasWei,
      int256 linkEth
    )
  {
    Registration storage registration = s_registrations[id];
    gasLimit = registration.executeGas;
    (maxLinkPayment, gasWei, linkEth) = getPaymentAmounts(gasLimit);
    if (registration.balance < maxLinkPayment) {
      return (false, performData, 0, 0, 0, 0);
    }

    bytes memory toCall = abi.encodeWithSelector(CHECK_SELECTOR, registration.checkData);
    (bool success, bytes memory result) = registration.target.call(toCall);
    if (!success) {
      return (false, performData, 0, 0, 0, 0);
    }
    (canPerform, performData) = abi.decode(result, (bool, bytes));
    return (canPerform, performData, maxLinkPayment, gasLimit, gasWei, linkEth);
  }

  function tryUpkeep(
    uint256 id,
    bytes calldata performData
  )
    external
    cannotExecute()
    validateRegistration(id)
    returns (
      bool success
    )
  {
    Registration storage s_registration = s_registrations[id];
    uint256 gasLimit = s_registration.executeGas;
    (uint256 payment,,) = getPaymentAmounts(gasLimit);
    if (s_registration.balance < payment) {
      return false;
    }

    bytes memory toCall = abi.encodeWithSelector(PERFORM_SELECTOR, performData);
    (success,) = s_registration.target.call{gas: gasLimit}(toCall);

    return success;
  }

  function performUpkeep(
    uint256 id,
    bytes calldata performData
  )
    external
    validateKeeper()
    validateRegistration(id)
  {
    Registration memory registration = s_registrations[id];
    uint256 gasLimit = registration.executeGas;
    (uint256 payment,,) = getPaymentAmounts(gasLimit);
    require(registration.balance >= payment, "!executable");
    require(gasleft() > registration.executeGas + REGISTRY_GAS_OVERHEAD, "!gasleft");

    uint256  gasUsed = gasleft();
    bytes memory toCall = abi.encodeWithSelector(PERFORM_SELECTOR, performData);
    (bool success,) = registration.target.call{gas: gasLimit}(toCall);
    gasUsed = gasUsed - gasleft();

    (payment,,) = getPaymentAmounts(gasUsed);
    s_registrations[id].balance = uint96(uint256(registration.balance).sub(payment));
    uint256 newBalance = uint256(s_keeperInfo[msg.sender].balance).add(payment);
    s_keeperInfo[msg.sender].balance = uint96(newBalance);

    emit UpkeepPerformed(id, success, payment, performData);
  }

  function addFunds(
    uint256 id,
    uint256 amount
  )
    external
    validateRegistration(id)
  {
    s_registrations[id].balance = uint96(uint256(s_registrations[id].balance).add(amount));
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
    require(s_registrations[id].admin == msg.sender, "only callable by admin");
    require(s_registrations[id].validUntilHeight <= block.number, "registration must be canceled");

    s_registrations[id].balance = uint96(uint256(s_registrations[id].balance).sub(amount));
    emit FundsWithdrawn(id, amount, to);

    LINK.transfer(to, amount);
  }

  function withdrawPayment(
    address from,
    uint256 amount,
    address to
  )
    external
  {
    KeeperInfo memory keeper = s_keeperInfo[from];
    require(keeper.payee == msg.sender, "only callable by payee");
    require(keeper.balance >= amount, "insufficient balance");

    s_keeperInfo[from].balance = uint96(uint256(keeper.balance).sub(amount));
    emit PaymentWithdrawn(from, amount, to, msg.sender);

    LINK.transfer(to, amount);
  }

  function canceledRegistrations()
    external
    view
    returns (
      uint256[] memory
    )
  {
    return s_canceledRegistrations;
  }

  function registration(
    uint256 id
  )
    external
    view
    returns (
      address target,
      uint32 executeGas,
      uint96 balance,
      address admin,
      uint64 validUntilHeight,
      bytes memory checkData
    )
  {
    Registration memory reg = s_registrations[id];
    return (
      reg.target,
      reg.executeGas,
      reg.balance,
      reg.admin,
      reg.validUntilHeight,
      reg.checkData
    );
  }

  // PRIVATE

  function getPaymentAmounts(
    uint256 gasLimit
  )
    private
    view
    returns (
      uint256 payment,
      int256 gasWei,
      int256 linkEth
    )
  {
    Config memory _config = s_config;
    uint256 timestamp;
    (,gasWei,,timestamp,) = FASTGAS.latestRoundData();
    if (_config.stalenessSeconds > 0) {
      require(block.timestamp - timestamp < _config.stalenessSeconds, "stale GAS/ETH data");
    }
    (,linkEth,,timestamp,) = LINKETH.latestRoundData();
    if (_config.stalenessSeconds > 0) {
      require(block.timestamp - timestamp < _config.stalenessSeconds, "stale LINK/ETH data");
    }

    // Assuming that the total ETH supply is capped by 2**128 Wei, the maximum
    // intermediate value here is on the order of 2**188 and will therefore
    // always fit a uint256.
    uint256 weiForGas = uint256(gasWei).mul(gasLimit.add(REGISTRY_GAS_OVERHEAD));
    uint256 linkForGas = weiForGas.mul(LINK_DIVISIBILITY).div(uint256(linkEth));
    payment = linkForGas.add(linkForGas.mul(_config.paymentPremiumPPT).div(PPT_BASE));

    return (payment, gasWei, linkEth);
  }

  function proposeNewPayee(
    address keeper,
    address proposed
  )
    external
  {
    require(s_keeperInfo[keeper].payee == msg.sender, "only callable by payee");
    s_proposedPayee[keeper] = proposed;

    emit NewPayeeProposed(keeper, msg.sender, proposed);
  }

  function acceptPayeeProposal(
    address keeper
  )
    external
  {
    require(s_proposedPayee[keeper] == msg.sender, "only callable by proposed payee");
    address past = s_keeperInfo[keeper].payee;
    s_keeperInfo[keeper].payee = msg.sender;
    s_proposedPayee[keeper] = ZERO_ADDRESS;

    emit PayeeProposalAccepted(keeper, past, msg.sender);
  }


  // MODIFIERS

  modifier validateRegistration(
    uint256 id
  ) {
    require(s_registrations[id].validUntilHeight > block.number, "invalid upkeep id");
    _;
  }

  modifier cannotExecute()
  {
    require(msg.sender == ZERO_ADDRESS, "only for simulated backend");
    _;
  }

  modifier validateKeeper()
  {
    require(s_keeperInfo[msg.sender].active, "only active keepers");
    _;
  }

}
