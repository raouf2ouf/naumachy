// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Calldata } from "@1inch/solidity-utils/contracts/libraries/Calldata.sol";
import { Context, ContextLib } from "swap-vm/libs/VM.sol";
import { Fee, BPS } from "swap-vm/instructions/Fee.sol";

/// @dev Arguments of the toxicity fee: four 4-byte words.
library ToxicityFeeArgsBuilder {
    using Calldata for bytes;

    error ToxicityFeeMissingArgs();
    error ToxicityFeeBpsOutOfRange(uint32 bps);

    /// @param baseBps  fee charged with no recent one-way flow (1e9 = 100%)
    /// @param slopeBps fee added per 100% of the outgoing token's balance drained inside the window
    /// @param maxBps   ceiling of the fee
    /// @param window   seconds over which recent flow decays linearly to nothing
    function build(uint32 baseBps, uint32 slopeBps, uint32 maxBps, uint32 window) internal pure returns (bytes memory) {
        require(baseBps <= BPS && maxBps <= BPS, ToxicityFeeBpsOutOfRange(baseBps > maxBps ? baseBps : maxBps));
        return abi.encodePacked(baseBps, slopeBps, maxBps, window);
    }

    function parse(bytes calldata args) internal pure returns (uint32 baseBps, uint32 slopeBps, uint32 maxBps, uint32 window) {
        baseBps = uint32(bytes4(args.slice(0, 4, ToxicityFeeMissingArgs.selector)));
        slopeBps = uint32(bytes4(args.slice(4, 8, ToxicityFeeMissingArgs.selector)));
        maxBps = uint32(bytes4(args.slice(8, 12, ToxicityFeeMissingArgs.selector)));
        window = uint32(bytes4(args.slice(12, 16, ToxicityFeeMissingArgs.selector)));
    }
}

/// @title ToxicityFee
/// @notice A maker fee that widens with recent one-way flow. Every fill records how much of the
///   outgoing token the strategy gave away; that memory decays linearly over a window. The fee on
///   the next fill in the same direction grows with the share of the balance drained inside the
///   window, and a fill in the other direction relieves it. Static curves on Aqua bleed to takers
///   who arrive exactly when a quote is stale; this instruction makes the stale side expensive.
/// @dev Middleware, like the flat fee: it must run before the swap amounts are computed, executes
///   the rest of the program nested inside itself, and keeps the fee with the maker. Storage is per
///   order hash and token, the DynamicBalances pattern. In quote mode the fee is computed from the
///   same storage and nothing is written, so quote and swap agree within a block.
abstract contract ToxicityFee is Fee {
    using ContextLib for Context;

    /// @notice Recent outflow of a token from a strategy, decayed at read time.
    mapping(bytes32 orderHash => mapping(address token => uint256)) public recentOutflow;
    /// @notice When the strategy's flow memory was last written.
    mapping(bytes32 orderHash => uint64) public lastFlowAt;

    /// @param args.baseBps  | 4 bytes
    /// @param args.slopeBps | 4 bytes
    /// @param args.maxBps   | 4 bytes
    /// @param args.window   | 4 bytes (seconds)
    function _toxicityFeeXD(Context memory ctx, bytes calldata args) internal {
        (uint32 baseBps, uint32 slopeBps, uint32 maxBps, uint32 window) = ToxicityFeeArgsBuilder.parse(args);
        bytes32 orderHash = ctx.query.orderHash;
        uint64 last = lastFlowAt[orderHash];
        uint256 drainedOut = _decayed(recentOutflow[orderHash][ctx.query.tokenOut], last, window);
        uint256 drainedIn = _decayed(recentOutflow[orderHash][ctx.query.tokenIn], last, window);

        // pressure: the share of the outgoing token's balance that left inside the window
        uint256 balanceOut = ctx.swap.balanceOut;
        uint256 feeBps = baseBps;
        if (balanceOut > 0 && drainedOut > 0) {
            uint256 pressure = drainedOut >= balanceOut ? BPS : drainedOut * BPS / balanceOut;
            feeBps += uint256(slopeBps) * pressure / BPS;
        }
        if (feeBps > maxBps) feeBps = maxBps;

        _feeAmountIn(ctx, feeBps);   // runs the rest of the program nested, keeps the fee with the maker

        if (!ctx.vm.isStaticContext) {
            recentOutflow[orderHash][ctx.query.tokenOut] = drainedOut + ctx.swap.amountOut;
            recentOutflow[orderHash][ctx.query.tokenIn] = drainedIn > ctx.swap.amountIn ? drainedIn - ctx.swap.amountIn : 0;
            lastFlowAt[orderHash] = uint64(block.timestamp);
        }
    }

    /// @dev Linear decay to zero over `window` seconds since `last`; a zero window keeps no memory.
    function _decayed(uint256 value, uint64 last, uint32 window) internal view returns (uint256) {
        if (value == 0 || last == 0 || window == 0) return 0;
        uint256 dt = block.timestamp - last;
        if (dt >= window) return 0;
        return value * (window - dt) / window;
    }
}
