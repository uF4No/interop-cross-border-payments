// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";
import {Counter} from "../src/Counter.sol";

contract CounterTest is Test {
    Counter public counter;

    function setUp() public {
        counter = new Counter();
    }

    function test_Inc() public {
        counter.inc();
        assertEq(counter.x(), 1);
    }

    function testFuzz_IncBy(uint256 x) public {
        counter.incBy(x);
        assertEq(counter.x(), x);
    }
}
