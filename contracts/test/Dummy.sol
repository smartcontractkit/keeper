pragma solidity 0.6.12;

contract Dummy {
  bool internal _canExecute;

  function setCanExecute(bool _value) public {
    _canExecute = _value;
  }

  function canExecute() public view returns (bool) {
    return _canExecute;
  }

  function execute() external {
    require(canExecute(), "Cannot execute");
    setCanExecute(false);
  }

  function alwaysFails() external {
    assert(false);
  }

  function kill() external {
    selfdestruct(msg.sender);
  }
}
