pragma solidity 0.7.6;

import './UpkeepBase.sol';
import './UpkeepInterface.sol';

abstract contract UpkeepCompatible is UpkeepBase, UpkeepInterface {}
