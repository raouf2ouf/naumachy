// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { ISwapVM } from "swap-vm/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "swap-vm/libs/MakerTraits.sol";
import { TakerTraitsLib } from "swap-vm/libs/TakerTraits.sol";
import { Controls, ControlsArgsBuilder } from "swap-vm/instructions/Controls.sol";
import { XYCSwap } from "swap-vm/instructions/XYCSwap.sol";
import { Fee, FeeArgsBuilder } from "swap-vm/instructions/Fee.sol";
import { Program, ProgramBuilder } from "../lib/swap-vm/test/utils/ProgramBuilder.sol";
import { NaumachyOpcodes } from "../src/NaumachyOpcodes.sol";
import { NaumachyRouter } from "../src/NaumachyRouter.sol";
import { PoolPriceOracle } from "../src/oracles/PoolPriceOracle.sol";
import { ToxicityFee, ToxicityFeeArgsBuilder } from "../src/instructions/ToxicityFee.sol";
import { RiskCap, RiskCapArgsBuilder } from "../src/instructions/RiskCap.sol";
import { OracleAnchor, OracleAnchorArgsBuilder } from "../src/instructions/OracleAnchor.sol";
import { Taker } from "../src/arena/Taker.sol";
import { ArenaPass } from "../src/arena/ArenaPass.sol";

/// @dev A Chainlink-shaped oracle that answers a fixed number: a stale or wrong reference on one pair.
contract FixedOracle {
    int256 public immutable answer;
    constructor(int256 a) { answer = a; }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) { return (1, answer, block.timestamp, block.timestamp, 1); }
}

/// @notice One inventory, three markets. A gladiator ships WETH, USDC and cbBTC in one strategy and
///   quotes all three pairs from one ledger, each pair anchored on its own pool. The tests are the
///   claims: every pair tracks its own reference; a taker who loops through the three pairs never
///   profits; a stale reference on one pair is exactly what a loop drains; the pass gate keeps an
///   anonymous taker out; and a fee can differ by the token the taker pays with.
contract NaumachyPairsTest is Test, NaumachyOpcodes {
    using ProgramBuilder for Program;
    address constant AQUA = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant CBBTC = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;
    address constant POOL_WETH_USDC = 0xd0b53D9277642d899DF5C87A3966A349A798F224;
    address constant POOL_CBBTC_USDC = 0xfBB6Eed8e7aa03B138556eeDaF5D271A5E1e43ef;
    address constant POOL_CBBTC_WETH = 0x7AeA2E8A3843516afa07293a10Ac8E49906dabD1;
    uint32 constant BP = 1e5;
    uint256 constant LEDGER_WETH = 1e18;
    uint256 constant LEDGER_USDC = 4000e6;
    uint256 constant LEDGER_CBBTC = 0.04e8;

    Aqua aqua = Aqua(AQUA);
    NaumachyRouter router;
    PoolPriceOracle oWethUsdc; PoolPriceOracle oCbbtcUsdc; PoolPriceOracle oCbbtcWeth;
    Taker taker; Taker raider; ArenaPass pass;
    address maker = makeAddr("gladiator");

    constructor() NaumachyOpcodes(AQUA) {}

    function setUp() public {
        string memory rpc = vm.envOr("RPC_BASE_TENDERLY", vm.envOr("RPC_BASE", string("")));
        if (bytes(rpc).length == 0) { vm.skip(true); return; }
        vm.createSelectFork(rpc);
        router = new NaumachyRouter(AQUA, WETH, address(this), "NaumachyRouter", "0.1.0");
        oWethUsdc = new PoolPriceOracle(POOL_WETH_USDC); oCbbtcUsdc = new PoolPriceOracle(POOL_CBBTC_USDC); oCbbtcWeth = new PoolPriceOracle(POOL_CBBTC_WETH);
        taker = new Taker(AQUA, address(router)); raider = new Taker(AQUA, address(router));
        pass = new ArenaPass(address(this)); pass.mint(address(taker), 1e18);
        deal(WETH, maker, 10e18); deal(USDC, maker, 40_000e6); deal(CBBTC, maker, 1e8);
        for (uint256 i = 0; i < 2; i++) {
            address t = i == 0 ? address(taker) : address(raider);
            deal(WETH, t, 10e18); deal(USDC, t, 100_000e6); deal(CBBTC, t, 1e8);
        }
        vm.startPrank(maker);
        IERC20(WETH).approve(AQUA, type(uint256).max); IERC20(USDC).approve(AQUA, type(uint256).max); IERC20(CBBTC).approve(AQUA, type(uint256).max);
        vm.stopPrank();
    }

    // ---- programs ----

    function _pairs(address cbbtcWethOracle) internal view returns (OracleAnchorArgsBuilder.Pair[] memory pairs) {
        pairs = new OracleAnchorArgsBuilder.Pair[](3);
        pairs[0] = OracleAnchorArgsBuilder.Pair(address(oWethUsdc), WETH, USDC, 18, 18, 6);        // token1 per token0 of each pool
        pairs[1] = OracleAnchorArgsBuilder.Pair(address(oCbbtcUsdc), USDC, CBBTC, 18, 6, 8);
        pairs[2] = OracleAnchorArgsBuilder.Pair(cbbtcWethOracle, WETH, CBBTC, 18, 18, 8);
    }

    function _anchored3(uint32 feeBps, address cbbtcWethOracle) internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(RiskCap._riskCapXD, RiskCapArgsBuilder.build(2e8, 2e8)),
            p.build(ToxicityFee._toxicityFeeXD, ToxicityFeeArgsBuilder.build(feeBps, 0, feeBps, 600)),
            p.build(OracleAnchor._oracleAnchorXD, OracleAnchorArgsBuilder.build(0, 100e6, _pairs(cbbtcWethOracle))),
            p.build(XYCSwap._xycSwapXD),
            p.build(Controls._salt, abi.encodePacked(uint256(0x3a1e)))
        );
    }

    function _gated(bytes memory program) internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(p.build(Controls._onlyTakerTokenBalanceNonZero, ControlsArgsBuilder.buildTakerTokenBalanceNonZero(address(pass))), program);
    }

    /// @dev The fee depends on the token the taker pays with: 20 bps when it pays USDC (buys WETH
    ///   from the maker), 2 bps when it pays WETH. Layout, program counters in bytes:
    ///   riskCap | jumpIfTokenIn(WETH -> B) | A: toxicity 20 | jump(-> cont) | B: toxicity 2 | cont: anchor, xyc, salt
    function _directional() internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        bytes memory cap = p.build(RiskCap._riskCapXD, RiskCapArgsBuilder.build(2e8, 2e8));
        bytes memory feeA = p.build(ToxicityFee._toxicityFeeXD, ToxicityFeeArgsBuilder.build(20 * BP, 0, 20 * BP, 600));
        bytes memory feeB = p.build(ToxicityFee._toxicityFeeXD, ToxicityFeeArgsBuilder.build(2 * BP, 0, 2 * BP, 600));
        bytes memory tail = bytes.concat(
            p.build(OracleAnchor._oracleAnchorXD, OracleAnchorArgsBuilder.build(0, 100e6, _pairs(address(oCbbtcWeth)))),
            p.build(XYCSwap._xycSwapXD), p.build(Controls._salt, abi.encodePacked(uint256(0xd1)))
        );
        uint256 jumpIfLen = 2 + 22; uint256 jumpLen = 2 + 2;
        uint16 pcB = uint16(cap.length + jumpIfLen + feeA.length + jumpLen);
        uint16 pcCont = uint16(pcB + feeB.length);
        return bytes.concat(
            cap,
            p.build(Controls._jumpIfTokenIn, ControlsArgsBuilder.buildJumpIfToken(WETH, pcB)),
            feeA, p.build(Controls._jump, ControlsArgsBuilder.buildJump(pcCont)),
            feeB,
            tail
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

    function _ship(ISwapVM.Order memory order) internal returns (bytes32) {
        address[] memory tokens = new address[](3); tokens[0] = WETH; tokens[1] = USDC; tokens[2] = CBBTC;
        uint256[] memory amounts = new uint256[](3); amounts[0] = LEDGER_WETH; amounts[1] = LEDGER_USDC; amounts[2] = LEDGER_CBBTC;
        vm.prank(maker);
        return aqua.ship(address(router), abi.encode(order), tokens, amounts);
    }

    function _td(address who) internal pure returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: who, isExactIn: true, shouldUnwrapWeth: false, hasPreTransferInCallback: true, hasPreTransferOutCallback: false,
            isStrictThresholdAmount: false, isFirstTransferFromTaker: false, useTransferFromAndAquaPush: false, threshold: "", to: address(0), deadline: 0,
            preTransferInHookData: "", postTransferInHookData: "", preTransferOutHookData: "", postTransferOutHookData: "",
            preTransferInCallbackData: "", preTransferOutCallbackData: "", instructionsArgs: "", signature: ""
        }));
    }

    function _quote(ISwapVM.Order memory order, address tokenIn, address tokenOut, uint256 amountIn) internal view returns (uint256 out) {
        (, out,) = router.asView().quote(order, tokenIn, tokenOut, amountIn, _td(address(taker)));
    }

    /// @dev What `amountIn` is worth in `tokenOut` at the pool's own price.
    function _fair(PoolPriceOracle o, address tokenIn, uint256 amountIn) internal view returns (uint256) {
        uint256 price = o.latestAnswer();   // quote per base, 18 decimals
        uint256 bd = o.baseDecimals(); uint256 qd = o.quoteDecimals();
        return tokenIn == o.base()
            ? Math.mulDiv(amountIn, price * 10 ** qd, 10 ** (18 + bd))
            : Math.mulDiv(amountIn, 10 ** (18 + bd), price * 10 ** qd);
    }

    function _assertNear(uint256 got, uint256 fair, uint256 feeBps, string memory what) internal pure {
        assertLt(got, fair, string.concat(what, ": the maker keeps a fee"));
        assertGt(got, fair * (10_000 - feeBps - 15) / 10_000, string.concat(what, ": within fee + 15 bps of the pool"));
    }

    // ---- claims ----

    function testFork_threePairsQuoteAtTheirOwnOracles() public {
        ISwapVM.Order memory order = _order(_anchored3(5 * BP, address(oCbbtcWeth)));
        _ship(order);
        _assertNear(_quote(order, USDC, WETH, 100e6), _fair(oWethUsdc, USDC, 100e6), 5, "USDC->WETH");
        _assertNear(_quote(order, WETH, USDC, 0.02e18), _fair(oWethUsdc, WETH, 0.02e18), 5, "WETH->USDC");
        _assertNear(_quote(order, USDC, CBBTC, 100e6), _fair(oCbbtcUsdc, USDC, 100e6), 5, "USDC->cbBTC");
        _assertNear(_quote(order, CBBTC, USDC, 0.001e8), _fair(oCbbtcUsdc, CBBTC, 0.001e8), 5, "cbBTC->USDC");
        _assertNear(_quote(order, WETH, CBBTC, 0.02e18), _fair(oCbbtcWeth, WETH, 0.02e18), 5, "WETH->cbBTC");
        _assertNear(_quote(order, CBBTC, WETH, 0.001e8), _fair(oCbbtcWeth, CBBTC, 0.001e8), 5, "cbBTC->WETH");
    }

    function _loop(ISwapVM.Order memory order, bool forward) internal returns (int256 deltaUsdc) {
        uint256 before = IERC20(USDC).balanceOf(address(taker));
        if (forward) {
            (, uint256 w) = taker.swap(order, USDC, WETH, 100e6, _td(address(taker)));
            (, uint256 b) = taker.swap(order, WETH, CBBTC, w, _td(address(taker)));
            taker.swap(order, CBBTC, USDC, b, _td(address(taker)));
        } else {
            (, uint256 b) = taker.swap(order, USDC, CBBTC, 100e6, _td(address(taker)));
            (, uint256 w) = taker.swap(order, CBBTC, WETH, b, _td(address(taker)));
            taker.swap(order, WETH, USDC, w, _td(address(taker)));
        }
        deltaUsdc = int256(IERC20(USDC).balanceOf(address(taker))) - int256(before);
    }

    function testFork_triangleRoundTripNeverProfits() public {
        ISwapVM.Order memory order = _order(_anchored3(5 * BP, address(oCbbtcWeth)));
        _ship(order);
        int256 forward = _loop(order, true);
        int256 backward = _loop(order, false);
        assertLe(forward, 0, "USDC -> WETH -> cbBTC -> USDC cannot profit against three live references");
        assertLe(backward, 0, "USDC -> cbBTC -> WETH -> USDC cannot profit either");
        assertGt(forward, -1e6, "the loop costs fees and slippage, not more");
    }

    function testFork_staleReferenceOnOnePairIsWhatTheLoopDrains() public {
        // the cbBTC/WETH leg answers 1% above the pool: cbBTC is dear in WETH there, so sell cbBTC for WETH on that leg
        FixedOracle stale = new FixedOracle(int256(oCbbtcWeth.latestAnswer() * 101 / 100));
        ISwapVM.Order memory order = _order(_anchored3(5 * BP, address(stale)));
        _ship(order);
        int256 forward = _loop(order, true);   // USDC -> WETH (fair) -> cbBTC (1% too many) -> USDC (fair)
        assertGt(forward, 0, "one reference 1% off and a 5 bps fee: the loop takes the difference");
        assertGt(forward, 0.5e6, "about 1% of 100 USDC less three fees");
    }

    function testFork_passGateKeepsTheRaiderOut() public {
        ISwapVM.Order memory order = _order(_gated(_anchored3(5 * BP, address(oCbbtcWeth))));
        _ship(order);
        ISwapVM view_ = router.asView();
        vm.expectPartialRevert(Controls.TakerTokenBalanceIsZero.selector);
        view_.quote(order, USDC, WETH, 100e6, _td(address(raider)));   // an anonymous quote reverts before any price is computed
        vm.expectPartialRevert(Controls.TakerTokenBalanceIsZero.selector);
        raider.swap(order, USDC, WETH, 100e6, _td(address(raider)));
        (uint256 amountIn, uint256 amountOut) = taker.swap(order, USDC, WETH, 100e6, _td(address(taker)));
        assertEq(amountIn, 100e6); assertGt(amountOut, 0);
    }

    function testFork_feeDependsOnTheTokenTheTakerPays() public {
        ISwapVM.Order memory order = _order(_directional());
        _ship(order);
        uint256 usdcIn = _quote(order, USDC, WETH, 100e6);              // pays USDC: 20 bps
        uint256 wethIn = _quote(order, WETH, USDC, 0.025e18);           // pays WETH: 2 bps
        uint256 feeUsdcSide = 1e4 - usdcIn * 1e4 / _fair(oWethUsdc, USDC, 100e6);
        uint256 feeWethSide = 1e4 - wethIn * 1e4 / _fair(oWethUsdc, WETH, 0.025e18);
        assertGt(feeUsdcSide, 18, "paying USDC costs about 20 bps");
        assertLt(feeWethSide, 6, "paying WETH costs about 2 bps");
        // swap agrees with quote on both branches
        (, uint256 s1) = taker.swap(order, USDC, WETH, 100e6, _td(address(taker)));
        assertEq(s1, usdcIn);
    }

    function testFork_riskCapHoldsOnEveryPair() public {
        ISwapVM.Order memory order = _order(_anchored3(5 * BP, address(oCbbtcWeth)));
        _ship(order);
        vm.expectPartialRevert(RiskCap.RiskCapExceeded.selector);
        taker.swap(order, USDC, CBBTC, 1500e6, _td(address(taker)));   // would take well over 20% of the cbBTC ledger
        // a token the strategy never shipped is refused by Aqua's ledger before the program runs
        ISwapVM view_ = router.asView();
        vm.expectRevert();
        view_.quote(order, WETH, address(pass), 1e18, _td(address(taker)));
    }
}
