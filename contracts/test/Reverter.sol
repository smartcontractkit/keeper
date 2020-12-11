pragma solidity 0.6.12;

import '../UpkeptInterface.sol';

contract Reverter is UpkeptInterface {

  function checkForUpkeep(bytes calldata data)
    public
    view
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
