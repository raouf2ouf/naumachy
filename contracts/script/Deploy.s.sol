// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console } from "forge-std/Script.sol";
import { NaumachyRouter } from "../src/NaumachyRouter.sol";
import { PoolPriceOracle } from "../src/oracles/PoolPriceOracle.sol";
import { Taker } from "../src/arena/Taker.sol";
import { TakerData } from "../src/arena/TakerData.sol";

/// @dev Deploys the router against the canonical Aqua registry and one pool oracle. The same script
///   serves the gym (an anvil fork of Base) and the live arena on Base; the chain decides nothing.
///   Env: AQUA (default canonical), WETH (default Base), POOL (default WETH/USDC 0.05% on Base),
///   ROUTER_OWNER (default the broadcaster).
contract Deploy is Script {
    function run() external {
        address aqua = vm.envOr("AQUA", 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a);
        address weth = vm.envOr("WETH", 0x4200000000000000000000000000000000000006);
        address pool = vm.envOr("POOL", 0xd0b53D9277642d899DF5C87A3966A349A798F224);
        vm.startBroadcast();
        address owner = vm.envOr("ROUTER_OWNER", msg.sender);
        NaumachyRouter router = new NaumachyRouter(aqua, weth, owner, "NaumachyRouter", "0.1.0");
        PoolPriceOracle oracle = new PoolPriceOracle(pool);
        Taker taker = new Taker(aqua, address(router));
        TakerData takerData = new TakerData();
        vm.stopBroadcast();
        console.log("TakerData", address(takerData));
        console.log("NaumachyRouter", address(router));
        console.log("PoolPriceOracle", address(oracle), "base", oracle.base());
        console.log("Taker", address(taker));
        console.log("pool price, quote per base, 18 decimals", oracle.latestAnswer());
    }
}
