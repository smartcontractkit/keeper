pragma solidity 0.6.12;

import '../UpkeepCompatible.sol';

contract UpkeepReverter is UpkeepCompatible {

  function checkForUpkeep(bytes calldata data)
    public
    override
    returns (
      bool callable,
      bytes calldata executedata
    )
  {
    require(false, "!working");
    return (true, data);
  }

  function performUpkeep(
    bytes calldata
  )
    external
    override
  {
    require(false, "!working");
  }

}