pragma solidity 0.6.12;

import '../UpkeptInterface.sol';

contract Dummy is UpkeptInterface {
  bool internal _canExecute;

  function setCanExecute(bool _value) public {
    _canExecute = _value;
  }

  function checkForUpkeep(bytes calldata data)
    public
    override
    returns (
      bool callable,
      bytes calldata executedata
    )
  {
    return (_canExecute, data);
  }

  function performUpkeep(
    bytes calldata
  )
    external
    override
  {
    require(_canExecute, "Cannot execute");
    setCanExecute(false);
  }

  function alwaysFails() external {
    assert(false);
  }

  function kill() external {
    selfdestruct(msg.sender);
  }
}
