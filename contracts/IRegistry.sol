pragma solidity 0.6.12;

interface IRegistry {
  function queryJob() external view returns (bool);
  function executeJob(address caller) external;
}
