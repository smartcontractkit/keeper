pragma solidity 0.6.12;

import '../UpkeptInterface.sol';

contract UpkeptMock is UpkeptInterface {
  bool private canExecute;

  event UpkeepPerformedWith(bytes upkeepData);

  function setCanExecute(bool value)
    public
  {
    canExecute = value;
  }

  function checkForUpkeep(bytes calldata data)
    public
    override
    returns (
      bool callable,
      bytes calldata executedata
    )
  {
    return (canExecute, data);
  }

  function performUpkeep(
    bytes calldata data
  )
    external
    override
  {
    require(canExecute, "Cannot execute");

    setCanExecute(false);

    emit UpkeepPerformedWith(data);
  }

}
