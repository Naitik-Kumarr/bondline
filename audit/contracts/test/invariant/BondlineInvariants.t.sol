// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";

import {Terms, Rules, Position, CoverStatus, Health} from "../../src/Types.sol";
import {MirrorFeed} from "../../src/MirrorFeed.sol";
import {OracleVenue} from "../../src/OracleVenue.sol";
import {AgentAccount} from "../../src/AgentAccount.sol";
import {BondlineCover} from "../../src/BondlineCover.sol";
import {BondlineMarket} from "../../src/BondlineMarket.sol";
import {MockUSDG} from "../mocks/MockUSDG.sol";
import {MockStock} from "../mocks/MockStock.sol";

/// @notice Drives random sequences of every money-moving action across offers and covers.
contract Handler is Test {
    BondlineMarket public market;
    MockUSDG public usdg;
    MockStock public tsla;
    MockStock public amzn;
    MirrorFeed public tslaFeed;
    MirrorFeed public amznFeed;
    address public keeper;
    address public agent;

    address[] public covers;
    address[] public accounts;
    mapping(address account => address cover) public coverOf;
    address[] internal _underwriters;
    uint256[] internal _underwriterKeys;
    address[] internal _users;

    /// @dev Set if any settle ever paid more than the account's reservation.
    bool public payoutExceededReserve;
    uint256 public settles;
    uint256 public trades;
    uint256 internal _nonce;

    constructor(
        BondlineMarket market_,
        MockUSDG usdg_,
        MockStock tsla_,
        MockStock amzn_,
        MirrorFeed tslaFeed_,
        MirrorFeed amznFeed_,
        address keeper_,
        address agent_
    ) {
        market = market_;
        usdg = usdg_;
        tsla = tsla_;
        amzn = amzn_;
        tslaFeed = tslaFeed_;
        amznFeed = amznFeed_;
        keeper = keeper_;
        agent = agent_;
        for (uint256 i; i < 3; ++i) {
            (address u, uint256 k) = makeAddrAndKey(string.concat("uw", vm.toString(i)));
            _underwriters.push(u);
            _underwriterKeys.push(k);
            usdg.mint(u, 10_000_000e6);
            address b = makeAddr(string.concat("user", vm.toString(i)));
            _users.push(b);
            usdg.mint(b, 10_000_000e6);
        }
    }

    function coverCount() external view returns (uint256) {
        return covers.length;
    }

    function accountCount() external view returns (uint256) {
        return accounts.length;
    }

    // ---------------------------------------------------------------- actions

    function createOffer(uint256 who, uint16 feeBps, uint16 maxStockBps, uint256 bond, bool withAuthorization) external {
        if (covers.length >= 6) return;
        uint256 i = who % _underwriters.length;
        address uw = _underwriters[i];
        Terms memory t = Terms({
            agent: agent,
            minLimitBps: 500,
            maxLimitBps: 2000,
            feeBps: uint16(bound(feeBps, 0, 500)),
            maxStockBps: uint16(bound(maxStockBps, 1000, 10_000)),
            name: "fuzz"
        });
        bond = bound(bond, 1e6, 200_000e6);
        address cover;
        if (withAuthorization) {
            bytes32 nonce = bytes32(++_nonce);
            uint256 deadline = block.timestamp + 1 hours;
            bytes32 structHash = keccak256(
                abi.encode(usdg.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), uw, address(market), bond, 0, deadline, nonce)
            );
            (uint8 v, bytes32 r, bytes32 s) =
                vm.sign(_underwriterKeys[i], keccak256(abi.encodePacked("\x19\x01", usdg.DOMAIN_SEPARATOR(), structHash)));
            vm.prank(uw);
            (, cover) = market.createOfferWithAuthorization(t, bond, 0, deadline, nonce, v, r, s);
        } else {
            vm.prank(uw);
            (, cover) = market.createOffer(t);
            vm.startPrank(uw);
            usdg.approve(cover, bond);
            BondlineCover(cover).fund(bond);
            vm.stopPrank();
        }
        covers.push(cover);
    }

    function fund(uint256 coverSeed, uint256 amount) external {
        if (covers.length == 0) return;
        address cover = covers[coverSeed % covers.length];
        amount = bound(amount, 1, 100_000e6);
        address funder = _users[coverSeed % _users.length];
        vm.startPrank(funder);
        usdg.approve(cover, amount);
        BondlineCover(cover).fund(amount);
        vm.stopPrank();
    }

    function release(uint256 coverSeed, uint256 amount) external {
        if (covers.length == 0) return;
        BondlineCover cover = BondlineCover(covers[coverSeed % covers.length]);
        uint256 available = cover.free();
        if (available == 0) return;
        amount = bound(amount, 1, available);
        address uw = cover.underwriter();
        vm.prank(uw);
        cover.release(uw, amount);
    }

    function open(uint256 coverSeed, uint256 userSeed, uint16 limitBps, uint256 amount, uint16 stockBps) external {
        if (covers.length == 0 || accounts.length >= 40) return;
        BondlineCover cover = BondlineCover(covers[coverSeed % covers.length]);
        if (!cover.listed()) return;
        limitBps = uint16(bound(limitBps, 500, 2000));
        amount = bound(amount, 1e6, 50_000e6);
        Rules memory r = Rules({
            assetMask: 3,
            maxStockBps: uint16(bound(stockBps, cover.terms().maxStockBps / 2, cover.terms().maxStockBps)),
            maxTradeBps: 10_000,
            maxDailyBps: 100_000,
            maxSlippageBps: 50,
            maxPriceAge: 300
        });
        (,, uint256 need) = cover.quoteDeposit(amount, limitBps);
        (uint256 fee,,) = cover.quoteDeposit(amount, limitBps);
        if (need > cover.free() + fee) return;
        address u = _users[userSeed % _users.length];
        vm.startPrank(u);
        usdg.approve(address(cover), amount);
        address a = cover.open(limitBps, r, amount);
        vm.stopPrank();
        accounts.push(a);
        coverOf[a] = address(cover);
    }

    function deposit(uint256 accountSeed, uint256 amount) external {
        if (accounts.length == 0) return;
        address a = accounts[accountSeed % accounts.length];
        BondlineCover cover = BondlineCover(coverOf[a]);
        Position memory p = cover.position(a);
        if (p.status != CoverStatus.Active || !cover.listed()) return;
        amount = bound(amount, 1e6, 20_000e6);
        (uint256 fee,, uint256 need) = cover.quoteDeposit(amount, p.limitBps);
        if (need > cover.free() + fee) return;
        address funder = _users[accountSeed % _users.length];
        vm.startPrank(funder);
        usdg.approve(address(cover), amount);
        cover.deposit(a, amount);
        vm.stopPrank();
    }

    function withdraw(uint256 accountSeed, uint256 bps) external {
        if (accounts.length == 0) return;
        address a = accounts[accountSeed % accounts.length];
        BondlineCover cover = BondlineCover(coverOf[a]);
        Position memory p = cover.position(a);
        if (p.status != CoverStatus.Active || !cover.health(a).fresh) return;
        uint256 amount = AgentAccount(a).valuation().cash * bound(bps, 1, 10_000) / 10_000;
        if (amount == 0) return;
        vm.prank(p.user);
        cover.withdraw(a, amount);
    }

    function trade(uint256 accountSeed, bool isBuy, bool useTsla, uint256 usd) external {
        if (accounts.length == 0) return;
        address a = accounts[accountSeed % accounts.length];
        uint256 value = AgentAccount(a).valuation().value;
        // Mostly sensible sizes (so trades execute and covers can reach their limit), sometimes anything.
        usd = usd % 8 == 0 ? bound(usd, 0, 100_000e6) : bound(usd, value / 50, value * 9 / 10);
        vm.prank(agent);
        if (AgentAccount(a).trade(useTsla ? address(tsla) : address(amzn), isBuy, usd, 0, bytes("{}"))) ++trades;
    }

    function movePrices(int256 tslaBps, int256 amznBps, uint256 secondsPassed) external {
        vm.warp(block.timestamp + bound(secondsPassed, 1, 600));
        (, int256 t,,,) = tslaFeed.latestRoundData();
        (, int256 m,,,) = amznFeed.latestRoundData();
        t = t * (10_000 + bound(tslaBps, -5000, 5000)) / 10_000;
        m = m * (10_000 + bound(amznBps, -5000, 5000)) / 10_000;
        vm.startPrank(keeper);
        tslaFeed.push(t > 1e6 ? t : int256(1e6), block.timestamp);
        amznFeed.push(m > 1e6 ? m : int256(1e6), block.timestamp);
        vm.stopPrank();
    }

    function settle(uint256 accountSeed) external {
        if (accounts.length == 0) return;
        address a = accounts[accountSeed % accounts.length];
        BondlineCover cover = BondlineCover(coverOf[a]);
        Health memory h = cover.health(a);
        if (!h.settleable) return;
        uint256 reserve = cover.position(a).reserve;
        uint256 paid = cover.settle(a);
        if (paid > reserve) payoutExceededReserve = true;
        ++settles;
    }

    function close(uint256 accountSeed) external {
        // Rare, so most covers live long enough to trade and reach their limit.
        if (accounts.length == 0 || accountSeed % 6 != 0) return;
        address a = accounts[accountSeed % accounts.length];
        BondlineCover cover = BondlineCover(coverOf[a]);
        Position memory p = cover.position(a);
        if (p.status != CoverStatus.Active) return;
        vm.prank(p.user);
        cover.close(a);
    }

    function delist(uint256 coverSeed) external {
        if (covers.length == 0 || coverSeed % 8 != 0) return;
        address cover = covers[coverSeed % covers.length];
        uint256 id = market.idOf(cover);
        vm.prank(market.offer(id).underwriter);
        market.delist(id);
    }
}

/// @notice The fixture shared by the invariant suite and the handler sanity test.
abstract contract BondlineInvariantSetup is StdInvariant, Test {
    Handler internal handler;
    BondlineMarket internal market;
    MockUSDG internal usdg;
    MockStock internal tsla;
    MockStock internal amzn;
    BondlineCover internal coverImpl;
    address internal agent = makeAddr("agent");

    function setUp() public {
        vm.warp(1_790_000_000);
        address keeper = makeAddr("keeper");
        usdg = new MockUSDG();
        tsla = new MockStock("Tesla", "TSLA");
        amzn = new MockStock("Amazon", "AMZN");
        MirrorFeed tslaFeed = new MirrorFeed(keeper, 8, "TSLA");
        MirrorFeed amznFeed = new MirrorFeed(keeper, 8, "AMZN");
        vm.startPrank(keeper);
        tslaFeed.push(400e8, block.timestamp);
        amznFeed.push(200e8, block.timestamp);
        vm.stopPrank();

        coverImpl = new BondlineCover();
        address[] memory assets = new address[](2);
        assets[0] = address(tsla);
        assets[1] = address(amzn);
        address[] memory feeds = new address[](2);
        feeds[0] = address(tslaFeed);
        feeds[1] = address(amznFeed);
        market = new BondlineMarket(
            address(usdg), address(coverImpl), address(new AgentAccount()), assets, feeds, 300, 10, "Invariant"
        );
        address v = market.venue();
        usdg.mint(v, 100_000_000e6);
        tsla.mint(v, 1_000_000e18);
        amzn.mint(v, 1_000_000e18);

        handler = new Handler(market, usdg, tsla, amzn, tslaFeed, amznFeed, keeper, agent);
        targetContract(address(handler));
    }
}

contract BondlineInvariants is BondlineInvariantSetup {

    /// @dev Every cover's reservations never exceed its bond.
    function invariant_reservedNeverExceedsBond() public view {
        for (uint256 i; i < handler.coverCount(); ++i) {
            BondlineCover c = BondlineCover(handler.covers(i));
            assertLe(c.reserved(), c.bond());
        }
    }

    /// @dev A cover's `reserved` is exactly the sum of its accounts' reservations.
    function invariant_reservedIsSumOfReservations() public view {
        for (uint256 i; i < handler.coverCount(); ++i) {
            BondlineCover c = BondlineCover(handler.covers(i));
            uint256 sum;
            for (uint256 j; j < c.accountCount(); ++j) {
                sum += c.position(c.accountAt(j)).reserve;
            }
            assertEq(sum, c.reserved());
        }
    }

    /// @dev Each account's reservation covers the most settle could pay it right now.
    function invariant_reservationCoversWorstCase() public view {
        for (uint256 i; i < handler.accountCount(); ++i) {
            address a = handler.accounts(i);
            BondlineCover c = BondlineCover(handler.coverOf(a));
            Position memory p = c.position(a);
            if (p.status != CoverStatus.Active) continue;
            assertGe(p.reserve, p.principal * (3000 - p.limitBps) / 10_000);
        }
    }

    /// @dev No settle ever paid more than its reservation.
    function invariant_noPayoutExceedsReservation() public view {
        assertFalse(handler.payoutExceededReserve());
    }

    /// @dev Every cover holds at least its bond in USDG.
    function invariant_coverHoldsItsBond() public view {
        for (uint256 i; i < handler.coverCount(); ++i) {
            BondlineCover c = BondlineCover(handler.covers(i));
            assertGe(usdg.balanceOf(address(c)), c.bond());
        }
    }

    /// @dev The market never keeps USDG.
    function invariant_marketHoldsNoUsdg() public view {
        assertEq(usdg.balanceOf(address(market)), 0);
    }

    /// @dev The agent can't move money out: it never holds USDG or stocks.
    function invariant_agentHoldsNothing() public view {
        assertEq(usdg.balanceOf(agent), 0);
        assertEq(tsla.balanceOf(agent), 0);
        assertEq(amzn.balanceOf(agent), 0);
    }

    /// @dev Only covers the market deployed are offers.
    function invariant_onlyMarketCoversAreOffers() public view {
        for (uint256 i; i < handler.coverCount(); ++i) {
            assertTrue(market.isOffer(handler.covers(i)));
        }
        assertFalse(market.isOffer(address(coverImpl)));
        assertFalse(market.isOffer(address(handler)));
    }

    // Reachability is proven by HandlerSanity (a seeded walk that must trade and settle), and was checked
    // for the fuzzer itself with a probe invariant asserting "no trade/settle ever happens": it failed within
    // the first runs, i.e. fuzz runs do execute trades and paid settles.
}
