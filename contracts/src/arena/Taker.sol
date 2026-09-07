// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { ITakerCallbacks } from "swap-vm/interfaces/ITakerCallbacks.sol";
import { ISwapVM } from "swap-vm/interfaces/ISwapVM.sol";

/// @title Taker
/// @notice The arena's taker: pays the maker through Aqua's push inside the router's callback, the
///   way the upstream tests do. The taker engine drives it from an ordinary account; it holds the
///   tokens it trades with, so the engine's wallet never needs allowances.
contract Taker is ITakerCallbacks {
    Aqua public immutable aqua;
    ISwapVM public immutable router;

    constructor(address aqua_, address router_) {
        aqua = Aqua(aqua_);
        router = ISwapVM(router_);
    }

    function swap(ISwapVM.Order calldata order, address tokenIn, address tokenOut, uint256 amount, bytes calldata takerTraitsAndData)
        external returns (uint256 amountIn, uint256 amountOut)
    {
        (amountIn, amountOut,) = router.swap(order, tokenIn, tokenOut, amount, takerTraitsAndData);
    }

    function preTransferInCallback(address maker, address, address tokenIn, address, uint256 amountIn, uint256, bytes32 orderHash, bytes calldata) external {
        require(msg.sender == address(router), "not the router");
        IERC20(tokenIn).approve(address(aqua), amountIn);
        aqua.push(maker, address(router), orderHash, tokenIn, amountIn);
    }

    function preTransferOutCallback(address, address, address, address, uint256, uint256, bytes32, bytes calldata) external view {
        require(msg.sender == address(router), "not the router");
    }
}
