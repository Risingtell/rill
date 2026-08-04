// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @notice Test double for real FXRP: EIP-2612 `permit`, 6 decimals, same feature
/// profile confirmed on-chain in SPEC.md section 1 (no EIP-3009). Mint is open so tests
/// can fund any address; the real FXRP proxy has no such function.
contract MockFXRP is ERC20, ERC20Permit {
    constructor() ERC20("FXRP", "FXRP") ERC20Permit("FXRP") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
