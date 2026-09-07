// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Calldata } from "@1inch/solidity-utils/contracts/libraries/Calldata.sol";
import { Context, ContextLib } from "swap-vm/libs/VM.sol";
import { BPS } from "swap-vm/instructions/Fee.sol";

library RiskCapArgsBuilder {
    using Calldata for bytes;

    error RiskCapMissingArgs();
    error RiskCapBpsOutOfRange(uint32 bps);

    /// @param maxOutBps largest share of the outgoing token's balance one fill may take (1e9 = 100%)
    /// @param maxInBps  largest share of the incoming token's balance one fill may add
    function build(uint32 maxOutBps, uint32 maxInBps) internal pure returns (bytes memory) {
        require(maxOutBps <= BPS && maxInBps <= BPS, RiskCapBpsOutOfRange(maxOutBps > maxInBps ? maxOutBps : maxInBps));
        return abi.encodePacked(maxOutBps, maxInBps);
    }

    function parse(bytes calldata args) internal pure returns (uint32 maxOutBps, uint32 maxInBps) {
        maxOutBps = uint32(bytes4(args.slice(0, 4, RiskCapMissingArgs.selector)));
        maxInBps = uint32(bytes4(args.slice(4, 8, RiskCapMissingArgs.selector)));
    }
}

/// @title RiskCap
/// @notice An arena rule enforced in bytecode: no single fill may take more than a share of the
///   strategy's balance of the outgoing token, nor add more than a share of the incoming one. The
///   caps are read from the ledger balances at entry, before any instruction reshapes them, so a
///   virtual curve cannot lift them. Every gladiator composes with it as its outermost instruction.
/// @dev Middleware: runs the rest of the program nested, then checks the resulting amounts. It
///   reverts in quote mode too, so a taker learns the cap before sending a transaction.
abstract contract RiskCap {
    using ContextLib for Context;

    error RiskCapExceeded(address token, uint256 amount, uint256 cap);

    /// @param args.maxOutBps | 4 bytes
    /// @param args.maxInBps  | 4 bytes
    function _riskCapXD(Context memory ctx, bytes calldata args) internal {
        (uint32 maxOutBps, uint32 maxInBps) = RiskCapArgsBuilder.parse(args);
        uint256 capOut = ctx.swap.balanceOut * maxOutBps / BPS;
        uint256 capIn = ctx.swap.balanceIn * maxInBps / BPS;
        ctx.runLoop();
        require(ctx.swap.amountOut <= capOut, RiskCapExceeded(ctx.query.tokenOut, ctx.swap.amountOut, capOut));
        require(ctx.swap.amountIn <= capIn, RiskCapExceeded(ctx.query.tokenIn, ctx.swap.amountIn, capIn));
    }
}
