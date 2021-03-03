// SPDX-License-Identifier: MIT

pragma solidity 0.7.6;

import "./UniswapV2Factory.sol";
import "./UniswapV2Pair.sol";
import "../KeeperCompatibleInterface.sol";
import "../vendor/Owned.sol";
import "../vendor/SafeMath.sol";

contract UniswapV2Oracle is KeeperCompatibleInterface, Owned {
  using SafeMath for uint256;

  struct PairDetails {
    bool active;
    uint256 latestPrice0;
    uint256 latestPrice1;
    uint8 index;
  }

  UniswapV2Factory private immutable uniswapV2Factory;

  uint256 private s_upkeepInterval;
  uint256 private s_latestUpkeepTimestamp;
  mapping(address => PairDetails) private s_latestPairDetails;
  address[] private s_pairs;

  event UpkeepIntervalSet(
    uint256 previous,
    uint256 latest
  );
  event PairAdded(
    address indexed pair,
    address indexed tokenA,
    address indexed tokenB
  );
  event PairRemoved(
    address indexed pair
  );
  event PairPriceUpdated(
    address indexed pair,
    uint256 previousPrice0,
    uint256 previousPrice1,
    uint256 latestPrice0,
    uint256 latestPrice1
  );
  event LatestUpkeepTimestampUpdated(
    uint256 previous,
    uint256 latest
  );

  /**
   * @notice Construct a new UniswapV2Oracle Keep3r
   * @param uniswapV2FactoryAddress address of the uniswap v2 factory
   * @param upkeepInterval interval to update the price of every pair
   */
  constructor(
    address uniswapV2FactoryAddress,
    uint256 upkeepInterval
  )
    Owned()
  {
    uniswapV2Factory = UniswapV2Factory(uniswapV2FactoryAddress);
    setUpkeepInterval(upkeepInterval);
  }

  /**
   * @notice Set the interval at which the prices of pairs should be updated
   * @param newInterval uint256
   */
  function setUpkeepInterval(
    uint256 newInterval
  )
    public
    onlyOwner()
  {
    require(newInterval > 0, "Invalid interval");
    uint256 previousInterval = s_upkeepInterval;
    require(previousInterval != newInterval, "Interval is unchanged");
    s_upkeepInterval = newInterval;
    emit UpkeepIntervalSet(previousInterval, newInterval);
  }

  /**
   * @notice Add a token pair
   * @param tokenA address of the first token
   * @param tokenB address of the second token
   */
  function addPair(
    address tokenA,
    address tokenB
  )
    external
  {
    // Get pair address from uniswap
    address newPair = uniswapV2Factory.getPair(tokenA, tokenB);

    // Create the details if isn't already added
    require(s_latestPairDetails[newPair].active == false, "Pair already added");
    PairDetails memory pairDetails = PairDetails(
      true,
      0,
      0,
      uint8(s_pairs.length)
    );

    // Add to the pair details and pairs list
    s_latestPairDetails[newPair] = pairDetails;
    s_pairs.push(newPair);

    emit PairAdded(newPair, tokenA, tokenB);
  }

  function getPairs()
    external
    view
    returns (
      address[] memory
    )
  {
    return s_pairs;
  }

  function removePair(
    address pair
  )
    external
  {
    // TODO
  }

  /**
   * @notice Check if the contract needs upkeep. If not pairs are set,
   * then upkeepNeeded will be false.
   * @dev bytes param not used here
   * @return upkeepNeeded boolean
   * @return performData (not used here)
   */
  function checkUpkeep(
    bytes calldata
  )
    external
    view
    override
    returns (
      bool upkeepNeeded,
      bytes memory performData
    )
  {
    upkeepNeeded = _checkUpkeep();
    performData = bytes("");
  }

  /**
   * @notice Perform the upkeep. This updates all of the price pairs
   * with their latest price from Uniswap
   * @dev bytes param not used here
   */
  function performUpkeep(
    bytes calldata
  ) 
    external
    override
  {
    require(_checkUpkeep(), "Upkeep not needed");
    for (uint256 i = 0; i < s_pairs.length; i++) {
      _updateLatestPairPrice(s_pairs[i]);
    }
    _updateLatestUpkeepTimestamp();
  }

  /**
   * @notice Retrieve and update the latest price of a pair.
   * @param pair The address of the pair contract
   */
  function _updateLatestPairPrice(
    address pair
  )
    private
  {
    PairDetails memory pairDetails = s_latestPairDetails[pair];
    uint256 previousPrice0 = pairDetails.latestPrice0;
    uint256 previousPrice1 = pairDetails.latestPrice1;
    uint256 latestPrice0 = UniswapV2Pair(pair).price0CumulativeLast();
    uint256 latestPrice1 = UniswapV2Pair(pair).price1CumulativeLast();
    s_latestPairDetails[pair].latestPrice0 = latestPrice0;
    s_latestPairDetails[pair].latestPrice1 = latestPrice1;
    emit PairPriceUpdated(pair,
      previousPrice0,
      previousPrice1,
      latestPrice0,
      latestPrice1
    );
  }

  /**
   * @notice Update the latestUpkeepTimestamp once upkeep has been performed
   */
  function _updateLatestUpkeepTimestamp()
    private
  {
    uint256 previousTimestamp = s_latestUpkeepTimestamp;
    uint256 latestTimestamp = block.timestamp;
    s_latestUpkeepTimestamp = latestTimestamp;
    emit LatestUpkeepTimestampUpdated(previousTimestamp, latestTimestamp);
  }

  /**
   * @notice Check whether upkeep is needed
   * @dev Possible outcomes:
   *    - No pairs set:                                 false
   *    - Some pairs set, but not enough time passed:   false
   *    - Some pairs set, and enough time passed:       true
   */
  function _checkUpkeep()
    private
    view
    returns (
      bool upkeepNeeded
    )
  {
    upkeepNeeded = (s_pairs.length > 0)
      && (block.timestamp >= s_latestUpkeepTimestamp.add(s_upkeepInterval));
  }
}
