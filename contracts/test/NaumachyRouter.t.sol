// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { ISwapVM } from "swap-vm/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "swap-vm/libs/MakerTraits.sol";
import { TakerTraitsLib } from "swap-vm/libs/TakerTraits.sol";
import { Controls } from "swap-vm/instructions/Controls.sol";
import { XYCSwap } from "swap-vm/instructions/XYCSwap.sol";
import { Program, ProgramBuilder } from "../lib/swap-vm/test/utils/ProgramBuilder.sol";
import { NaumachyOpcodes } from "../src/NaumachyOpcodes.sol";
import { NaumachyRouter } from "../src/NaumachyRouter.sol";
import { PoolPriceOracle } from "../src/oracles/PoolPriceOracle.sol";
import { ToxicityFee, ToxicityFeeArgsBuilder } from "../src/instructions/ToxicityFee.sol";
import { RiskCap, RiskCapArgsBuilder } from "../src/instructions/RiskCap.sol";
import { OracleAnchor, OracleAnchorArgsBuilder } from "../src/instructions/OracleAnchor.sol";
import { Taker } from "../src/arena/Taker.sol";

/// @dev First blood on a fork of Base: the canonical Aqua registry, real WETH and USDC, our router,
///   a gladiator anchored to the WETH/USDC 0.05% pool. Needs RPC_BASE_TENDERLY (or RPC_BASE).
contract NaumachyRouterTest is Test, NaumachyOpcodes {
    using ProgramBuilder for Program;

    address constant AQUA = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant POOL = 0xd0b53D9277642d899DF5C87A3966A349A798F224;   // WETH/USDC 0.05%

    uint32 constant BP = 1e5;              // one basis point on the 1e9 scale
    uint256 constant LEDGER_WETH = 1e18;
    uint256 constant LEDGER_USDC = 4000e6;

    Aqua aqua = Aqua(AQUA);
    NaumachyRouter router;
    PoolPriceOracle oracle;
    Taker taker;
    address maker = makeAddr("gladiator");
    ISwapVM.Order order;
    bytes32 strategyHash;

    constructor() NaumachyOpcodes(AQUA) {}

    function setUp() public {
        string memory rpc = vm.envOr("RPC_BASE_TENDERLY", vm.envOr("RPC_BASE", string("")));
        if (bytes(rpc).length == 0) { vm.skip(true); return; }
        vm.createSelectFork(rpc);

        oracle = new PoolPriceOracle(POOL);
        router = new NaumachyRouter(AQUA, WETH, address(this), "NaumachyRouter", "0.1.0");
        taker = new Taker(AQUA, address(router));

        deal(WETH, maker, 10e18);
        deal(USDC, maker, 40_000e6);
        deal(WETH, address(taker), 10e18);
        deal(USDC, address(taker), 100_000e6);

        order = _order(_gladiatorProgram());
        vm.startPrank(maker);
        IERC20(WETH).approve(AQUA, type(uint256).max);
        IERC20(USDC).approve(AQUA, type(uint256).max);
        address[] memory tokens = new address[](2); tokens[0] = WETH; tokens[1] = USDC;
        uint256[] memory amounts = new uint256[](2); amounts[0] = LEDGER_WETH; amounts[1] = LEDGER_USDC;
        strategyHash = aqua.ship(address(router), abi.encode(order), tokens, amounts);
        vm.stopPrank();
    }

    // RiskCap 20% a side > ToxicityFee 5 bps base, +200 bps per full drain, 50 bps ceiling, 10 min memory
    // > OracleAnchor on the pool, depth 100x > XYCSwap > Salt
    function _gladiatorProgram() internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(RiskCap._riskCapXD, RiskCapArgsBuilder.build(2e8, 2e8)),
            p.build(ToxicityFee._toxicityFeeXD, ToxicityFeeArgsBuilder.build(5 * BP, 200 * BP, 50 * BP, 600)),
            p.build(OracleAnchor._oracleAnchorXD, OracleAnchorArgsBuilder.build(address(oracle), WETH, USDC, 18, 18, 6, 0, 100e6)),
            p.build(XYCSwap._xycSwapXD),
            p.build(Controls._salt, abi.encodePacked(uint256(0x5a17)))
        );
    }

    function _order(bytes memory program) internal view returns (ISwapVM.Order memory) {
        return MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: maker, shouldUnwrapWeth: false, useAquaInsteadOfSignature: true, allowZeroAmountIn: false, receiver: address(0),
            hasPreTransferInHook: false, hasPostTransferInHook: false, hasPreTransferOutHook: false, hasPostTransferOutHook: false,
            preTransferInTarget: address(0), preTransferInData: "", postTransferInTarget: address(0), postTransferInData: "",
            preTransferOutTarget: address(0), preTransferOutData: "", postTransferOutTarget: address(0), postTransferOutData: "",
            program: program
        }));
    }

    function _takerData(bool isExactIn) internal view returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: address(taker), isExactIn: isExactIn, shouldUnwrapWeth: false, hasPreTransferInCallback: true, hasPreTransferOutCallback: false,
            isStrictThresholdAmount: false, isFirstTransferFromTaker: false, useTransferFromAndAquaPush: false, threshold: "", to: address(0), deadline: 0,
            preTransferInHookData: "", postTransferInHookData: "", preTransferOutHookData: "", postTransferOutHookData: "",
            preTransferInCallbackData: "", preTransferOutCallbackData: "", instructionsArgs: "", signature: ""
        }));
    }

    function _quote(address tokenIn, address tokenOut, uint256 amount, bool isExactIn) internal view returns (uint256 amountIn, uint256 amountOut) {
        (amountIn, amountOut,) = router.asView().quote(order, tokenIn, tokenOut, amount, _takerData(isExactIn));
    }

    function _swap(address tokenIn, address tokenOut, uint256 amount, bool isExactIn) internal returns (uint256 amountIn, uint256 amountOut) {
        return taker.swap(order, tokenIn, tokenOut, amount, _takerData(isExactIn));
    }

    // USDC in for WETH out: how much WETH the pool price says `usdc` is worth
    function _wethFor(uint256 usdc) internal view returns (uint256) {
        return usdc * 1e18 * 1e18 / (oracle.latestAnswer() * 1e6);
    }

    function testFork_shipMatchesRouterHash() public view {
        assertEq(strategyHash, router.hash(order), "Aqua strategy hash is the router's order hash");
        (uint256 w, uint256 u) = aqua.safeBalances(maker, address(router), strategyHash, WETH, USDC);
        assertEq(w, LEDGER_WETH); assertEq(u, LEDGER_USDC);
    }

    function testFork_quoteTracksThePoolBothWays() public view {
        (, uint256 wethOut) = _quote(USDC, WETH, 100e6, true);
        uint256 fair = _wethFor(100e6);
        assertLt(wethOut, fair, "the maker keeps a fee");
        assertGt(wethOut, fair * 998 / 1000, "within 20 bps of the pool: 5 bps fee plus slippage at 100x depth");

        (, uint256 usdcOut) = _quote(WETH, USDC, 0.025e18, true);
        uint256 fairUsdc = 0.025e18 * oracle.latestAnswer() * 1e6 / 1e36;
        assertLt(usdcOut, fairUsdc); assertGt(usdcOut, fairUsdc * 998 / 1000);
    }

    function testFork_swapMovesRealTokens() public {
        uint256 takerWeth = IERC20(WETH).balanceOf(address(taker));
        uint256 takerUsdc = IERC20(USDC).balanceOf(address(taker));
        uint256 makerWeth = IERC20(WETH).balanceOf(maker);
        uint256 makerUsdc = IERC20(USDC).balanceOf(maker);

        (uint256 amountIn, uint256 amountOut) = _swap(USDC, WETH, 100e6, true);

        assertEq(amountIn, 100e6);
        assertEq(IERC20(USDC).balanceOf(address(taker)), takerUsdc - amountIn, "taker paid USDC");
        assertEq(IERC20(WETH).balanceOf(address(taker)), takerWeth + amountOut, "taker received WETH");
        assertEq(IERC20(USDC).balanceOf(maker), makerUsdc + amountIn, "maker received USDC in its own wallet");
        assertEq(IERC20(WETH).balanceOf(maker), makerWeth - amountOut, "maker gave WETH from its own wallet");
        (uint256 w, uint256 u) = aqua.safeBalances(maker, address(router), strategyHash, WETH, USDC);
        assertEq(w, LEDGER_WETH - amountOut, "ledger WETH down"); assertEq(u, LEDGER_USDC + amountIn, "ledger USDC up");
    }

    function testFork_quoteEqualsSwap() public {
        (uint256 qIn, uint256 qOut) = _quote(USDC, WETH, 250e6, true);
        (uint256 sIn, uint256 sOut) = _swap(USDC, WETH, 250e6, true);
        assertEq(qIn, sIn); assertEq(qOut, sOut);
        (uint256 qIn2, uint256 qOut2) = _quote(WETH, USDC, 25e6, false);   // exact out: 25 USDC
        (uint256 sIn2, uint256 sOut2) = _swap(WETH, USDC, 25e6, false);
        assertEq(qIn2, sIn2); assertEq(qOut2, sOut2);
    }

    // 200 USDC is about 8% of the WETH ledger at the fork's price, well under the 20% cap
    function testFork_toxicityFeeWidensThenForgets() public {
        (, uint256 out1) = _quote(USDC, WETH, 200e6, true);
        _swap(USDC, WETH, 200e6, true);
        (, uint256 out2) = _quote(USDC, WETH, 200e6, true);
        uint256 unitBefore = out1 * 1e18 / 200e6; uint256 unitAfter = out2 * 1e18 / 200e6;
        assertLt(unitAfter, unitBefore, "after a drain in the same direction the same USDC buys less WETH");
        // the fee grew: the pressure term, not just curve slippage
        assertGt((unitBefore - unitAfter) * 1e4 / unitBefore, 10, "more than 10 bps worse");

        vm.warp(block.timestamp + 601);       // the memory has decayed to nothing
        (, uint256 out3) = _quote(USDC, WETH, 200e6, true);
        assertApproxEqRel(out3 * 1e18 / 200e6, unitBefore, 0.003e18, "back to the base fee once the window has passed");
    }

    function testFork_reverseFlowRelievesTheFee() public {
        _swap(USDC, WETH, 200e6, true);                     // drain WETH
        (, uint256 drained) = _quote(USDC, WETH, 100e6, true);
        _swap(WETH, USDC, 0.05e18, true);                   // WETH comes back
        (, uint256 relieved) = _quote(USDC, WETH, 100e6, true);
        assertGt(relieved, drained, "a fill in the other direction relieves the pressure");
    }

    function testFork_riskCapStopsLargeFills() public {
        vm.expectPartialRevert(RiskCap.RiskCapExceeded.selector);
        _swap(USDC, WETH, 900e6, true);     // 900 USDC in is over 20% of the 4000 USDC ledger balance
        ISwapVM view_ = router.asView();
        vm.expectPartialRevert(RiskCap.RiskCapExceeded.selector);
        view_.quote(order, USDC, WETH, 900e6, _takerData(true));    // and the quote says so too
        _swap(USDC, WETH, 300e6, true);     // under both caps goes through
    }

    function testFork_roundTripGivesNoFreeMoney() public {
        uint256 before = IERC20(USDC).balanceOf(address(taker));
        (, uint256 weth) = _swap(USDC, WETH, 300e6, true);
        _swap(WETH, USDC, weth, true);
        assertLe(IERC20(USDC).balanceOf(address(taker)), before, "crossing the spread twice cannot profit the taker");
    }

    function testFork_oracleAnswersThePoolPrice() public view {
        uint256 p = oracle.latestAnswer();
        assertGt(p, 500e18); assertLt(p, 50_000e18);   // a sane USDC per WETH on the day of the fork
        assertEq(oracle.base(), WETH); assertEq(oracle.quote(), USDC);
    }
}
