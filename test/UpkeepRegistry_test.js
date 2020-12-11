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
  const payee = accounts[6]
  const keepers = [keeper1, keeper2, keeper3]
  const linkEth = new BN('30000000000000000')
  const gasWei = new BN('100000000000')
  const executeGas = new BN('100000')
  const emptyBytes = '0x00'
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

  describe('#registerUpkeep', () => {
    it('reverts if the target is not a contract', async () => {
      await expectRevert(
        registry.registerUpkeep(
          constants.ZERO_ADDRESS,
          executeGas,
          admin,
          keepers,
          emptyBytes,
          { from: owner }
        ),
        '!contract'
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
          constants.ZERO_ADDRESS,
          executeGas,
          admin,
          keepers,
          emptyBytes,
          { from: owner }
        ),
        '!contract'
      )
    })

    it('reverts if the query function is invalid', async () => {
      const reverter = await UpkeptReverter.new()
      await expectRevert(
        registry.registerUpkeep(
          reverter.address,
          executeGas,
          admin,
          keepers,
          emptyBytes,
          { from: owner }
        ),
        '!query'
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
      const check = await registry.checkForUpkeep.call(id)
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
        const check = await registry.checkForUpkeep.call(id)
        assert.isFalse(check.canPerform)
      })

      it('returns true if the target can execute', async () => {
        await mock.setCanExecute(true)
        const mockResponse = await mock.checkForUpkeep.call("0x")
        assert.isTrue(mockResponse.callable)
        const check = await registry.checkForUpkeep.call(id)
        assert.isTrue(check.canPerform)
      })
    })
  })

  describe('#tryUpkeep', () => {
    it('returns false if the registration is not funded', async () => {
      await expectRevert(
        registry.tryUpkeep(keeper1, id, "0x"),
        "!executable"
      )
    })

    context('when the registration is funded', () => {
      beforeEach(async () => {
        await linkToken.approve(registry.address, ether('100'), { from: owner })
        await registry.addFunds(id, ether('100'), { from: owner })
      })

      it('reverts if the target cannot execute', async () => {
        await expectRevert(
          registry.tryUpkeep.call(keeper1, id, "0x"),
          'upkeep failed'
        )
      })

      it('reverts if the sender is not a target', async () => {
        await expectRevert(
          registry.tryUpkeep.call(nonkeeper, id, "0x"),
          'only keepers'
        )
      })

      it('returns true if the contract can execute', async () => {
        await mock.setCanExecute(true)
        assert.isTrue(await registry.tryUpkeep.call(keeper1, id, "0x"))
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
    })
  })

  describe('#withdrawFunds', () => {
    beforeEach(async () => {
      await linkToken.approve(registry.address, ether('100'), { from: keeper1 })
      await registry.addFunds(id, ether('1'), { from: keeper1 })
    })

    it('reverts if called by anyone but the admin', async () => {
      await expectRevert(
        registry.withdrawFunds(id + 1, ether('1'), payee, { from: owner }),
        'only callable by admin'
      )
    })

    it('reverts if called with more than available balance', async () => {
      await expectRevert(
        registry.withdrawFunds(id, ether('2'), payee, { from: admin }),
        'SafeMath: subtraction overflow'
      )
    })

    it('moves the funds out and updates the balance', async () => {
      const payeeBefore = await linkToken.balanceOf(payee)
      const registryBefore = await linkToken.balanceOf(registry.address)

      let registration = await registry.registrations(id)
      assert.isTrue(ether('1').eq(registration.balance))

      await registry.withdrawFunds(id, ether('1'), payee, { from: admin })

      const payeeAfter = await linkToken.balanceOf(payee)
      const registryAfter = await linkToken.balanceOf(registry.address)

      assert.isTrue(payeeBefore.add(ether('1')).eq(payeeAfter))
      assert.isTrue(registryBefore.sub(ether('1')).eq(registryAfter))

      registration = await registry.registrations(id)
      assert.equal(0, registration.balance)
    })
  })
})
