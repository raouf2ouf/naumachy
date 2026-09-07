// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Context } from "swap-vm/libs/VM.sol";
import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";
import { SwapVM } from "swap-vm/SwapVM.sol";
import { NaumachyOpcodes } from "./NaumachyOpcodes.sol";

/// @title NaumachyRouter
/// @notice The full SwapVM router, redeployed with Naumachy's instructions appended. Strategies ship
///   to the canonical Aqua registry with this router as their app; gladiators compose ToxicityFee,
///   RiskCap and OracleAnchor with the upstream instruction set.
contract NaumachyRouter is Simulator, SwapVM, NaumachyOpcodes {
    constructor(address aqua, address weth, address owner, string memory name, string memory version)
        SwapVM(aqua, weth, owner, name, version) NaumachyOpcodes(aqua) {}

    function _instructions() internal pure override returns (function(Context memory, bytes calldata) internal[] memory result) {
        return _opcodes();
    }
}
