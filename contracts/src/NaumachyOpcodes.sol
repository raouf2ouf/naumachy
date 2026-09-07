// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Context } from "swap-vm/libs/VM.sol";
import { Opcodes } from "swap-vm/opcodes/Opcodes.sol";
import { Controls } from "swap-vm/instructions/Controls.sol";
import { Balances } from "swap-vm/instructions/Balances.sol";
import { XYCSwap } from "swap-vm/instructions/XYCSwap.sol";
import { XYCConcentrate } from "swap-vm/instructions/XYCConcentrate.sol";
import { Decay } from "swap-vm/instructions/Decay.sol";
import { LimitSwap } from "swap-vm/instructions/LimitSwap.sol";
import { MinRate } from "swap-vm/instructions/MinRate.sol";
import { DutchAuction } from "swap-vm/instructions/DutchAuction.sol";
import { TWAPSwap } from "swap-vm/instructions/TWAPSwap.sol";
import { Fee } from "swap-vm/instructions/Fee.sol";
import { Extruction } from "swap-vm/instructions/Extruction.sol";
import { ToxicityFee } from "./instructions/ToxicityFee.sol";
import { RiskCap } from "./instructions/RiskCap.sol";
import { OracleAnchor } from "./instructions/OracleAnchor.sol";

/// @title NaumachyOpcodes
/// @notice The SwapVM v1.0.2 instruction table with its byte layout intact, followed by Naumachy's
///   own. Runtime byte = static slot minus one, so the upstream table ends at 0x2d and ours begins
///   at 0x2e: ToxicityFee, RiskCap, OracleAnchor. A full router with three more instructions does
///   not fit the 24,576-byte contract limit of Base, so the instructions no gladiator archetype
///   composes (the pegged swap, the experimental fee variants, order invalidators, the gas
///   adjuster) keep their bytes but revert: a program that names one fails loudly, never silently.
contract NaumachyOpcodes is Opcodes, ToxicityFee, RiskCap, OracleAnchor {
    error UnsupportedInstruction();

    constructor(address aqua) Opcodes(aqua) {}

    function _unsupported(Context memory /* ctx */, bytes calldata /* args */) internal pure {
        revert UnsupportedInstruction();
    }

    function _opcodes() internal pure override returns (function(Context memory, bytes calldata) internal[] memory result) {
        function(Context memory, bytes calldata) internal[50] memory instructions = [
            _notInstruction,
            // 0x00..0x09 reserved for debugging utilities
            _notInstruction, _notInstruction, _notInstruction, _notInstruction, _notInstruction,
            _notInstruction, _notInstruction, _notInstruction, _notInstruction, _notInstruction,
            // 0x0a.. controls
            Controls._jump,
            Controls._jumpIfTokenIn,
            Controls._jumpIfTokenOut,
            Controls._deadline,
            Controls._onlyTakerTokenBalanceNonZero,
            Controls._onlyTakerTokenBalanceGte,
            Controls._onlyTakerTokenSupplyShareGte,
            // 0x11 balances
            Balances._staticBalancesXD,
            Balances._dynamicBalancesXD,
            // 0x13 invalidators: signed orders only, Aqua strategies dock instead
            _unsupported,
            _unsupported,
            _unsupported,
            // 0x16 swaps and modifiers
            XYCSwap._xycSwapXD,
            XYCConcentrate._xycConcentrateGrowLiquidity2D,
            Decay._decayXD,
            LimitSwap._limitSwap1D,
            LimitSwap._limitSwapOnlyFull1D,
            MinRate._requireMinRate1D,
            MinRate._adjustMinRate1D,
            DutchAuction._dutchAuctionBalanceIn1D,
            DutchAuction._dutchAuctionBalanceOut1D,
            _unsupported,                        // BaseFeeAdjuster
            TWAPSwap._twap,
            Extruction._extruction,
            Controls._salt,
            Fee._flatFeeAmountInXD,
            _unsupported,                        // FeeExperimental flat fee out
            _unsupported,                        // progressive fee in
            _unsupported,                        // progressive fee out
            _unsupported,                        // protocol fee out
            _unsupported,                        // aqua protocol fee out
            _unsupported,                        // PeggedSwap
            Fee._protocolFeeAmountInXD,
            Fee._aquaProtocolFeeAmountInXD,
            Fee._dynamicProtocolFeeAmountInXD,
            Fee._aquaDynamicProtocolFeeAmountInXD,
            // 0x2e.. Naumachy
            ToxicityFee._toxicityFeeXD,
            RiskCap._riskCapXD,
            OracleAnchor._oracleAnchorXD
        ];
        uint256 instructionsArrayLength = instructions.length - 1;
        assembly ("memory-safe") {
            result := instructions
            mstore(result, instructionsArrayLength)
        }
    }
}
