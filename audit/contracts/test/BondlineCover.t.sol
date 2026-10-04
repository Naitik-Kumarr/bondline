// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import {BaseTest} from "./Base.t.sol";
import {Terms, Rules, Health, Position, CoverStatus, Valuation} from "../src/Types.sol";
import {AgentAccount} from "../src/AgentAccount.sol";
import {BondlineCover} from "../src/BondlineCover.sol";
import {IBondlineCover} from "../src/interfaces/IBondline.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";

contract BondlineCoverTest is BaseTest {
    BondlineCover internal cover;

    function setUp() public override {
        super.setUp();
        cover = _offer(_terms(), 10_000e6);
    }

    // ---------------------------------------------------------------- initialization

    function test_initialState() public view {
        assertEq(cover.market(), address(market));
        assertEq(cover.underwriter(), underwriter);
        assertEq(cover.agent(), agent);
        assertEq(cover.usdg(), address(usdg));
        assertEq(cover.accountImplementation(), address(accountImpl));
        assertEq(cover.capBps(), 3000);
        assertEq(cover.maxPriceAge(), MAX_AGE);
        assertTrue(cover.listed());
        assertEq(cover.bond(), 10_000e6);
        assertEq(cover.reserved(), 0);
        assertEq(cover.free(), 10_000e6);
        Terms memory t = cover.terms();
        assertEq(t.feeBps, 100);
        assertEq(t.name, "Bold 1%");
        assertEq(cover.accountCount(), 0);
    }

    function test_initialize_onlyOnce() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        cover.initialize(stranger, _terms());
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        coverImpl.initialize(stranger, _terms());
    }

    function test_initialize_rejectsZeroAddresses() public {
        // A clone initialized directly (not through the market) still validates its inputs.
        BondlineCover c = BondlineCover(_clone(address(coverImpl)));
        vm.expectRevert(IBondlineCover.ZeroAddress.selector);
        vm.prank(address(market));
        c.initialize(address(0), _terms());
        Terms memory t = _terms();
        t.agent = address(0);
        vm.expectRevert(IBondlineCover.ZeroAddress.selector);
        vm.prank(address(market));
        c.initialize(underwriter, t);
    }

    // ---------------------------------------------------------------- bond

    function test_fund_anyone() public {
        vm.startPrank(stranger);
        usdg.approve(address(cover), 500e6);
        vm.expectEmit(true, false, false, true, address(cover));
        emit IBondlineCover.Funded(stranger, 500e6, 10_500e6);
        cover.fund(500e6);
        vm.stopPrank();
        assertEq(cover.bond(), 10_500e6);
        assertEq(usdg.balanceOf(address(cover)), 10_500e6);
    }

    function test_fund_zero() public {
        vm.expectRevert(IBondlineCover.ZeroAmount.selector);
        cover.fund(0);
    }

    function test_release_onlyUnderwriter_onlyFree() public {
        _open(cover, 1000, 1000e6); // reserves 198 USDG; bond 10,010 with the premium
        vm.prank(stranger);
        vm.expectRevert(IBondlineCover.NotUnderwriter.selector);
        cover.release(stranger, 1e6);

        vm.startPrank(underwriter);
        vm.expectRevert(IBondlineCover.ZeroAddress.selector);
        cover.release(address(0), 1e6);
        vm.expectRevert(IBondlineCover.ZeroAmount.selector);
        cover.release(underwriter, 0);
        uint256 freeBond = cover.free();
        assertEq(freeBond, 10_010e6 - 198e6);
        vm.expectRevert(abi.encodeWithSelector(IBondlineCover.InsufficientFreeBond.selector, freeBond + 1, freeBond));
        cover.release(underwriter, freeBond + 1);

        uint256 before = usdg.balanceOf(underwriter);
        vm.expectEmit(true, false, false, true, address(cover));
        emit IBondlineCover.BondReleased(underwriter, freeBond, 198e6);
        cover.release(underwriter, freeBond);
        vm.stopPrank();
        assertEq(usdg.balanceOf(underwriter), before + freeBond);
        assertEq(cover.bond(), cover.reserved());
        assertEq(cover.free(), 0);
    }

    function test_delist_onlyMarket() public {
        vm.expectRevert(IBondlineCover.NotMarket.selector);
        cover.delist();
        vm.prank(address(market));
        cover.delist();
        assertFalse(cover.listed());
        vm.prank(address(market));
        cover.delist(); // idempotent
    }

    // ---------------------------------------------------------------- open and deposit

    function test_open_createsAccountAndDeposits() public {
        vm.startPrank(user);
        usdg.approve(address(cover), 1000e6);
        address predicted = vm.computeCreateAddress(address(cover), vm.getNonce(address(cover)));
        vm.expectEmit(true, true, false, true, address(cover));
        emit IBondlineCover.Opened(predicted, user, 1000, _rules());
        vm.expectEmit(true, true, false, true, address(cover));
        emit IBondlineCover.Deposited(predicted, user, 1000e6, 10e6, 990e6, 198e6);
        address a = cover.open(1000, _rules(), 1000e6);
        vm.stopPrank();

        assertEq(a, predicted);
        assertTrue(cover.isAccount(a));
        assertEq(cover.accountCount(), 1);
        assertEq(cover.accountAt(0), a);
        Position memory p = cover.position(a);
        assertEq(p.user, user);
        assertEq(p.limitBps, 1000);
        assertEq(uint8(p.status), uint8(CoverStatus.Active));
        assertEq(p.principal, 990e6);
        assertEq(p.reserve, 198e6);
        assertEq(cover.bond(), 10_010e6);
        assertEq(cover.premiums(), 10e6);
        assertEq(cover.reserved(), 198e6);
        assertEq(usdg.balanceOf(a), 990e6);
        assertEq(usdg.balanceOf(address(cover)), 10_010e6);
        assertEq(AgentAccount(a).owner(), user);
        assertEq(AgentAccount(a).agent(), agent);
    }

    function test_open_whenDelisted() public {
        vm.prank(underwriter);
        market.delist(0);
        vm.prank(user);
        vm.expectRevert(IBondlineCover.NotListed.selector);
        cover.open(1000, _rules(), 1000e6);
    }

    function test_open_limitOutOfRange() public {
        vm.startPrank(user);
        vm.expectRevert(abi.encodeWithSelector(IBondlineCover.LimitOutOfRange.selector, 499, 500, 2000));
        cover.open(499, _rules(), 1000e6);
        vm.expectRevert(abi.encodeWithSelector(IBondlineCover.LimitOutOfRange.selector, 2001, 500, 2000));
        cover.open(2001, _rules(), 1000e6);
        vm.stopPrank();
    }

    function test_open_invalidRules() public {
        Rules[] memory bad = new Rules[](10);
        for (uint256 i; i < bad.length; ++i) {
            bad[i] = _rules();
        }
        bad[0].assetMask = 0;
        bad[1].assetMask = 4; // only two assets
        bad[2].maxStockBps = 8001; // above the offer's 80%
        bad[3].maxTradeBps = 0;
        bad[4].maxTradeBps = 10_001;
        bad[5].maxDailyBps = 0;
        bad[6].maxDailyBps = 100_001;
        bad[7].maxSlippageBps = 501;
        bad[8].maxPriceAge = 0;
        bad[9].maxPriceAge = MAX_AGE + 1;
        vm.startPrank(user);
        usdg.approve(address(cover), type(uint256).max);
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(IBondlineCover.InvalidRules.selector);
            cover.open(1000, bad[i], 1000e6);
        }
        vm.stopPrank();
    }

    function test_deposit_anyoneCanTopUp() public {
        AgentAccount acct = _open(cover, 1000, 1000e6);
        vm.startPrank(stranger);
        usdg.approve(address(cover), 500e6);
        vm.expectEmit(true, true, false, true, address(cover));
        emit IBondlineCover.Deposited(address(acct), stranger, 500e6, 5e6, 495e6, 99e6);
        cover.deposit(address(acct), 500e6);
        vm.stopPrank();
        Position memory p = cover.position(address(acct));
        assertEq(p.principal, 1485e6);
        assertEq(p.reserve, 297e6);
        assertEq(p.user, user); // only the user can take it out
    }

    function test_deposit_reserveRoundsUp() public {
        AgentAccount acct = _open(cover, 1500, 1000e6);
        // The open reserved 990 x 15% = 148.5 USDG exactly. Now an uneven deposit:
        vm.startPrank(user);
        usdg.approve(address(cover), 1_000_001);
        cover.deposit(address(acct), 1_000_001); // fee 10,000 -> net 990,001 -> x 1500 / 10000 = 148,500.15
        vm.stopPrank();
        assertEq(cover.position(address(acct)).reserve, 148_500_000 + 148_501); // rounded up
    }

    function test_deposit_refusedBeyondCapacity() public {
        BondlineCover thin = _offer(_terms(), 100e6);
        vm.startPrank(user);
        usdg.approve(address(thin), type(uint256).max);
        // 1000 at a 10% limit reserves 198; bond is 100 + 10 premium = 110.
        vm.expectRevert(abi.encodeWithSelector(IBondlineCover.InsufficientCapacity.selector, 198e6, 110e6));
        thin.open(1000, _rules(), 1000e6);
        // 500 reserves 99, which 100 + 5 covers.
        address a = thin.open(1000, _rules(), 500e6);
        vm.stopPrank();
        assertEq(thin.reserved(), 99e6);
        assertEq(thin.free(), 6e6);
        assertTrue(thin.isAccount(a));
    }

    function test_deposit_tooSmall() public {
        vm.startPrank(user);
        usdg.approve(address(cover), 1e6);
        vm.expectRevert(abi.encodeWithSelector(IBondlineCover.DepositTooSmall.selector, 1e6 - 1, 1e6));
        cover.open(1000, _rules(), 1e6 - 1);
        vm.stopPrank();
    }

    function test_deposit_unknownOrInactive() public {
        vm.expectRevert(abi.encodeWithSelector(IBondlineCover.UnknownAccount.selector, stranger));
        cover.deposit(stranger, 1e6);
        AgentAccount acct = _open(cover, 1000, 1000e6);
        vm.prank(user);
        cover.close(address(acct));
        vm.expectRevert(abi.encodeWithSelector(IBondlineCover.NotActive.selector, address(acct)));
        cover.deposit(address(acct), 1e6);
    }

    function test_deposit_whenDelisted() public {
        AgentAccount acct = _open(cover, 1000, 1000e6);
        vm.prank(underwriter);
        market.delist(0);
        vm.startPrank(user);
        usdg.approve(address(cover), 1e6);
        vm.expectRevert(IBondlineCover.NotListed.selector);
        cover.deposit(address(acct), 1e6);
        vm.stopPrank();
    }

    function test_quoteDeposit() public view {
        (uint256 fee, uint256 net, uint256 reserveNeeded) = cover.quoteDeposit(1000e6, 1000);
        assertEq(fee, 10e6);
        assertEq(net, 990e6);
        assertEq(reserveNeeded, 198e6);
    }

    // ---------------------------------------------------------------- withdraw

    function test_withdraw_shrinksPrincipalByShareOfValue() public {
        (, AgentAccount acct) = _investedIn(cover);
        Valuation memory v = acct.valuation();
        uint256 amount = 100e6;
        uint256 expectedPrincipal = 990e6 * (v.value - amount) / v.value;
        uint256 expectedReserve = (expectedPrincipal * 2000 + 9999) / 10_000;
        uint256 before = usdg.balanceOf(user);

        vm.expectEmit(true, true, false, true, address(cover));
        emit IBondlineCover.Withdrawn(address(acct), user, amount, expectedPrincipal, expectedReserve);
        vm.prank(user);
        cover.withdraw(address(acct), amount);

        assertEq(usdg.balanceOf(user), before + amount);
        Position memory p = cover.position(address(acct));
        assertEq(p.principal, expectedPrincipal);
        assertEq(p.reserve, expectedReserve);
        assertEq(cover.reserved(), expectedReserve);
    }

    function test_withdraw_checks() public {
        (, AgentAccount acct) = _investedIn(cover);
        vm.prank(stranger);
        vm.expectRevert(IBondlineCover.NotUser.selector);
        cover.withdraw(address(acct), 1e6);
        vm.expectRevert(abi.encodeWithSelector(IBondlineCover.UnknownAccount.selector, stranger));
        cover.withdraw(stranger, 1e6);

        vm.startPrank(user);
        vm.expectRevert(IBondlineCover.ZeroAmount.selector);
        cover.withdraw(address(acct), 0);
        vm.expectRevert(abi.encodeWithSelector(IBondlineCover.InsufficientCash.selector, 199e6, 198e6));
        cover.withdraw(address(acct), 199e6);
        vm.warp(block.timestamp + MAX_AGE + 1);
        vm.expectRevert(abi.encodeWithSelector(IBondlineCover.StalePrices.selector, block.timestamp - MAX_AGE - 1, MAX_AGE));
        cover.withdraw(address(acct), 1e6);
        vm.stopPrank();
    }

    function test_withdraw_invalidPrice() public {
        (, AgentAccount acct) = _investedIn(cover);
        vm.mockCall(
            address(tslaFeed),
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(uint80(9), int256(0), block.timestamp, block.timestamp, uint80(9))
        );
        vm.prank(user);
        vm.expectRevert(IBondlineCover.InvalidPrices.selector);
        cover.withdraw(address(acct), 1e6);
    }

    function test_withdraw_afterClose() public {
        AgentAccount acct = _open(cover, 1000, 1000e6);
        vm.startPrank(user);
        cover.close(address(acct));
        vm.expectRevert(abi.encodeWithSelector(IBondlineCover.NotActive.selector, address(acct)));
        cover.withdraw(address(acct), 1e6);
        vm.stopPrank();
    }

    function test_withdraw_cashOnlyAccountNeedsNoPrices() public {
        AgentAccount acct = _open(cover, 1000, 1000e6);
        vm.warp(block.timestamp + 10 days); // every price stale; the account holds only cash
        vm.prank(user);
        cover.withdraw(address(acct), 495e6);
        assertEq(cover.position(address(acct)).principal, 495e6);
        assertEq(cover.position(address(acct)).reserve, 99e6);
    }

    // ---------------------------------------------------------------- settle

    function test_settle_paysTheGap() public {
        (, AgentAccount acct) = _investedIn(cover);
        _drop(3000); // TSLA 400 -> 280
        uint256 value = acct.valuation().value;
        uint256 loss = 990e6 - value;
        uint256 expected = loss - 99e6; // under the 198 cap
        uint256 before = usdg.balanceOf(user);

        Health memory h = cover.health(address(acct));
        assertTrue(h.settleable);
        assertEq(h.payoutNow, expected);

        vm.expectEmit(true, true, true, true, address(cover));
        emit IBondlineCover.Settled(address(acct), user, stranger, value, loss, 99e6, expected);
        vm.prank(stranger);
        uint256 paid = cover.settle(address(acct));

        assertEq(paid, expected);
        assertEq(usdg.balanceOf(user), before + expected);
        assertEq(cover.bond(), 10_010e6 - expected);
        assertEq(cover.reserved(), 0);
        assertEq(cover.claimsPaid(), expected);
        assertEq(uint8(cover.position(address(acct)).status), uint8(CoverStatus.Settled));
        assertTrue(acct.stopped());
        assertTrue(acct.released());
        // The stocks stay in the account.
        assertGt(tsla.balanceOf(address(acct)), 0);
    }

    function test_settle_cappedAtThirtyPercentDrop() public {
        (, AgentAccount acct) = _investedIn(cover);
        _drop(9000); // a crash far beyond the cap
        vm.prank(stranger);
        uint256 paid = cover.settle(address(acct));
        assertEq(paid, 198e6); // principal x (30% - 10%)
    }

    function test_settle_withinLimit() public {
        (, AgentAccount acct) = _investedIn(cover);
        _drop(1000); // account down ~8%
        Health memory h = cover.health(address(acct));
        assertFalse(h.settleable);
        assertEq(h.payoutNow, 0);
        vm.expectRevert(abi.encodeWithSelector(IBondlineCover.WithinLimit.selector, h.loss, 99e6));
        cover.settle(address(acct));
    }

    function test_settle_neverOnStalePrice() public {
        (, AgentAccount acct) = _investedIn(cover);
        _drop(5000);
        vm.warp(block.timestamp + MAX_AGE + 1);
        Health memory h = cover.health(address(acct));
        assertFalse(h.fresh);
        assertFalse(h.settleable);
        vm.expectRevert(abi.encodeWithSelector(IBondlineCover.StalePrices.selector, block.timestamp - MAX_AGE - 1, MAX_AGE));
        cover.settle(address(acct));
    }

    function test_settle_onlyOnce_andUnknown() public {
        (, AgentAccount acct) = _investedIn(cover);
        _drop(5000);
        cover.settle(address(acct));
        vm.expectRevert(abi.encodeWithSelector(IBondlineCover.NotActive.selector, address(acct)));
        cover.settle(address(acct));
        vm.expectRevert(abi.encodeWithSelector(IBondlineCover.UnknownAccount.selector, stranger));
        cover.settle(stranger);
    }

    function test_settle_frozenUserCantReceive() public {
        (, AgentAccount acct) = _investedIn(cover);
        _drop(5000);
        usdg.setFrozen(user, true);
        vm.expectRevert(abi.encodeWithSelector(MockUSDG.AddressFrozen.selector, user));
        cover.settle(address(acct));
        // The user can still stop the agent: close moves no tokens.
        vm.prank(user);
        cover.close(address(acct));
        assertTrue(acct.stopped());
    }

    function test_settle_thenSweep() public {
        (, AgentAccount acct) = _investedIn(cover);
        _drop(5000);
        cover.settle(address(acct));
        uint256 stocks = tsla.balanceOf(address(acct));
        vm.prank(user);
        acct.sweep();
        assertEq(tsla.balanceOf(user), stocks);
    }

    // ---------------------------------------------------------------- close

    function test_close_atAnyPriceMovesNoTokens() public {
        (, AgentAccount acct) = _investedIn(cover);
        _drop(5000);
        vm.warp(block.timestamp + 30 days); // stale prices
        usdg.setPaused(true); // and the issuer has paused USDG
        uint256 cash = usdg.balanceOf(address(acct));
        vm.expectEmit(true, true, false, true, address(cover));
        emit IBondlineCover.Closed(address(acct), user);
        vm.prank(user);
        cover.close(address(acct));
        assertEq(usdg.balanceOf(address(acct)), cash);
        assertEq(cover.reserved(), 0);
        assertEq(uint8(cover.position(address(acct)).status), uint8(CoverStatus.Closed));
        assertTrue(acct.stopped());
        assertTrue(acct.released());
    }

    function test_close_onlyUser_onlyActive() public {
        AgentAccount acct = _open(cover, 1000, 1000e6);
        vm.prank(underwriter);
        vm.expectRevert(IBondlineCover.NotUser.selector);
        cover.close(address(acct));
        vm.startPrank(user);
        cover.close(address(acct));
        vm.expectRevert(abi.encodeWithSelector(IBondlineCover.NotActive.selector, address(acct)));
        cover.close(address(acct));
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- health

    function test_health_unknownAccount() public view {
        Health memory h = cover.health(stranger);
        assertEq(uint8(h.status), uint8(CoverStatus.None));
        assertEq(h.value, 0);
        assertFalse(h.settleable);
    }

    function test_health_fields() public {
        (, AgentAccount acct) = _investedIn(cover);
        Health memory h = cover.health(address(acct));
        assertEq(uint8(h.status), uint8(CoverStatus.Active));
        assertTrue(h.fresh);
        assertEq(h.limitBps, 1000);
        assertEq(h.principal, 990e6);
        assertEq(h.limit, 99e6);
        assertEq(h.reserve, 198e6);
        assertEq(h.value, acct.valuation().value);
        assertEq(h.loss, 990e6 - h.value);
        assertGt(h.stockValue, 0);
    }

    function test_health_cashOnlyIsFresh() public {
        AgentAccount acct = _open(cover, 1000, 1000e6);
        vm.warp(block.timestamp + 10 days);
        assertTrue(cover.health(address(acct)).fresh);
    }

    // ---------------------------------------------------------------- fuzz

    /// @dev For any deposit, limit and drop: settle pays exactly min(loss - limit, principal x band), never more
    ///      than the reserve, and reverts within the limit.
    function testFuzz_settle_formula(uint256 amount, uint16 limitBps, uint256 dropBps, uint256 stockBps) public {
        amount = bound(amount, 1e6, 1_000_000e6);
        limitBps = uint16(bound(limitBps, 500, 2000));
        dropBps = bound(dropBps, 0, 9999);
        stockBps = bound(stockBps, 0, 8000);
        BondlineCover c = _offer(_terms(), 400_000e6);
        AgentAccount acct = _open(c, limitBps, amount);
        uint256 principal = c.position(address(acct)).principal;
        uint256 buy = principal * stockBps / 10_000;
        if (buy > 0) _trade(acct, address(tsla), true, buy);
        _drop(dropBps);

        uint256 value = acct.valuation().value;
        uint256 limit = (principal * limitBps + 9999) / 10_000;
        uint256 loss = principal > value ? principal - value : 0;
        uint256 reserve = c.position(address(acct)).reserve;
        if (loss <= limit) {
            vm.expectRevert(abi.encodeWithSelector(IBondlineCover.WithinLimit.selector, loss, limit));
            c.settle(address(acct));
            return;
        }
        uint256 cap = principal * (3000 - limitBps) / 10_000;
        uint256 expected = loss - limit < cap ? loss - limit : cap;
        uint256 paid = c.settle(address(acct));
        assertEq(paid, expected);
        assertLe(paid, reserve);
        // The user ends with at least principal - limit: value left plus the payout.
        if (loss - limit <= cap) assertGe(value + paid, principal - limit);
    }

    /// @dev Withdrawing can never raise what settle would pay.
    function testFuzz_withdraw_neverRaisesPayout(uint256 dropBps, uint256 takeBps) public {
        dropBps = bound(dropBps, 0, 6000);
        takeBps = bound(takeBps, 1, 10_000);
        (, AgentAccount acct) = _investedIn(cover);
        _drop(dropBps);
        Health memory before = cover.health(address(acct));
        uint256 take = acct.valuation().cash * takeBps / 10_000;
        if (take == 0) return;
        vm.prank(user);
        cover.withdraw(address(acct), take);
        Health memory afterW = cover.health(address(acct));
        assertLe(afterW.payoutNow, before.payoutNow);
        assertLe(afterW.reserve, before.reserve);
        assertGe(afterW.reserve, afterW.principal * (3000 - 1000) / 10_000);
    }

    /// @dev Every deposit reserves its worst case, rounded up, and is refused beyond capacity.
    function testFuzz_deposit_reserve(uint256 amount, uint16 limitBps, uint16 feeBps, uint256 bondAmount) public {
        amount = bound(amount, 1e6, 1_000_000e6);
        limitBps = uint16(bound(limitBps, 1, 2999));
        feeBps = uint16(bound(feeBps, 0, 500));
        bondAmount = bound(bondAmount, 1e6, 500_000e6);
        Terms memory t = _terms();
        t.minLimitBps = 1;
        t.maxLimitBps = 2999;
        t.feeBps = feeBps;
        BondlineCover c = _offer(t, bondAmount);
        uint256 fee = amount * feeBps / 10_000;
        uint256 net = amount - fee;
        uint256 need = (net * (3000 - limitBps) + 9999) / 10_000;
        vm.startPrank(user);
        usdg.approve(address(c), amount);
        if (need > bondAmount + fee) {
            vm.expectRevert(abi.encodeWithSelector(IBondlineCover.InsufficientCapacity.selector, need, bondAmount + fee));
            c.open(limitBps, _rules(), amount);
        } else {
            address a = c.open(limitBps, _rules(), amount);
            assertEq(c.position(a).reserve, need);
            assertEq(c.bond(), bondAmount + fee);
            assertLe(c.reserved(), c.bond());
        }
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- helpers

    function _investedIn(BondlineCover c) internal returns (BondlineCover, AgentAccount acct) {
        acct = _open(c, 1000, 1000e6);
        assertTrue(_trade(acct, address(tsla), true, 792e6));
        return (c, acct);
    }

    function _clone(address impl) internal returns (address instance) {
        bytes memory code = abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", impl, hex"5af43d82803e903d91602b57fd5bf3"
        );
        assembly {
            instance := create(0, add(code, 0x20), mload(code))
        }
    }
}
