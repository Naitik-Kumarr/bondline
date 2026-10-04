// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice The parts of Paxos USDG that Bondline uses: ERC-20, EIP-3009 and the issuer's controls.
interface IUSDG is IERC20 {
    /// @notice EIP-3009. Reverts unless `msg.sender == to`, so a signed authorization can't be front-run.
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);

    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32);

    /// @notice Issuer control: while paused, transfers revert.
    function paused() external view returns (bool);

    /// @notice Issuer control: a frozen address can't send or receive.
    function isFrozen(address account) external view returns (bool);
}
