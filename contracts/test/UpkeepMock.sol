pragma solidity 0.6.12;

import '../UpkeepCompatible.sol';

contract UpkeepMock is UpkeepCompatible {
  bool public canExecute;

  event UpkeepPerformedWith(bytes upkeepData);

  function setCanExecute(bool value)
    public
  {
    canExecute = value;
  }

  function checkForUpkeep(bytes calldata data)
    external
    override
    cannotExecute()
    returns (
      bool callable,
      bytes calldata executedata
    )
  {
    bool couldExecute = canExecute;

    setCanExecute(false); // test that state modifcations don't stick

    return (couldExecute, data);
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
