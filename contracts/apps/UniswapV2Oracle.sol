// SPDX-License-Identifier: MIT

pragma solidity 0.7.6;

import "./UniswapV2Factory.sol";
import "./UniswapV2Pair.sol";
import "../KeeperCompatibleInterface.sol";
import "../vendor/Owned.sol";
import "../vendor/SafeMath.sol";

contract UniswapV2Oracle is KeeperCompatibleInterface, Owned {
  using SafeMath for uint256;

  UniswapV2Factory private immutable uniswapV2Factory;

  uint256 private s_upkeepInterval;
  uint256 private s_latestUpkeepTimestamp;
  mapping(address => uint) private s_latestPairPrice;
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
  event PairPriceUpdated(
    address indexed pair,
    uint256 previous,
    uint256 latest
  );
  event LatestUpkeepTimestampUpdated(
    uint256 previous,
    uint256 latest
  );

  constructor(
    UniswapV2Factory uniV2Factory,
    uint256 upkeepInterval
  )
    Owned()
  {
    uniswapV2Factory = uniV2Factory;
    setUpkeepInterval(upkeepInterval);
  }

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

  function addPair(
    address tokenA,
    address tokenB
  )
    external
  {
    address newPair = uniswapV2Factory.getPair(tokenA, tokenB);
    require(s_latestPairPrice[newPair] == 0, "Pair already added");
    s_pairs.push(newPair);
    emit PairAdded(newPair, tokenA, tokenB);
  }

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

  function _updateLatestPairPrice(
    address pair
  )
    private
  {
    uint256 previousPrice = s_latestPairPrice[pair];
    uint256 latestPrice = UniswapV2Pair(pair).price0CumulativeLast();
    s_latestPairPrice[pair] = latestPrice;
    emit PairPriceUpdated(pair, previousPrice, latestPrice);
  }

  function _updateLatestUpkeepTimestamp()
    private
  {
    uint256 previousTimestamp = s_latestUpkeepTimestamp;
    uint256 latestTimestamp = block.timestamp;
    s_latestUpkeepTimestamp = latestTimestamp;
    emit LatestUpkeepTimestampUpdated(previousTimestamp, latestTimestamp);
  }

  function _checkUpkeep()
    private
    view
    returns (
      bool upkeepNeeded
    )
  {
    upkeepNeeded = (block.timestamp.sub(s_upkeepInterval) >= s_latestUpkeepTimestamp);
  }
}
