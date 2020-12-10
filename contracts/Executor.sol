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
    external
    view
    returns (bool success)
  {
    (success,,) = _canExecute();
  }

  function _canExecute()
    internal
    view
    returns (
      bool success,
      uint256 primaryPayment,
      uint256 secondaryPayment
    )
  {
    (success,, primaryPayment, secondaryPayment) = registry.queryJob();
  }

  function execute()
    external
  {
    (bool success, uint256 primaryPayment, uint256 secondaryPayment) = _canExecute();
    require(success, "!canExecute");
    registry.executeJob(msg.sender, primaryPayment, secondaryPayment);
  }
}
