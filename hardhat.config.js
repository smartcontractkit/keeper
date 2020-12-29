require("@nomiclabs/hardhat-truffle5");
require("hardhat-gas-reporter");

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    version: "0.7.6",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000000
      }
    }
  },
  gasReporter: {
    currency: 'USD',
    gasPrice: 1
  }
};

