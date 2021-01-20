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
const deployer = process.env.DEPLOYER || 0

module.exports = {
  networks: {
    hardhat: {},
    kovan: {
      url: kovanUrl,
      accounts: [kovanPrivateKey]
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
    },
    linkEth: {
      1: '0xDC530D9457755926550b59e8ECcdaE7624181557',
      42: '0x3Af8C569ab77af5230596Acf0E8c2F9351d24C38',
    },
    fastGas: {
      1: '0x169E633A2D1E6c10dD91238Ba11c4A708dfEF37C',
      42: '0x73B9b95a2AE128225dbE53A7451B6c97e3De6F08',
    },
    deployer: {
      default: deployer
    }
  },
  gasReporter: {
    currency: 'USD',
    gasPrice: 1
  }
};

