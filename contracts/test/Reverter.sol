pragma solidity 0.6.12;

import '../ChainlinkKeeperInterface.sol';

contract Reverter is ChainlinkKeeperInterface {

  function query(bytes calldata data)
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

  function execute(
    bytes calldata
  )
    external
    override
  {
    require(false, "!working");
  }

}
