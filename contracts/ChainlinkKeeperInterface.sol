pragma solidity 0.6.12;

interface ChainlinkKeeperInterface {
  function query(bytes calldata data) external view returns (bool, bytes memory);
  function execute(bytes calldata data) external;
}
