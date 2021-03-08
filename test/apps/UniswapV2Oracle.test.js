const { artifacts } = require("hardhat")

const UniswapV2PairMock = artifacts.require('UniswapV2PairMock')
const UniswapV2FactoryMock = artifacts.require('UniswapV2FactoryMock')
const UniswapV2Oracle = artifacts.require('UniswapV2Oracle')

contract('UniswapV2Oracle', ([owner, uniDeployer, stranger1, stranger2]) => {
  const upkeepInterval = 60*30 // 30 minutes

  let uniswapV2Oracle, factoryMock 

  beforeEach(async () => {
    factoryMock = await UniswapV2FactoryMock.new(uniDeployer, {from:uniDeployer})
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

  })
  describe('#addPair', () => {

  })
  describe('#removePair', () => {
    
  })
  describe('#getPairPrice', () => {
    
  })
  describe('#checkUpkeep', () => {
    
  })
  describe('#performUpkeep', () => {
    
  })
})
