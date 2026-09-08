// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ArenaPass
/// @notice The arena's access token. A gladiator that opens its program with SwapVM's taker-balance
///   gate serves only takers holding a pass: routed flow carries one, anonymous flow does not. On
///   mainnet the same gate keeps 99% of Aqua's volume for 1inch's resolvers; here the lanista hands
///   passes to the takers it vouches for, and a gladiator decides whether the flow it keeps out is
///   worth the flow it gives up.
contract ArenaPass is ERC20, Ownable {
    constructor(address lanista) ERC20("Naumachy Arena Pass", "PASS") Ownable(lanista) {}

    function mint(address to, uint256 amount) external onlyOwner { _mint(to, amount); }
    function burn(address from, uint256 amount) external onlyOwner { _burn(from, amount); }
}
