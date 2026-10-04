// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import {BaseTest} from "./Base.t.sol";
import {Rules, BlockReason, Valuation} from "../src/Types.sol";
import {AgentAccount} from "../src/AgentAccount.sol";
import {BondlineCover} from "../src/BondlineCover.sol";
import {BondlineMarket} from "../src/BondlineMarket.sol";
import {IAgentAccount} from "../src/interfaces/IBondline.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";

contract AgentAccountTest is BaseTest {
    BondlineCover internal cover;
    AgentAccount internal acct;
    bytes internal constant DECISION = bytes('{"agent":"Bold","action":"buy","asset":"TSLA","usd":100}');

    function setUp() public override {
        super.setUp();
        cover = _offer(_terms(), 10_000e6);
        acct = _open(cover, 1000, 1000e6); // 990 USDG principal after the 1% premium
    }

    function _expectBlocked(address asset, bool isBuy, uint256 usd, BlockReason reason, uint256 observed, uint256 limit)
        internal
    {
        vm.expectEmit(true, true, false, true, address(acct));
        emit IAgentAccount.Blocked(asset, isBuy, usd, reason, observed, limit, keccak256(DECISION));
    }

    function _tradeAs(address asset, bool isBuy, uint256 usd, uint256 minOut) internal returns (bool) {
        vm.prank(agent);
        return acct.trade(asset, isBuy, usd, minOut, DECISION);
    }

    // ---------------------------------------------------------------- setup and views

    function test_initialState() public view {
        assertEq(acct.owner(), user);
        assertEq(acct.agent(), agent);
        assertEq(acct.cover(), address(cover));
        assertEq(acct.market(), address(market));
        assertEq(acct.usdg(), address(usdg));
        assertEq(acct.venue(), address(venue));
        assertEq(acct.assets().length, 2);
        assertEq(acct.feeds()[1], address(amznFeed));
        Rules memory r = acct.rules();
        assertEq(r.maxStockBps, 8000);
        assertFalse(acct.paused());
        assertFalse(acct.stopped());
        assertFalse(acct.released());
        Valuation memory v = acct.valuation();
        assertEq(v.value, 990e6);
        assertEq(v.cash, 990e6);
        assertEq(v.stockValue, 0);
        assertEq(v.oldestUpdate, 0);
        assertTrue(v.pricesValid);
    }

    function test_initialize_onlyOnce() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        acct.initialize(user, agent, address(market), address(usdg), address(venue), _assets(), _feeds(), _rules());
    }

    function test_implementation_cannotBeInitialized() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        accountImpl.initialize(user, agent, address(market), address(usdg), address(venue), _assets(), _feeds(), _rules());
    }

    // ---------------------------------------------------------------- trades that execute

    function test_buy_executesAndEmitsReceipt() public {
        vm.expectEmit(true, true, false, true, address(acct));
        // 400 USDG at $400 = 0.999 TSLA after the spread; value after = 590 + 0.999 x 400 = 989.6
        emit IAgentAccount.Traded(
            address(tsla), true, 400e6, 400e6, 0.999e18, uint256(TSLA_PRICE), 989.6e6, 399.6e6, keccak256(DECISION)
        );
        assertTrue(_tradeAs(address(tsla), true, 400e6, 0.99e18));
        assertEq(tsla.balanceOf(address(acct)), 0.999e18);
        assertEq(usdg.balanceOf(address(acct)), 590e6);
        (, uint256 volume) = acct.dayVolume();
        assertEq(volume, 400e6);
        assertEq(usdg.allowance(address(acct), address(venue)), 0);
    }

    function test_sell_executes() public {
        assertTrue(_tradeAs(address(tsla), true, 400e6, 0));
        assertTrue(_tradeAs(address(tsla), false, 200e6, 0));
        // 200 USDG at $400 = 0.5 TSLA, rounded up; fill 199.8 USDG.
        assertEq(tsla.balanceOf(address(acct)), 0.499e18);
        assertEq(usdg.balanceOf(address(acct)), 590e6 + 199.8e6);
    }

    function test_sell_all() public {
        assertTrue(_tradeAs(address(amzn), true, 200e6, 0));
        uint256 held = amzn.balanceOf(address(acct));
        assertTrue(_tradeAs(address(amzn), false, type(uint256).max, 0));
        assertEq(amzn.balanceOf(address(acct)), 0);
        assertEq(usdg.balanceOf(address(acct)), 790e6 + held * 200 / 1e12 * 9990 / 10_000);
    }

    function test_dayVolume_resetsNextDay() public {
        assertTrue(_tradeAs(address(tsla), true, 100e6, 0));
        (uint256 day, uint256 volume) = acct.dayVolume();
        assertEq(volume, 100e6);
        vm.warp(block.timestamp + 1 days);
        _setPrices(TSLA_PRICE, AMZN_PRICE);
        (uint256 nextDay, uint256 nextVolume) = acct.dayVolume();
        assertEq(nextDay, day + 1);
        assertEq(nextVolume, 0);
        assertTrue(_tradeAs(address(tsla), true, 100e6, 0));
        (, volume) = acct.dayVolume();
        assertEq(volume, 100e6);
    }

    // ---------------------------------------------------------------- every refusal is a receipt

    function test_onlyAgentCanTrade() public {
        vm.prank(user);
        vm.expectRevert(IAgentAccount.NotAgent.selector);
        acct.trade(address(tsla), true, 1e6, 0, DECISION);
    }

    function test_blocked_stopped() public {
        vm.prank(user);
        cover.close(address(acct));
        _expectBlocked(address(tsla), true, 1e6, BlockReason.Stopped, 1, 0);
        assertFalse(_tradeAs(address(tsla), true, 1e6, 0));
    }

    function test_blocked_paused() public {
        vm.prank(user);
        acct.pause();
        _expectBlocked(address(tsla), true, 1e6, BlockReason.Paused, 1, 0);
        assertFalse(_tradeAs(address(tsla), true, 1e6, 0));
    }

    function test_blocked_zeroAmount() public {
        _expectBlocked(address(tsla), true, 0, BlockReason.ZeroAmount, 0, 1);
        assertFalse(_tradeAs(address(tsla), true, 0, 0));
    }

    function test_blocked_unknownAsset() public {
        _expectBlocked(address(usdg), true, 1e6, BlockReason.AssetNotAllowed, type(uint256).max, 3);
        assertFalse(_tradeAs(address(usdg), true, 1e6, 0));
    }

    function test_blocked_assetNotInMask() public {
        Rules memory r = _rules();
        r.assetMask = 1; // TSLA only
        acct = _openWith(cover, 1000, r, 1000e6);
        _expectBlocked(address(amzn), true, 1e6, BlockReason.AssetNotAllowed, 1, 1);
        assertFalse(_tradeAs(address(amzn), true, 1e6, 0));
    }

    function test_blocked_stalePrice() public {
        vm.warp(block.timestamp + 301);
        _expectBlocked(address(tsla), true, 1e6, BlockReason.PriceStale, 301, 300);
        assertFalse(_tradeAs(address(tsla), true, 1e6, 0));
    }

    function test_blocked_staleHeldStock() public {
        assertTrue(_tradeAs(address(amzn), true, 100e6, 0));
        // TSLA is fresh but the AMZN the account holds is not.
        vm.warp(block.timestamp + 200);
        vm.prank(keeper);
        tslaFeed.push(TSLA_PRICE, block.timestamp);
        vm.warp(block.timestamp + 150);
        _expectBlocked(address(tsla), true, 1e6, BlockReason.PriceStale, 350, 300);
        assertFalse(_tradeAs(address(tsla), true, 1e6, 0));
    }

    function test_blocked_invalidPrice() public {
        vm.mockCall(
            address(tslaFeed),
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(uint80(9), int256(-1), block.timestamp, block.timestamp, uint80(9))
        );
        _expectBlocked(address(tsla), true, 1e6, BlockReason.PriceStale, type(uint256).max, 300);
        assertFalse(_tradeAs(address(tsla), true, 1e6, 0));
    }

    function test_blocked_brokenFeed() public {
        vm.mockCallRevert(address(amznFeed), abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector), "down");
        _expectBlocked(address(amzn), true, 1e6, BlockReason.PriceStale, type(uint256).max, 300);
        assertFalse(_tradeAs(address(amzn), true, 1e6, 0));
    }

    function test_blocked_incompleteRound() public {
        // startedAt after updatedAt, or a round answered in an earlier round: treated as no price.
        vm.mockCall(
            address(tslaFeed),
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(uint80(9), TSLA_PRICE, block.timestamp, block.timestamp - 1, uint80(9))
        );
        _expectBlocked(address(tsla), true, 1e6, BlockReason.PriceStale, type(uint256).max, 300);
        assertFalse(_tradeAs(address(tsla), true, 1e6, 0));
        vm.mockCall(
            address(tslaFeed),
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(uint80(9), TSLA_PRICE, block.timestamp, block.timestamp, uint80(8))
        );
        _expectBlocked(address(tsla), true, 1e6, BlockReason.PriceStale, type(uint256).max, 300);
        assertFalse(_tradeAs(address(tsla), true, 1e6, 0));
    }

    function test_blocked_venuePriceDiffersFromOracle() public {
        vm.mockCall(
            address(venue),
            abi.encodeWithSelector(venue.quoteBuy.selector),
            abi.encode(uint256(0.25e18), uint256(TSLA_PRICE) - 1, block.timestamp)
        );
        _expectBlocked(address(tsla), true, 100e6, BlockReason.PriceStale, uint256(TSLA_PRICE) - 1, uint256(TSLA_PRICE));
        assertFalse(_tradeAs(address(tsla), true, 100e6, 0));
    }

    function test_blocked_tradeTooLarge() public {
        Rules memory r = _rules();
        r.maxTradeBps = 2000;
        acct = _openWith(cover, 1000, r, 1000e6);
        _expectBlocked(address(tsla), true, 200e6, BlockReason.TradeTooLarge, 200e6, 198e6);
        assertFalse(_tradeAs(address(tsla), true, 200e6, 0));
    }

    function test_blocked_dailyLimit() public {
        Rules memory r = _rules();
        r.maxDailyBps = 3000; // 297 USDG a day on 990
        acct = _openWith(cover, 1000, r, 1000e6);
        assertTrue(_tradeAs(address(tsla), true, 200e6, 0));
        // value after the first trade: 790 + 0.4995 TSLA x 400 = 989.8
        _expectBlocked(address(tsla), true, 100e6, BlockReason.DailyLimit, 300e6, 296.94e6);
        assertFalse(_tradeAs(address(tsla), true, 100e6, 0));
    }

    function test_blocked_insufficientCash() public {
        Rules memory r = _rules();
        r.maxStockBps = 8000;
        acct = _openWith(cover, 1000, r, 1000e6);
        assertTrue(_tradeAs(address(tsla), true, 500e6, 0));
        // 490 cash left; ask for 600.
        _expectBlocked(address(tsla), true, 600e6, BlockReason.InsufficientCash, 600e6, 490e6);
        assertFalse(_tradeAs(address(tsla), true, 600e6, 0));
    }

    function test_blocked_insufficientStock() public {
        _expectBlocked(address(tsla), false, 100e6, BlockReason.InsufficientStock, 100e6, 0);
        assertFalse(_tradeAs(address(tsla), false, 100e6, 0));
    }

    function test_blocked_sellAllOfNothing() public {
        _expectBlocked(address(tsla), false, type(uint256).max, BlockReason.ZeroAmount, 0, 1);
        assertFalse(_tradeAs(address(tsla), false, type(uint256).max, 0));
    }

    function test_blocked_stockShare() public {
        // 80% of 990 is 792; 800 would be 8081 bps.
        _expectBlocked(address(tsla), true, 800e6, BlockReason.StockShare, 8081, 8000);
        assertFalse(_tradeAs(address(tsla), true, 800e6, 0));
    }

    function test_blocked_slippage() public {
        Rules memory r = _rules();
        r.maxSlippageBps = 5; // tighter than the venue's 10 bps spread
        acct = _openWith(cover, 1000, r, 1000e6);
        _expectBlocked(address(tsla), true, 100e6, BlockReason.Slippage, 10, 5);
        assertFalse(_tradeAs(address(tsla), true, 100e6, 0));
    }

    function test_blocked_minOut() public {
        _expectBlocked(address(tsla), true, 400e6, BlockReason.MinOut, 0.999e18, 1e18);
        assertFalse(_tradeAs(address(tsla), true, 400e6, 1e18));
    }

    function test_blocked_noLiquidity() public {
        BondlineMarket empty = _newMarket(MAX_AGE, "Empty");
        BondlineCover c = _offerIn(empty, _terms(), 10_000e6);
        acct = _open(c, 1000, 1000e6);
        _expectBlocked(address(tsla), true, 100e6, BlockReason.NoLiquidity, 0.24975e18, 0);
        assertFalse(_tradeAs(address(tsla), true, 100e6, 0));
    }

    function test_blocked_changesNothing() public {
        uint256 cash = usdg.balanceOf(address(acct));
        (, uint256 volume) = acct.dayVolume();
        assertFalse(_tradeAs(address(tsla), true, 800e6, 0)); // StockShare
        assertEq(usdg.balanceOf(address(acct)), cash);
        assertEq(tsla.balanceOf(address(acct)), 0);
        (, uint256 volumeAfter) = acct.dayVolume();
        assertEq(volumeAfter, volume);
    }

    // ---------------------------------------------------------------- user controls

    function test_pauseResume() public {
        vm.startPrank(user);
        vm.expectEmit(address(acct));
        emit IAgentAccount.AgentPaused();
        acct.pause();
        vm.expectRevert(IAgentAccount.AlreadyPaused.selector);
        acct.pause();
        vm.expectEmit(address(acct));
        emit IAgentAccount.AgentResumed();
        acct.resume();
        vm.expectRevert(IAgentAccount.NotPaused.selector);
        acct.resume();
        vm.stopPrank();
        assertTrue(_tradeAs(address(tsla), true, 10e6, 0));
    }

    function test_pauseResume_onlyOwner() public {
        vm.expectRevert(IAgentAccount.NotOwner.selector);
        acct.pause();
        vm.prank(agent);
        vm.expectRevert(IAgentAccount.NotOwner.selector);
        acct.resume();
    }

    function test_pauseResume_afterStop() public {
        vm.startPrank(user);
        cover.close(address(acct));
        vm.expectRevert(IAgentAccount.AlreadyStopped.selector);
        acct.pause();
        vm.expectRevert(IAgentAccount.AlreadyStopped.selector);
        acct.resume();
        vm.stopPrank();
    }

    function test_sweep_onlyAfterRelease() public {
        vm.startPrank(user);
        vm.expectRevert(IAgentAccount.NotReleased.selector);
        acct.sweep();
        vm.expectRevert(IAgentAccount.NotReleased.selector);
        acct.sweepToken(address(usdg));
        vm.stopPrank();
    }

    function test_sweep_takesEverythingAfterClose() public {
        assertTrue(_tradeAs(address(tsla), true, 400e6, 0));
        assertTrue(_tradeAs(address(amzn), true, 200e6, 0));
        uint256 tslaHeld = tsla.balanceOf(address(acct));
        uint256 amznHeld = amzn.balanceOf(address(acct));
        uint256 before = usdg.balanceOf(user);

        vm.startPrank(user);
        cover.close(address(acct));
        vm.expectEmit(true, true, false, true, address(acct));
        emit IAgentAccount.Swept(user, address(usdg), 390e6);
        acct.sweep();
        vm.stopPrank();

        assertEq(usdg.balanceOf(user), before + 390e6);
        assertEq(tsla.balanceOf(user), tslaHeld);
        assertEq(amzn.balanceOf(user), amznHeld);
        assertEq(usdg.balanceOf(address(acct)), 0);
    }

    function test_sweepToken_whenAnotherTokenIsPaused() public {
        assertTrue(_tradeAs(address(tsla), true, 400e6, 0));
        vm.prank(user);
        cover.close(address(acct));
        usdg.setPaused(true);
        vm.startPrank(user);
        vm.expectRevert(); // sweeping USDG fails while USDG is paused
        acct.sweep();
        acct.sweepToken(address(tsla)); // the stocks still come out
        vm.stopPrank();
        assertEq(tsla.balanceOf(user), 0.999e18);
    }

    function test_sweep_onlyOwner() public {
        vm.prank(user);
        cover.close(address(acct));
        vm.prank(agent);
        vm.expectRevert(IAgentAccount.NotOwner.selector);
        acct.sweep();
        vm.prank(agent);
        vm.expectRevert(IAgentAccount.NotOwner.selector);
        acct.sweepToken(address(usdg));
    }

    // ---------------------------------------------------------------- only the cover moves money

    function test_coverOnlyFunctions() public {
        vm.startPrank(agent);
        vm.expectRevert(IAgentAccount.NotCover.selector);
        acct.pay(agent, 1e6);
        vm.expectRevert(IAgentAccount.NotCover.selector);
        acct.stop();
        vm.expectRevert(IAgentAccount.NotCover.selector);
        acct.release();
        vm.stopPrank();
    }

    function test_stopAndRelease_areIdempotent() public {
        vm.startPrank(address(cover));
        acct.stop();
        acct.stop();
        acct.release();
        acct.release();
        vm.stopPrank();
        assertTrue(acct.stopped());
        assertTrue(acct.released());
    }

    function testFuzz_agentCanNeverMoveMoneyOut(uint256 usd, bool isBuy, uint8 assetIdx, uint256 minOut) public {
        address asset = assetIdx % 2 == 0 ? address(tsla) : address(amzn);
        usd = bound(usd, 0, 2_000e6);
        uint256 valueBefore = acct.valuation().value;
        vm.prank(agent);
        acct.trade(asset, isBuy, usd, minOut, DECISION);
        // Whatever the agent asks, it receives nothing, and the account loses at most the venue's spread.
        assertEq(usdg.balanceOf(agent), 0);
        assertEq(tsla.balanceOf(agent), 0);
        assertEq(amzn.balanceOf(agent), 0);
        assertGe(acct.valuation().value, valueBefore * (10_000 - SPREAD) / 10_000 - 1);
    }
}
