require("@nomiclabs/hardhat-truffle5");
require("hardhat-gas-reporter");
require("hardhat-deploy");

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
const kovanUrl = process.env.KOVAN_RPC_URL || 'http://localhost:8545'
const kovanPrivateKey = process.env.KOVAN_PRIVATE_KEY || '0x00'
const mumbaiUrl = process.env.MUMBAI_RPC_URL || 'http://localhost:8545'
const mumbaiPrivateKey = process.env.MUMBAI_PRIVATE_KEY || '0x00'
const bscTestnetUrl = process.env.BSCTESTNET_RPC_URL || 'http://localhost:8545'
const bscTestnetPrivateKey = process.env.BSCTESTNET_PRIVATE_KEY || '0x00'
const deployer = process.env.DEPLOYER || 0

module.exports = {
  networks: {
    hardhat: {},
    kovan: {
      url: kovanUrl,
      accounts: [kovanPrivateKey],
      chainId: 42,
    },
    mumbai: {
      url: mumbaiUrl,
      accounts: [mumbaiPrivateKey],
      chainId: 80001,
    },
    bsctestnet: {
      url: bscTestnetUrl,
      accounts: [bscTestnetPrivateKey],
      chainId: 97,
    }
  },
  solidity: {
    version: "0.7.6",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000000
      }
    }
  },
  namedAccounts: {
    linkToken: {
      1: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
      42: '0xa36085F69e2889c224210F603D836748e7dC0088',
      80001: '0x326C977E6efc84E512bB9C30f76E30c160eD06FB',
      97: '0x84b9b910527ad5c03a9ca831909e21e236ea7b06',
    },
    linkEth: {
      1: '0xDC530D9457755926550b59e8ECcdaE7624181557',
      42: '0x3Af8C569ab77af5230596Acf0E8c2F9351d24C38',
      80001: '0xc0FAb0a0c9204ae4682eFdca3F05EAAb17440271', // FIXME: Replace to the real feed smart contract deployed on Mumbai. The provided one is the mock.
      97: '0xBF44C29A52dF268841f7C689F73A5ec6dc6e6409', // FIXME: Replace to the real feed smart contract deployed on BSC Testnet. The provided one is the mock.
    },
    fastGas: {
      1: '0x169E633A2D1E6c10dD91238Ba11c4A708dfEF37C',
      42: '0x73B9b95a2AE128225dbE53A7451B6c97e3De6F08',
      80001: '0xc0FAb0a0c9204ae4682eFdca3F05EAAb17440271', // FIXME: Replace to the real feed smart contract deployed on Mumbai. The provided one is the mock.
      97: '0xBF44C29A52dF268841f7C689F73A5ec6dc6e6409', // FIXME: Replace to the real feed smart contract deployed on BSC Testnet. The provided one is the mock.
    },
    deployer: {
      default: deployer
    }
  },
  gasReporter: {
    currency: 'USD',
    gasPrice: 10
  }
};

