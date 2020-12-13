pragma solidity 0.6.12;

contract UpkeepBase {

  modifier cannotExecute()
  {
    require(msg.sender == address(0), "only for simulated backend");
    _;
  }

}
