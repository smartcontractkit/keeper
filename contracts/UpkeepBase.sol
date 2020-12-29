pragma solidity 0.7.6;

contract UpkeepBase {

  function preventExecution()
    internal
    view
  {
    require(tx.origin == address(0), "only for simulated backend");
  }

  modifier cannotExecute()
  {
    preventExecution();
    _;
  }

}
