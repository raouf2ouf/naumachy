// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { ArenaRegistry } from "../src/ArenaRegistry.sol";

contract ArenaRegistryTest is Test {
    ArenaRegistry registry;
    address lanista = makeAddr("lanista");
    address spartacus = makeAddr("spartacus");
    address crixus = makeAddr("crixus");
    bytes32 constant S1 = keccak256("strategy-1");
    bytes32 constant S2 = keccak256("strategy-2");
    bytes32 constant ANCHORED = "anchored-amm";
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function setUp() public { registry = new ArenaRegistry(lanista); }

    function test_lifecycle() public {
        vm.prank(spartacus); registry.register("spartacus", address(0));
        vm.prank(crixus); registry.register("crixus", spartacus);          // lineage
        (, uint32 born, address parent,) = registry.gladiators(crixus);
        assertEq(born, 0); assertEq(parent, spartacus);

        vm.prank(lanista); uint32 g = registry.openGeneration("tape-a");
        assertEq(g, 0);
        vm.prank(spartacus); registry.enter(S1, ANCHORED);
        vm.prank(crixus); registry.enter(S2, ANCHORED);
        assertEq(registry.entries(0).length, 2);

        vm.startPrank(lanista);
        registry.score(0, spartacus, S1, 12_500_000, 900_000, 41, USDC);   // +12.5 USDC, se 0.9, 41 fills
        registry.score(0, crixus, S2, -3_000_000, 1_200_000, 17, USDC);
        registry.closeGeneration(0, spartacus, S1, 12_500_000);
        vm.stopPrank();
        (int256 sq, int256 se, uint32 fills, address quote, bool attested) = registry.scores(0, S1);
        assertEq(sq, 12_500_000); assertEq(se, 900_000); assertEq(fills, 41); assertEq(quote, USDC); assertTrue(attested);
        (,, uint64 closedAt, address champion, bytes32 cs, int256 cscore) = registry.generations(0);
        assertGt(closedAt, 0); assertEq(champion, spartacus); assertEq(cs, S1); assertEq(cscore, 12_500_000);

        vm.prank(lanista); registry.promote(spartacus, S1, 8453, 1_000e6);
        vm.prank(lanista); uint32 g1 = registry.openGeneration("tape-b");
        assertEq(g1, 1);
    }

    function test_guards() public {
        vm.expectRevert(abi.encodeWithSelector(ArenaRegistry.NoOpenGeneration.selector));
        registry.currentGeneration();
        vm.prank(spartacus); registry.register("spartacus", address(0));
        vm.prank(spartacus); vm.expectRevert(abi.encodeWithSelector(ArenaRegistry.AlreadyRegistered.selector, spartacus)); registry.register("again", address(0));
        vm.prank(crixus); vm.expectRevert(abi.encodeWithSelector(ArenaRegistry.UnknownParent.selector, crixus)); registry.register("crixus", crixus);
        vm.prank(spartacus); vm.expectRevert(abi.encodeWithSelector(ArenaRegistry.NoOpenGeneration.selector)); registry.enter(S1, ANCHORED);
        vm.prank(lanista); registry.openGeneration("tape");
        vm.prank(crixus); vm.expectRevert(abi.encodeWithSelector(ArenaRegistry.NotRegistered.selector, crixus)); registry.enter(S2, ANCHORED);
        vm.prank(lanista); vm.expectRevert(abi.encodeWithSelector(ArenaRegistry.NotEntered.selector, uint32(0), spartacus, S1)); registry.score(0, spartacus, S1, 1, 0, 1, USDC);
        vm.prank(lanista); vm.expectRevert(abi.encodeWithSelector(ArenaRegistry.GenerationStillOpen.selector, uint32(0))); registry.openGeneration("tape-2");
        vm.prank(spartacus); vm.expectRevert(); registry.openGeneration("not the lanista");
    }
}
