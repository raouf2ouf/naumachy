// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { Calldata } from "@1inch/solidity-utils/contracts/libraries/Calldata.sol";
import { Context } from "swap-vm/libs/VM.sol";
import { IPriceOracle } from "swap-vm/instructions/interfaces/IPriceOracle.sol";

library OracleAnchorArgsBuilder {
    using Calldata for bytes;

    error OracleAnchorMissingArgs();

    uint256 internal constant DEPTH_ONE = 1e6;   // depth multiplier scale: 1e6 means the real balance

    /// @param oracle         answers latestRoundData() with the price of one `base` in the other token
    /// @param base           the token the oracle prices
    /// @param oracleDecimals decimals of the oracle answer
    /// @param baseDecimals   decimals of `base`
    /// @param quoteDecimals  decimals of the other token of the pair
    /// @param maxStaleness   seconds after which the answer is refused, 0 for no check
    /// @param depth          virtual depth of the curve as a multiple of the real balance, 1e6 = 1x
    function build(address oracle, address base, uint8 oracleDecimals, uint8 baseDecimals, uint8 quoteDecimals, uint16 maxStaleness, uint32 depth)
        internal pure returns (bytes memory)
    {
        return abi.encodePacked(oracle, base, oracleDecimals, baseDecimals, quoteDecimals, maxStaleness, depth);
    }

    function parse(bytes calldata args) internal pure returns (address oracle, address base, uint8 oracleDecimals, uint8 baseDecimals, uint8 quoteDecimals, uint16 maxStaleness, uint32 depth) {
        oracle = address(bytes20(args.slice(0, 20, OracleAnchorMissingArgs.selector)));
        base = address(bytes20(args.slice(20, 40, OracleAnchorMissingArgs.selector)));
        oracleDecimals = uint8(bytes1(args.slice(40, 41, OracleAnchorMissingArgs.selector)));
        baseDecimals = uint8(bytes1(args.slice(41, 42, OracleAnchorMissingArgs.selector)));
        quoteDecimals = uint8(bytes1(args.slice(42, 43, OracleAnchorMissingArgs.selector)));
        maxStaleness = uint16(bytes2(args.slice(43, 45, OracleAnchorMissingArgs.selector)));
        depth = uint32(bytes4(args.slice(45, 49, OracleAnchorMissingArgs.selector)));
    }
}

/// @title OracleAnchor
/// @notice Re-centres the curve on an oracle price before the swap instruction runs. The virtual
///   balance of the incoming token is the real one times a depth multiplier; the virtual balance of
///   the outgoing token is what that amount is worth at the oracle price. A constant-product swap
///   over these balances then executes at the oracle price with slippage set by the depth, whichever
///   way the taker trades. The real ledger still bounds what can leave, so a deep virtual curve
///   never promises more than the maker holds.
/// @dev Not middleware: it rewrites the balance registers and lets the program continue. It must run
///   before amounts are computed. Pair-bound: both tokens of the swap must be the oracle's base and
///   the other token of the pair.
abstract contract OracleAnchor {
    using SafeCast for int256;

    error OracleAnchorShouldBeAppliedBeforeSwapAmountsComputation();
    error OracleAnchorUnknownToken(address tokenIn, address tokenOut);
    error OracleAnchorStale(uint256 currentTime, uint256 updatedAt, uint16 maxStaleness);
    error OracleAnchorEmptyCurve();

    /// @param args.oracle         | 20 bytes
    /// @param args.base           | 20 bytes
    /// @param args.oracleDecimals | 1 byte
    /// @param args.baseDecimals   | 1 byte
    /// @param args.quoteDecimals  | 1 byte
    /// @param args.maxStaleness   | 2 bytes
    /// @param args.depth          | 4 bytes (1e6 = 1x)
    function _oracleAnchorXD(Context memory ctx, bytes calldata args) internal view {
        require(ctx.swap.amountIn == 0 || ctx.swap.amountOut == 0, OracleAnchorShouldBeAppliedBeforeSwapAmountsComputation());
        (address oracle, address base, uint8 oracleDecimals, uint8 baseDecimals, uint8 quoteDecimals, uint16 maxStaleness, uint32 depth) = OracleAnchorArgsBuilder.parse(args);
        bool baseIn = ctx.query.tokenIn == base;
        require(baseIn || ctx.query.tokenOut == base, OracleAnchorUnknownToken(ctx.query.tokenIn, ctx.query.tokenOut));

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
}
