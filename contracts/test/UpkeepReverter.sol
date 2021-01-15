pragma solidity 0.7.6;

import '../UpkeepCompatible.sol';

contract UpkeepReverter is UpkeepCompatible {

  function checkForUpkeep(bytes calldata data)
    public
    override
    cannotExecute()
    returns (
      bool callable,
      bytes calldata executedata
    )
  {
    require(false, "!working");
    return (true, data);
  }

  function performUpkeep(
    bytes calldata,
    bytes calldata
  )
    external
    override
  {
    require(false, "!working");
  }

}
