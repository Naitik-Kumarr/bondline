// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {Terms, Rules} from "../../src/Types.sol";
import {MirrorFeed} from "../../src/MirrorFeed.sol";
import {AgentAccount} from "../../src/AgentAccount.sol";
import {BondlineCover} from "../../src/BondlineCover.sol";
import {BondlineMarket} from "../../src/BondlineMarket.sol";
import {IUSDG} from "../../src/interfaces/IUSDG.sol";

/// @notice Runs against a fork of Robinhood Chain testnet and the real Paxos USDG. Opt in with FORK_TESTS=true:
///         FORK_TESTS=true forge test --match-path test/fork/UsdgFork.t.sol
contract UsdgForkTest is Test {
    IUSDG internal constant USDG = IUSDG(0x7E955252E15c84f5768B83c41a71F9eba181802F);
    address internal constant TSLA = 0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E;
    address internal constant AMZN = 0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02;
    bytes32 internal constant ONCHAIN_DOMAIN_SEPARATOR =
        0xb1debe91e09d82163fd9cddaab89359061c0671664e1611258a3c3de7c2d950b;
    bytes32 internal constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    BondlineMarket internal market;
    address internal keeper = makeAddr("keeper");
    address internal agent = makeAddr("agent");
    address internal underwriter;
    uint256 internal underwriterKey;
    bool internal forked;

    function setUp() public {
        if (!vm.envOr("FORK_TESTS", false)) return;
        vm.createSelectFork("rhTestnet");
        forked = true;
        (underwriter, underwriterKey) = makeAddrAndKey("fork-underwriter");

        MirrorFeed tslaFeed = new MirrorFeed(keeper, 8, "TSLA");
        MirrorFeed amznFeed = new MirrorFeed(keeper, 8, "AMZN");
        vm.startPrank(keeper);
        tslaFeed.push(370e8, block.timestamp);
        amznFeed.push(250e8, block.timestamp);
        vm.stopPrank();

        address[] memory assets = new address[](2);
        assets[0] = TSLA;
        assets[1] = AMZN;
        address[] memory feeds = new address[](2);
        feeds[0] = address(tslaFeed);
        feeds[1] = address(amznFeed);
        market = new BondlineMarket(
            address(USDG), address(new BondlineCover()), address(new AgentAccount()), assets, feeds, 300, 10, "Fork"
        );
        deal(address(USDG), underwriter, 1_000e6);
    }

    function _terms() internal view returns (Terms memory) {
        return Terms({agent: agent, minLimitBps: 500, maxLimitBps: 2000, feeBps: 100, maxStockBps: 3000, name: "Fork"});
    }

    function _sign(address to, uint256 value, bytes32 nonce, uint256 validBefore)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(abi.encode(RECEIVE_TYPEHASH, underwriter, to, value, 0, validBefore, nonce));
        (v, r, s) = vm.sign(underwriterKey, keccak256(abi.encodePacked("\x19\x01", ONCHAIN_DOMAIN_SEPARATOR, structHash)));
    }

    function test_fork_domainSeparator() public {
        if (!forked) vm.skip(true);
        assertEq(USDG.DOMAIN_SEPARATOR(), ONCHAIN_DOMAIN_SEPARATOR);
        assertFalse(USDG.paused());
        assertFalse(USDG.isFrozen(underwriter));
    }

    function test_fork_receiveWithAuthorizationNeedsThePayee() public {
        if (!forked) vm.skip(true);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _sign(address(market), 100e6, keccak256("fork-n0"), deadline);
        vm.expectRevert(abi.encodeWithSignature("CallerMustBePayee()"));
        USDG.receiveWithAuthorization(underwriter, address(market), 100e6, 0, deadline, keccak256("fork-n0"), v, r, s);
    }

    function test_fork_oneSignatureUnderwriting() public {
        if (!forked) vm.skip(true);
        bytes32 nonce = keccak256("fork-n1");
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _sign(address(market), 500e6, nonce, deadline);

        vm.prank(underwriter);
        (, address cover) = market.createOfferWithAuthorization(_terms(), 500e6, 0, deadline, nonce, v, r, s);

        assertEq(BondlineCover(cover).bond(), 500e6);
        assertEq(USDG.balanceOf(cover), 500e6);
        assertEq(USDG.balanceOf(address(market)), 0);
        assertEq(USDG.balanceOf(underwriter), 500e6);
        assertTrue(USDG.authorizationState(underwriter, nonce));

        // Reusing the nonce fails on the real token too.
        vm.prank(underwriter);
        vm.expectRevert();
        market.createOfferWithAuthorization(_terms(), 500e6, 0, deadline, nonce, v, r, s);

        // And a buyer can open a cover with real USDG and an exact approval.
        address buyer = makeAddr("fork-buyer");
        deal(address(USDG), buyer, 100e6);
        Rules memory rules = Rules({
            assetMask: 3,
            maxStockBps: 3000,
            maxTradeBps: 2000,
            maxDailyBps: 30_000,
            maxSlippageBps: 50,
            maxPriceAge: 300
        });
        vm.startPrank(buyer);
        USDG.approve(cover, 100e6);
        address account = BondlineCover(cover).open(1000, rules, 100e6);
        vm.stopPrank();
        assertEq(USDG.balanceOf(account), 99e6);
        assertEq(USDG.allowance(buyer, cover), 0);
    }
}
