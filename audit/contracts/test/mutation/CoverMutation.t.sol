// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";

import {BaseTest} from "../Base.t.sol";
import {Terms, Rules, Health, Position, CoverStatus} from "../../src/Types.sol";
import {AgentAccount} from "../../src/AgentAccount.sol";
import {BondlineCover} from "../../src/BondlineCover.sol";
import {IBondlineCover} from "../../src/interfaces/IBondline.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";

/// @notice Tests added after mutation testing BondlineCover.sol (see contracts/reports/proofs.md): each one kills a
///         mutant that the earlier suites let survive. Boundary conditions and bookkeeping that only matter with
///         two accounts or at an exact equality.
contract CoverMutationTest is BaseTest {
    BondlineCover internal cover;

    function setUp() public override {
        super.setUp();
        cover = _offer(_terms(), 100_000e6);
    }

    /// @dev Models a trading loss of exactly `lost` USDG: moves cash out of the account to the venue.
    function _lose(AgentAccount acct, uint256 lost) internal {
        address sink = address(venue);
        vm.prank(address(acct));
        usdg.transfer(sink, lost);
    }

    // ---------------------------------------------------------------- exact limit boundary

    /// @dev loss == limit must revert, loss == limit + 1 must pay exactly 1 (kills `loss <= limit` -> `loss < limit`).
    function test_settle_exactlyAtLimitReverts_oneWeiOverPaysOneWei() public {
        AgentAccount acct = _open(cover, 1000, 1000e6); // principal 990e6, limit 99e6
        _lose(acct, 99e6);
        Health memory h = cover.health(address(acct));
        assertEq(h.loss, 99e6);
        assertEq(h.limit, 99e6);
        assertFalse(h.settleable);
        assertEq(h.payoutNow, 0);
        vm.expectRevert(abi.encodeWithSelector(IBondlineCover.WithinLimit.selector, 99e6, 99e6));
        cover.settle(address(acct));
        assertEq(uint8(cover.position(address(acct)).status), uint8(CoverStatus.Active));

        _lose(acct, 1);
        h = cover.health(address(acct));
        assertTrue(h.settleable);
        assertEq(h.payoutNow, 1);
        assertEq(cover.settle(address(acct)), 1);
    }

    /// @dev The limit rounds up: on a principal where limit x principal / 10000 has a remainder, a loss one wei
    ///      below the rounded-up limit is within it and the rounded-up limit itself is still within it.
    function test_settle_limitRoundsUp() public {
        // deposit 1,000.000003 USDG -> net 990.00000297 floors to 990.000002 (fee 1% floors); use a fee-free offer
        Terms memory t = _terms();
        t.feeBps = 0;
        BondlineCover c = _offer(t, 100_000e6);
        AgentAccount acct = _open(c, 777, 1_000_000_001); // principal 1,000,000,001; limit = ceil(77_700.00077) = 77_700_001
        Position memory p = c.position(address(acct));
        assertEq(p.principal, 1_000_000_001);
        _lose(acct, 77_700_001);
        assertEq(c.health(address(acct)).limit, 77_700_001);
        vm.expectRevert(abi.encodeWithSelector(IBondlineCover.WithinLimit.selector, 77_700_001, 77_700_001));
        c.settle(address(acct));
        _lose(acct, 1);
        assertEq(c.settle(address(acct)), 1);
    }

    // ---------------------------------------------------------------- bookkeeping across two accounts

    function _two() internal returns (AgentAccount small, AgentAccount large) {
        small = _open(cover, 1000, 10e6); // reserve 1.98e6
        vm.startPrank(stranger);
        usdg.approve(address(cover), 1000e6);
        large = AgentAccount(cover.open(1000, _rules(), 1000e6)); // reserve 198e6
        vm.stopPrank();
    }

    /// @dev Settling the account with the smaller reservation must leave exactly the other's reservation reserved
    ///      (kills `reserved -= pos.reserve` -> `reserved %= pos.reserve`, which is only equal when R2 < R1).
    function test_settle_keepsOtherAccountsReservation() public {
        (AgentAccount small, AgentAccount large) = _two();
        uint256 rSmall = cover.position(address(small)).reserve;
        uint256 rLarge = cover.position(address(large)).reserve;
        assertLt(rSmall, rLarge);
        assertEq(cover.reserved(), rSmall + rLarge);
        _lose(small, 1.5e6); // principal 9.9e6, limit 0.99e6: loss 1.5e6 pays 0.51e6 (band is 1.98e6)
        uint256 bondBefore = cover.bond();
        uint256 payout = cover.settle(address(small));
        assertEq(payout, 510_000);
        assertEq(cover.reserved(), rLarge);
        assertEq(cover.bond(), bondBefore - payout);
        assertEq(cover.claimsPaid(), payout);
        assertEq(cover.position(address(small)).reserve, 0);
        assertEq(cover.position(address(large)).reserve, rLarge);
    }

    function test_close_keepsOtherAccountsReservation() public {
        (AgentAccount small, AgentAccount large) = _two();
        uint256 rSmall = cover.position(address(small)).reserve;
        uint256 rLarge = cover.position(address(large)).reserve;
        vm.prank(user);
        cover.close(address(small));
        assertEq(cover.reserved(), rLarge);
        assertEq(cover.position(address(small)).reserve, 0);
        assertEq(cover.reserved(), cover.position(address(large)).reserve);
        assertGt(rSmall, 0);
    }

    function test_withdraw_keepsOtherAccountsReservation() public {
        (AgentAccount small, AgentAccount large) = _two();
        uint256 rLarge = cover.position(address(large)).reserve;
        uint256 rSmall = cover.position(address(small)).reserve;
        vm.prank(user);
        cover.withdraw(address(small), 4e6); // value 9.9e6 -> 5.9e6
        Position memory p = cover.position(address(small));
        assertEq(p.principal, 9.9e6 * 5.9e6 / 9.9e6); // 5.9e6
        assertEq(p.reserve, (p.principal * 2000 + 9999) / 10_000);
        assertEq(cover.reserved(), rLarge + p.reserve);
        assertLt(p.reserve, rSmall);
    }

    // ---------------------------------------------------------------- delist

    function test_delist_secondCallEmitsNothing() public {
        vm.recordLogs();
        vm.prank(address(market));
        cover.delist();
        assertEq(vm.getRecordedLogs().length, 1);
        vm.recordLogs();
        vm.prank(address(market));
        cover.delist();
        assertEq(vm.getRecordedLogs().length, 0);
    }

    // ---------------------------------------------------------------- health

    function test_health_lossAndPayoutNow() public {
        AgentAccount acct = _open(cover, 1000, 1000e6); // principal 990e6, limit 99e6, band 20% = 198e6
        Health memory h = cover.health(address(acct));
        assertEq(h.loss, 0);
        assertEq(h.payoutNow, 0);
        assertFalse(h.settleable);

        _lose(acct, 150e6); // loss 150e6 -> payout 51e6, below the 198e6 band
        h = cover.health(address(acct));
        assertEq(h.value, 840e6);
        assertEq(h.loss, 150e6);
        assertEq(h.limit, 99e6);
        assertTrue(h.fresh);
        assertTrue(h.settleable);
        assertEq(h.payoutNow, 51e6);

        _lose(acct, 400e6); // loss 550e6 -> loss - limit = 451e6, capped at the 198e6 band
        h = cover.health(address(acct));
        assertEq(h.loss, 550e6);
        assertEq(h.payoutNow, 198e6);
        assertEq(h.reserve, 198e6);
    }

    /// @dev A gain: value above principal means loss is 0 (not a wrapped or modular value).
    function test_health_gainHasZeroLoss() public {
        AgentAccount acct = _open(cover, 1000, 1000e6);
        usdg.mint(address(acct), 40e6);
        Health memory h = cover.health(address(acct));
        assertEq(h.value, 1030e6);
        assertEq(h.loss, 0);
        assertFalse(h.settleable);
        assertEq(h.payoutNow, 0);
        vm.expectRevert(abi.encodeWithSelector(IBondlineCover.WithinLimit.selector, 0, 99e6));
        cover.settle(address(acct));
    }

    /// @dev Loss with a value that does not divide the principal: guards `-` against `%`.
    function test_health_lossIsExactDifference() public {
        AgentAccount acct = _open(cover, 1000, 1000e6);
        _lose(acct, 400e6);
        Health memory h = cover.health(address(acct));
        assertEq(h.value, 590e6);
        assertEq(h.loss, 400e6);
        assertEq(h.payoutNow, 198e6); // loss - limit = 301e6, capped at the 198e6 band
    }

    // ---------------------------------------------------------------- capacity boundary

    /// @dev The premium joins the bond first, so a bond of 188 USDG plus the 10 USDG premium is exactly the 198 USDG
    ///      worst case of a 1,000 USDG deposit at a 10% limit: accepted at equality, refused one unit below.
    function test_open_capacityExactlyEnough_andOneBelow() public {
        BondlineCover exact = _offer(_terms(), 188e6);
        _open(exact, 1000, 1000e6);
        assertEq(exact.free(), 0);

        BondlineCover tight = _offer(_terms(), 188e6 - 1);
        vm.startPrank(user);
        usdg.approve(address(tight), 1000e6);
        vm.expectRevert(abi.encodeWithSelector(IBondlineCover.InsufficientCapacity.selector, 198e6, 198e6 - 1));
        tight.open(1000, _rules(), 1000e6);
        vm.stopPrank();
    }

    /// @dev With part of the bond already reserved, a second deposit must fit in what is left (bond - reserved).
    function test_deposit_refusedWhenFreeBondTooSmall_withReservedBond() public {
        BondlineCover c = _offer(_terms(), 300e6);
        AgentAccount acct = _open(c, 1000, 1000e6); // bond 310e6, reserved 198e6, free 112e6
        assertEq(c.free(), 112e6);
        vm.startPrank(user);
        usdg.approve(address(c), 700e6);
        // 700 USDG: premium 7e6 joins the bond (free 119e6), net 693e6 reserves 138.6e6 > 119e6.
        vm.expectRevert(abi.encodeWithSelector(IBondlineCover.InsufficientCapacity.selector, 138.6e6, 119e6));
        c.deposit(address(acct), 700e6);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- rules boundaries

    function _expectOpen(Rules memory r, bool ok) internal {
        vm.startPrank(user);
        usdg.approve(address(cover), 1000e6);
        if (!ok) vm.expectRevert(IBondlineCover.InvalidRules.selector);
        cover.open(1000, r, 1000e6);
        vm.stopPrank();
    }

    /// @dev Only bits of existing assets (two here) may be set: 5 sets a bit above the assets, 255 sets many.
    function test_open_assetMaskAboveRangeRejected() public {
        Rules memory r = _rules();
        r.assetMask = 5;
        _expectOpen(r, false);
        r.assetMask = 255;
        _expectOpen(r, false);
        r.assetMask = 4;
        _expectOpen(r, false);
        r.assetMask = 0;
        _expectOpen(r, false);
        for (uint8 m = 1; m <= 3; ++m) {
            r.assetMask = m;
            _expectOpen(r, true);
        }
    }

    function test_open_slippageBoundary() public {
        Rules memory r = _rules();
        r.maxSlippageBps = 500;
        _expectOpen(r, true);
        r.maxSlippageBps = 501;
        _expectOpen(r, false);
        r.maxSlippageBps = 0;
        _expectOpen(r, true);
    }

    /// @dev A rule may be stricter than the market's price age, equal to it, but not looser (kills `>` -> `!=`).
    function test_open_priceAgeBoundary() public {
        Rules memory r = _rules();
        r.maxPriceAge = MAX_AGE - 200;
        _expectOpen(r, true);
        r.maxPriceAge = MAX_AGE;
        _expectOpen(r, true);
        r.maxPriceAge = MAX_AGE + 1;
        _expectOpen(r, false);
        r.maxPriceAge = 1;
        _expectOpen(r, true);
    }

    function test_open_tradeAndDailyBoundaries() public {
        Rules memory r = _rules();
        r.maxTradeBps = 10_000;
        r.maxDailyBps = 100_000;
        _expectOpen(r, true);
        r.maxTradeBps = 1;
        r.maxDailyBps = 1;
        _expectOpen(r, true);
        r.maxTradeBps = 10_001;
        _expectOpen(r, false);
        r.maxTradeBps = 10_000;
        r.maxDailyBps = 100_001;
        _expectOpen(r, false);
    }

    /// @dev A delisted offer refuses with NotListed before it looks at the arguments.
    function test_open_delistedRefusesBeforeValidatingArguments() public {
        vm.prank(address(market));
        cover.delist();
        Rules memory bad = _rules();
        bad.assetMask = 0;
        vm.startPrank(user);
        usdg.approve(address(cover), 1000e6);
        vm.expectRevert(IBondlineCover.NotListed.selector);
        cover.open(1000, bad, 1000e6);
        vm.expectRevert(IBondlineCover.NotListed.selector);
        cover.open(1, _rules(), 1000e6); // limit below the offer's minimum
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- cumulative counters

    function test_counters_accumulateAcrossDepositsAndSettlements() public {
        AgentAccount a = _open(cover, 1000, 1000e6); // premium 10e6
        assertEq(cover.premiums(), 10e6);
        vm.startPrank(stranger);
        usdg.approve(address(cover), 1000e6);
        AgentAccount b = AgentAccount(cover.open(1000, _rules(), 500e6)); // premium 5e6
        vm.stopPrank();
        assertEq(cover.premiums(), 15e6);
        assertTrue((10e6 & 5e6) != 0); // so `|=` and `^=` would differ from `+=`

        _lose(a, 150e6); // pays 51e6
        _lose(b, 140e6); // principal 495e6, limit 49.5e6: pays 90.5e6
        uint256 p1 = cover.settle(address(a));
        assertEq(p1, 51e6);
        assertEq(cover.claimsPaid(), p1);
        uint256 p2 = cover.settle(address(b));
        assertEq(p2, 90.5e6);
        assertTrue((p1 & p2) != 0);
        assertEq(cover.claimsPaid(), p1 + p2);
        assertEq(cover.premiums(), 15e6);
    }

    // ---------------------------------------------------------------- health of settled and invalid-priced accounts

    function test_health_settledAndClosedAccountsAreNotSettleable() public {
        AgentAccount a = _open(cover, 1000, 1000e6);
        AgentAccount b = _open(cover, 1000, 1000e6);
        _lose(a, 300e6);
        _lose(b, 300e6);
        cover.settle(address(a));
        vm.prank(user);
        cover.close(address(b));
        Health memory ha = cover.health(address(a));
        Health memory hb = cover.health(address(b));
        assertEq(uint8(ha.status), uint8(CoverStatus.Settled));
        assertEq(uint8(hb.status), uint8(CoverStatus.Closed));
        assertGt(ha.loss, ha.limit);
        assertTrue(ha.fresh);
        assertFalse(ha.settleable);
        assertFalse(hb.settleable);
        assertEq(ha.payoutNow, 0);
        assertEq(hb.payoutNow, 0);
    }

    function test_health_invalidPriceIsNotFresh_andDoesNotRevert() public {
        (, AgentAccount acct) = _investedFor(cover);
        vm.mockCall(
            address(tslaFeed),
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(uint80(9), int256(0), block.timestamp, block.timestamp, uint80(9))
        );
        Health memory h = cover.health(address(acct));
        assertFalse(h.fresh);
        assertFalse(h.settleable);
        assertEq(h.payoutNow, 0);
        assertEq(h.principal, 990e6);
    }

    function _investedFor(BondlineCover c) internal returns (BondlineCover, AgentAccount acct) {
        acct = _open(c, 1000, 1000e6);
        assertTrue(_trade(acct, address(tsla), true, 792e6));
        return (c, acct);
    }

    // ---------------------------------------------------------------- reentrancy guard on open

    /// @dev `open` pulls USDG from the caller; a token that calls back into the cover during that transfer must
    ///      find the cover locked (kills removing `nonReentrant` from `open`).
    function test_open_isNonReentrant() public {
        ReentrantToken token = new ReentrantToken();
        FakeMarket fm = new FakeMarket(address(token), address(coverImpl), address(accountImpl), address(venue));
        BondlineCover c = fm.makeCover(underwriter, _terms());
        token.mint(address(this), 1500e6);
        token.approve(address(c), 1500e6);
        c.fund(500e6);
        token.mint(address(token), 10e6);
        token.arm(address(c));
        c.open(1000, _rules(), 1000e6);
        assertTrue(token.hookRan());
        assertFalse(token.reenteredOk());
    }
}

/// @dev A USDG stand-in that calls `cover.fund(1)` from inside `transferFrom` and records whether it got through.
contract ReentrantToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address internal _cover;
    bool public hookRan;
    bool public reenteredOk;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function arm(address cover_) external {
        _cover = cover_;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (_cover != address(0) && !hookRan) {
            hookRan = true;
            allowance[address(this)][_cover] = 1;
            (bool ok,) = _cover.call(abi.encodeWithSignature("fund(uint256)", 1));
            reenteredOk = ok;
        }
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev Just enough of a market for a cover to initialise against, with a custom token.
contract FakeMarket {
    address public usdg;
    address public accountImplementation;
    address public venue;
    address internal _coverImpl;
    uint16 public constant capBps = 3000;
    uint32 public constant maxPriceAge = 300;

    constructor(address usdg_, address coverImpl_, address accountImpl_, address venue_) {
        usdg = usdg_;
        _coverImpl = coverImpl_;
        accountImplementation = accountImpl_;
        venue = venue_;
    }

    function makeCover(address underwriter, Terms memory t) external returns (BondlineCover c) {
        c = BondlineCover(_clone(_coverImpl));
        c.initialize(underwriter, t);
    }

    function assets() external pure returns (address[] memory a) {
        a = new address[](2);
        a[0] = address(0xA1);
        a[1] = address(0xA2);
    }

    function feeds() external pure returns (address[] memory f) {
        f = new address[](2);
        f[0] = address(0xF1);
        f[1] = address(0xF2);
    }

    function _clone(address impl) internal returns (address inst) {
        bytes20 t = bytes20(impl);
        assembly ("memory-safe") {
            let p := mload(0x40)
            mstore(p, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(p, 0x14), t)
            mstore(add(p, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            inst := create(0, p, 0x37)
        }
    }
}
