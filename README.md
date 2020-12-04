# Chainlink Contract Callers (C<sup>3</sup>)

A project has a function that needs to be called on some interval of time, or when certain on-chain conditions are met. Instead of running their own centralized service, they can make use of the Chainlink network to call their contracts as-needed.

## Features

- Rewards multiple callers if called in the same block. This means if multiple Chainlink nodes had successfully triggered an execute function in the same block, the caller that actually performed the state change on the target contract will get paid the full amount, while all secondary callers get paid at an 80% discounted rate to keep incentives for monitoring.
- Utilizes the LINK/ETH and Fast Gas feeds from Chainlink to automatically calculate payment. This makes it to where projects don't need to keep up with the most up-to-date amount of LINK to reward callers. Additionally, if nodes race eachother, they still only get paid at the fast gas rate.
- Protection for node operators in case of:
  - Underfunded jobs
  - Faulty execution functions (if the target execution function fails, nodes still get paid)
  - Transaction racing (payment is given based on the rate of the Fast Gas feed, not the gas price of the caller)

## Requirements

- In order to support C<sup>3</sup>, there must be a function which accepts no parameters and returns a bool in order to determine if the contract needs to be updated. This will be referred to as your query function.
- Once your execution function has executed, the query function should return false.
- See Dummy.sol for a simple example contract.

## Workflow

- Anyone can call `addJob` with the following parameters in order to add support for decentralized execution:
  - `_target`: The contract address that contains the functions to query and execute, this must be a contract address
  - `_querySelector`: The bytes4 function selector of the query function to call, should return a bool
  - `_executeSelector`: The bytes4 function selector of the execute function to call, this would write state
  - `_gasLimit`: The amount of gas that must be supplied to the execute function
  - `_rewardCallers`: The number of callers to reward if executed in the same block, must be at least 1
  - `_executeData`: The preformatted bytes to be sent with the execute transaction, can be empty if not necessary
- Once the job is added, an Executor contract is created which is key to the details of your job. Nodes will subscribe to this contract's address for monitoring and execution
- Next, funds must be added in order for the nodes to be able to execute your contract function
  - Approve the Registry contract to spend LINK from your address
  - Call `addFunds` with the address of your Executor contract and the amount of LINK you wish to fund the job with
- With funds added to the job, nodes will be able to call your execution function if the query function returns true
- Once the job is funded, query funtion returns true, and a node has called the execute function:
  - The spot rate of LINK/ETH to the gas price is calculated for payment
  - The job's payment balance is decremented
  - The job is marked as executed for that block number
  - The target contract's execution function is called with the amount of gas specified on job creation
  - A log, `Executed(address,address,bytes4,bool)` is emitted from the Registry contract
