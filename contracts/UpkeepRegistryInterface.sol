pragma solidity 0.6.12;

interface UpkeepRegistryGettersInterface {
  function getUpkeep(uint256 id)
    external view returns (
      address target,
      uint32 executeGas,
      bytes memory checkData,
      uint96 balance,
      address lastKeeper,
      address admin,
      uint64 maxValidBlocknumber
    );
  function getUpkeepCount()
    external view returns (uint256);
  function getCanceledUpkeepList()
    external view returns (uint256[] memory);
  function getKeeperList()
    external view returns (address[] memory);
  function getKeeperInfo(address query)
    external view returns (
      address payee,
      bool active,
      uint96 balance
    );
  function getConfig()
    external view returns (
      uint32 paymentPremiumPPB,
      uint24 checkFrequencyBlocks,
      uint32 checkGasLimit,
      uint24 stalenessSeconds,
      int256 fallbackGasPrice,
      int256 fallbackLinkPrice
    );
}

/**
  * @dev The view methods are not actually marked as view in the implementation
  * but we want them to be easily queried off-chain. Solidity will not compile
  * if we actually inherrit from this interface, so we document it here.
*/
interface UpkeepRegistryInterface is UpkeepRegistryGettersInterface {
  function checkForUpkeep(uint256 upkeepId)
    external view returns ( bool canPerform,
      bytes memory performData,
      uint256 maxLinkPayment,
      uint256 gasLimit,
      int256 gasWei,
      int256 linkEth
    );

  function tryUpkeep(uint256 id, bytes calldata performData)
    external view returns (bool success);

  function performUpkeep(uint256 id, bytes calldata performData) external;
}

interface UpkeepRegistryKeeperInterface is UpkeepRegistryGettersInterface {
  function checkForUpkeep(uint256 upkeepId)
    external returns ( bool canPerform,
      bytes memory performData,
      uint256 maxLinkPayment,
      uint256 gasLimit,
      int256 gasWei,
      int256 linkEth
    );

  function tryUpkeep(uint256 id, bytes calldata performData)
    external returns (bool success);

  function performUpkeep(uint256 id, bytes calldata performData) external;
}
