pragma solidity 0.6.12;

import "@chainlink/contracts/src/v0.6/interfaces/AggregatorV3Interface.sol";
import "@chainlink/contracts/src/v0.6/Owned.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./SafeMath96.sol";
import "./UpkeepBase.sol";
import "./UpkeepInterface.sol";

/**
  * @notice Registry for adding work for Chainlink Keepers to perform on client
  * contracts. Clients must support the Upkeep interface.
*/
contract UpkeepRegistry is Owned, UpkeepBase, ReentrancyGuard {
  using Address for address;
  using SafeERC20 for IERC20;
  using SafeMath for uint256;
  using SafeMath96 for uint96;

  address constant private ZERO_ADDRESS = address(0);
  bytes4 constant private CHECK_SELECTOR = UpkeepInterface.checkForUpkeep.selector;
  bytes4 constant private PERFORM_SELECTOR = UpkeepInterface.performUpkeep.selector;
  uint256 constant private CALL_GAS_MAX = 2_500_000;
  uint256 constant private CALL_GAS_MIN = 2_300;
  uint256 constant private CANCELATION_DELAY = 50;
  uint256 constant private CUSHION = 3_000;
  uint256 constant private LINK_DIVISIBILITY = 1e18;
  uint256 constant private REGISTRY_GAS_OVERHEAD = 80_000;
  uint32 constant private PPB_BASE = 1_000_000_000;
  uint64 constant private UINT64_MAX = 2**64 - 1;
  uint96 constant private LINK_TOTAL_SUPPLY = 1e27;

  uint256 private s_registrationCount;
  uint256[] private s_canceledRegistrations;
  address[] private s_keepers;
  mapping(uint256 => Registration) private s_registrations;
  mapping(address => KeeperInfo) private s_keeperInfo;
  mapping(address => address) private s_proposedPayee;
  mapping(uint256 => bytes) private s_checkData;
  Config private s_config;
  int256 private s_fallbackGasPrice;  // not in config object for gas savings
  int256 private s_fallbackLinkPrice; // not in config object for gas savings

  IERC20 public immutable LINK;
  AggregatorV3Interface public immutable LINK_ETH_FEED;
  AggregatorV3Interface public immutable FAST_GAS_FEED;

  struct Registration {
    address target;
    uint32 executeGas;
    uint96 balance;
    address admin;
    uint64 maxValidBlocknumber;
    address lastKeeper;
  }

  struct KeeperInfo {
    address payee;
    uint96 balance;
    bool active;
  }

  struct Config {
    uint32 paymentPremiumPPB;
    uint24 checkFrequencyBlocks;
    uint32 checkGasLimit;
    uint24 stalenessSeconds;
  }

  event UpkeepRegistered(
    uint256 indexed id,
    uint32 executeGas,
    address admin
  );
  event UpkeepPerformed(
    uint256 indexed id,
    bool indexed success,
    uint96 payment,
    bytes performData
  );
  event UpkeepCanceled(
    uint256 indexed id,
    uint64 indexed atBlockHeight
  );
  event FundsAdded(
    uint256 indexed id,
    address indexed from,
    uint96 amount
  );
  event FundsWithdrawn(
    uint256 indexed id,
    uint256 amount,
    address to
  );
  event ConfigSet(
    uint32 paymentPremiumPPB,
    uint24 checkFrequencyBlocks,
    uint32 checkGasLimit,
    uint24 stalenessSeconds,
    int256 fallbackGasPrice,
    int256 fallbackLinkPrice
  );
  event KeepersUpdated(
    address[] keepers,
    address[] payees
  );
  event PaymentWithdrawn(
    address indexed keeper,
    uint256 indexed amount,
    address indexed to,
    address payee
  );
  event PayeeshipTransferRequested(
    address indexed keeper,
    address indexed from,
    address indexed to
  );
  event PayeeshipTransferred(
    address indexed keeper,
    address indexed from,
    address indexed to
  );

  /*
   * @param link address of the LINK Token
   * @param linkEthFeed address of the LINK/ETH price feed
   * @param fastGasFeed address of the Fast Gas price feed
   * @param paymentPremiumPPB payment premium rate oracles receive on top of
   * being reimbursed for gas, measured in parts per thousand
   * @param checkFrequencyBlocks number of blocks an oracle should wait before
   * checking for upkeep
   * @param checkGasLimit gas limit when checking for upkeep
   * @param stalenessSeconds number of seconds that is allowed for feed data to
   * be stale before switching to the fallback pricing
   * @param fallbackGasPrice gas price used if the gas price feed is stale
   * @param fallbackLinkPrice LINK price used if the LINK price feed is stale
   */
  constructor(
    address link,
    address linkEthFeed,
    address fastGasFeed,
    uint32 paymentPremiumPPB,
    uint24 checkFrequencyBlocks,
    uint32 checkGasLimit,
    uint24 stalenessSeconds,
    int256 fallbackGasPrice,
    int256 fallbackLinkPrice
  )
    public
  {
    LINK = IERC20(link);
    LINK_ETH_FEED = AggregatorV3Interface(linkEthFeed);
    FAST_GAS_FEED = AggregatorV3Interface(fastGasFeed);

    setConfig(
      paymentPremiumPPB,
      checkFrequencyBlocks,
      checkGasLimit,
      stalenessSeconds,
      fallbackGasPrice,
      fallbackLinkPrice
    );
  }


  // ACTIONS

  /*
   * @notice adds a new registration for upkeep
   * @param target address to peform upkeep on
   * @param gasLimit amount of gas to provide the target contract when
   * performing upkeep
   * @param admin address to cancel upkeep and withdraw remaining funds
   * @param checkData data passed to the contract when checking for upkeep
   */
  function registerUpkeep(
    address target,
    uint32 gasLimit,
    address admin,
    bytes calldata checkData
  )
    external
    onlyOwner()
  {
    require(target.isContract(), "target is not a contract");
    require(gasLimit >= CALL_GAS_MIN, "min gas is 2300");
    require(gasLimit <= CALL_GAS_MAX, "max gas is 2500000");

    uint256 id = s_registrationCount;
    s_registrations[id] = Registration({
      target: target,
      executeGas: gasLimit,
      balance: 0,
      admin: admin,
      maxValidBlocknumber: UINT64_MAX,
      lastKeeper: address(0)
    });
    s_checkData[id] = checkData;
    s_registrationCount++;

    emit UpkeepRegistered(id, gasLimit, admin);
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
    (gasWei, linkEth) = getFeedData();
    maxLinkPayment = calculatePaymentAmount(gasLimit, gasWei, linkEth);
    if (registration.balance < maxLinkPayment) {
      return (false, performData, 0, 0, 0, 0);
    }

    bytes memory callData = abi.encodeWithSelector(CHECK_SELECTOR, s_checkData[id]);
    (
      bool success,
      bytes memory result
    ) = registration.target.call{gas: s_config.checkGasLimit}(callData);
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
    validRegistration(id)
    returns (
      bool success
    )
  {
    Registration memory registration = s_registrations[id];
    uint256 gasLimit = registration.executeGas;
    (int256 gasWei, int256 linkEth) = getFeedData();
    uint96 payment = calculatePaymentAmount(gasLimit, gasWei, linkEth);
    if (registration.balance < payment) {
      return false;
    }

    bytes memory callData = abi.encodeWithSelector(PERFORM_SELECTOR, performData);

    return callWithExactGas(gasLimit, registration.target, callData);
  }

  function performUpkeep(
    uint256 id,
    bytes calldata performData
  )
    external
    nonReentrant()
    validateKeeper()
    validRegistration(id)
  {
    Registration memory registration = s_registrations[id];
    uint256 gasLimit = registration.executeGas;
    (int256 gasWei, int256 linkEth) = getFeedData();
    if (gasWei > int256(tx.gasprice)) {
      gasWei = int256(tx.gasprice);
    }
    uint96 payment = calculatePaymentAmount(gasLimit, gasWei, linkEth);
    require(registration.balance >= payment, "!executable");
    require(registration.lastKeeper != msg.sender, "keepers must take turns");

    uint256  gasUsed = gasleft();
    bytes memory callData = abi.encodeWithSelector(PERFORM_SELECTOR, performData);
    bool success = callWithExactGas(gasLimit, registration.target, callData);
    gasUsed = gasUsed - gasleft();

    payment = calculatePaymentAmount(gasUsed, gasWei, linkEth);
    registration.balance = registration.balance.sub(payment);
    registration.lastKeeper = msg.sender;
    s_registrations[id] = registration;
    uint96 newBalance = s_keeperInfo[msg.sender].balance.add(payment);
    s_keeperInfo[msg.sender].balance = newBalance;

    emit UpkeepPerformed(id, success, payment, performData);
  }

  /*
   * @notice prevent an upkeep from being performed in the future
   * @param id upkeep to be canceled
   */
  function cancelUpkeep(
    uint256 id
  )
    external
  {
    require(s_registrations[id].maxValidBlocknumber == UINT64_MAX, "cannot cancel upkeep");
    bool isOwner = msg.sender == owner;
    require(isOwner|| msg.sender == s_registrations[id].admin, "only owner or admin");

    uint256 height = block.number;
    if (!isOwner) {
      height = height.add(CANCELATION_DELAY);
    }
    s_registrations[id].maxValidBlocknumber = uint64(height);
    s_canceledRegistrations.push(id);

    emit UpkeepCanceled(id, uint64(height));
  }

  /*
   * @notice adds LINK funding for an upkeep by tranferring from the sender's
   * LINK balance
   * @param id upkeep to fund
   * @param amount number of LINK to transfer
   */
  function addFunds(
    uint256 id,
    uint96 amount
  )
    external
    validRegistration(id)
  {
    s_registrations[id].balance = s_registrations[id].balance.add(amount);
    LINK.transferFrom(msg.sender, address(this), amount);
    emit FundsAdded(id, msg.sender, amount);
  }

  /*
   * @notice uses LINK's transferAndCall to LINK and add funding to an upkeep
   * @dev safe to cast uint256 to uint96 as total LINK supply is under UINT96MAX
   * @param sender the account which transferred the funds
   * @param amount number of LINK transfer
   */
  function onTokenTransfer(
    address sender,
    uint256 amount,
    bytes calldata data
  )
    external
  {
    require(msg.sender == address(LINK), "only callable through LINK");
    require(data.length == 32, "data must be 32 bytes");
    uint256 id = abi.decode(data, (uint256));
    validateRegistration(id);

    s_registrations[id].balance = s_registrations[id].balance.add(uint96(amount));

    emit FundsAdded(id, sender, uint96(amount));
  }

  /*
   * @notice removes funding from a cancelled upkeep
   * @param id upkeep to withdraw funds from
   * @param amount address to send remaining funds to
   */
  function withdrawFunds(
    uint256 id,
    address to
  )
    external
  {
    require(s_registrations[id].admin == msg.sender, "only callable by admin");
    require(s_registrations[id].maxValidBlocknumber <= block.number, "registration must be canceled");

    uint256 amount = s_registrations[id].balance;
    s_registrations[id].balance = 0;
    emit FundsWithdrawn(id, amount, to);

    LINK.transfer(to, amount);
  }

  /*
   * @notice withdraws a keeper's payment, callable only by the keeper's payee
   * @param from keeper address
   * @param to address to send the payment to
   */
  function withdrawPayment(
    address from,
    address to
  )
    external
  {
    KeeperInfo memory keeper = s_keeperInfo[from];
    require(keeper.payee == msg.sender, "only callable by payee");

    s_keeperInfo[from].balance = 0;
    emit PaymentWithdrawn(from, keeper.balance, to, msg.sender);

    LINK.transfer(to, keeper.balance);
  }

  /*
   * @notice proposes the safe transfer of a keeper's payee to another address
   * @param keeper address of the keeper to transfer payee role
   * @param to address transfer payee role to
   */
  function transferPayeeship(
    address keeper,
    address proposed
  )
    external
  {
    require(s_keeperInfo[keeper].payee == msg.sender, "only callable by payee");
    require(proposed != msg.sender, "cannot transfer to self");

    if (s_proposedPayee[keeper] != proposed) {
      s_proposedPayee[keeper] = proposed;
      emit PayeeshipTransferRequested(keeper, msg.sender, proposed);
    }
  }

  /*
   * @notice accepts the safe transfer of payee role for a keeper
   * @param keeper address to accept the payee role for
   */
  function acceptPayeeship(
    address keeper
  )
    external
  {
    require(s_proposedPayee[keeper] == msg.sender, "only callable by proposed payee");
    address past = s_keeperInfo[keeper].payee;
    s_keeperInfo[keeper].payee = msg.sender;
    s_proposedPayee[keeper] = ZERO_ADDRESS;

    emit PayeeshipTransferred(keeper, past, msg.sender);
  }


  // SETTERS

  /*
   * @notice updates the configuration of the registry
   * @param paymentPremiumPPB payment premium rate oracles receive on top of
   * being reimbursed for gas, measured in parts per thousand
   * @param checkFrequencyBlocks number of blocks an oracle should wait before
   * checking for upkeep
   * @param checkGasLimit gas limit when checking for upkeep
   * @param stalenessSeconds number of seconds that is allowed for feed data to
   * be stale before switching to the fallback pricing
   * @param fallbackGasPrice gas price used if the gas price feed is stale
   * @param fallbackLinkPrice LINK price used if the LINK price feed is stale
   */
  function setConfig(
    uint32 paymentPremiumPPB,
    uint24 checkFrequencyBlocks,
    uint32 checkGasLimit,
    uint24 stalenessSeconds,
    int256 fallbackGasPrice,
    int256 fallbackLinkPrice
  )
    onlyOwner()
    public
  {
    s_config = Config({
      paymentPremiumPPB: paymentPremiumPPB,
      checkFrequencyBlocks: checkFrequencyBlocks,
      checkGasLimit: checkGasLimit,
      stalenessSeconds: stalenessSeconds
    });
    s_fallbackGasPrice = fallbackGasPrice;
    s_fallbackLinkPrice = fallbackLinkPrice;

    emit ConfigSet(
      paymentPremiumPPB,
      checkFrequencyBlocks,
      checkGasLimit,
      stalenessSeconds,
      fallbackGasPrice,
      fallbackLinkPrice
    );
  }

  /*
   * @notice update the list of keepers allowed to peform upkeep
   * @param keepers list of addresses allowed to perform upkeep
   * @param payees addreses corresponding to keepers who are allowed to
   * move payments which have been acrued
   */
  function setKeepers(
    address[] calldata keepers,
    address[] calldata payees
  )
    external
    onlyOwner()
  {
    for (uint256 i = 0; i < s_keepers.length; i++) {
      address keeper = s_keepers[i];
      s_keeperInfo[keeper].active = false;
    }
    for (uint256 i = 0; i < keepers.length; i++) {
      address keeper = keepers[i];
      KeeperInfo storage s_keeper = s_keeperInfo[keeper];
      address oldPayee = s_keeper.payee;
      address newPayee = payees[i];
      require(oldPayee == ZERO_ADDRESS || oldPayee == newPayee, "cannot change payee");
      s_keeper.payee = newPayee;
      s_keeper.active = true;
    }
    s_keepers = keepers;
    emit KeepersUpdated(keepers, payees);
  }


  // GETTERS

  /*
   * @notice read all of the details about an upkeep
   */
  function getUpkeep(
    uint256 id
  )
    external
    view
    returns (
      address target,
      uint32 executeGas,
      uint96 balance,
      address lastKeeper,
      address admin,
      uint64 maxValidBlocknumber,
      bytes memory checkData
    )
  {
    Registration memory reg = s_registrations[id];
    return (
      reg.target,
      reg.executeGas,
      reg.balance,
      reg.lastKeeper,
      reg.admin,
      reg.maxValidBlocknumber,
      reg.checkData
    );
  }

  /*
   * @notice read the total number of upkeep's registered
   */
  function getUpkeepCount()
    external
    view
    returns (
      uint256
    )
  {
    return s_registrationCount;
  }

  function getCanceledUpkeepList()
    external
    view
    returns (
      uint256[] memory
    )
  {
    return s_canceledRegistrations;
  }

  /*
   * @notice read the current list of addresses allowed to perform upkeep
   */
  function getKeepers()
    external
    view
    returns (
      address[] memory
    )
  {
    return s_keepers;
  }

  /*
   * @notice read the current info about any keeper address
   */
  function getKeeperInfo(
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

  /*
   * @notice read the current configuration of the registry
   */
  function getConfig()
    external
    view
    returns (
      uint32 paymentPremiumPPB,
      uint24 checkFrequencyBlocks,
      uint32 checkGasLimit,
      uint24 stalenessSeconds,
      int256 fallbackGasPrice,
      int256 fallbackLinkPrice
    )
  {
    Config memory config = s_config;
    return (
      config.paymentPremiumPPB,
      config.checkFrequencyBlocks,
      config.checkGasLimit,
      config.stalenessSeconds,
      s_fallbackGasPrice,
      s_fallbackLinkPrice
    );
  }


  // PRIVATE

  /*
   * @dev retrieves feed data for fast gas/eth and link/eth prices. if the feed data
   * is stale it uses the configured fallback price. once a price is picked for
   * gas it takes the min of gas price in the transaction or the fast gas price
   * in order to reduce costs for the upkeep clients.
   */
  function getFeedData()
    private
    view
    returns (
      int256 gasWei,
      int256 linkEth
    )
  {
    uint32 stalenessSeconds = s_config.stalenessSeconds;
    bool staleFallback = stalenessSeconds > 0;
    uint256 timestamp;
    (,gasWei,,timestamp,) = FAST_GAS_FEED.latestRoundData();
    if (staleFallback && stalenessSeconds < block.timestamp - timestamp) {
      gasWei = s_fallbackGasPrice;
    }
    (,linkEth,,timestamp,) = LINK_ETH_FEED.latestRoundData();
    if (staleFallback && stalenessSeconds < block.timestamp - timestamp) {
      linkEth = s_fallbackLinkPrice;
    }
    return (gasWei, linkEth);
  }

  /*
   * @dev calculates LINK paid for gas spent plus a configure premium percentage
   */
  function calculatePaymentAmount(
    uint256 gasLimit,
    int256 gasWei,
    int256 linkEth
  )
    private
    view
    returns (
      uint96 payment
    )
  {
    uint256 weiForGas = uint256(gasWei).mul(gasLimit.add(REGISTRY_GAS_OVERHEAD));
    uint256 linkForGas = weiForGas.mul(LINK_DIVISIBILITY).div(uint256(linkEth));
    uint256 premium = linkForGas.mul(s_config.paymentPremiumPPB).div(PPB_BASE);
    uint256 total = linkForGas.add(premium);
    require(total <= LINK_TOTAL_SUPPLY, "payment greater than all LINK");
    return uint96(total); // LINK_TOTAL_SUPPLY < UINT96_MAX
  }

  /*
   * @dev calls target address with exactly gasAmount gas and data as calldata
   * or reverts
   */
  function callWithExactGas(
    uint256 gasAmount,
    address target,
    bytes memory data
  )
    private
    returns (
      bool success
    )
  {
    assembly{
      let g := gas()
      // Compute g -= CUSHION and check for underflow
      if lt(g, CUSHION) { revert(0, 0) }
      g := sub(g, CUSHION)
      // if g - g//64 <= gasAmount, revert
      // (we subtract g//64 because of EIP-150)
      if iszero(gt(sub(g, div(g, 64)), gasAmount)) { revert(0, 0) }
      // solidity calls check that a contract actually exists at the destination, so we do the same
      if iszero(extcodesize(target)) { revert(0, 0) }
      // call and return whether we succeeded. ignore return data
      success := call(gasAmount, target, 0, add(data, 0x20), mload(data), 0, 0)
    }
    return success;
  }

  /*
   * @dev ensures a registration is valid
   */
  function validateRegistration(
    uint256 id
  )
    private
    view
  {
    require(s_registrations[id].maxValidBlocknumber > block.number, "invalid upkeep id");
  }


  // MODIFIERS

  /*
   * @dev ensures a registration is valid
   */
  modifier validRegistration(
    uint256 id
  ) {
    validateRegistration(id);
    _;
  }

  /*
   * @dev ensures a keeper is permissioned to peform upkeep
   */
  modifier validateKeeper()
  {
    require(s_keeperInfo[msg.sender].active, "only active keepers");
    _;
  }

}
