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

  uint256 constant private LINK_DIVISIBILITY = 1e18;
  bytes4 constant private CHECK_SELECTOR = UpkeptInterface.checkForUpkeep.selector;
  bytes4 constant private PERFORM_SELECTOR = UpkeptInterface.performUpkeep.selector;
  uint256 constant private CALL_GAS_MINIMUM = 2300;
  address constant private ZERO_ADDRESS = address(0);

  IERC20 public immutable LINK;
  AggregatorInterface public immutable LINKETH;
  AggregatorInterface public immutable FASTGAS;

  uint256 public registrationCount;
  uint256[] private s_deregistered;
  mapping(uint256 => Registration) public registrations;
  mapping(address => KeeperInfo) private s_keeperInfo;
  address[] private s_keeperList;
  mapping(address => address) private s_proposedPayee;

  struct Registration {
    address target;
    uint32 executeGas;
    uint96 balance;
    address admin;
    bool valid;
    bytes checkData;
  }

  struct KeeperInfo {
    address payee;
    uint96 balance;
    bool active;
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
  event KeeperAdded(
    address indexed keeper,
    address payee
  );
  event KeeperRemoved(
    address indexed keeper
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
      address old = s_keeper.payee;
      address newPayee = payees[i];
      require(old == ZERO_ADDRESS || old == newPayee, "cannot change payee");
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
    require(gasLimit > CALL_GAS_MINIMUM, "below minimum gas");

    uint256 id = registrationCount;
    registrations[id] = Registration({
      target: target,
      executeGas: gasLimit,
      balance: 0,
      admin: admin,
      valid: true,
      checkData: queryData
    });
    registrationCount++;

    emit UpkeepRegistered(id, gasLimit, admin);
  }

  function deregisterUpkeep(
    uint256 id
  )
    external
    onlyOwner()
    validateRegistration(id)
  {
    registrations[id].valid = false;
    s_deregistered.push(id);

    emit UpkeepDeregistered(id);
  }

  function checkForUpkeep(
    uint256 id
  )
    external
    cannotExecute()
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
    (bool success, bytes memory result) = registration.target.call(toCall);
    if (!success) {
      return (false, performData);
    }
    return abi.decode(result, (bool, bytes));
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
    Registration storage s_registration = registrations[id];
    uint256 payment = getPaymentAmount(id);
    if (s_registration.balance < payment) {
      return false;
    }

    bytes memory toCall = abi.encodeWithSelector(PERFORM_SELECTOR, performData);
    (success,) = s_registration.target.call{gas: s_registration.executeGas}(toCall);

    return success;
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
    require(s_keeperInfo[msg.sender].active, "only active keepers");

    uint256 payment = getPaymentAmount(id);
    require(registration.balance >= payment, "!executable");
    s_registration.balance = uint96(uint256(registration.balance).sub(payment));
    uint256 newBalance = uint256(s_keeperInfo[msg.sender].balance).add(payment);
    s_keeperInfo[msg.sender].balance = uint96(newBalance);

    require(gasleft() > registration.executeGas, "!gasleft");
    bytes memory toCall = abi.encodeWithSelector(PERFORM_SELECTOR, performData);
    (bool success,) = registration.target.call{gas: registration.executeGas}(toCall);

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

  function deregistered()
    external
    view
    returns (
      uint256[] memory
    )
  {
    return s_deregistered;
  }

  function balanceFor(
    uint256 id
  )
    external
    view
    returns (
      uint96 balance
    )
  {
    return registrations[id].balance;
  }

  // PRIVATE

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
    // Assuming that the total ETH supply is capped by 2**128 Wei, the maximum
    // intermediate value here is on the order of 2**188 and will therefore
    // always fit a uint256.
    uint256 base = gasPrice.mul(gasLimit).mul(LINK_DIVISIBILITY).div(linkEthPrice);
    return base.add(base.mul(25).div(100));
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
    require(registrations[id].valid, "invalid upkeep id");
    _;
  }

  modifier cannotExecute()
  {
    require(msg.sender == ZERO_ADDRESS, "only for reading");
    _;
  }

}
