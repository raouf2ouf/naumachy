// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { ISwapVM } from "swap-vm/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "swap-vm/libs/MakerTraits.sol";
import { Controls } from "swap-vm/instructions/Controls.sol";
import { XYCSwap } from "swap-vm/instructions/XYCSwap.sol";
import { Program, ProgramBuilder } from "../lib/swap-vm/test/utils/ProgramBuilder.sol";
import { NaumachyOpcodes } from "../src/NaumachyOpcodes.sol";
import { ToxicityFee, ToxicityFeeArgsBuilder } from "../src/instructions/ToxicityFee.sol";
import { RiskCap, RiskCapArgsBuilder } from "../src/instructions/RiskCap.sol";
import { OracleAnchor, OracleAnchorArgsBuilder } from "../src/instructions/OracleAnchor.sol";

/// @dev Ships one gladiator: RiskCap > ToxicityFee > OracleAnchor > XYCSwap > Salt, on the WETH/USDC
///   pair, from the broadcaster's wallet. Env: ROUTER, ORACLE, AQUA, WETH, USDC, LEDGER_WETH,
///   LEDGER_USDC, and the program's knobs: CAP_BPS, FEE_BASE_BPS, FEE_SLOPE_BPS, FEE_MAX_BPS,
///   FEE_WINDOW, DEPTH (1e6 = 1x), SALT. Basis points are on SwapVM's 1e9 base.
contract ShipGladiator is Script, NaumachyOpcodes {
    using ProgramBuilder for Program;

    constructor() NaumachyOpcodes(vm.envOr("AQUA", 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a)) {}

    function run() external {
        address aqua = vm.envOr("AQUA", 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a);
        address weth = vm.envOr("WETH", 0x4200000000000000000000000000000000000006);
        address usdc = vm.envOr("USDC", 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
        address router = vm.envAddress("ROUTER");
        address oracle = vm.envAddress("ORACLE");
        uint32 capBps = uint32(vm.envOr("CAP_BPS", uint256(2e8)));
        uint32 feeBase = uint32(vm.envOr("FEE_BASE_BPS", uint256(5e5)));
        uint32 feeSlope = uint32(vm.envOr("FEE_SLOPE_BPS", uint256(2e7)));
        uint32 feeMax = uint32(vm.envOr("FEE_MAX_BPS", uint256(5e6)));
        uint32 window = uint32(vm.envOr("FEE_WINDOW", uint256(600)));
        uint32 depth = uint32(vm.envOr("DEPTH", uint256(100e6)));
        uint256 salt = vm.envOr("SALT", uint256(block.timestamp));

        Program memory p = ProgramBuilder.init(_opcodes());
        bytes memory program = bytes.concat(
            p.build(RiskCap._riskCapXD, RiskCapArgsBuilder.build(capBps, capBps)),
            p.build(ToxicityFee._toxicityFeeXD, ToxicityFeeArgsBuilder.build(feeBase, feeSlope, feeMax, window)),
            p.build(OracleAnchor._oracleAnchorXD, OracleAnchorArgsBuilder.build(oracle, weth, usdc, 18, 18, 6, 0, depth)),
            p.build(XYCSwap._xycSwapXD),
            p.build(Controls._salt, abi.encodePacked(salt))
        );

        vm.startBroadcast();
        address maker = msg.sender;
        ISwapVM.Order memory order = MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: maker, shouldUnwrapWeth: false, useAquaInsteadOfSignature: true, allowZeroAmountIn: false, receiver: address(0),
            hasPreTransferInHook: false, hasPostTransferInHook: false, hasPreTransferOutHook: false, hasPostTransferOutHook: false,
            preTransferInTarget: address(0), preTransferInData: "", postTransferInTarget: address(0), postTransferInData: "",
            preTransferOutTarget: address(0), preTransferOutData: "", postTransferOutTarget: address(0), postTransferOutData: "",
            program: program
        }));
        if (IERC20(weth).allowance(maker, aqua) == 0) IERC20(weth).approve(aqua, type(uint256).max);
        if (IERC20(usdc).allowance(maker, aqua) == 0) IERC20(usdc).approve(aqua, type(uint256).max);
        address[] memory tokens = new address[](2); tokens[0] = weth; tokens[1] = usdc;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = vm.envOr("LEDGER_WETH", uint256(1e18)); amounts[1] = vm.envOr("LEDGER_USDC", uint256(2500e6));
        bytes32 strategyHash = Aqua(aqua).ship(router, abi.encode(order), tokens, amounts);
        vm.stopBroadcast();
        console.log("shipped", maker);
        console.logBytes32(strategyHash);
        console.log("program bytes", program.length);
    }
}
