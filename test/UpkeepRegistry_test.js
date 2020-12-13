const UpkeepRegistry = artifacts.require('UpkeepRegistry')
const UpkeptMock = artifacts.require('UpkeptMock')
const UpkeptReverter = artifacts.require('UpkeptReverter')
const { LinkToken } = require('@chainlink/contracts/truffle/v0.4/LinkToken')
const { MockV3Aggregator } = require('@chainlink/contracts/truffle/v0.6/MockV3Aggregator')
const { BN, constants, ether, expectEvent, expectRevert, time } = require('@openzeppelin/test-helpers')

contract('UpkeepRegistry', (accounts) => {
  const owner = accounts[0]
  const keeper1 = accounts[1]
  const keeper2 = accounts[2]
  const keeper3 = accounts[3]
  const nonkeeper = accounts[4]
  const admin = accounts[5]
  const payee1 = accounts[6]
  const payee2 = accounts[7]
  const payee3 = accounts[8]
  const keepers = [keeper1, keeper2, keeper3]
  const payees = [payee1, payee2, payee3]
  const linkEth = new BN(300000000)
  const gasWei = new BN(100)
  const linkDivisibility = new BN("1000000000000000000")
  const executeGas = new BN('100000')
  const paymentPremiumPPT = new BN('25000')
  const paymentPremiumBase = new BN('100000')
  const checkFrequencyBlocks = new BN(3)
  const emptyBytes = '0x00'
  const zeroAddress = constants.ZERO_ADDRESS
  const extraGas = new BN('250000')
  const registryGasOverhead = new BN('65000')
  const stalenessSeconds = new BN(43820)
  const maxCheckGas = new BN(20000000)
  const fallbackGasPrice = new BN(600000000)
  const fallbackLinkPrice = new BN(200)
  let linkToken, linkEthFeed, gasPriceFeed, registry, mock, id

  linkForGas = (upkeepGasSpent) => {
    const gasSpent = registryGasOverhead.add(new BN(upkeepGasSpent))
    const base = gasWei.mul(gasSpent).mul(linkDivisibility).div(linkEth)
    const premium = base.mul(paymentPremiumPPT).div(paymentPremiumBase)
    return base.add(premium)
  }

  beforeEach(async () => {
    LinkToken.setProvider(web3.currentProvider)
    MockV3Aggregator.setProvider(web3.currentProvider)
    linkToken = await LinkToken.new({ from: owner })
    gasPriceFeed = await MockV3Aggregator.new(0, gasWei, { from: owner })
    linkEthFeed = await MockV3Aggregator.new(9, linkEth, { from: owner })
    registry = await UpkeepRegistry.new(
      linkToken.address,
      linkEthFeed.address,
      gasPriceFeed.address,
      paymentPremiumPPT,
      checkFrequencyBlocks,
      maxCheckGas,
      stalenessSeconds,
      fallbackGasPrice,
      fallbackLinkPrice,
      { from: owner }
    )
    mock = await UpkeptMock.new()
    await linkToken.transfer(keeper1, ether('100'), { from: owner })
    await linkToken.transfer(keeper2, ether('100'), { from: owner })
    await linkToken.transfer(keeper3, ether('100'), { from: owner })

    await registry.setKeepers(keepers, payees, {from: owner})
    const { receipt } = await registry.registerUpkeep(
      mock.address,
      executeGas,
      admin,
      emptyBytes,
      { from: owner }
    )
    id = receipt.logs[0].args.id
  })

  describe('#setKeepers', () => {
    it('reverts when not called by the owner', async () => {
      await expectRevert(
        registry.setKeepers([], [], {from: keeper1}),
        "Only callable by owner"
      )
    })

    it('emits events for every keeper added and removed', async () => {
      const oldKeepers = [keeper1, keeper2]
      const oldPayees = [payee1, payee2]
      await registry.setKeepers(oldKeepers, oldPayees, {from: owner})
      assert.deepEqual(oldKeepers, await registry.getKeepers())

      // remove keepers
      const newKeepers = [keeper2, keeper3]
      const newPayees = [payee2, payee3]
      const { receipt } = await registry.setKeepers(newKeepers, newPayees, {from: owner})
      assert.deepEqual(newKeepers, await registry.getKeepers())

      expectEvent(receipt, 'KeepersUpdated', {
        keepers: newKeepers,
        payees: newPayees
      })
    })

    it('updates the keeper to inactive when removed', async () => {
      await registry.setKeepers(keepers, payees, {from: owner})
      await registry.setKeepers([keeper1], [payee1], {from: owner})
      const added = await registry.getKeeperInfo(keeper1)
      assert.isTrue(added.active)
      const removed = await registry.getKeeperInfo(keeper2)
      assert.isFalse(removed.active)
    })

    it('reverts if the owner changes the payee', async () => {
      await registry.setKeepers(keepers, payees, {from: owner})
      await expectRevert(
        registry.setKeepers(keepers, [payee1, payee2, owner], {from: owner}),
        "cannot change payee"
      )
    })
  })

  describe('#registerUpkeep', () => {
    it('reverts if the target is not a contract', async () => {
      await expectRevert(
        registry.registerUpkeep(
          zeroAddress,
          executeGas,
          admin,
          emptyBytes,
          { from: owner }
        ),
        'target is not a contract'
      )
    })

    it('reverts if called by a non-owner', async () => {
      const reverter = await UpkeptReverter.new()
      await expectRevert(
        registry.registerUpkeep(
          reverter.address,
          executeGas,
          admin,
          emptyBytes,
          { from: keeper1 }
        ),
        'Only callable by owner'
      )
    })

    it('reverts if execute gas is too low', async () => {
      await expectRevert(
        registry.registerUpkeep(
          mock.address,
          2299,
          admin,
          emptyBytes,
          { from: owner }
        ),
        'min gas is 2300'
      )
    })


    it('reverts if execute gas is too high', async () => {
      const reverter = await UpkeptReverter.new()
      await expectRevert(
        registry.registerUpkeep(
          mock.address,
          2500001,
          admin,
          emptyBytes,
          { from: owner }
        ),
        'max gas is 2500000'
      )
    })

    it('creates a record of the registration', async () => {
      const { receipt } = await registry.registerUpkeep(
        mock.address,
        executeGas,
        admin,
        emptyBytes,
        { from: owner }
      )
      id = receipt.logs[0].args.id
      expectEvent(receipt, 'UpkeepRegistered', {
        id: id,
        executeGas: executeGas
      })
      const registration = await registry.getRegistration(id)
      assert.equal(mock.address, registration.target)
      assert.equal(0, registration.balance)
      assert.equal(emptyBytes, registration.checkData)
      assert.equal(0xffffffffffffffff, registration.validUntilHeight)
    })
  })

  describe('#addFunds', () => {
    beforeEach(async () => {
      await linkToken.approve(registry.address, ether('100'), { from: keeper1 })
    })

    it('reverts if the registration does not exist', async () => {
      await expectRevert(
        registry.addFunds(id + 1, ether('1'), { from: keeper1 }),
        'invalid upkeep id'
      )
    })

    it('adds to the balance of the registration', async () => {
      await registry.addFunds(id, ether('1'), { from: keeper1 })
      const registration = await registry.getRegistration(id)
      assert.isTrue(ether('1').eq(registration.balance))
    })
  })

  describe('#checkForUpkeep', () => {
    it('returns false if the upkeep is not funded', async () => {
      const check = await registry.checkForUpkeep.call(id, {from: zeroAddress})
      assert.isFalse(check.canPerform)
    })

    context('when the registration is funded', () => {
      beforeEach(async () => {
        await linkToken.approve(registry.address, ether('100'), { from: keeper1 })
        await registry.addFunds(id, ether('100'), { from: keeper1 })
      })

      it('returns false if the target cannot execute', async () => {
        const mockResponse = await mock.checkForUpkeep.call("0x")
        assert.isFalse(mockResponse.callable)
        const check = await registry.checkForUpkeep.call(id, { from: zeroAddress })
        assert.isFalse(check.canPerform)
      })

      it('returns true with pricing info if the target can execute', async () => {
        await mock.setCanExecute(true)
        const mockResponse = await mock.checkForUpkeep.call("0x")
        assert.isTrue(mockResponse.callable)
        const check = await registry.checkForUpkeep.call(id, {from: zeroAddress})

        assert.isTrue(check.canPerform)
        assert.isTrue(check.gasLimit.eq(executeGas))
        assert.isTrue(check.linkEth.eq(linkEth))
        assert.isTrue(check.gasWei.eq(gasWei))
        assert.isTrue(check.maxLinkPayment.eq(linkForGas(executeGas)))
      })

      it('reverts if executed', async () => {
        await mock.setCanExecute(true)
        await expectRevert(
          registry.checkForUpkeep(id),
          'only for simulated backend'
        )
      })

      describe.skip("truffle troubles", () => {
        // Truffle appears to be having trouble with calls that specify they
        // are from the zero address. If I comment out the modifier that
        // enforces use of the zero address, the calls that don't use the zero
        // address pass. I believe these tests are good, but limited by Truffle
        // at the moment so I'm markig them as skipped.
        it("reverts if the gas price feed is stale", async () => {
          const roundId = 99
          const answer = 42
          const updatedAt = 946684800
          const startedAt = 946684799
          await gasPriceFeed.updateRoundData(roundId, answer, updatedAt, startedAt, {from: owner})

          await expectRevert(
            registry.checkForUpkeep.call(id),
            //registry.checkForUpkeep.call(id, {from: zeroAddress}),
            "stale GAS/ETH data"
          )
        })

        it("reverts if the link price feed is stale", async () => {
          const roundId = 99
          const answer = 42
          const updatedAt = 946684800
          const startedAt = 946684799
          await linkEthFeed.updateRoundData(roundId, answer, updatedAt, startedAt, {from: owner})

          await expectRevert(
            registry.checkForUpkeep.call(id),
            //registry.checkForUpkeep.call(id, {from: zeroAddress}),
            "stale LINK/ETH data"
          )
        })
      })
    })
  })

  describe('#tryUpkeep', () => {
    it('returns false if the registration is not funded', async () => {
      assert.isFalse(await registry.tryUpkeep.call(id, "0x00", { from: zeroAddress }))
    })

    context('when the registration is funded', () => {
      beforeEach(async () => {
        await linkToken.approve(registry.address, ether('100'), { from: owner })
        await registry.addFunds(id, ether('100'), { from: owner })
      })

      it('reverts if the target cannot execute', async () => {
        assert.isFalse(await registry.tryUpkeep.call(id, "0x00", { from: zeroAddress }))
      })

      describe('when the target can execute', () => {
        beforeEach(async () => {
          await mock.setCanExecute(true)
        })

        it('returns true if called', async () => {
          assert.isTrue(await registry.tryUpkeep.call(id, "0x", {from: zeroAddress}))
        })

        it('reverts if executed', async () => {
          await expectRevert(
            registry.tryUpkeep(id, "0x"),
            'only for simulated backend'
          )
        })
      })
    })
  })

  describe('#performUpkeep', () => {
    it('reverts if the registration is not funded', async () => {
      await expectRevert(
        registry.performUpkeep(id, "0x", { from: keeper2 }),
        '!executable'
      )
    })

    context('when the registration is funded', () => {
      beforeEach(async () => {
        await linkToken.approve(registry.address, ether('100'), { from: owner })
        await registry.addFunds(id, ether('100'), { from: owner })
      })

      it('does not revert if the target cannot execute', async () => {
        const mockResponse = await mock.checkForUpkeep.call("0x")
        assert.isFalse(mockResponse.callable)

        await registry.performUpkeep(id, "0x", { from: keeper3 })
      })

      it('reverts if not enough gas supplied', async () => {
        await mock.setCanExecute(true)
        const mockResponse = await mock.checkForUpkeep.call("0x")
        assert.isTrue(mockResponse.callable)
        await expectRevert(
          registry.performUpkeep(id, "0x", { from: keeper1, gas: new BN('120000') }),
          '!gasleft'
        )
      })

      it('executes the data passed to the registry', async () => {
        await mock.setCanExecute(true)
        let mockResponse = await mock.checkForUpkeep.call("0x")
        assert.isTrue(mockResponse.callable)

        const performData = "0xc0ffeec0ffee"
        const tx = await registry.performUpkeep(id, performData, { from: keeper1, gas: extraGas })

        expectEvent(tx.receipt, 'UpkeepPerformed', {
          success: true,
          performData: performData
        })
        mockResponse = await mock.checkForUpkeep.call("0x")
        assert.isFalse(mockResponse.callable) // updated contract state
      })

      it('updates payment balances', async () => {
        const keeperBefore = await registry.getKeeperInfo(keeper1)
        const registrationBefore = await registry.getRegistration(id)
        const keeperLinkBefore = await linkToken.balanceOf(keeper1)
        const registryLinkBefore = await linkToken.balanceOf(registry.address)

        //// Do the thing
        await registry.performUpkeep(id, "0x", { from: keeper1 })

        const keeperAfter = await registry.getKeeperInfo(keeper1)
        const registrationAfter = await registry.getRegistration(id)
        const keeperLinkAfter = await linkToken.balanceOf(keeper1)
        const registryLinkAfter = await linkToken.balanceOf(registry.address)

        assert.isTrue(keeperAfter.balance.gt(keeperBefore.balance))
        assert.isTrue(registrationBefore.balance.gt(registrationAfter.balance))
        assert.isTrue(keeperLinkAfter.eq(keeperLinkBefore))
        assert.isTrue(registryLinkBefore.eq(registryLinkAfter))
      })

      it('only pays for gas used', async () => {
        const before = (await registry.getKeeperInfo(keeper1)).balance
        const { receipt } = await registry.performUpkeep(id, "0x", { from: keeper1 })
        const after = (await registry.getKeeperInfo(keeper1)).balance

        const max = linkForGas(executeGas)
        const totalTx = linkForGas(receipt.gasUsed)
        const difference = after.sub(before)
        assert.isTrue(max.gt(totalTx))
        assert.isTrue(totalTx.gt(difference))
        assert.isTrue(linkForGas(2889).eq(difference)) // likely flaky
      })

      it('pays the caller even if the target function fails', async () => {
        const { receipt } = await registry.registerUpkeep(
          mock.address,
          executeGas,
          admin,
          emptyBytes,
          { from: owner }
        )
        const id = receipt.logs[0].args.id
        await linkToken.approve(registry.address, ether('100'), { from: owner })
        await registry.addFunds(id, ether('100'), { from: owner })
        const keeperBalanceBefore = (await registry.getKeeperInfo(keeper1)).balance

        // Do the thing
        const tx = await registry.performUpkeep(id, "0x", { from: keeper1 })

        const keeperBalanceAfter = (await registry.getKeeperInfo(keeper1)).balance
        assert.isTrue(keeperBalanceAfter.gt(keeperBalanceBefore))
      })

      it('reverts if the upkeep is called by a non-keeper', async () => {
        await expectRevert(
          registry.performUpkeep(id, "0x", { from: nonkeeper }),
          'only active keepers'
        )
      })

      it('reverts if the upkeep has been canceled', async () => {
        await mock.setCanExecute(true)

        await registry.cancelRegistration(id, { from: owner })

        await expectRevert(
          registry.performUpkeep(id, "0x", { from: keeper1 }),
          'invalid upkeep id'
        )
      })
    })
  })

  describe('#withdrawFunds', () => {
    beforeEach(async () => {
      await linkToken.approve(registry.address, ether('100'), { from: keeper1 })
      await registry.addFunds(id, ether('1'), { from: keeper1 })
    })

    it('reverts if called by anyone but the admin', async () => {
      await expectRevert(
        registry.withdrawFunds(id + 1, ether('1'), payee1, { from: owner }),
        'only callable by admin'
      )
    })

    it('reverts if called on an uncanceled registration', async () => {
      await expectRevert(
        registry.withdrawFunds(id, ether('1'), payee1, { from: admin }),
        'registration must be canceled'
      )
    })

    describe("after the registration is cancelled", () => {
      beforeEach(async () => {
        await registry.cancelRegistration(id, { from: owner })
      })

      it('reverts if called with more than available balance', async () => {
        await expectRevert(
          registry.withdrawFunds(id, ether('2'), payee1, { from: admin }),
          'SafeMath: subtraction overflow'
        )
      })

      it('moves the funds out and updates the balance', async () => {
        const payee1Before = await linkToken.balanceOf(payee1)
        const registryBefore = await linkToken.balanceOf(registry.address)

        let registration = await registry.getRegistration(id)
        assert.isTrue(ether('1').eq(registration.balance))

        await registry.withdrawFunds(id, ether('1'), payee1, { from: admin })

        const payee1After = await linkToken.balanceOf(payee1)
        const registryAfter = await linkToken.balanceOf(registry.address)

        assert.isTrue(payee1Before.add(ether('1')).eq(payee1After))
        assert.isTrue(registryBefore.sub(ether('1')).eq(registryAfter))

        registration = await registry.getRegistration(id)
        assert.equal(0, registration.balance)
      })
    })
  })

  describe('#cancelRegistration', () => {
    it('reverts if the ID is not valid', async () => {
      await expectRevert(
        registry.cancelRegistration(id + 1, { from: owner }),
        'invalid upkeep id'
      )
    })

    it('reverts if called by a non-owner/non-admin', async () => {
      await expectRevert(
        registry.cancelRegistration(id, { from: keeper1 }),
        'only owner or admin'
      )
    })

    describe("when called by the owner", async () => {
      it('sets the registration to invalid immediately', async () => {
        const { receipt } = await registry.cancelRegistration(id, { from: owner })

        const registration = await registry.getRegistration(id)
        assert.equal(registration.validUntilHeight.toNumber(), receipt.blockNumber)
      })

      it('emits an event', async () => {
        const { receipt } = await registry.cancelRegistration(id, { from: owner })

        expectEvent(receipt, 'RegistrationCanceled', {
          id: id,
          atBlockHeight: new BN(receipt.blockNumber)
        })
      })

      it('updates the canceled registrations list', async () => {
        let canceled = await registry.getCanceledRegistrations.call()
        assert.deepEqual([], canceled)

        await registry.cancelRegistration(id, { from: owner })

        canceled = await registry.getCanceledRegistrations.call()
        assert.deepEqual([id], canceled)
      })

      it('immediately prevents upkeep', async () => {
        await registry.cancelRegistration(id, { from: owner })

        await expectRevert(
          registry.performUpkeep(id, "0x", { from: keeper2 }),
          'invalid upkeep id'
        )
      })
    })

    describe("when called by the admin", async () => {
      const delay = 50

      it('sets the registration to invalid in 50 blocks', async () => {
        const { receipt } = await registry.cancelRegistration(id, { from: admin })
        const registration = await registry.getRegistration(id)
        assert.isFalse(registration.validUntilHeight.eq(receipt.blockNumber + 50))
      })

      it('emits an event', async () => {
        const { receipt } = await registry.cancelRegistration(id, { from: admin })
        expectEvent(receipt, 'RegistrationCanceled', {
          id: id,
          atBlockHeight: new BN(receipt.blockNumber + delay)
        })
      })

      it('updates the canceled registrations list', async () => {
        let canceled = await registry.getCanceledRegistrations.call()
        assert.deepEqual([], canceled)

        await registry.cancelRegistration(id, { from: admin })

        canceled = await registry.getCanceledRegistrations.call()
        assert.deepEqual([id], canceled)
      })

      it('immediately prevents upkeep', async () => {
        await linkToken.approve(registry.address, ether('100'), { from: owner })
        await registry.addFunds(id, ether('100'), { from: owner })
        await registry.cancelRegistration(id, { from: admin })
        await registry.performUpkeep(id, "0x", { from: keeper2 }) // still works

        for (let i = 0; i < delay; i++) {
          await time.advanceBlock()
        }

        await expectRevert(
          registry.performUpkeep(id, "0x", { from: keeper2 }),
          'invalid upkeep id'
        )
      })
    })
  })

  describe('#withdrawPayment', () => {
    beforeEach(async () => {
      await linkToken.approve(registry.address, ether('100'), { from: owner })
      await registry.addFunds(id, ether('100'), { from: owner })
      await registry.performUpkeep(id, "0x", { from: keeper1 })
    })

    it("reverts if called by anyone but the payee", async () => {
      await expectRevert(
        registry.withdrawPayment(keeper1, nonkeeper, { from: payee2 }),
        "only callable by payee"
      )
    })

    it("updates the balances", async () => {
      const to = nonkeeper
      const keeperBefore = (await registry.getKeeperInfo(keeper1)).balance
      const registrationBefore = (await registry.getRegistration(id)).balance
      const toLinkBefore = await linkToken.balanceOf(to)
      const registryLinkBefore = await linkToken.balanceOf(registry.address)

      //// Do the thing
      await registry.withdrawPayment(keeper1, nonkeeper, { from: payee1 })

      const keeperAfter = (await registry.getKeeperInfo(keeper1)).balance
      const registrationAfter = (await registry.getRegistration(id)).balance
      const toLinkAfter = await linkToken.balanceOf(to)
      const registryLinkAfter = await linkToken.balanceOf(registry.address)

      assert.isTrue(keeperAfter.eq(new BN(0)))
      assert.isTrue(registrationBefore.eq(registrationAfter))
      assert.isTrue(toLinkBefore.add(keeperBefore).eq(toLinkAfter))
      assert.isTrue(registryLinkBefore.sub(keeperBefore).eq(registryLinkAfter))
    })

    it("emits a log announcing the withdrawal", async () => {
      const balance = (await registry.getKeeperInfo(keeper1)).balance
      const { receipt } = await registry.withdrawPayment(
        keeper1, nonkeeper, { from: payee1 }
      )

      expectEvent(receipt, 'PaymentWithdrawn', {
        keeper: keeper1,
        amount: balance,
        to: nonkeeper,
        payee: payee1,
      })
    })
  })

  describe('#transferPayeeship', () => {
    it("reverts when called by anyone but the current payee", async () => {
      await expectRevert(
        registry.transferPayeeship(keeper1, payee2, { from: payee2 }),
        "only callable by payee"
      )
    })

    it("reverts when transferring to self", async () => {
      await expectRevert(
        registry.transferPayeeship(keeper1, payee1, { from: payee1 }),
        "cannot transfer to self"
      )
    })

    it("does not change the payee", async () => {
      await registry.transferPayeeship(keeper1, payee2, { from: payee1 })

      const info = await registry.getKeeperInfo(keeper1)
      assert.equal(payee1, info.payee)
    })

    it("emits an event announcing the new payee", async () => {
      const { receipt } = await registry.transferPayeeship(keeper1, payee2, { from: payee1 })

      expectEvent(receipt, 'PayeeshipTransferRequested', {
        keeper: keeper1,
        from: payee1,
        to: payee2,
      })
    })

    it("does not emit an event when called with the same proposal", async () => {
      await registry.transferPayeeship(keeper1, payee2, { from: payee1 })

      const { receipt } = await registry.transferPayeeship(keeper1, payee2, { from: payee1 })

      assert.equal(0, receipt.logs.length)
    })
  })

  describe('#acceptPayeeship', () => {
    beforeEach(async () => {
      await registry.transferPayeeship(keeper1, payee2, { from: payee1 })
    })

    it("reverts when called by anyone but the proposed payee", async () => {
      await expectRevert(
        registry.acceptPayeeship(keeper1, { from: payee1 }),
        "only callable by proposed payee"
      )
    })

    it("emits an event announcing the new payee", async () => {
      const { receipt } = await registry.acceptPayeeship(keeper1, { from: payee2 })

      expectEvent(receipt, 'PayeeshipTransferred', {
        keeper: keeper1,
        from: payee1,
        to: payee2,
      })
    })

    it("does change the payee", async () => {
      await registry.acceptPayeeship(keeper1, { from: payee2 })

      const info = await registry.getKeeperInfo(keeper1)
      assert.equal(payee2, info.payee)
    })
  })

  describe('#setConfig', () => {
    const payment = new BN(1)
    const checks = new BN(2)
    const staleness = new BN(3)
    const maxGas = new BN(4)
    const fbGasEth = new BN(5)
    const fbLinkEth = new BN(6)

    it("reverts when called by anyone but the proposed owner", async () => {
      await expectRevert(
        registry.setConfig(
          payment,
          checks,
          maxGas,
          staleness,
          fbGasEth,
          fbLinkEth,
          { from: payee1 }
        ),
        "Only callable by owner"
      )
    })

    it("updates the config", async () => {
      const old = await registry.getConfig()
      assert.isTrue(paymentPremiumPPT.eq(old.paymentPremiumPPT))
      assert.isTrue(checkFrequencyBlocks.eq(old.checkFrequencyBlocks))
      assert.isTrue(stalenessSeconds.eq(old.stalenessSeconds))

      await registry.setConfig(
        payment,
        checks,
        maxGas,
        staleness,
        fbGasEth,
        fbLinkEth,
        { from: owner }
      )

      const updated = await registry.getConfig()
      assert.isTrue(updated.paymentPremiumPPT.eq(payment))
      assert.isTrue(updated.checkFrequencyBlocks.eq(checks))
      assert.isTrue(updated.stalenessSeconds.eq(staleness))
      assert.isTrue(updated.checkMaxGas.eq(maxGas))
      assert.isTrue(updated.fallbackGasPrice.eq(fbGasEth))
      assert.isTrue(updated.fallbackLinkPrice.eq(fbLinkEth))
    })

    it("emits an event", async () => {
      const { receipt } = await registry.setConfig(
        payment,
        checks,
        maxGas,
        staleness,
        fbGasEth,
        fbLinkEth,
        { from: owner }
      )
      expectEvent(receipt, 'ConfigSet', {
        paymentPremiumPPT: payment,
        checkFrequencyBlocks: checks,
        checkMaxGas: maxGas,
        stalenessSeconds: staleness,
        fallbackGasPrice: fbGasEth,
        fallbackLinkPrice: fbLinkEth,
      })
    })
  })
})
