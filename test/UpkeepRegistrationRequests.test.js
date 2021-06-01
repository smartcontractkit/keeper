const KeeperRegistry = artifacts.require("KeeperRegistry");
const UpkeepRegistrationRequests = artifacts.require(
  "UpkeepRegistrationRequests"
);

const UpkeepMock = artifacts.require("UpkeepMock");
const { LinkToken } = require("@chainlink/contracts/truffle/v0.4/LinkToken");
const {
  MockV3Aggregator,
} = require("@chainlink/contracts/truffle/v0.6/MockV3Aggregator");
const {
  BN,
  constants,
  ether,
  expectEvent,
  expectRevert,
  time,
} = require("@openzeppelin/test-helpers");

contract("UpkeepRegistrationRequests", (accounts) => {
  const owner = accounts[0];
  const admin = accounts[1];
  const someAddress = accounts[2];
  const registrarOwner = accounts[3];
  const linkEth = new BN(300000000);
  const gasWei = new BN(100);
  const executeGas = new BN(100000);
  const source = new BN(100);
  const paymentPremiumPPB = new BN(250000000);

  const window_big = new BN(1000);
  const window_small = new BN(2);
  const threshold_big = new BN(1000);
  const threshold_small = new BN(5);

  const blockCountPerTurn = new BN(3);
  const emptyBytes = "0x00";
  const stalenessSeconds = new BN(43820);
  const gasCeilingMultiplier = new BN(1)
  const maxCheckGas = new BN(20000000);
  const fallbackGasPrice = new BN(200);
  const fallbackLinkPrice = new BN(200000000);
  const minLINKJuels = new BN(1000000000000000000n);
  const amount = new BN(5000000000000000000n);
  const amount1 = new BN(6000000000000000000n);

  let linkToken, linkEthFeed, gasPriceFeed, registry, mock;

  beforeEach(async () => {
    LinkToken.setProvider(web3.currentProvider);
    MockV3Aggregator.setProvider(web3.currentProvider);
    linkToken = await LinkToken.new({ from: owner });
    gasPriceFeed = await MockV3Aggregator.new(0, gasWei, { from: owner });
    linkEthFeed = await MockV3Aggregator.new(9, linkEth, { from: owner });
    registry = await KeeperRegistry.new(
      linkToken.address,
      linkEthFeed.address,
      gasPriceFeed.address,
      paymentPremiumPPB,
      blockCountPerTurn,
      maxCheckGas,
      stalenessSeconds,
      gasCeilingMultiplier,
      fallbackGasPrice,
      fallbackLinkPrice,
      { from: owner }
    );

    mock = await UpkeepMock.new();

    registrar = await UpkeepRegistrationRequests.new(
      linkToken.address,
      minLINKJuels,
      { from: registrarOwner }
    );

    await registry.setRegistrar(registrar.address);
  });

  describe("#register", () => {
    const upkeepName = "SampleUpkeep";

    it("reverts if not called by the LINK token", async () => {
      await expectRevert(
        registrar.register(
          upkeepName,
          emptyBytes,
          mock.address,
          executeGas,
          admin,
          emptyBytes,
          amount,
          source,
          { from: someAddress }
        ),
        "Must use LINK token"
      );
    });

    it("reverts if the amount passed in data mismatches actual amount sent", async () => {
      //get current upkeep count
      const upkeepCount = await registry.getUpkeepCount();

      //set auto approve ON with high threshold limits
      await registrar.setRegistrationConfig(
        true,
        window_small,
        threshold_big,
        registry.address,
        minLINKJuels,
        { from: registrarOwner }
      );

      //register with auto approve ON
      let abiEncodedBytes = registrar.contract.methods
        .register(
          upkeepName,
          emptyBytes,
          mock.address,
          executeGas,
          admin,
          emptyBytes,
          amount1,
          source
        )
        .encodeABI();

      await expectRevert(
        linkToken.transferAndCall(
          registrar.address,
          amount,
          abiEncodedBytes
        ),
        "Amount mismatch"
      );

    });

    it("Auto Approve ON - registers an upkeep on KeeperRegistry instantly and emits both RegistrationRequested and RegistrationApproved events", async () => {
      //get current upkeep count
      const upkeepCount = await registry.getUpkeepCount();

      //set auto approve ON with high threshold limits
      await registrar.setRegistrationConfig(
        true,
        window_small,
        threshold_big,
        registry.address,
        minLINKJuels,
        { from: registrarOwner }
      );

      //register with auto approve ON
      let abiEncodedBytes = registrar.contract.methods
        .register(
          upkeepName,
          emptyBytes,
          mock.address,
          executeGas,
          admin,
          emptyBytes,
          amount,
          source
        )
        .encodeABI();
      const { receipt } = await linkToken.transferAndCall(
        registrar.address,
        amount,
        abiEncodedBytes
      );

      //confirm if a new upkeep has been registered and the details are the same as the one just registered
      const newupkeep = await registry.getUpkeep(upkeepCount);
      assert.equal(newupkeep.target, mock.address);
      assert.equal(newupkeep.admin, admin);
      assert.equal(newupkeep.checkData, emptyBytes);
      assert.equal(newupkeep.balance.toString(), amount.toString());
      assert.isTrue(newupkeep.executeGas.eq(executeGas));

      //confirm if RegistrationRequested and RegistrationApproved event are received
      let event_RegistrationRequested = receipt.rawLogs.some((l) => {
        return (
          l.topics[0] ==
          web3.utils.keccak256(
            "RegistrationRequested(bytes32,string,bytes,address,uint32,address,bytes,uint96,uint8)"
          )
        );
      });
      assert.ok(
        event_RegistrationRequested,
        "RegistrationRequested event not emitted"
      );

      let event_RegistrationApproved = receipt.rawLogs.some((l) => {
        return (
          l.topics[0] ==
          web3.utils.keccak256("RegistrationApproved(bytes32,string,uint256)")
        );
      });
      assert.ok(
        event_RegistrationApproved,
        "RegistrationApproved event not emitted"
      );
    });

    it("Auto Approve OFF - does not registers an upkeep on KeeperRegistry, emits only RegistrationRequested event", async () => {
      //get upkeep count before attempting registration
      const beforeCount = await registry.getUpkeepCount();

      //set auto approve OFF, threshold limits dont matter in this case
      await registrar.setRegistrationConfig(
        false,
        window_small,
        threshold_big,
        registry.address,
        minLINKJuels,
        { from: registrarOwner }
      );

      //register with auto approve OFF
      let abiEncodedBytes = registrar.contract.methods
        .register(
          upkeepName,
          emptyBytes,
          mock.address,
          executeGas,
          admin,
          emptyBytes,
          amount,
          source
        )
        .encodeABI();
      const { receipt } = await linkToken.transferAndCall(
        registrar.address,
        amount,
        abiEncodedBytes
      );

      //get upkeep count after attempting registration
      const afterCount = await registry.getUpkeepCount();
      //confirm that a new upkeep has NOT been registered and upkeep count is still the same
      assert.deepEqual(beforeCount, afterCount);

      //confirm that only RegistrationRequested event is amitted and RegistrationApproved event is not
      let event_RegistrationRequested = receipt.rawLogs.some((l) => {
        return (
          l.topics[0] ==
          web3.utils.keccak256(
            "RegistrationRequested(bytes32,string,bytes,address,uint32,address,bytes,uint96,uint8)"
          )
        );
      });
      assert.ok(
        event_RegistrationRequested,
        "RegistrationRequested event not emitted"
      );

      let event_RegistrationApproved = receipt.rawLogs.some((l) => {
        return (
          l.topics[0] ==
          web3.utils.keccak256("RegistrationApproved(bytes32,string,uint256)")
        );
      });
      assert.ok(
        !event_RegistrationApproved,
        "RegistrationApproved event should not be emitted"
      );
    });

    it("Auto Approve ON - Throttle max approvals - does not registers an upkeep on KeeperRegistry beyond the throttle limit, emits only RegistrationRequested event after throttle starts", async () => {
      //get upkeep count before attempting registration
      const beforeCount = await registry.getUpkeepCount();

      //set auto approve on, with low threshold limits
      await registrar.setRegistrationConfig(
        true,
        window_big,
        threshold_small,
        registry.address,
        minLINKJuels,
        { from: registrarOwner }
      );

      let abiEncodedBytes = registrar.contract.methods
        .register(
          upkeepName,
          emptyBytes,
          mock.address,
          executeGas,
          admin,
          emptyBytes,
          amount,
          source
        )
        .encodeABI();

      //register within threshold, new upkeep should be registered
      await linkToken.transferAndCall(
        registrar.address,
        amount,
        abiEncodedBytes
      );
      const intermediateCount = await registry.getUpkeepCount();
      //make sure 1 upkeep was registered
      assert.equal(beforeCount.toNumber() + 1, intermediateCount.toNumber());

      //try registering more than threshold(say 2x), new upkeeps should not be registered after the threshold amount is reached
      for (let step = 0; step < threshold_small * 2; step++) {
        await linkToken.transferAndCall(
          registrar.address,
          amount,
          abiEncodedBytes
        );
      }
      const afterCount = await registry.getUpkeepCount();
      //count of newly registered upkeeps should be equal to the threshold set for auto approval
      const newRegistrationsCount = afterCount.toNumber() - beforeCount.toNumber();
      assert(newRegistrationsCount == threshold_small,"Registrations beyond threshold");
    });
  });
});
