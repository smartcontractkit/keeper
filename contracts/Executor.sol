pragma solidity 0.6.12;

import "./IExecutor.sol";
import "./IRegistry.sol";

contract Executor is IExecutor {
  IRegistry public immutable registry;

  constructor()
    public
  {
    registry = IRegistry(msg.sender);
  }

  function canExecute()
    external
    view
    override
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
    override
  {
    (bool success, uint256 primaryPayment, uint256 secondaryPayment) = _canExecute();
    require(success, "!canExecute");
    registry.executeJob(msg.sender, primaryPayment, secondaryPayment);
  }
}
