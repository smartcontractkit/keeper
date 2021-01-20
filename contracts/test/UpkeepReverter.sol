// SPDX-License-Identifier: MIT

pragma solidity 0.7.6;

import '../KeeperCompatible.sol';

contract UpkeepReverter is KeeperCompatible {

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
    bytes calldata
  )
    external
    override
  {
    require(false, "!working");
  }

}
