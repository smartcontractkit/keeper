pragma solidity 0.7.6;

interface UpkeepInterface {
  function checkForUpkeep(
    bytes calldata data
  )
    external
    returns (
      bool success,
      bytes memory dynamicData
    );
  function performUpkeep(
    bytes calldata staticData,
    bytes calldata dynamicData
  ) external;
}
