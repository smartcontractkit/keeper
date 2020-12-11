const Registry = artifacts.require('Registry')
const Dummy = artifacts.require('Dummy')
const Reverter = artifacts.require('Reverter')
const { LinkToken } = require('@chainlink/contracts/truffle/v0.4/LinkToken')
const { MockV2Aggregator } = require('@chainlink/contracts/truffle/v0.6/MockV2Aggregator')
const { BN, constants, ether, expectEvent, expectRevert, time } = require('@openzeppelin/test-helpers')

contract('Registry', (accounts) => {
  const maintainer = accounts[0]
  const user1 = accounts[1]
  const user2 = accounts[2]
  const user3 = accounts[3]
  const linkEth = new BN('30000000000000000')
  const gasWei = new BN('100000000000')
  const executeGas = new BN('100000')
  const emptyBytes = '0x00'
  const extraGas = new BN('250000')
  let linkToken, linkEthFeed, gasPriceFeed, registry, dummy, reverter, jobId

  beforeEach(async () => {
    LinkToken.setProvider(web3.currentProvider)
    MockV2Aggregator.setProvider(web3.currentProvider)
    linkToken = await LinkToken.new({ from: maintainer })
    gasPriceFeed = await MockV2Aggregator.new(gasWei, { from: maintainer })
    linkEthFeed = await MockV2Aggregator.new(linkEth, { from: maintainer })
    registry = await Registry.new(
      linkToken.address,
      linkEthFeed.address,
      gasPriceFeed.address,
      { from: maintainer }
    )
    dummy = await Dummy.new()
    reverter = await Reverter.new()
    await linkToken.transfer(user1, ether('100'), { from: maintainer })
    await linkToken.transfer(user2, ether('100'), { from: maintainer })
    await linkToken.transfer(user3, ether('100'), { from: maintainer })

    const { receipt } = await registry.addJob(
      dummy.address,
      executeGas,
      emptyBytes,
      { from: user1 }
    )
    jobId = receipt.logs[0].args.id
  })

  describe('#addJob', () => {
    it('reverts if the target is not a contract', async () => {
      await expectRevert(
        registry.addJob(
          constants.ZERO_ADDRESS,
          executeGas,
          emptyBytes
        ),
        '!contract'
      )
    })

    it('reverts if the query function is invalid', async () => {
      await expectRevert(
        registry.addJob(
          reverter.address,
          executeGas,
          emptyBytes
        ),
        '!query'
      )
    })

    it('creates a record of the job', async () => {
      const { receipt } = await registry.addJob(
        dummy.address,
        executeGas,
        emptyBytes,
        { from: user1 }
      )
      jobId = receipt.logs[0].args.id
      expectEvent(receipt, 'AddJob', {
        id: jobId,
        executeGas: executeGas
      })
      const job = await registry.jobs(jobId)
      assert.equal(dummy.address, job.target)
      assert.equal(0, job.balance)
      assert.equal(emptyBytes, job.queryData)
    })
  })

  describe('#addFunds', () => {
    beforeEach(async () => {
      await linkToken.approve(registry.address, ether('100'), { from: user1 })
    })

    it('reverts if the job does not exist', async () => {
      await expectRevert(
        registry.addFunds(jobId + 1, ether('1'), { from: user1 }),
        '!job'
      )
    })

    it('adds to the balance of the job', async () => {
      await registry.addFunds(jobId, ether('1'), { from: user1 })
      const job = await registry.jobs(jobId)
      assert.isTrue(ether('1').eq(job.balance))
    })
  })

  describe('#executeJob', () => {
    it('reverts if the job is not funded', async () => {
      await expectRevert(
        registry.executeJob(jobId),
        '!executable'
      )
    })

    context('when the job is funded', () => {
      beforeEach(async () => {
        await linkToken.approve(registry.address, ether('100'), { from: maintainer })
        await registry.addFunds(jobId, ether('100'), { from: maintainer })
      })

      it('does not revert if the target cannot execute', async () => {
        const dummyResponse = await dummy.query.call("0x")
        assert.isFalse(dummyResponse.callable)

        await registry.executeJob(jobId)
      })

      it('reverts if not enough gas supplied', async () => {
        await dummy.setCanExecute(true)
        const dummyResponse = await dummy.query.call("0x")
        assert.isTrue(dummyResponse.callable)
        await expectRevert(
          registry.executeJob(jobId, { from: user1, gas: new BN('120000') }),
          '!gasleft'
        )
      })

      it('executes always for the first caller if the target can execute', async () => {
        await dummy.setCanExecute(true)
        let dummyResponse = await dummy.query.call("0x")
        assert.isTrue(dummyResponse.callable)
        const balanceBefore = await linkToken.balanceOf(user1)
        const tx = await registry.executeJob(jobId, { from: user1, gas: extraGas })
        const balanceAfter = await linkToken.balanceOf(user1)
        assert.isTrue(balanceAfter.gt(balanceBefore))
        await expectEvent.inTransaction(tx.tx, Registry, 'Executed', {
          target: dummy.address,
          success: true
        })
        dummyResponse = await dummy.query.call("0x")
        assert.isFalse(dummyResponse.callable)
      })

      it('pays the caller even if the target function fails', async () => {
        const { receipt } = await registry.addJob(
          dummy.address,
          executeGas,
          emptyBytes,
          { from: user1 }
        )
        const jobId = receipt.logs[0].args.id
        await linkToken.approve(registry.address, ether('100'), { from: maintainer })
        await registry.addFunds(jobId, ether('100'), { from: maintainer })
        await dummy.setCanExecute(true)
        const balanceBefore = await linkToken.balanceOf(user1)
        const tx = await registry.executeJob(jobId, { from: user1 })
        const balanceAfter = await linkToken.balanceOf(user1)
        assert.isTrue(balanceAfter.gt(balanceBefore))
      })
    })
  })

  describe('#queryJob', () => {
    it('returns false if the job is not funded', async () => {
      assert.isFalse(await registry.queryJob.call(jobId))
    })

    context('when the job is funded', () => {
      beforeEach(async () => {
        await linkToken.approve(registry.address, ether('100'), { from: user1 })
        await registry.addFunds(jobId, ether('100'), { from: user1 })
      })

      it('returns false if the target cannot execute', async () => {
        const dummyResponse = await dummy.query.call("0x")
        assert.isFalse(dummyResponse.callable)
        assert.isFalse(await registry.queryJob.call(jobId))
      })

      it('returns true if the target can execute', async () => {
        await dummy.setCanExecute(true)
        const dummyResponse = await dummy.query.call("0x")
        assert.isTrue(dummyResponse.callable)
        assert.isTrue(await registry.queryJob.call(jobId))
      })
    })
  })
})
