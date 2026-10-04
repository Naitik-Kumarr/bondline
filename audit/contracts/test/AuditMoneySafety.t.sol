// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {Vm} from "forge-std/Vm.sol";
import {Terms, Rules, Position, Health, CoverStatus, Valuation} from "../src/Types.sol";
import {AgentAccount} from "../src/AgentAccount.sol";
import {BondlineCover} from "../src/BondlineCover.sol";
import {IBondlineCover, IAgentAccount, IMirrorFeed, IOracleVenue} from "../src/interfaces/IBondline.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";

/// @notice Independent safety-property tests. testSafety_* are intentionally failing regression proofs;
/// testClean_* demonstrate properties that held in the isolated audit copy. No transaction is broadcast.
contract AuditMoneySafetyTest is BaseTest {
    function testSafety_cashWithdrawalUnaffectedByZeroValueStaleDonation() public {
        BondlineCover c = _offer(_terms(), 10_000e6);
        AgentAccount a = _open(c, 1000, 1000e6);
        vm.warp(block.timestamp + MAX_AGE + 1);
        // AMZN is not permitted by this account's mask in the parallel test below. Even a one-wei
        // external donation, valued at zero USDG base units, turns cash into a stale account.
        amzn.mint(stranger, 1);
        vm.prank(stranger);
        amzn.transfer(address(a), 1);
        assertEq(a.valuation().stockValue, 0);
        vm.prank(user);
        c.withdraw(address(a), 100e6); // Safety property: zero-value unsolicited dust must not block cash.
    }

    function testSafety_claimUnaffectedByDisallowedZeroValueStaleDonation() public {
        BondlineCover c = _offer(_terms(), 10_000e6);
        Rules memory r = _rules();
        r.assetMask = 1;
        AgentAccount a = _openWith(c, 1000, r, 1000e6);
        assertTrue(_trade(a, address(tsla), true, 792e6));
        vm.warp(block.timestamp + MAX_AGE + 1);
        vm.prank(keeper);
        tslaFeed.push(200e8, block.timestamp); // Held TSLA fresh, loss past limit, untouched AMZN stale.
        assertTrue(c.health(address(a)).settleable);
        amzn.mint(stranger, 1);
        vm.prank(stranger);
        amzn.transfer(address(a), 1);
        assertEq(amzn.balanceOf(address(a)), 1);
        assertTrue(c.health(address(a)).settleable, "unsolicited zero-value disallowed stock blocked payout");
    }

    function testSafety_untrustedReplayParticipantCannotExtractVenueUSDG() public {
        // Two real TSLA replay rounds from keeper/data/replay-rounds.json, public before replay starts:
        // 18446744073709553016 ($346.175), then 18446744073709553060 ($374.37).
        _setPrices(34617500000, AMZN_PRICE);
        uint256 venueBefore = usdg.balanceOf(address(venue));
        uint256 attackerBefore = usdg.balanceOf(stranger);
        Terms memory t = Terms({agent: stranger, minLimitBps: 2999, maxLimitBps: 2999,
            feeBps: 0, maxStockBps: 10_000, name: "untrusted participant"});
        Rules memory r = _rules();
        r.maxStockBps = 10_000;
        vm.startPrank(stranger);
        (, address coverAddress) = market.createOffer(t);
        BondlineCover c = BondlineCover(coverAddress);
        usdg.approve(coverAddress, 80e6);
        c.fund(80e6); // 0.01% reserve for an 800,000-USDG account; no whitelist involved.
        usdg.approve(coverAddress, 800_000e6);
        AgentAccount a = AgentAccount(c.open(2999, r, 800_000e6));
        assertTrue(a.trade(address(tsla), true, 800_000e6, 0, bytes("known low")));
        vm.stopPrank();
        _setPrices(37437000000, AMZN_PRICE); // Simulates the honest scheduled keeper, not attacker authority.
        vm.startPrank(stranger);
        assertTrue(a.trade(address(tsla), false, type(uint256).max, 0, bytes("known high")));
        uint256 cash = usdg.balanceOf(address(a));
        c.withdraw(address(a), cash);
        c.release(stranger, c.free());
        vm.stopPrank();
        emit log_named_uint("attacker profit USDG base units", usdg.balanceOf(stranger) - attackerBefore);
        emit log_named_uint("venue loss USDG base units", venueBefore - usdg.balanceOf(address(venue)));
        assertGe(usdg.balanceOf(address(venue)), venueBefore,
            "permissionless self-created account bypassed replay-inventory admission protection");
    }

    function testSafety_emptyOfferSpamRemainsEnumerableUnderTwoMillionGas() public {
        Terms memory t = _terms();
        vm.startPrank(stranger);
        for (uint256 i; i < 1000; ++i) market.createOffer(t); // No bond, fee or minimum stake required.
        vm.stopPrank();
        assertEq(market.offerCount(), 1000);
        vm.cool(address(market));
        (bool ok,) = address(market).staticcall{gas: 2_000_000}(abi.encodeWithSignature("offers()"));
        assertTrue(ok, "zero-bond spam makes the all-offers getter exceed 2M gas");
    }

    function testSafety_healthRejectsIssuerPausedSettlement() public {
        (BondlineCover c, AgentAccount a) = _invested();
        _drop(5000);
        usdg.setPaused(true);
        (bool ok,) = address(c).call(abi.encodeCall(c.settle, (address(a))));
        assertFalse(ok);
        assertFalse(c.health(address(a)).settleable, "health says settle would succeed while token is paused");
    }

    function testSafety_healthRejectsFrozenPayoutRecipient() public {
        (BondlineCover c, AgentAccount a) = _invested();
        _drop(5000);
        usdg.setFrozen(user, true);
        (bool ok,) = address(c).call(abi.encodeCall(c.settle, (address(a))));
        assertFalse(ok);
        assertFalse(c.health(address(a)).settleable, "health says settle would succeed for frozen recipient");
    }

    function testSafety_issuerBlockedTradeStillProducesBlockedReceipt() public {
        BondlineCover c = _offer(_terms(), 10_000e6);
        AgentAccount a = _open(c, 1000, 1000e6);
        usdg.setPaused(true);
        vm.recordLogs();
        vm.prank(agent);
        (bool ok,) = address(a).call(abi.encodeCall(a.trade, (address(tsla), true, 100e6, 0, bytes("buy"))));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 blocked;
        bytes32 sig = keccak256("Blocked(address,bool,uint256,uint8,uint256,uint256,bytes32)");
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(a) && logs[i].topics[0] == sig) ++blocked;
        }
        assertTrue(ok && blocked == 1, "paused USDG causes reverted transaction without Blocked receipt");
    }

    function testSafety_oldMirrorAnswerCannotBeRetimestampedAsFresh() public {
        (,, , uint256 previous,) = tslaFeed.latestRoundData();
        vm.warp(previous + MAX_AGE + 1);
        vm.prank(keeper);
        tslaFeed.push(TSLA_PRICE, block.timestamp); // Same old answer, invented current timestamp is accepted.
        (,,, uint256 current,) = tslaFeed.latestRoundData();
        assertEq(current, previous, "timestamp monotonicity cannot authenticate the source timestamp");
    }

    function testSafety_keeperCannotManufacturePayoutAgainstUnchangedReferencePrice() public {
        (BondlineCover c, AgentAccount a) = _invested();
        assertFalse(c.health(address(a)).settleable);
        uint256 held = tsla.balanceOf(address(a));
        uint256 cash = usdg.balanceOf(address(a));
        // The reference remains the original $400. Only the trusted mirror's value changes.
        // This test documents a disclosed trust boundary, rather than unauthorized keeper access.
        uint256 referenceValue = cash + held * uint256(TSLA_PRICE) / 1e20;
        _drop(5000);
        uint256 reserve = c.position(address(a)).reserve;
        uint256 paid = c.settle(address(a));
        assertLe(paid, reserve);
        emit log_named_uint("unchanged-reference account value USDG base units", referenceValue);
        emit log_named_uint("mirror-only manufactured payout USDG base units", paid);
        assertEq(paid, 0, "fixed keeper can set a fresh unsupported price and trigger a capped payout");
    }

    function testClean_measureEmptyOfferEnumerationCost() public {
        Terms memory t = _terms();
        vm.startPrank(stranger);
        for (uint256 i; i < 1000; ++i) market.createOffer(t);
        vm.stopPrank();
        vm.cool(address(market));
        uint256 before = gasleft();
        market.offers();
        emit log_named_uint("1000 empty offers getter gas (account cold; storage warm)", before - gasleft());
        assertEq(market.offerCount(), 1000);
    }

    function testClean_pausedSettlementRollsBackAllAccountingAndCanRetry() public {
        (BondlineCover c, AgentAccount a) = _invested();
        _drop(5000);
        Position memory before = c.position(address(a));
        uint256 bondBefore = c.bond();
        usdg.setPaused(true);
        vm.expectRevert(MockUSDG.ContractPaused.selector);
        c.settle(address(a));
        _checkUnchanged(c, a, before, bondBefore);
        usdg.setPaused(false);
        uint256 paid = c.settle(address(a));
        assertLe(paid, before.reserve);
        assertTrue(a.stopped());
    }

    function testClean_frozenSettlementRollsBackAllAccountingAndCanRetry() public {
        (BondlineCover c, AgentAccount a) = _invested();
        _drop(5000);
        Position memory before = c.position(address(a));
        uint256 bondBefore = c.bond();
        usdg.setFrozen(user, true);
        vm.expectRevert(abi.encodeWithSelector(MockUSDG.AddressFrozen.selector, user));
        c.settle(address(a));
        _checkUnchanged(c, a, before, bondBefore);
        usdg.setFrozen(user, false);
        assertLe(c.settle(address(a)), before.reserve);
    }

    function testClean_closeStopsAndReleasesEvenWhilePricesStaleAndUSDGPaused() public {
        (BondlineCover c, AgentAccount a) = _invested();
        vm.warp(block.timestamp + 365 days);
        usdg.setPaused(true);
        usdg.setFrozen(user, true);
        vm.prank(user);
        c.close(address(a));
        assertTrue(a.stopped());
        assertTrue(a.released());
        assertEq(c.reserved(), 0);
        assertEq(uint8(c.position(address(a)).status), uint8(CoverStatus.Closed));
    }

    function testClean_underwriterCannotReleaseAnyReservedUSDGOrBlockSettlement() public {
        (BondlineCover c, AgentAccount a) = _invested();
        uint256 freeBond = c.free();
        vm.startPrank(underwriter);
        vm.expectRevert();
        c.release(underwriter, freeBond + 1);
        c.release(underwriter, freeBond);
        market.delist(0);
        vm.stopPrank();
        _drop(5000);
        uint256 reservation = c.position(address(a)).reserve;
        assertLe(c.settle(address(a)), reservation);
        assertGe(c.bond(), c.reserved());
    }

    function testClean_doubleSettlementRejectedAndNoSecondPayout() public {
        (BondlineCover c, AgentAccount a) = _invested();
        _drop(5000);
        c.settle(address(a));
        uint256 balance = usdg.balanceOf(user);
        vm.expectRevert(abi.encodeWithSelector(IBondlineCover.NotActive.selector, address(a)));
        c.settle(address(a));
        assertEq(usdg.balanceOf(user), balance);
    }

    function testClean_staleAndInvalidPricesCannotSettle() public {
        (BondlineCover c, AgentAccount a) = _invested();
        _drop(5000);
        vm.warp(block.timestamp + MAX_AGE + 1);
        vm.expectRevert();
        c.settle(address(a));
        vm.mockCall(address(tslaFeed), abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(uint80(9), int256(0), block.timestamp, block.timestamp, uint80(9)));
        vm.expectRevert(IBondlineCover.InvalidPrices.selector);
        c.settle(address(a));
    }

    function testClean_agentCannotWithdrawPayReleaseOrBypassRules() public {
        BondlineCover c = _offer(_terms(), 10_000e6);
        AgentAccount a = _open(c, 1000, 1000e6);
        vm.startPrank(agent);
        vm.expectRevert(IAgentAccount.NotOwner.selector);
        a.sweep();
        vm.expectRevert(IAgentAccount.NotOwner.selector);
        a.sweepToken(address(usdg));
        vm.expectRevert(IAgentAccount.NotCover.selector);
        a.pay(agent, 1e6);
        vm.expectRevert(IAgentAccount.NotCover.selector);
        a.release();
        vm.expectRevert(IBondlineCover.NotUser.selector);
        c.withdraw(address(a), 1e6);
        uint256 cash = usdg.balanceOf(address(a));
        assertFalse(a.trade(address(tsla), true, 990e6, 0, bytes("outside stock cap")));
        assertEq(usdg.balanceOf(address(a)), cash);
        vm.stopPrank();
    }

    function testClean_keeperOnlyAndTimestampAnswerSanity() public {
        vm.prank(stranger);
        vm.expectRevert(IMirrorFeed.NotKeeper.selector);
        tslaFeed.push(1, block.timestamp + 1);
        vm.startPrank(keeper);
        vm.expectRevert(IMirrorFeed.InvalidAnswer.selector);
        tslaFeed.push(0, block.timestamp);
        vm.expectRevert();
        tslaFeed.push(1, block.timestamp + 1);
        vm.expectRevert();
        tslaFeed.push(1, block.timestamp);
        vm.stopPrank();
    }

    function testClean_directEOACannotTradeAtVenue() public {
        vm.prank(stranger);
        vm.expectRevert();
        venue.buy(address(tsla), 1e6, 0);
    }

    function testClean_receiveAuthorizationCannotBeFrontRunOrReplayed() public {
        uint256 bondAmount = 100e6;
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 nonce = keccak256("independent-audit-authorization");
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(underwriterKey, underwriter, address(market),
            bondAmount, 0, deadline, nonce);
        vm.prank(stranger);
        vm.expectRevert(MockUSDG.CallerMustBePayee.selector);
        usdg.receiveWithAuthorization(underwriter, address(market), bondAmount, 0, deadline, nonce, v, r, s);
        vm.prank(stranger);
        vm.expectRevert(MockUSDG.InvalidSignature.selector);
        market.createOfferWithAuthorization(_terms(), bondAmount, 0, deadline, nonce, v, r, s);
        assertFalse(usdg.authorizationState(underwriter, nonce));
        vm.prank(underwriter);
        (, address c) = market.createOfferWithAuthorization(_terms(), bondAmount, 0, deadline, nonce, v, r, s);
        assertEq(usdg.balanceOf(address(market)), 0);
        assertEq(usdg.balanceOf(c), bondAmount);
        vm.prank(underwriter);
        vm.expectRevert(MockUSDG.AuthorizationAlreadyUsed.selector);
        market.createOfferWithAuthorization(_terms(), bondAmount, 0, deadline, nonce, v, r, s);
    }

    function testFuzz_cleanPayoutNeverExceedsReservationAfterTopupAndWithdrawal(uint256 extra, uint256 take) public {
        extra = bound(extra, 1e6, 10_000e6);
        (BondlineCover c, AgentAccount a) = _invested();
        vm.startPrank(user);
        usdg.approve(address(c), extra);
        c.deposit(address(a), extra);
        take = bound(take, 1, usdg.balanceOf(address(a)));
        c.withdraw(address(a), take);
        vm.stopPrank();
        _drop(9999);
        Health memory h = c.health(address(a));
        if (h.settleable) assertLe(c.settle(address(a)), h.reserve);
        assertGe(c.bond(), c.reserved());
    }

    function _checkUnchanged(BondlineCover c, AgentAccount a, Position memory before, uint256 bondBefore) internal view {
        Position memory afterFailed = c.position(address(a));
        assertEq(uint8(afterFailed.status), uint8(before.status));
        assertEq(afterFailed.reserve, before.reserve);
        assertEq(c.reserved(), before.reserve);
        assertEq(c.bond(), bondBefore);
        assertEq(c.claimsPaid(), 0);
        assertFalse(a.stopped());
        assertFalse(a.released());
    }
}
