pragma solidity 0.6.12;

interface UpkeptInterface {
  function checkForUpkeep(bytes calldata data) external returns (bool, bytes memory);
  function performUpkeep(bytes calldata data) external;
}
