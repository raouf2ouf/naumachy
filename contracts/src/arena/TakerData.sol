// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { TakerTraitsLib } from "swap-vm/libs/TakerTraits.sol";

/// @dev Packs the taker traits the way the router expects, so off-chain engines read one pure
///   function instead of re-implementing the bit layout.
contract TakerData {
    function build(address taker, bool isExactIn) external pure returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: taker, isExactIn: isExactIn, shouldUnwrapWeth: false, hasPreTransferInCallback: true, hasPreTransferOutCallback: false,
            isStrictThresholdAmount: false, isFirstTransferFromTaker: false, useTransferFromAndAquaPush: false, threshold: "", to: address(0), deadline: 0,
            preTransferInHookData: "", postTransferInHookData: "", preTransferOutHookData: "", postTransferOutHookData: "",
            preTransferInCallbackData: "", preTransferOutCallbackData: "", instructionsArgs: "", signature: ""
        }));
    }
}
