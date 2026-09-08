// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { Context } from "swap-vm/libs/VM.sol";
import { IPriceOracle } from "swap-vm/instructions/interfaces/IPriceOracle.sol";

library OracleAnchorArgsBuilder {
    error OracleAnchorMissingArgs();

    uint256 internal constant DEPTH_ONE = 1e6;   // depth multiplier scale: 1e6 means the real balance
    uint256 internal constant HEADER = 6;        // maxStaleness (2) + depth (4)
    uint256 internal constant ENTRY = 63;        // oracle (20) + base (20) + quote (20) + three decimals

    /// @dev One anchored pair: the oracle answers `latestRoundData()` with the price of one `base` in `quote`.
    struct Pair { address oracle; address base; address quote; uint8 oracleDecimals; uint8 baseDecimals; uint8 quoteDecimals; }

    /// @param maxStaleness seconds after which an answer is refused, 0 for no check
    /// @param depth        virtual depth of the curve as a multiple of the real balance, 1e6 = 1x
    /// @param pairs        the pairs this strategy anchors; a swap on any other pair reverts
    function build(uint16 maxStaleness, uint32 depth, Pair[] memory pairs) internal pure returns (bytes memory out) {
        out = abi.encodePacked(maxStaleness, depth);
        for (uint256 i = 0; i < pairs.length; i++) {
            out = abi.encodePacked(out, pairs[i].oracle, pairs[i].base, pairs[i].quote, pairs[i].oracleDecimals, pairs[i].baseDecimals, pairs[i].quoteDecimals);
        }
    }

    /// @dev A single anchored pair, the common case.
    function build(address oracle, address base, address quote, uint8 oracleDecimals, uint8 baseDecimals, uint8 quoteDecimals, uint16 maxStaleness, uint32 depth)
        internal pure returns (bytes memory)
    {
        Pair[] memory pairs = new Pair[](1);
        pairs[0] = Pair(oracle, base, quote, oracleDecimals, baseDecimals, quoteDecimals);
        return build(maxStaleness, depth, pairs);
    }
}

/// @title OracleAnchor
/// @notice Re-centres the curve on an oracle price before the swap instruction runs. The virtual
///   balance of the incoming token is the real one times a depth multiplier; the virtual balance of
///   the outgoing token is what that amount is worth at the oracle price. A constant-product swap
///   over these balances then executes at the oracle price with slippage set by the depth, whichever
///   way the taker trades. The real ledger still bounds what can leave, so a deep virtual curve
///   never promises more than the maker holds.
///   One instruction carries a table of pairs, so a strategy shipped with several tokens quotes
///   every pair from one ledger, each at its own reference. The table is what keeps the quotes
///   coherent: a taker who loops through three pairs meets three live prices, not one stale one.
/// @dev Not middleware: it rewrites the balance registers and lets the program continue. It must run
///   before amounts are computed. A swap on a pair the table does not name reverts.
abstract contract OracleAnchor {
    using SafeCast for int256;

    error OracleAnchorShouldBeAppliedBeforeSwapAmountsComputation();
    error OracleAnchorUnknownPair(address tokenIn, address tokenOut);
    error OracleAnchorStale(uint256 currentTime, uint256 updatedAt, uint16 maxStaleness);
    error OracleAnchorEmptyCurve();

    /// @param args.maxStaleness | 2 bytes
    /// @param args.depth        | 4 bytes (1e6 = 1x)
    /// @param args.pairs        | N x 63 bytes: oracle, base, quote, oracleDecimals, baseDecimals, quoteDecimals
    function _oracleAnchorXD(Context memory ctx, bytes calldata args) internal view {
        require(ctx.swap.amountIn == 0 || ctx.swap.amountOut == 0, OracleAnchorShouldBeAppliedBeforeSwapAmountsComputation());
        require(args.length >= OracleAnchorArgsBuilder.HEADER + OracleAnchorArgsBuilder.ENTRY, OracleAnchorArgsBuilder.OracleAnchorMissingArgs());
        uint16 maxStaleness = uint16(bytes2(args[0:2]));
        uint32 depth = uint32(bytes4(args[2:6]));
        address tokenIn = ctx.query.tokenIn; address tokenOut = ctx.query.tokenOut;

        (address oracle, bool baseIn, uint8 oracleDecimals, uint8 baseDecimals, uint8 quoteDecimals) = _lookup(args, tokenIn, tokenOut);

        (, int256 answer, , uint256 updatedAt, ) = IPriceOracle(oracle).latestRoundData();
        require(maxStaleness == 0 || block.timestamp <= updatedAt + maxStaleness, OracleAnchorStale(block.timestamp, updatedAt, maxStaleness));
        uint256 price = answer.toUint256();   // quote per base, scaled by 10^oracleDecimals

        uint256 virtualIn = ctx.swap.balanceIn * depth / OracleAnchorArgsBuilder.DEPTH_ONE;
        uint256 virtualOut = baseIn
            ? Math.mulDiv(virtualIn, price * 10 ** quoteDecimals, 10 ** (uint256(oracleDecimals) + baseDecimals))
            : Math.mulDiv(virtualIn, 10 ** (uint256(oracleDecimals) + baseDecimals), price * 10 ** quoteDecimals);
        require(virtualIn > 0 && virtualOut > 0, OracleAnchorEmptyCurve());
        ctx.swap.balanceIn = virtualIn;
        ctx.swap.balanceOut = virtualOut;
    }

    /// @dev Finds the table entry for the swap's pair in either orientation.
    function _lookup(bytes calldata args, address tokenIn, address tokenOut)
        private pure returns (address oracle, bool baseIn, uint8 oracleDecimals, uint8 baseDecimals, uint8 quoteDecimals)
    {
        for (uint256 off = OracleAnchorArgsBuilder.HEADER; off + OracleAnchorArgsBuilder.ENTRY <= args.length; off += OracleAnchorArgsBuilder.ENTRY) {
            address base = address(bytes20(args[off + 20:off + 40]));
            address quote = address(bytes20(args[off + 40:off + 60]));
            if (base == tokenIn && quote == tokenOut) baseIn = true;
            else if (base == tokenOut && quote == tokenIn) baseIn = false;
            else continue;
            return (address(bytes20(args[off:off + 20])), baseIn, uint8(args[off + 60]), uint8(args[off + 61]), uint8(args[off + 62]));
        }
        revert OracleAnchorUnknownPair(tokenIn, tokenOut);
    }
}
