const { artifacts } = require("hardhat")

const UniswapV2PairMock = artifacts.require('UniswapV2PairMock')
const UniswapV2FactoryMock = artifacts.require('UniswapV2FactoryMock')
const UniswapV2Oracle = artifacts.require('UniswapV2Oracle')
const { expectEvent, expectRevert } = require('@openzeppelin/test-helpers')


contract('UniswapV2Oracle', ([
  owner,
  uniDeployer,
  stranger1,
  stranger2,
  tokenA,
  tokenB,
  tokenC,
  tokenD
]) => {
  const upkeepInterval = 60*30 // 30 minutes
  const pair1Price0 = 1*10**18
  const pair1Price1 = 2*10**18
  const pair2Price0 = 3*10**18
  const pair2Price1 = 4*10**18

  let uniswapV2Oracle, factoryMock, pair1Address, pair2Address

  beforeEach(async () => {
    factoryMock = await UniswapV2FactoryMock.new(uniDeployer, {from:uniDeployer})
    // Add some pairs to the factory
    await factoryMock.createPair(tokenA, tokenB)
    pair1Address = await factoryMock.getPair(tokenA, tokenB)
    const pair1 = await UniswapV2PairMock.at(pair1Address)
    await pair1.setPrice0(pair1Price0.toString())
    await pair1.setPrice1(pair1Price1.toString())
    await factoryMock.createPair(tokenC, tokenD)
    pair2Address = await factoryMock.getPair(tokenC, tokenD)
    const pair2 = await UniswapV2PairMock.at(pair2Address)
    await pair2.setPrice0(pair2Price0.toString())
    await pair2.setPrice1(pair2Price1.toString())
    // Deploy UniswapV2Oracle
    uniswapV2Oracle = await UniswapV2Oracle.new(factoryMock.address, upkeepInterval, {from:owner})
  })

  describe('#constructor', () => {

    it('sets the correct owner', async () => {
      assert.equal(await uniswapV2Oracle.owner(), owner)
    })

    it('sets the correct factory', async () => {
      assert.equal(await uniswapV2Oracle.getUniswapV2Factory(), factoryMock.address)
    })

    it('sets the correct upkeep interval', async () => {
      assert.equal(await uniswapV2Oracle.getUpkeepInterval(), upkeepInterval)
    })

    it('sets empty pairs list', async () => {
      const pairs = await uniswapV2Oracle.getPairs()
      assert.equal(pairs.length, 0)
    })
  })

  describe('#setUpkeepInterval', () => {
    const newInterval = 60*60 // 60 minutes
    let receipt
    describe('when called by the owner', () => {

      beforeEach(async () => {
        receipt = await uniswapV2Oracle.setUpkeepInterval(
          newInterval,
          {from: owner}
        )
      })

      it('sets the correct interval', async () => {
        assert.equal(await uniswapV2Oracle.getUpkeepInterval(), newInterval)
      })

      it('emits an event', async () => {
        expectEvent(receipt, 'UpkeepIntervalSet', {
          previous: upkeepInterval.toString(),
          latest: newInterval.toString()
        })
      })
    })

    describe('when called by a stranger', () => {
      it('reverts with an owner message', async () => {
        await expectRevert(
          uniswapV2Oracle.setUpkeepInterval(
            newInterval,
            {from: stranger1}
          ),
          'Only callable by owner'
        )
      })
    })

  })
  describe('#addPair', () => {
    describe('when called by the owner', () => {
      let receipt
      beforeEach(async () => {
        receipt = await uniswapV2Oracle.addPair(
          tokenA,
          tokenB,
          {from:owner}
        )
      })

      it('adds a pair', async () => {
        const pairs = await uniswapV2Oracle.getPairs()
        assert.equal(pairs.length, 1)
        assert.equal(pairs[0], pair1Address)
      })

      it('sets the pair prices', async () => {
        const {latestPrice0, latestPrice1} = await uniswapV2Oracle.getPairPrice(pair1Address)
        assert.equal(latestPrice0.toString(), pair1Price0.toString())
        assert.equal(latestPrice1.toString(), pair1Price1.toString())
      })

      it('emits an event', async () => {
        expectEvent(receipt, 'PairAdded', {
          pair: pair1Address,
          tokenA: tokenA,
          tokenB: tokenB
        })
      })

      describe('when a pair already exists', () => {
        it('reverts with a pair message', async () => {
          await expectRevert(
            uniswapV2Oracle.addPair(
              tokenA,
              tokenB,
              {from:owner}
            ),
            'Pair already added'
          )
        })
      })
    })
    describe('when called by a stranger', () => {
      it('reverts with an owner message', async () => {
        await expectRevert(
          uniswapV2Oracle.addPair(
            tokenA,
            tokenB,
            {from:stranger1}
          ),
          'Only callable by owner'
        )
      })
    })
  })
  describe('#removePair', () => {
    describe('when called by the owner', () => {
      let previousLength, receipt
      beforeEach(async () => {
        await uniswapV2Oracle.addPair(
          tokenA,
          tokenB,
          {from:owner}
        )
        await uniswapV2Oracle.addPair(
          tokenC,
          tokenD,
          {from:owner}
        )
        previousLength = (await uniswapV2Oracle.getPairs()).length
        receipt = await uniswapV2Oracle.removePair(
          0,
          pair1Address,
          {from:owner}
        )
      })

      it('removes a pair', async () => {
        const newPairs = await uniswapV2Oracle.getPairs()
        assert.equal(newPairs.length, previousLength-1)
        assert.equal(newPairs[0], pair2Address)
      })

      it('emits an event', async () => {
        await expectEvent(
          receipt, 'PairRemoved', {
            pair: pair1Address
          }
        )
      })

      describe('invalid args', () => {
        it('reverts when a pair is not active', async () => {
          await expectRevert(
            uniswapV2Oracle.removePair(
              0,
              pair1Address,
              {from:owner}
            ),
            'Pair doesn\'t exist'
          )
        })

        it('reverts when the index is invalid', async () => {
          await expectRevert(
            uniswapV2Oracle.removePair(
              99,
              pair1Address,
              {from:owner}
            ),
            'Pair doesn\'t exist'
          )
        })
      })
    })

    describe('when called by a stranger', () => {
      it('reverts with an owner message', async () => {
        await expectRevert(
          uniswapV2Oracle.removePair(
            0,
            pair1Address,
            {from:stranger1}
          ),
          'Only callable by owner'
        )
      })
    })
  })

  describe('#getPairPrice', () => {
    
  })
  describe('#checkUpkeep', () => {
    
  })
  describe('#performUpkeep', () => {
    
  })
})
