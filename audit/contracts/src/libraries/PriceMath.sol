// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title PriceMath
/// @notice Unit conversions between USDG (6 decimals), Stock Tokens (18 decimals) and 8-decimal prices.
library PriceMath {
    /// @dev 10^(18 + 8 - 6): stock units x price / SCALE = USDG units.
    uint256 internal constant SCALE = 1e20;

    /// @notice USDG value of `amount` stock tokens at `price`, rounded down.
    function usdForStock(uint256 amount, uint256 price) internal pure returns (uint256) {
        return Math.mulDiv(amount, price, SCALE);
    }

    /// @notice Stock tokens worth `usd` at `price`, rounded down.
    function stockForUsd(uint256 usd, uint256 price) internal pure returns (uint256) {
        return Math.mulDiv(usd, SCALE, price);
    }

    /// @notice Stock tokens worth `usd` at `price`, rounded up.
    function stockForUsdUp(uint256 usd, uint256 price) internal pure returns (uint256) {
        return Math.mulDiv(usd, SCALE, price, Math.Rounding.Ceil);
    }

    /// @notice Seconds since `updatedAt`; 0 if it is somehow in the future.
    function age(uint256 updatedAt) internal view returns (uint256) {
        return updatedAt >= block.timestamp ? 0 : block.timestamp - updatedAt;
    }
}
