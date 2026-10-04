// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {ProofOfCover} from "../src/ProofOfCover.sol";
import {AgentAccount} from "../src/AgentAccount.sol";
import {BondlineCover} from "../src/BondlineCover.sol";
import {BondlineMarket} from "../src/BondlineMarket.sol";

/// @notice A contract that answers any call with canned bytes, reverts, or returns a huge payload.
contract Canned {
    mapping(bytes4 => bytes) public answer;
    mapping(bytes4 => bool) public reverts;
    bool public huge;

    function set(bytes4 sel, bytes memory data) external {
        answer[sel] = data;
    }

    function setReverts(bytes4 sel) external {
        reverts[sel] = true;
    }

    function setHuge() external {
        huge = true;
    }

    fallback() external {
        if (reverts[msg.sig]) revert("canned");
        if (huge) {
            assembly {
                return(0, 1000000)
            }
        }
        bytes memory a = answer[msg.sig];
        assembly {
            return(add(a, 32), mload(a))
        }
    }
}

contract ProofOfCoverTest is BaseTest {
    ProofOfCover internal poc;
    BondlineMarket internal live;

    function setUp() public override {
        super.setUp();
        live = _newMarket(MAX_AGE, "Live");
        // `market` (from the base fixture) plays the Replay market.
        poc = new ProofOfCover(address(live), address(market));
    }

    function _check(address a)
        internal
        view
        returns (bool covered, address uw, uint256 limit, uint256 cap, uint256 capacity)
    {
        return poc.isCovered(a);
    }

    function _selCover() internal pure returns (bytes4) {
        return bytes4(keccak256("cover()"));
    }

    // ---------------------------------------------------------------- configuration

    function test_immutables() public view {
        assertEq(poc.liveMarket(), address(live));
        assertEq(poc.replayMarket(), address(market));
    }

    // ---------------------------------------------------------------- covered

    function test_covered_replayMarket() public {
        BondlineCover cover = _offer(_terms(), 10_000e6);
        AgentAccount acct = _open(cover, 1000, 1000e6);
        (bool covered, address uw, uint256 limit, uint256 cap, uint256 capacity) = _check(address(acct));
        assertTrue(covered);
        assertEq(uw, underwriter);
        assertEq(limit, 1000);
        assertEq(cap, 3000);
        assertEq(capacity, cover.free());
        assertGt(capacity, 0);
    }

    function test_covered_liveMarket() public {
        BondlineCover cover = _offerIn(live, _terms(), 10_000e6);
        AgentAccount acct = _open(cover, 1500, 1000e6);
        (bool covered, address uw, uint256 limit, uint256 cap, uint256 capacity) = _check(address(acct));
        assertTrue(covered);
        assertEq(uw, underwriter);
        assertEq(limit, 1500);
        assertEq(cap, 3000);
        assertEq(capacity, cover.free());
    }

    function test_capacity_tracksFreeBond() public {
        BondlineCover cover = _offer(_terms(), 10_000e6);
        AgentAccount a1 = _open(cover, 1000, 1000e6);
        (,,,, uint256 before_) = _check(address(a1));
        _open(cover, 1000, 1000e6);
        (,,,, uint256 after_) = _check(address(a1));
        assertLt(after_, before_);
        assertEq(after_, cover.free());
    }

    // ---------------------------------------------------------------- not covered

    function test_notCovered_afterSettle() public {
        (BondlineCover cover, AgentAccount acct) = _invested();
        _drop(2000);
        cover.settle(address(acct));
        _assertNot(address(acct));
    }

    function test_notCovered_afterClose() public {
        BondlineCover cover = _offer(_terms(), 10_000e6);
        AgentAccount acct = _open(cover, 1000, 1000e6);
        vm.prank(user);
        cover.close(address(acct));
        _assertNot(address(acct));
    }

    function test_notCovered_eoaAndRandomContracts() public view {
        _assertNot(address(0));
        _assertNot(user);
        _assertNot(address(usdg));
        _assertNot(address(market));
        _assertNot(address(poc));
        _assertNot(address(1)); // ecrecover precompile: returns no data for a bad call
        _assertNot(address(2)); // sha256 precompile: returns a 32-byte hash that is not an address
        _assertNot(address(4)); // identity precompile: echoes the 4-byte selector
    }

    function test_notCovered_coverFromAnotherMarket() public {
        BondlineMarket other = _newMarket(MAX_AGE, "Other");
        BondlineCover cover = _offerIn(other, _terms(), 10_000e6);
        AgentAccount acct = _open(cover, 1000, 1000e6);
        _assertNot(address(acct));
    }

    function test_notCovered_fakeAccountNamingARealCover() public {
        BondlineCover cover = _offer(_terms(), 10_000e6);
        Canned fake = new Canned();
        fake.set(_selCover(), abi.encode(address(cover)));
        _assertNot(address(fake));
    }

    function test_notCovered_fakeAccountNamingAnInactiveRealAccountsCover() public {
        // The cover knows the real account, not the fake one, so the fake one is None there.
        BondlineCover cover = _offer(_terms(), 10_000e6);
        _open(cover, 1000, 1000e6);
        Canned fake = new Canned();
        fake.set(_selCover(), abi.encode(address(cover)));
        _assertNot(address(fake));
    }

    // ---------------------------------------------------------------- hostile targets never revert

    function test_hostileAccount_dirtyAddressWord() public {
        Canned a = new Canned();
        a.set(_selCover(), abi.encode(uint256(type(uint256).max)));
        _assertNot(address(a));
    }

    function test_hostileAccount_revertsShortOrHuge() public {
        Canned r = new Canned();
        r.setReverts(_selCover());
        _assertNot(address(r));

        Canned shortData = new Canned();
        shortData.set(_selCover(), hex"1234");
        _assertNot(address(shortData));

        Canned h = new Canned();
        h.setHuge();
        _assertNot(address(h));
    }

    function test_hostileMarketAndCover() public {
        // A fake "market" that calls everything an offer, and a fake "cover" with bad answers.
        Canned fakeMarket = new Canned();
        Canned fakeCover = new Canned();
        Canned acct = new Canned();
        ProofOfCover p = new ProofOfCover(address(fakeMarket), address(fakeMarket));
        acct.set(_selCover(), abi.encode(address(fakeCover)));

        bytes4 isOffer = bytes4(keccak256("isOffer(address)"));
        bytes4 position = bytes4(keccak256("position(address)"));
        bytes4 uwSel = bytes4(keccak256("underwriter()"));
        bytes4 capSel = bytes4(keccak256("capBps()"));
        bytes4 freeSel = bytes4(keccak256("free()"));

        // Not an offer.
        (bool c,,,,) = p.isCovered(address(acct));
        assertFalse(c);
        fakeMarket.set(isOffer, abi.encode(uint256(1)));

        // The position call fails.
        fakeCover.setReverts(position);
        (c,,,,) = p.isCovered(address(acct));
        assertFalse(c);
        Canned fakeCover2 = new Canned();
        acct.set(_selCover(), abi.encode(address(fakeCover2)));

        // Status Active (1) but the limit does not fit a uint16.
        fakeCover2.set(position, abi.encode(user, uint256(1 << 20), uint256(1), uint256(1), uint256(1)));
        (c,,,,) = p.isCovered(address(acct));
        assertFalse(c);

        // Good position, but every other read is missing.
        fakeCover2.set(position, abi.encode(user, uint256(1000), uint256(1), uint256(1), uint256(1)));
        (c,,,,) = p.isCovered(address(acct));
        assertFalse(c);

        // Underwriter word with dirty high bits.
        fakeCover2.set(uwSel, abi.encode(type(uint256).max));
        fakeCover2.set(capSel, abi.encode(uint256(3000)));
        fakeCover2.set(freeSel, abi.encode(uint256(5)));
        (c,,,,) = p.isCovered(address(acct));
        assertFalse(c);

        // Cap that does not fit a uint16.
        fakeCover2.set(uwSel, abi.encode(underwriter));
        fakeCover2.set(capSel, abi.encode(uint256(1 << 20)));
        (c,,,,) = p.isCovered(address(acct));
        assertFalse(c);

        // All answers valid: covered, with the canned values.
        fakeCover2.set(capSel, abi.encode(uint256(3000)));
        (bool ok, address uw, uint256 limit, uint256 cap, uint256 capacity) = p.isCovered(address(acct));
        assertTrue(ok);
        assertEq(uw, underwriter);
        assertEq(limit, 1000);
        assertEq(cap, 3000);
        assertEq(capacity, 5);

        // The "isOffer" answer must be exactly 1.
        fakeMarket.set(isOffer, abi.encode(uint256(2)));
        (c,,,,) = p.isCovered(address(acct));
        assertFalse(c);
    }

    function testFuzz_neverReverts(address a) public view {
        poc.isCovered(a);
    }

    function _assertNot(address a) internal view {
        (bool covered, address uw, uint256 limit, uint256 cap, uint256 capacity) = poc.isCovered(a);
        assertFalse(covered);
        assertEq(uw, address(0));
        assertEq(limit, 0);
        assertEq(cap, 0);
        assertEq(capacity, 0);
    }
}
