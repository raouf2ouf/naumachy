// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console } from "forge-std/Script.sol";
import { NaumachyRouter } from "../src/NaumachyRouter.sol";
import { PoolPriceOracle } from "../src/oracles/PoolPriceOracle.sol";
import { Taker } from "../src/arena/Taker.sol";
import { TakerData } from "../src/arena/TakerData.sol";
import { ArenaPass } from "../src/arena/ArenaPass.sol";
import { ArenaRegistry } from "../src/ArenaRegistry.sol";

/// @dev Deploys the router against the canonical Aqua registry, one pool oracle per arena pair, two
///   takers (one holding an arena pass, one anonymous), the pass token and the registry. The same
///   script serves the gym (an anvil fork of Base) and the live arena on Base; the chain decides
///   nothing. Env: AQUA, WETH, POOL_WETH_USDC, POOL_CBBTC_USDC, POOL_CBBTC_WETH (Base defaults),
///   ROUTER_OWNER and LANISTA (default the broadcaster).
contract Deploy is Script {
    function run() external {
        address aqua = vm.envOr("AQUA", 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a);
        address weth = vm.envOr("WETH", 0x4200000000000000000000000000000000000006);
        address poolWethUsdc = vm.envOr("POOL_WETH_USDC", vm.envOr("POOL", 0xd0b53D9277642d899DF5C87A3966A349A798F224));
        address poolCbbtcUsdc = vm.envOr("POOL_CBBTC_USDC", 0xfBB6Eed8e7aa03B138556eeDaF5D271A5E1e43ef);
        address poolCbbtcWeth = vm.envOr("POOL_CBBTC_WETH", 0x7AeA2E8A3843516afa07293a10Ac8E49906dabD1);
        vm.startBroadcast();
        address owner = vm.envOr("ROUTER_OWNER", msg.sender);
        address lanista = vm.envOr("LANISTA", msg.sender);
        NaumachyRouter router = new NaumachyRouter(aqua, weth, owner, "NaumachyRouter", "0.1.0");
        PoolPriceOracle oracle = new PoolPriceOracle(poolWethUsdc);
        PoolPriceOracle oracleCbbtcUsdc = new PoolPriceOracle(poolCbbtcUsdc);
        PoolPriceOracle oracleCbbtcWeth = new PoolPriceOracle(poolCbbtcWeth);
        Taker taker = new Taker(aqua, address(router));
        Taker raider = new Taker(aqua, address(router));
        TakerData takerData = new TakerData();
        ArenaPass pass = new ArenaPass(lanista);
        if (lanista == msg.sender) pass.mint(address(taker), 1e18);   // routed flow carries a pass; the raider stays anonymous
        ArenaRegistry arena = new ArenaRegistry(lanista);
        vm.stopBroadcast();
        console.log("TakerData", address(takerData));
        console.log("ArenaRegistry", address(arena), "lanista", arena.owner());
        console.log("NaumachyRouter", address(router));
        console.log("PoolPriceOracle WETH/USDC", address(oracle), oracle.latestAnswer());
        console.log("PoolPriceOracle USDC/cbBTC", address(oracleCbbtcUsdc), oracleCbbtcUsdc.latestAnswer());
        console.log("PoolPriceOracle WETH/cbBTC", address(oracleCbbtcWeth), oracleCbbtcWeth.latestAnswer());
        console.log("Taker (pass)", address(taker));
        console.log("Taker (raider)", address(raider));
        console.log("ArenaPass", address(pass));
    }
}
