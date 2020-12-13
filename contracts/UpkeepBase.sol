pragma solidity 0.6.12;

contract UpkeepBase {

  modifier cannotExecute()
  {
    require(tx.origin == address(0), "only for simulated backend");
    _;
  }

}
