const Registry = artifacts.require('Registry')
const Executor = artifacts.require('Executor')
const Dummy = artifacts.require('Dummy')
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
  const querySelector = '0x78b90337'
  const executeSelector = '0x61461954'
  const executeGas = new BN('100000')
  const emptyBytes = '0x00'
  const rewardCallers = new BN('3')

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
    await this.link.transfer(user1, ether('100'), { from: maintainer })
    await this.link.transfer(user2, ether('100'), { from: maintainer })
    await this.link.transfer(user3, ether('100'), { from: maintainer })
  })

  describe('addJob', () => {
    it('reverts if the target is not a contract', async () => {
      await expectRevert(
        this.registry.addJob(
          constants.ZERO_ADDRESS,
          querySelector,
          executeSelector,
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
          querySelector,
          executeSelector,
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
          this.dummy.address,
          '0xabcdef01',
          executeSelector,
          executeGas,
          rewardCallers,
          emptyBytes
        ),
        '!query'
      )
    })

    it('adds the job and creates an Executor contract', async () => {
      const { receipt } = await this.registry.addJob(
        this.dummy.address,
        querySelector,
        executeSelector,
        executeGas,
        rewardCallers,
        emptyBytes,
        { from: user1 }
      )
      expectEvent(receipt, 'AddJob', {
        target: this.dummy.address,
        executeGas: executeGas
      })
      const executorAddr = receipt.logs[0].args.executor
      const executor = await Executor.at(executorAddr)
      assert.equal(this.registry.address, await executor.registry())
      const job = await this.registry.jobs(executorAddr)
      assert.equal(querySelector, job.querySelector)
      assert.equal(executeSelector, job.executeSelector)
      assert.equal(this.dummy.address, job.target)
      assert.equal(0, job.balance)
      assert.equal(receipt.blockNumber, job.lastExecuted)
      assert.equal(emptyBytes, job.executeData)
    })
  })

  describe('addFunds', () => {
    let executorAddr

    beforeEach(async () => {
      await this.link.approve(this.registry.address, ether('100'), { from: user1 })
      const { receipt } = await this.registry.addJob(
        this.dummy.address,
        querySelector,
        executeSelector,
        executeGas,
        rewardCallers,
        emptyBytes,
        { from: user1 }
      )
      executorAddr = receipt.logs[0].args.executor
    })

    it('reverts if the job does not exist', async () => {
      await expectRevert(
        this.registry.addFunds(this.dummy.address, ether('1'), { from: user1 }),
        '!job'
      )
    })

    it('adds to the balance of the job', async () => {
      await this.registry.addFunds(executorAddr, ether('1'), { from: user1 })
      const job = await this.registry.jobs(executorAddr)
      assert.isTrue(ether('1').eq(job.balance))
    })
  })
})
