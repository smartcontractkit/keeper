pragma solidity 0.6.12;

interface IExecutor {
  function execute() external;
  function canExecute() external view returns (bool);
}
