module.exports = {
  // To be used when testing the queued transactions
  // networks: {
  //   test: {
  //     host: "127.0.0.1",
  //     port: 8545,
  //     network_id: "*"
  //   }
  // },
  compilers: {
    solc: {
      version: "0.6.12",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200
        }
      }
    }
  }
}
