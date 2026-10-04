// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Test double for Paxos USDG on Robinhood Chain: 6 decimals, EIP-712 domain ("Global Dollar", "1"),
///         EIP-2612 permit, EIP-3009 with the standard typehashes (receiveWithAuthorization reverts
///         `CallerMustBePayee()` unless the caller is the payee), nonce reuse and expiry checks, and the issuer's
///         pause and freeze controls.
contract MockUSDG is ERC20Permit {
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    struct Authorization {
        address from;
        address to;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
    }

    mapping(address authorizer => mapping(bytes32 nonce => bool used)) public authorizationState;
    bool public paused;
    mapping(address account => bool) public isFrozen;

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    error CallerMustBePayee();
    error AuthorizationAlreadyUsed();
    error AuthorizationNotYetValid();
    error AuthorizationExpired();
    error InvalidSignature();
    error ContractPaused();
    error AddressFrozen(address account);

    constructor() ERC20("Global Dollar", "USDG") ERC20Permit("Global Dollar") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setPaused(bool paused_) external {
        paused = paused_;
    }

    function setFrozen(address account, bool frozen) external {
        isFrozen[account] = frozen;
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        _useAuthorization(
            TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
            Authorization(from, to, value, validAfter, validBefore, nonce),
            v,
            r,
            s
        );
        _transfer(from, to, value);
    }

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
    ) external {
        if (to != msg.sender) revert CallerMustBePayee();
        _useAuthorization(
            RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
            Authorization(from, to, value, validAfter, validBefore, nonce),
            v,
            r,
            s
        );
        _transfer(from, to, value);
    }

    function _useAuthorization(bytes32 typehash, Authorization memory a, uint8 v, bytes32 r, bytes32 s) private {
        if (block.timestamp <= a.validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp >= a.validBefore) revert AuthorizationExpired();
        if (authorizationState[a.from][a.nonce]) revert AuthorizationAlreadyUsed();
        bytes32 structHash =
            keccak256(abi.encode(typehash, a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce));
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(_hashTypedDataV4(structHash), v, r, s);
        if (err != ECDSA.RecoverError.NoError || signer != a.from) revert InvalidSignature();
        authorizationState[a.from][a.nonce] = true;
        emit AuthorizationUsed(a.from, a.nonce);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (paused) revert ContractPaused();
        if (isFrozen[from]) revert AddressFrozen(from);
        if (isFrozen[to]) revert AddressFrozen(to);
        super._update(from, to, value);
    }
}
