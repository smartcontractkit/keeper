const UpkeepRegistry = artifacts.require('UpkeepRegistry')
const UpkeptMock = artifacts.require('UpkeptMock')
const UpkeptReverter = artifacts.require('UpkeptReverter')
const { LinkToken } = require('@chainlink/contracts/truffle/v0.4/LinkToken')
const { MockV2Aggregator } = require('@chainlink/contracts/truffle/v0.6/MockV2Aggregator')
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
  const linkEth = new BN('30000000000000000')
  const gasWei = new BN('100000000000')
  const executeGas = new BN('100000')
  const emptyBytes = '0x00'
  const zeroAddress = constants.ZERO_ADDRESS
  const extraGas = new BN('250000')
  let linkToken, linkEthFeed, gasPriceFeed, registry, mock, id

  beforeEach(async () => {
    LinkToken.setProvider(web3.currentProvider)
    MockV2Aggregator.setProvider(web3.currentProvider)
    linkToken = await LinkToken.new({ from: owner })
    gasPriceFeed = await MockV2Aggregator.new(gasWei, { from: owner })
    linkEthFeed = await MockV2Aggregator.new(linkEth, { from: owner })
    registry = await UpkeepRegistry.new(
      linkToken.address,
      linkEthFeed.address,
      gasPriceFeed.address,
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
      keepers,
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
      assert.deepEqual(oldKeepers, await registry.keepers())

      // remove keepers
      const newKeepers = [keeper2, keeper3]
      const newPayees = [payee2, payee3]
      const { receipt } = await registry.setKeepers(newKeepers, newPayees, {from: owner})
      assert.deepEqual(newKeepers, await registry.keepers())

      expectEvent(receipt, 'KeeperRemoved', { keeper: keeper1 })
      expectEvent(receipt, 'KeeperRemoved', { keeper: keeper2 })
      expectEvent(receipt, 'KeeperAdded', { keeper: keeper2, payee: payee2 })
      expectEvent(receipt, 'KeeperAdded', { keeper: keeper3, payee: payee3 })
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
          keepers,
          emptyBytes,
          { from: owner }
        ),
        'target is not a contract'
      )
    })

    it('reverts if 0 keepers are passed', async () => {
      await expectRevert(
        registry.registerUpkeep(
          mock.address,
          executeGas,
          admin,
          [],
          emptyBytes,
          { from: owner }
        ),
        'minimum of 1 keeper'
      )
    })

    it('reverts if the target is not a contract', async () => {
      await expectRevert(
        registry.registerUpkeep(
          zeroAddress,
          executeGas,
          admin,
          keepers,
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
          keepers,
          emptyBytes,
          { from: keeper1 }
        ),
        'Only callable by owner'
      )
    })

    it('creates a record of the registration', async () => {
      const { receipt } = await registry.registerUpkeep(
        mock.address,
        executeGas,
        admin,
        keepers,
        emptyBytes,
        { from: owner }
      )
      id = receipt.logs[0].args.id
      expectEvent(receipt, 'UpkeepRegistered', {
        id: id,
        executeGas: executeGas,
        keepers: keepers
      })
      const registration = await registry.registrations(id)
      assert.equal(mock.address, registration.target)
      assert.equal(0, registration.balance)
      assert.equal(emptyBytes, registration.checkData)
      assert.isTrue(registration.valid)
      assert.deepEqual(keepers, await registry.keepersFor(id))
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
      const registration = await registry.registrations(id)
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

      it('returns true if the target can execute', async () => {
        await mock.setCanExecute(true)
        const mockResponse = await mock.checkForUpkeep.call("0x")
        assert.isTrue(mockResponse.callable)
        const check = await registry.checkForUpkeep.call(id, {from: zeroAddress})
        assert.isTrue(check.canPerform)
      })

      it('reverts if executed', async () => {
        await mock.setCanExecute(true)
        await expectRevert(
          registry.checkForUpkeep(id),
          'only for reading'
        )
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
            'only for reading'
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

      it('executes always for the first caller if the target can execute', async () => {
        await mock.setCanExecute(true)
        let mockResponse = await mock.checkForUpkeep.call("0x")
        assert.isTrue(mockResponse.callable)
        const balanceBefore = await linkToken.balanceOf(keeper1)
        const tx = await registry.performUpkeep(id, "0x2a", { from: keeper1, gas: extraGas })
        const balanceAfter = await linkToken.balanceOf(keeper1)
        assert.isTrue(balanceAfter.gt(balanceBefore))
        await expectEvent.inTransaction(tx.tx, UpkeepRegistry, 'UpkeepPerformed', {
          success: true,
          performData: "0x2a"
        })
        mockResponse = await mock.checkForUpkeep.call("0x")
        assert.isFalse(mockResponse.callable)
      })

      it('passes the calldata on to the upkept target', async () => {
        const performData = "0xc0ffeec0ffee"
        await mock.setCanExecute(true)
        const tx = await registry.performUpkeep(id, performData, { from: keeper1 })
        await expectEvent.inTransaction(tx.tx, UpkeptMock, 'UpkeepPerformedWith', {
          upkeepData: performData
        })
      })

      it('pays the caller even if the target function fails', async () => {
        const { receipt } = await registry.registerUpkeep(
          mock.address,
          executeGas,
          admin,
          keepers,
          emptyBytes,
          { from: owner }
        )
        const id = receipt.logs[0].args.id
        await linkToken.approve(registry.address, ether('100'), { from: owner })
        await registry.addFunds(id, ether('100'), { from: owner })
        await mock.setCanExecute(true)
        const balanceBefore = await linkToken.balanceOf(keeper1)
        const tx = await registry.performUpkeep(id, "0x", { from: keeper1 })
        const balanceAfter = await linkToken.balanceOf(keeper1)
        assert.isTrue(balanceAfter.gt(balanceBefore))
      })

      it('reverts if the upkeep is called by a non-keeper', async () => {
        await expectRevert(
          registry.performUpkeep(id, "0x", { from: nonkeeper }),
          'only keepers'
        )
      })

      it('reverts if the upkeep has been deregistered', async () => {
        await mock.setCanExecute(true)

        await registry.deregisterUpkeep(id, { from: owner })

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

    it('reverts if called with more than available balance', async () => {
      await expectRevert(
        registry.withdrawFunds(id, ether('2'), payee1, { from: admin }),
        'SafeMath: subtraction overflow'
      )
    })

    it('moves the funds out and updates the balance', async () => {
      const payee1Before = await linkToken.balanceOf(payee1)
      const registryBefore = await linkToken.balanceOf(registry.address)

      let registration = await registry.registrations(id)
      assert.isTrue(ether('1').eq(registration.balance))

      await registry.withdrawFunds(id, ether('1'), payee1, { from: admin })

      const payee1After = await linkToken.balanceOf(payee1)
      const registryAfter = await linkToken.balanceOf(registry.address)

      assert.isTrue(payee1Before.add(ether('1')).eq(payee1After))
      assert.isTrue(registryBefore.sub(ether('1')).eq(registryAfter))

      registration = await registry.registrations(id)
      assert.equal(0, registration.balance)
    })
  })

  describe('#deregisterUpkeep', () => {
    it('reverts if the ID is not valid', async () => {
      await expectRevert(
        registry.deregisterUpkeep(id + 1, { from: owner }),
        'invalid upkeep id'
      )
    })

    it('reverts if called by a non-owner', async () => {
      await expectRevert(
        registry.deregisterUpkeep(id + 1, { from: keeper1 }),
        'Only callable by owner'
      )
    })

    it('sets the registration to invalid', async () => {
      await registry.deregisterUpkeep(id, { from: owner })

      const registration = await registry.registrations(id)
      assert.isFalse(registration.valid)
    })

    it('emits an event', async () => {
      const { receipt } = await registry.deregisterUpkeep(id, { from: owner })

      expectEvent(receipt, 'UpkeepDeregistered', { id: id })
    })

    it('updates the keeperRegistraions records', async () => {
      let deregistered = await registry.deregistered.call()
      assert.deepEqual([], deregistered)

      await registry.deregisterUpkeep(id)

      deregistered = await registry.deregistered.call()
      assert.deepEqual([id], deregistered)
    })
  })

  describe('#proposeNewPayee', () => {
    it("reverts when called by anyone but the current payee", async () => {
      await expectRevert(
        registry.proposeNewPayee(keeper1, payee2, { from: payee2 }),
        "only callable by payee"
      )
    })

    it("does not change the payee", async () => {
      await registry.proposeNewPayee(keeper1, payee2, { from: payee1 })

      const info = await registry.getKeeperInfo(keeper1)
      assert.equal(payee1, info.payee)
    })

    it("emits an event announcing the new payee", async () => {
      const { receipt } = await registry.proposeNewPayee(keeper1, payee2, { from: payee1 })

      expectEvent(receipt, 'NewPayeeProposed', {
        keeper: keeper1,
        from: payee1,
        to: payee2,
      })
    })
  })

  describe('#proposeNewPayee', () => {
    beforeEach(async () => {
      await registry.proposeNewPayee(keeper1, payee2, { from: payee1 })
    })

    it("reverts when called by anyone but the proposed payee", async () => {
      await expectRevert(
        registry.acceptPayeeProposal(keeper1, { from: payee1 }),
        "only callable by proposed payee"
      )
    })

    it("emits an event announcing the new payee", async () => {
      const { receipt } = await registry.acceptPayeeProposal(keeper1, { from: payee2 })

      expectEvent(receipt, 'PayeeProposalAccepted', {
        keeper: keeper1,
        from: payee1,
        to: payee2,
      })
    })

    it("does change the payee", async () => {
      await registry.acceptPayeeProposal(keeper1, { from: payee2 })

      const info = await registry.getKeeperInfo(keeper1)
      assert.equal(payee2, info.payee)
    })
  })
})
