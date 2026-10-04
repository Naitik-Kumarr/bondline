// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {Terms, Rules, Health} from "../../src/Types.sol";
import {AgentAccount} from "../../src/AgentAccount.sol";
import {BondlineCover} from "../../src/BondlineCover.sol";
import {BondlineMarket} from "../../src/BondlineMarket.sol";
import {IUSDG} from "../../src/interfaces/IUSDG.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {MockStock} from "../mocks/MockStock.sol";

/// @notice Bondline on a fork of Robinhood Chain MAINNET, consuming Chainlink's real TSLA/USD and AMZN/USD feeds
///         directly and paying in the real Paxos USDG (0x5fc5...d168).
///
///         What is real here: USDG (including one-signature underwriting with EIP-3009 on chain 4663) and the
///         Chainlink feeds. What is not: the Stock Tokens are mocks deployed on the fork (Robinhood's mainnet
///         Stock Tokens come from an on-chain registry we did not wire up), and the price drop is mocked with
///         `vm.mockCall` because live stock prices don't move on a fork.
///
///         Opt in: FORK_TESTS=true forge test --match-contract MainnetFork
contract MainnetForkTest is Test {
    IUSDG internal constant USDG = IUSDG(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168);
    IAggregatorV3 internal constant TSLA_FEED = IAggregatorV3(0x4A1166a659A55625345e9515b32adECea5547C38);
    IAggregatorV3 internal constant AMZN_FEED = IAggregatorV3(0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C);
    bytes32 internal constant MAINNET_DOMAIN_SEPARATOR =
        0x7a3d7400b27830f4f91c2c16a082486d67c1befecaec2f53b33f1f35d5b62036;
    bytes32 internal constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    BondlineMarket internal market;
    MockStock internal tsla;
    MockStock internal amzn;
    address internal agent = makeAddr("agent");
    address internal buyer = makeAddr("buyer");
    address internal underwriter;
    uint256 internal underwriterKey;
    bool internal forked;

    function setUp() public {
        if (!vm.envOr("FORK_TESTS", false)) return;
        vm.createSelectFork("rhMainnet");
        forked = true;
        (underwriter, underwriterKey) = makeAddrAndKey("mainnet-underwriter");

        // Stock prices only update in market hours; start just after the latest real update.
        (,,, uint256 tslaUpdated,) = TSLA_FEED.latestRoundData();
        (,,, uint256 amznUpdated,) = AMZN_FEED.latestRoundData();
        vm.warp((tslaUpdated > amznUpdated ? tslaUpdated : amznUpdated) + 60);

        tsla = new MockStock("Tesla (fork mock)", "TSLA");
        amzn = new MockStock("Amazon (fork mock)", "AMZN");
        address[] memory assets = new address[](2);
        assets[0] = address(tsla);
        assets[1] = address(amzn);
        address[] memory feeds = new address[](2);
        feeds[0] = address(TSLA_FEED);
        feeds[1] = address(AMZN_FEED);
        // Chainlink's stock feeds have a 24h heartbeat; accept prices up to 25h old.
        market = new BondlineMarket(
            address(USDG), address(new BondlineCover()), address(new AgentAccount()), assets, feeds, 90_000, 10, "Mainnet fork"
        );
        tsla.mint(market.venue(), 1_000e18);
        amzn.mint(market.venue(), 1_000e18);
        deal(address(USDG), market.venue(), 100_000e6);
        deal(address(USDG), underwriter, 10_000e6);
        deal(address(USDG), buyer, 1_000e6);
    }

    function test_mainnetFork_realFeedsAndUsdg() public {
        if (!forked) vm.skip(true);
        assertEq(USDG.DOMAIN_SEPARATOR(), MAINNET_DOMAIN_SEPARATOR);
        assertEq(TSLA_FEED.decimals(), 8);
        (, int256 tslaPrice,,,) = TSLA_FEED.latestRoundData();
        assertGt(tslaPrice, 0);

        // 1. One USDG signature creates and funds an offer, on mainnet USDG.
        bytes32 nonce = keccak256("mainnet-fork-offer");
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash =
            keccak256(abi.encode(RECEIVE_TYPEHASH, underwriter, address(market), 5_000e6, 0, deadline, nonce));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(underwriterKey, keccak256(abi.encodePacked("\x19\x01", MAINNET_DOMAIN_SEPARATOR, structHash)));
        Terms memory terms =
            Terms({agent: agent, minLimitBps: 500, maxLimitBps: 2000, feeBps: 400, maxStockBps: 8000, name: "Bold 4%"});
        vm.prank(underwriter);
        (, address coverAddr) = market.createOfferWithAuthorization(terms, 5_000e6, 0, deadline, nonce, v, r, s);
        BondlineCover cover = BondlineCover(coverAddr);
        assertEq(cover.bond(), 5_000e6);
        assertEq(USDG.balanceOf(address(market)), 0);

        // 2. A buyer opens a 1,000 USDG cover at a 10% limit, with an exact approval.
        Rules memory rules = Rules({
            assetMask: 3,
            maxStockBps: 8000,
            maxTradeBps: 10_000,
            maxDailyBps: 100_000,
            maxSlippageBps: 50,
            maxPriceAge: 90_000
        });
        vm.startPrank(buyer);
        USDG.approve(coverAddr, 1_000e6);
        AgentAccount acct = AgentAccount(cover.open(1000, rules, 1_000e6));
        vm.stopPrank();
        uint256 principal = cover.position(address(acct)).principal;
        assertEq(principal, 960e6); // 4% premium joined the bond

        // 3. The agent buys TSLA at Chainlink's real price.
        vm.prank(agent);
        assertTrue(acct.trade(address(tsla), true, 768e6, 0, bytes('{"agent":"Bold","action":"buy"}')));

        // 4. MOCKED price drop (labelled): TSLA gaps down 35% at the next "open".
        (uint80 roundId, int256 answer,,,) = TSLA_FEED.latestRoundData();
        vm.mockCall(
            address(TSLA_FEED),
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(roundId + 1, answer * 65 / 100, block.timestamp, block.timestamp, roundId + 1)
        );

        // 5. Anyone settles; the bond pays the gap beyond the limit, in real USDG.
        Health memory h = cover.health(address(acct));
        assertTrue(h.settleable);
        uint256 before = USDG.balanceOf(buyer);
        uint256 paid = cover.settle(address(acct));
        assertEq(paid, h.payoutNow);
        assertEq(USDG.balanceOf(buyer), before + paid);
        assertLe(paid, principal * 2000 / 10_000);
        assertEq(paid, h.loss - h.limit);
        assertTrue(acct.stopped());
    }
}
