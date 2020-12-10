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
  const rewardCallers = new BN('3')
  const extraGas = new BN('250000')

  beforeEach(async () => {
    LinkToken.setProvider(web3.currentProvider)
    MockV2Aggregator.setProvider(web3.currentProvider)
    this.link = await LinkToken.new({ from: maintainer })
    this.gasPriceFeed = await MockV2Aggregator.new(gasWei, { from: maintainer })
    this.linkEthFeed = await MockV2Aggregator.new(linkEth, { from: maintainer })
    this.registry = await Registry.new(
      this.link.address,
      this.linkEthFeed.address,
      this.gasPriceFeed.address,
      { from: maintainer }
    )
    this.dummy = await Dummy.new()
    this.reverter = await Reverter.new()
    await this.link.transfer(user1, ether('100'), { from: maintainer })
    await this.link.transfer(user2, ether('100'), { from: maintainer })
    await this.link.transfer(user3, ether('100'), { from: maintainer })

    const { receipt } = await this.registry.addJob(
      this.dummy.address,
      executeGas,
      rewardCallers,
      emptyBytes,
      { from: user1 }
    )
    this.jobId = receipt.logs[0].args.id
  })

  describe('#addJob', () => {
    it('reverts if the target is not a contract', async () => {
      await expectRevert(
        this.registry.addJob(
          constants.ZERO_ADDRESS,
          executeGas,
          rewardCallers,
          emptyBytes
        ),
        '!contract'
      )
    })

    it('reverts if rewardCallers is 0', async () => {
      await expectRevert(
        this.registry.addJob(
          this.dummy.address,
          executeGas,
          0,
          emptyBytes
        ),
        '!rewardCallers'
      )
    })

    it('reverts if the query function is invalid', async () => {
      await expectRevert(
        this.registry.addJob(
          this.reverter.address,
          executeGas,
          rewardCallers,
          emptyBytes
        ),
        '!query'
      )
    })

    it('creates a record of the job', async () => {
      const { receipt } = await this.registry.addJob(
        this.dummy.address,
        executeGas,
        rewardCallers,
        emptyBytes,
        { from: user1 }
      )
      expectEvent(receipt, 'AddJob', {
        target: this.dummy.address,
        executeGas: executeGas
      })
      const jobID = receipt.logs[0].args.id
      const job = await this.registry.jobs(jobID)
      assert.equal(receipt.blockNumber, job.lastExecuted)
      assert.equal(this.dummy.address, job.target)
      assert.equal(0, job.balance)
      assert.equal(emptyBytes, job.executeData)
    })
  })

  describe('#addFunds', () => {
    beforeEach(async () => {
      await this.link.approve(this.registry.address, ether('100'), { from: user1 })
    })

    it('reverts if the job does not exist', async () => {
      await expectRevert(
        this.registry.addFunds(this.jobId + 1, ether('1'), { from: user1 }),
        '!job'
      )
    })

    it('adds to the balance of the job', async () => {
      await this.registry.addFunds(this.jobId, ether('1'), { from: user1 })
      const job = await this.registry.jobs(this.jobId)
      assert.isTrue(ether('1').eq(job.balance))
    })
  })

  describe('#executeJob', () => {
    it('reverts if the job is not funded', async () => {
      await expectRevert(
        this.registry.executeJob(this.jobId),
        '!executable'
      )
    })

    context('when the job is funded', () => {
      beforeEach(async () => {
        await this.link.approve(this.registry.address, ether('100'), { from: maintainer })
        await this.registry.addFunds(this.jobId, ether('100'), { from: maintainer })
      })

      it('does not revert if the target cannot execute', async () => {
        const dummyResponse = await this.dummy.query.call("0x")
        assert.isFalse(dummyResponse.callable)

        await this.registry.executeJob(this.jobId)
      })

      it('reverts if not enough gas supplied', async () => {
        await this.dummy.setCanExecute(true)
        const dummyResponse = await this.dummy.query.call("0x")
        assert.isTrue(dummyResponse.callable)
        await expectRevert(
          this.registry.executeJob(this.jobId, { from: user1, gas: new BN('120000') }),
          '!gasleft'
        )
      })

      it('executes always for the first caller if the target can execute', async () => {
        await this.dummy.setCanExecute(true)
        let dummyResponse = await this.dummy.query.call("0x")
        assert.isTrue(dummyResponse.callable)
        const balanceBefore = await this.link.balanceOf(user1)
        const tx = await this.registry.executeJob(this.jobId, { from: user1, gas: extraGas })
        const balanceAfter = await this.link.balanceOf(user1)
        assert.isTrue(balanceAfter.gt(balanceBefore))
        await expectEvent.inTransaction(tx.tx, Registry, 'Executed', {
          target: this.dummy.address,
          success: true
        })
        dummyResponse = await this.dummy.query.call("0x")
        assert.isFalse(dummyResponse.callable)
        const block = await web3.eth.getBlockNumber()
        const job = await this.registry.jobs(this.jobId)
        assert.equal(block, job.lastExecuted)
      })

      it('pays the caller even if the target function fails', async () => {
        const { receipt } = await this.registry.addJob(
          this.dummy.address,
          executeGas,
          rewardCallers,
          emptyBytes,
          { from: user1 }
        )
        const jobId = receipt.logs[0].args.id
        await this.link.approve(this.registry.address, ether('100'), { from: maintainer })
        await this.registry.addFunds(jobId, ether('100'), { from: maintainer })
        await this.dummy.setCanExecute(true)
        const balanceBefore = await this.link.balanceOf(user1)
        const tx = await this.registry.executeJob(this.jobId, { from: user1 })
        const balanceAfter = await this.link.balanceOf(user1)
        assert.isTrue(balanceAfter.gt(balanceBefore))
      })
    })
  })

  describe('#queryJob', () => {
    it('returns false if the job is not funded', async () => {
      assert.isFalse(await this.registry.queryJob.call(this.jobId))
    })

    context('when the job is funded', () => {
      beforeEach(async () => {
        await this.link.approve(this.registry.address, ether('100'), { from: user1 })
        await this.registry.addFunds(this.jobId, ether('100'), { from: user1 })
      })

      it('returns false if the target cannot execute', async () => {
        const dummyResponse = await this.dummy.query.call("0x")
        assert.isFalse(dummyResponse.callable)
        assert.isFalse(await this.registry.queryJob.call(this.jobId))
      })

      it('returns true if the target can execute', async () => {
        await this.dummy.setCanExecute(true)
        const dummyResponse = await this.dummy.query.call("0x")
        assert.isTrue(dummyResponse.callable)
        assert.isTrue(await this.registry.queryJob.call(this.jobId))
      })
    })
  })
})
