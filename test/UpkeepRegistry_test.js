const UpkeepRegistry = artifacts.require('UpkeepRegistry')
const UpkeptMock = artifacts.require('UpkeptMock')
const UpkeptReverter = artifacts.require('UpkeptReverter')
const { LinkToken } = require('@chainlink/contracts/truffle/v0.4/LinkToken')
const { MockV2Aggregator } = require('@chainlink/contracts/truffle/v0.6/MockV2Aggregator')
const { BN, constants, ether, expectEvent, expectRevert, time } = require('@openzeppelin/test-helpers')

contract('UpkeepRegistry', (accounts) => {
  const maintainer = accounts[0]
  const keeper1 = accounts[1]
  const keeper2 = accounts[2]
  const keeper3 = accounts[3]
  const nonkeeper = accounts[4]
  const keepers = [keeper1, keeper2, keeper3]
  const linkEth = new BN('30000000000000000')
  const gasWei = new BN('100000000000')
  const executeGas = new BN('100000')
  const emptyBytes = '0x00'
  const extraGas = new BN('250000')
  let linkToken, linkEthFeed, gasPriceFeed, registry, mock, upkeepId

  beforeEach(async () => {
    LinkToken.setProvider(web3.currentProvider)
    MockV2Aggregator.setProvider(web3.currentProvider)
    linkToken = await LinkToken.new({ from: maintainer })
    gasPriceFeed = await MockV2Aggregator.new(gasWei, { from: maintainer })
    linkEthFeed = await MockV2Aggregator.new(linkEth, { from: maintainer })
    registry = await UpkeepRegistry.new(
      linkToken.address,
      linkEthFeed.address,
      gasPriceFeed.address,
      { from: maintainer }
    )
    mock = await UpkeptMock.new()
    await linkToken.transfer(keeper1, ether('100'), { from: maintainer })
    await linkToken.transfer(keeper2, ether('100'), { from: maintainer })
    await linkToken.transfer(keeper3, ether('100'), { from: maintainer })

    const { receipt } = await registry.registerUpkeep(
      mock.address,
      executeGas,
      keepers,
      emptyBytes,
      { from: keeper1 }
    )
    upkeepId = receipt.logs[0].args.id
  })

  describe('#registerUpkeep', () => {
    it('reverts if the target is not a contract', async () => {
      await expectRevert(
        registry.registerUpkeep(
          constants.ZERO_ADDRESS,
          executeGas,
          keepers,
          emptyBytes
        ),
        '!contract'
      )
    })

    it('reverts if 0 keepers are passed', async () => {
      await expectRevert(
        registry.registerUpkeep(
          mock.address,
          executeGas,
          [],
          emptyBytes
        ),
        'minimum of 1 keeper'
      )
    })

    it('reverts if the target is not a contract', async () => {
      await expectRevert(
        registry.registerUpkeep(
          constants.ZERO_ADDRESS,
          executeGas,
          keepers,
          emptyBytes
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
          keepers,
          emptyBytes
        ),
        '!query'
      )
    })

    it('creates a record of the upkeep', async () => {
      const { receipt } = await registry.registerUpkeep(
        mock.address,
        executeGas,
        keepers,
        emptyBytes,
        { from: keeper1 }
      )
      upkeepId = receipt.logs[0].args.id
      expectEvent(receipt, 'UpkeepRegistered', {
        id: upkeepId,
        executeGas: executeGas,
        keepers: keepers
      })
      const upkeep = await registry.upkeeps(upkeepId)
      assert.equal(mock.address, upkeep.target)
      assert.equal(0, upkeep.balance)
      assert.equal(emptyBytes, upkeep.checkData)
      assert.deepEqual(keepers, await registry.keepersFor(upkeepId))
    })
  })

  describe('#addFunds', () => {
    beforeEach(async () => {
      await linkToken.approve(registry.address, ether('100'), { from: keeper1 })
    })

    it('reverts if the upkeep does not exist', async () => {
      await expectRevert(
        registry.addFunds(upkeepId + 1, ether('1'), { from: keeper1 }),
        '!upkeep'
      )
    })

    it('adds to the balance of the upkeep', async () => {
      await registry.addFunds(upkeepId, ether('1'), { from: keeper1 })
      const upkeep = await registry.upkeeps(upkeepId)
      assert.isTrue(ether('1').eq(upkeep.balance))
    })
  })

  describe('#checkForUpkeep', () => {
    it('returns false if the upkeep is not funded', async () => {
      const check = await registry.checkForUpkeep.call(upkeepId)
      assert.isFalse(check.canPerform)
    })

    context('when the upkeep is funded', () => {
      beforeEach(async () => {
        await linkToken.approve(registry.address, ether('100'), { from: keeper1 })
        await registry.addFunds(upkeepId, ether('100'), { from: keeper1 })
      })

      it('returns false if the target cannot execute', async () => {
        const mockResponse = await mock.checkForUpkeep.call("0x")
        assert.isFalse(mockResponse.callable)
        const check = await registry.checkForUpkeep.call(upkeepId)
        assert.isFalse(check.canPerform)
      })

      it('returns true if the target can execute', async () => {
        await mock.setCanExecute(true)
        const mockResponse = await mock.checkForUpkeep.call("0x")
        assert.isTrue(mockResponse.callable)
        const check = await registry.checkForUpkeep.call(upkeepId)
        assert.isTrue(check.canPerform)
      })
    })
  })

  describe('#tryUpkeep', () => {
    it('returns false if the upkeep is not funded', async () => {
      await expectRevert(
        registry.tryUpkeep(keeper1, upkeepId, "0x"),
        "!executable"
      )
    })

    context('when the upkeep is funded', () => {
      beforeEach(async () => {
        await linkToken.approve(registry.address, ether('100'), { from: maintainer })
        await registry.addFunds(upkeepId, ether('100'), { from: maintainer })
      })

      it('reverts if the target cannot execute', async () => {
        await expectRevert(
          registry.tryUpkeep.call(keeper1, upkeepId, "0x"),
          'upkeep failed'
        )
      })

      it('reverts if the sender is not a target', async () => {
        await expectRevert(
          registry.tryUpkeep.call(nonkeeper, upkeepId, "0x"),
          'only keepers'
        )
      })

      it('returns true if the contract can execute', async () => {
        await mock.setCanExecute(true)
        assert.isTrue(await registry.tryUpkeep.call(keeper1, upkeepId, "0x"))
      })
    })
  })


  describe('#performUpkeep', () => {
    it('reverts if the upkeep is not funded', async () => {
      await expectRevert(
        registry.performUpkeep(upkeepId, "0x", { from: keeper2 }),
        '!executable'
      )
    })

    context('when the upkeep is funded', () => {
      beforeEach(async () => {
        await linkToken.approve(registry.address, ether('100'), { from: maintainer })
        await registry.addFunds(upkeepId, ether('100'), { from: maintainer })
      })

      it('does not revert if the target cannot execute', async () => {
        const mockResponse = await mock.checkForUpkeep.call("0x")
        assert.isFalse(mockResponse.callable)

        await registry.performUpkeep(upkeepId, "0x", { from: keeper3 })
      })

      it('reverts if not enough gas supplied', async () => {
        await mock.setCanExecute(true)
        const mockResponse = await mock.checkForUpkeep.call("0x")
        assert.isTrue(mockResponse.callable)
        await expectRevert(
          registry.performUpkeep(upkeepId, "0x", { from: keeper1, gas: new BN('120000') }),
          '!gasleft'
        )
      })

      it('executes always for the first caller if the target can execute', async () => {
        await mock.setCanExecute(true)
        let mockResponse = await mock.checkForUpkeep.call("0x")
        assert.isTrue(mockResponse.callable)
        const balanceBefore = await linkToken.balanceOf(keeper1)
        const tx = await registry.performUpkeep(upkeepId, "0x", { from: keeper1, gas: extraGas })
        const balanceAfter = await linkToken.balanceOf(keeper1)
        assert.isTrue(balanceAfter.gt(balanceBefore))
        await expectEvent.inTransaction(tx.tx, UpkeepRegistry, 'UpkeepPerformed', {
          target: mock.address,
          success: true
        })
        mockResponse = await mock.checkForUpkeep.call("0x")
        assert.isFalse(mockResponse.callable)
      })

      it('passes the calldata on to the upkept target', async () => {
        const performData = "0xc0ffeec0ffee"
        await mock.setCanExecute(true)
        const tx = await registry.performUpkeep(upkeepId, performData, { from: keeper1 })
        await expectEvent.inTransaction(tx.tx, UpkeptMock, 'UpkeepPerformedWith', {
          upkeepData: performData
        })
      })

      it('pays the caller even if the target function fails', async () => {
        const { receipt } = await registry.registerUpkeep(
          mock.address,
          executeGas,
          keepers,
          emptyBytes,
          { from: keeper1 }
        )
        const upkeepId = receipt.logs[0].args.id
        await linkToken.approve(registry.address, ether('100'), { from: maintainer })
        await registry.addFunds(upkeepId, ether('100'), { from: maintainer })
        await mock.setCanExecute(true)
        const balanceBefore = await linkToken.balanceOf(keeper1)
        const tx = await registry.performUpkeep(upkeepId, "0x", { from: keeper1 })
        const balanceAfter = await linkToken.balanceOf(keeper1)
        assert.isTrue(balanceAfter.gt(balanceBefore))
      })

      it('reverts if the upkeep is called by a non-keeper', async () => {
        await expectRevert(
          registry.performUpkeep(upkeepId, "0x", { from: nonkeeper }),
          'only keepers'
        )
      })
    })
  })
})
