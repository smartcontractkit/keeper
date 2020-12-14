pragma solidity 0.6.12;

interface UpkeepInterface {
  function checkForUpkeep(bytes calldata data) external returns (bool, bytes memory);
  function performUpkeep(bytes calldata data) external;
}
