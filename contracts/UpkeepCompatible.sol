pragma solidity 0.6.12;

import './UpkeepBase.sol';
import './UpkeepInterface.sol';

abstract contract UpkeepCompatible is UpkeepBase, UpkeepInterface {}
