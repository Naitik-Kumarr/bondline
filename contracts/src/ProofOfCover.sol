// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CoverStatus} from "./Types.sol";

/// @title ProofOfCover
/// @notice A read-only lookup other contracts and apps can call to ask one question: "is this account covered
///         right now, by whom, and for how much?" It reads the two Bondline markets it was built with and nothing
///         else. It holds no funds, has no owner, no admin, no upgrade path and no state that can change.
/// @dev Every call into an outside contract is a low-level `staticcall` with a fixed-size return buffer, so a
///      random account, an EOA, a contract with no such function, a contract that reverts, or one that returns
///      garbage or a huge payload can never make `isCovered` revert or burn memory. Such an address is simply
///      reported as not covered.
contract ProofOfCover {
    /// @notice The Live market (prices pushed live by the keeper).
    address public immutable liveMarket;
    /// @notice The Replay market (the same offers on a replayed price history).
    address public immutable replayMarket;

    // Selectors of the functions read. Kept as constants so the call data is built without importing interfaces.
    bytes4 private constant COVER_OF = bytes4(keccak256("cover()"));
    bytes4 private constant IS_OFFER = bytes4(keccak256("isOffer(address)"));
    bytes4 private constant POSITION = bytes4(keccak256("position(address)"));
    bytes4 private constant UNDERWRITER = bytes4(keccak256("underwriter()"));
    bytes4 private constant CAP_BPS = bytes4(keccak256("capBps()"));
    bytes4 private constant FREE = bytes4(keccak256("free()"));

    /// @param liveMarket_ The Live BondlineMarket.
    /// @param replayMarket_ The Replay BondlineMarket.
    constructor(address liveMarket_, address replayMarket_) {
        liveMarket = liveMarket_;
        replayMarket = replayMarket_;
    }

    /// @notice Whether `account` is a Bondline covered account whose cover is active, and the terms of that cover.
    /// @dev `covered` is true only if all of these hold: `account.cover()` returns an address that one of the two
    ///      markets lists as one of its offers, and that cover's book shows `account` with status Active. A cover
    ///      that does not list the account (a fake account naming a real cover) reports status None, so it is not
    ///      covered. When `covered` is false every other value is zero.
    /// @param account The address to check: any address, including EOAs and unrelated contracts.
    /// @return covered True if the account's cover is an offer of one of the two markets and its position is Active.
    /// @return underwriter The address that bonded the cover (the underwriter of the offer).
    /// @return limitBps The account's loss limit in basis points of principal: losses beyond it are paid.
    /// @return capBps The cover's cap in basis points: the largest drop the cover pays down to (3000 = 30%).
    /// @return capacity The cover's free bond in USDG units (6 decimals): what it could still reserve for new
    ///         covers right now, not what is reserved for this account.
    function isCovered(address account)
        external
        view
        returns (bool covered, address underwriter, uint256 limitBps, uint256 capBps, uint256 capacity)
    {
        address cover = _coverOf(account);
        if (cover == address(0)) return (false, address(0), 0, 0, 0);
        if (!_isOffer(liveMarket, cover) && !_isOffer(replayMarket, cover)) return (false, address(0), 0, 0, 0);
        return _terms(cover, account);
    }

    /// @dev `account.cover()`, or zero if the call fails or the answer is not a clean address.
    function _coverOf(address account) private view returns (address) {
        (bool ok, uint256 word) = _read(account, abi.encodeWithSelector(COVER_OF));
        if (!ok || word >> 160 != 0) return address(0);
        return address(uint160(word));
    }

    /// @dev Reads the cover's book and terms for `account`. `cover.position(account)` is a static struct, so it comes
    ///      back as five words: user, limitBps, status, principal, reserve. A status other than Active, a failed
    ///      read, or a value that does not fit its type makes the account not covered.
    function _terms(address cover, address account) private view returns (bool, address, uint256, uint256, uint256) {
        (bool okP, bytes memory pos) = _readMany(cover, abi.encodeWithSelector(POSITION, account), 5);
        (bool okU, uint256 uw) = _read(cover, abi.encodeWithSelector(UNDERWRITER));
        (bool okC, uint256 cap) = _read(cover, abi.encodeWithSelector(CAP_BPS));
        (bool okF, uint256 free) = _read(cover, abi.encodeWithSelector(FREE));
        uint256 limit;
        uint256 status;
        assembly ("memory-safe") {
            limit := mload(add(pos, 64))
            status := mload(add(pos, 96))
        }
        if (
            !okP || status != uint256(CoverStatus.Active) || !okU || !okC || !okF || uw >> 160 != 0
                || limit > type(uint16).max || cap > type(uint16).max
        ) {
            return (false, address(0), 0, 0, 0);
        }
        return (true, address(uint160(uw)), limit, cap, free);
    }

    /// @dev True if `market.isOffer(cover)` returns true. False on any failure.
    function _isOffer(address market, address cover) private view returns (bool) {
        (bool ok, uint256 word) = _read(market, abi.encodeWithSelector(IS_OFFER, cover));
        return ok && word == 1;
    }

    /// @dev One-word read: a `staticcall` that reports failure instead of reverting.
    function _read(address target, bytes memory data) private view returns (bool ok, uint256 word) {
        (bool success, bytes memory out) = _readMany(target, data, 1);
        if (!success) return (false, 0);
        assembly ("memory-safe") {
            word := mload(add(out, 32))
        }
        return (true, word);
    }

    /// @dev A `staticcall` that copies at most `words` words of the answer into a fresh buffer and reports failure
    ///      (never reverts) if the target has no code, reverts, or returns fewer than `words` words. Extra return
    ///      data is ignored without being copied, so a hostile target cannot grow memory.
    function _readMany(address target, bytes memory data, uint256 words)
        private
        view
        returns (bool ok, bytes memory out)
    {
        uint256 size = words * 32;
        out = new bytes(size);
        uint256 got;
        assembly ("memory-safe") {
            ok := staticcall(gas(), target, add(data, 32), mload(data), add(out, 32), size)
            got := returndatasize()
        }
        ok = ok && got >= size;
    }
}
