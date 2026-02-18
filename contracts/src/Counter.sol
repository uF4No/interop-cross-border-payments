// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

contract Counter {
    uint256 public x = 0;

    function incBy(uint256 y) public {
        x = x + y;
    }

    function inc() public {
        x++;
    }
}
