pragma solidity 0.6.12;

interface IRegistry {
  function queryJob() external view returns (bool, uint256, uint256, uint256);
  function executeJob(address caller) external;
}
