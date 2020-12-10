pragma solidity 0.6.12;

import "./IRegistry.sol";

contract Executor {
  IRegistry public immutable registry;

  constructor()
    public
  {
    registry = IRegistry(msg.sender);
  }

  function canExecute()
    public
    view
    returns (bool success)
  {
    return registry.queryJob();
  }

  function execute(
    bytes calldata _
  )
    external
  {
    (bool success) = canExecute();
    require(success, "!canExecute");
    registry.executeJob(msg.sender);
  }

}
