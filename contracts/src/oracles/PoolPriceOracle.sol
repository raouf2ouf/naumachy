// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IUniswapV3PoolMinimal {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked);
}

/// @title PoolPriceOracle
/// @notice A Chainlink-shaped view of a Uniswap v3 pool: `latestRoundData()` answers the price of
///   one token0 in token1 with 18 decimals, read from the pool's current sqrt price at the block.
///   Aquascan scores the same pool's swaps, so a strategy anchored here is judged against the
///   reference it quotes from.
contract PoolPriceOracle {
    IUniswapV3PoolMinimal public immutable pool;
    address public immutable base;      // token0
    address public immutable quote;     // token1
    uint8 public immutable baseDecimals;
    uint8 public immutable quoteDecimals;

    constructor(address pool_) {
        pool = IUniswapV3PoolMinimal(pool_);
        base = pool.token0();
        quote = pool.token1();
        baseDecimals = IERC20Metadata(base).decimals();
        quoteDecimals = IERC20Metadata(quote).decimals();
    }

    function decimals() external pure returns (uint8) { return 18; }
    function description() external pure returns (string memory) { return "Uniswap v3 pool price, token1 per token0"; }
    function version() external pure returns (uint256) { return 1; }

    /// @dev price = (sqrtP / 2^96)^2 * 10^(18 + dec0 - dec1), computed as two 512-bit safe steps.
    function latestAnswer() public view returns (uint256) {
        (uint160 sqrtPriceX96, , , , , , ) = pool.slot0();
        uint256 p = Math.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), 1 << 64);   // sqrtP^2 / 2^64
        uint256 num = 10 ** 18 * 10 ** baseDecimals;
        uint256 den = (uint256(1) << 128) * 10 ** quoteDecimals;
        return Math.mulDiv(p, num, den);
    }

    function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) {
        roundId = uint80(block.number);
        answer = int256(latestAnswer());
        startedAt = block.timestamp;
        updatedAt = block.timestamp;
        answeredInRound = roundId;
    }

    function getRoundData(uint80) external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) {
        return this.latestRoundData();
    }
}
