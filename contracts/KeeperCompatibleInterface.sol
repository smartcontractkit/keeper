pragma solidity 0.7.6;

interface KeeperCompatibleInterface {
  function checkForUpkeep(
    bytes calldata data
  )
    external
    returns (
      bool success,
      bytes memory dynamicData
    );
  function performUpkeep(
    bytes calldata dynamicData
  ) external;
}
