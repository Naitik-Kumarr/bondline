// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {IOracleVenue} from "../src/interfaces/IBondline.sol";
import {AgentAccount} from "../src/AgentAccount.sol";
import {BondlineCover} from "../src/BondlineCover.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";

/// @dev Pretends to be an account of a real cover, to prove the venue checks the cover's own registry.
contract FakeAccount {
    address public cover;

    constructor(address cover_) {
        cover = cover_;
    }

    function tryBuy(IOracleVenue v, address asset) external {
        v.buy(asset, 1e6, 0);
    }
}

contract OracleVenueTest is BaseTest {
    function test_config() public view {
        assertEq(venue.market(), address(market));
        assertEq(venue.usdg(), address(usdg));
        assertEq(venue.spreadBps(), SPREAD);
        assertEq(venue.maxPriceAge(), MAX_AGE);
        assertEq(venue.feedOf(address(tsla)), address(tslaFeed));
        assertEq(venue.feedOf(address(amzn)), address(amznFeed));
    }

    function test_quotes_applySpread() public view {
        // 400 USDG at $400 = 1 TSLA, less 10 bps.
        (uint256 out, uint256 price, uint256 updatedAt) = venue.quoteBuy(address(tsla), 400e6);
        assertEq(out, 0.999e18);
        assertEq(price, uint256(TSLA_PRICE));
        assertEq(updatedAt, block.timestamp);
        // 1 AMZN at $200 = 200 USDG, less 10 bps.
        (out,,) = venue.quoteSell(address(amzn), 1e18);
        assertEq(out, 199.8e6);
    }

    function test_quote_unknownAsset() public {
        vm.expectRevert(abi.encodeWithSelector(IOracleVenue.UnknownAsset.selector, address(usdg)));
        venue.quoteBuy(address(usdg), 1e6);
    }

    function test_quote_stalePrice() public {
        vm.warp(block.timestamp + MAX_AGE + 1);
        vm.expectRevert(
            abi.encodeWithSelector(IOracleVenue.StalePrice.selector, address(tsla), block.timestamp - MAX_AGE - 1)
        );
        venue.quoteBuy(address(tsla), 1e6);
    }

    function test_quote_invalidPrice() public {
        vm.mockCall(
            address(tslaFeed),
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(uint80(1), int256(0), block.timestamp, block.timestamp, uint80(1))
        );
        vm.expectRevert(abi.encodeWithSelector(IOracleVenue.InvalidPrice.selector, address(tsla)));
        venue.quoteSell(address(tsla), 1e18);
    }

    function test_quote_incompleteRound() public {
        vm.mockCall(
            address(tslaFeed),
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(uint80(3), TSLA_PRICE, block.timestamp, block.timestamp, uint80(2))
        );
        vm.expectRevert(abi.encodeWithSelector(IOracleVenue.InvalidPrice.selector, address(tsla)));
        venue.quoteBuy(address(tsla), 1e6);
    }

    function test_buy_rejectsEOA() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(IOracleVenue.NotBondlineAccount.selector, user));
        venue.buy(address(tsla), 1e6, 0);
    }

    function test_sell_rejectsContractWithoutCover() public {
        vm.prank(address(market));
        vm.expectRevert(abi.encodeWithSelector(IOracleVenue.NotBondlineAccount.selector, address(market)));
        venue.sell(address(tsla), 1e18, 0);
    }

    function test_buy_rejectsFakeAccountOfRealCover() public {
        BondlineCover cover = _offer(_terms(), 10_000e6);
        FakeAccount fake = new FakeAccount(address(cover));
        vm.expectRevert(abi.encodeWithSelector(IOracleVenue.NotBondlineAccount.selector, address(fake)));
        fake.tryBuy(venue, address(tsla));
    }

    function test_buy_rejectsAccountOfUnregisteredCover() public {
        // A cover cloned outside the market: its accounts are not Bondline accounts.
        FakeAccount fake = new FakeAccount(address(coverImpl));
        vm.expectRevert(abi.encodeWithSelector(IOracleVenue.NotBondlineAccount.selector, address(fake)));
        fake.tryBuy(venue, address(tsla));
    }

    function test_buySell_byRealAccount() public {
        BondlineCover cover = _offer(_terms(), 10_000e6);
        AgentAccount acct = _open(cover, 1000, 1000e6);
        vm.startPrank(address(acct));
        usdg.approve(address(venue), 400e6);
        vm.expectEmit(true, true, false, true, address(venue));
        emit IOracleVenue.Bought(address(acct), address(tsla), 400e6, 0.999e18, uint256(TSLA_PRICE));
        uint256 out = venue.buy(address(tsla), 400e6, 0.999e18);
        assertEq(out, 0.999e18);
        assertEq(tsla.balanceOf(address(acct)), 0.999e18);

        tsla.approve(address(venue), 0.5e18);
        out = venue.sell(address(tsla), 0.5e18, 0);
        assertEq(out, 199.8e6);
        vm.stopPrank();
    }

    function test_buy_rejectsZeroAndShortfall() public {
        BondlineCover cover = _offer(_terms(), 10_000e6);
        AgentAccount acct = _open(cover, 1000, 1000e6);
        vm.startPrank(address(acct));
        vm.expectRevert(IOracleVenue.ZeroAmount.selector);
        venue.buy(address(tsla), 0, 0);
        vm.expectRevert(IOracleVenue.ZeroAmount.selector);
        venue.sell(address(tsla), 0, 0);
        vm.expectRevert(abi.encodeWithSelector(IOracleVenue.InsufficientOutput.selector, 0.999e18, 1e18));
        venue.buy(address(tsla), 400e6, 1e18);
        vm.expectRevert(abi.encodeWithSelector(IOracleVenue.InsufficientOutput.selector, 199.8e6, 200e6));
        venue.sell(address(amzn), 1e18, 200e6);
        vm.stopPrank();
    }

    function testFuzz_quotes(uint256 usd, uint256 price) public {
        usd = bound(usd, 1e6, 1e12);
        price = bound(price, 1e8, 10_000e8);
        _setPrices(int256(price), AMZN_PRICE);
        (uint256 out,,) = venue.quoteBuy(address(tsla), usd);
        assertEq(out, (usd * 1e20 / price) * (10_000 - SPREAD) / 10_000);
        (uint256 back,,) = venue.quoteSell(address(tsla), out);
        // A round trip loses about two spreads, never gains.
        assertLe(back, usd);
        assertGe(back, usd * (10_000 - 2 * SPREAD) / 10_000 - 2);
    }
}
