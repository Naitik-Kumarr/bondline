// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {Terms, Offer} from "../src/Types.sol";
import {BondlineMarket} from "../src/BondlineMarket.sol";
import {BondlineCover} from "../src/BondlineCover.sol";
import {IBondlineMarket, IBondlineCover} from "../src/interfaces/IBondline.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";

contract BondlineMarketTest is BaseTest {
    uint256 internal constant BOND = 5_000e6;

    // ---------------------------------------------------------------- constructor

    function test_config() public view {
        assertEq(market.label(), "Replay");
        assertEq(market.usdg(), address(usdg));
        assertEq(market.coverImplementation(), address(coverImpl));
        assertEq(market.accountImplementation(), address(accountImpl));
        assertEq(market.maxPriceAge(), MAX_AGE);
        assertEq(market.capBps(), 3000);
        assertEq(market.CAP_BPS(), 3000);
        assertEq(market.assets()[0], address(tsla));
        assertEq(market.feeds()[1], address(amznFeed));
        assertEq(market.offerCount(), 0);
        assertEq(venue.market(), address(market));
    }

    function test_constructor_validates() public {
        address[] memory a = _assets();
        address[] memory f = _feeds();
        vm.expectRevert(IBondlineMarket.ZeroAddress.selector);
        new BondlineMarket(address(0), address(coverImpl), address(accountImpl), a, f, MAX_AGE, SPREAD, "x");
        vm.expectRevert(IBondlineMarket.ZeroAddress.selector);
        new BondlineMarket(address(usdg), address(0), address(accountImpl), a, f, MAX_AGE, SPREAD, "x");
        vm.expectRevert(IBondlineMarket.ZeroAddress.selector);
        new BondlineMarket(address(usdg), address(coverImpl), address(0), a, f, MAX_AGE, SPREAD, "x");

        address[] memory one = new address[](1);
        one[0] = address(tsla);
        vm.expectRevert(IBondlineMarket.LengthMismatch.selector);
        new BondlineMarket(address(usdg), address(coverImpl), address(accountImpl), one, f, MAX_AGE, SPREAD, "x");

        address[] memory none = new address[](0);
        vm.expectRevert(IBondlineMarket.TooManyAssets.selector);
        new BondlineMarket(address(usdg), address(coverImpl), address(accountImpl), none, none, MAX_AGE, SPREAD, "x");

        address[] memory nine = new address[](9);
        vm.expectRevert(IBondlineMarket.TooManyAssets.selector);
        new BondlineMarket(address(usdg), address(coverImpl), address(accountImpl), nine, nine, MAX_AGE, SPREAD, "x");

        address[] memory zero = new address[](2);
        zero[0] = address(tsla);
        vm.expectRevert(IBondlineMarket.ZeroAddress.selector);
        new BondlineMarket(address(usdg), address(coverImpl), address(accountImpl), zero, f, MAX_AGE, SPREAD, "x");
    }

    // ---------------------------------------------------------------- createOffer

    function test_createOffer() public {
        Terms memory t = _terms();
        address predicted = vm.computeCreateAddress(address(market), vm.getNonce(address(market)));
        vm.expectEmit(true, true, true, true, address(market));
        emit IBondlineMarket.OfferCreated(0, predicted, underwriter, agent, t);
        vm.prank(underwriter);
        (uint256 id, address cover) = market.createOffer(t);

        assertEq(id, 0);
        assertEq(cover, predicted);
        assertTrue(market.isOffer(cover));
        assertEq(market.idOf(cover), 0);
        assertEq(market.offerCount(), 1);
        Offer memory o = market.offer(0);
        assertEq(o.cover, cover);
        assertEq(o.underwriter, underwriter);
        assertEq(o.agent, agent);
        assertTrue(o.listed);
        assertEq(market.offers().length, 1);
        assertEq(market.capacity(0), 0);
        assertEq(BondlineCover(cover).underwriter(), underwriter);
        assertEq(BondlineCover(cover).market(), address(market));
    }

    function test_createOffer_rejectsBadTerms() public {
        Terms[] memory bad = new Terms[](8);
        for (uint256 i; i < bad.length; ++i) {
            bad[i] = _terms();
        }
        bad[0].agent = address(0);
        bad[1].minLimitBps = 0;
        bad[2].minLimitBps = 2001; // above max
        bad[3].maxLimitBps = 3000; // must be below the cap
        bad[4].feeBps = 501;
        bad[5].maxStockBps = 0;
        bad[6].maxStockBps = 10_001;
        bad[7].name = "";
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(IBondlineMarket.InvalidTerms.selector);
            market.createOffer(bad[i]);
        }
        Terms memory longName = _terms();
        longName.name = "a name that is far too long for an offer on the board, more than 64 bytes";
        vm.expectRevert(IBondlineMarket.InvalidTerms.selector);
        market.createOffer(longName);
    }

    function testFuzz_createOffer_terms(uint16 minL, uint16 maxL, uint16 fee, uint16 maxStock) public {
        Terms memory t = _terms();
        t.minLimitBps = minL;
        t.maxLimitBps = maxL;
        t.feeBps = fee;
        t.maxStockBps = maxStock;
        bool valid = minL > 0 && minL <= maxL && maxL < 3000 && fee <= 500 && maxStock > 0 && maxStock <= 10_000;
        if (!valid) vm.expectRevert(IBondlineMarket.InvalidTerms.selector);
        vm.prank(underwriter);
        market.createOffer(t);
    }

    function test_unknownOffer() public {
        vm.expectRevert(abi.encodeWithSelector(IBondlineMarket.UnknownOffer.selector, 0));
        market.offer(0);
        vm.expectRevert(abi.encodeWithSelector(IBondlineMarket.UnknownOffer.selector, 0));
        market.capacity(0);
        vm.expectRevert(abi.encodeWithSelector(IBondlineMarket.UnknownOffer.selector, 0));
        market.delist(0);
        vm.expectRevert(abi.encodeWithSelector(IBondlineMarket.UnknownOffer.selector, type(uint256).max));
        market.idOf(address(coverImpl));
        assertFalse(market.isOffer(address(coverImpl)));
    }

    // ---------------------------------------------------------------- one signature, one transaction

    function _auth(uint256 key, address from, uint256 value, bytes32 nonce, uint256 validBefore)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        return _signReceive(key, from, address(market), value, 0, validBefore, nonce);
    }

    function test_createOfferWithAuthorization() public {
        bytes32 nonce = keccak256("offer-1");
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _auth(underwriterKey, underwriter, BOND, nonce, deadline);
        uint256 before = usdg.balanceOf(underwriter);
        address predicted = vm.computeCreateAddress(address(market), vm.getNonce(address(market)));

        vm.expectEmit(true, false, false, true, predicted);
        emit IBondlineCover.Funded(address(market), BOND, BOND);
        vm.expectEmit(true, true, false, true, address(market));
        emit IBondlineMarket.OfferFunded(0, underwriter, BOND);
        vm.prank(underwriter);
        (uint256 id, address cover) =
            market.createOfferWithAuthorization(_terms(), BOND, 0, deadline, nonce, v, r, s);

        assertEq(id, 0);
        assertEq(cover, predicted);
        assertEq(BondlineCover(cover).bond(), BOND);
        assertEq(BondlineCover(cover).underwriter(), underwriter);
        assertEq(usdg.balanceOf(cover), BOND);
        assertEq(usdg.balanceOf(underwriter), before - BOND);
        assertEq(usdg.balanceOf(address(market)), 0);
        assertEq(usdg.allowance(address(market), cover), 0);
        assertTrue(usdg.authorizationState(underwriter, nonce));
        assertEq(market.capacity(0), BOND);
    }

    function test_auth_wrongSigner() public {
        (address other, uint256 otherKey) = makeAddrAndKey("other");
        usdg.mint(other, BOND);
        bytes32 nonce = keccak256("n");
        // `other` signs an authorization for the underwriter's money.
        (uint8 v, bytes32 r, bytes32 s) = _auth(otherKey, underwriter, BOND, nonce, block.timestamp + 1 hours);
        vm.prank(underwriter);
        vm.expectRevert(MockUSDG.InvalidSignature.selector);
        market.createOfferWithAuthorization(_terms(), BOND, 0, block.timestamp + 1 hours, nonce, v, r, s);
    }

    function test_auth_fromIsAlwaysCaller() public {
        bytes32 nonce = keccak256("n");
        (uint8 v, bytes32 r, bytes32 s) = _auth(underwriterKey, underwriter, BOND, nonce, block.timestamp + 1 hours);
        // Someone who saw the signature can't use it: `from` becomes the caller, so the signature no longer matches.
        vm.prank(stranger);
        vm.expectRevert(MockUSDG.InvalidSignature.selector);
        market.createOfferWithAuthorization(_terms(), BOND, 0, block.timestamp + 1 hours, nonce, v, r, s);
        assertEq(usdg.balanceOf(underwriter), 1_000_000e6);
    }

    function test_auth_reusedNonce() public {
        bytes32 nonce = keccak256("n");
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _auth(underwriterKey, underwriter, BOND, nonce, deadline);
        vm.startPrank(underwriter);
        market.createOfferWithAuthorization(_terms(), BOND, 0, deadline, nonce, v, r, s);
        vm.expectRevert(MockUSDG.AuthorizationAlreadyUsed.selector);
        market.createOfferWithAuthorization(_terms(), BOND, 0, deadline, nonce, v, r, s);
        vm.stopPrank();
    }

    function test_auth_expired() public {
        bytes32 nonce = keccak256("n");
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _auth(underwriterKey, underwriter, BOND, nonce, deadline);
        vm.warp(deadline);
        vm.prank(underwriter);
        vm.expectRevert(MockUSDG.AuthorizationExpired.selector);
        market.createOfferWithAuthorization(_terms(), BOND, 0, deadline, nonce, v, r, s);
    }

    function test_auth_notYetValid() public {
        bytes32 nonce = keccak256("n");
        uint256 validAfter = block.timestamp + 10 minutes;
        (uint8 v, bytes32 r, bytes32 s) =
            _signReceive(underwriterKey, underwriter, address(market), BOND, validAfter, validAfter + 1 hours, nonce);
        vm.prank(underwriter);
        vm.expectRevert(MockUSDG.AuthorizationNotYetValid.selector);
        market.createOfferWithAuthorization(_terms(), BOND, validAfter, validAfter + 1 hours, nonce, v, r, s);
    }

    function test_auth_cannotBeRedirected() public {
        // A signature for the market can't be spent by calling USDG directly: only the payee may receive it.
        bytes32 nonce = keccak256("n");
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _auth(underwriterKey, underwriter, BOND, nonce, deadline);
        vm.prank(stranger);
        vm.expectRevert(MockUSDG.CallerMustBePayee.selector);
        usdg.receiveWithAuthorization(underwriter, address(market), BOND, 0, deadline, nonce, v, r, s);
    }

    function test_auth_zeroBondAndBadTerms() public {
        vm.expectRevert(IBondlineMarket.ZeroBond.selector);
        market.createOfferWithAuthorization(_terms(), 0, 0, 0, bytes32(0), 0, bytes32(0), bytes32(0));

        bytes32 nonce = keccak256("n");
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _auth(underwriterKey, underwriter, BOND, nonce, deadline);
        Terms memory t = _terms();
        t.feeBps = 600;
        vm.prank(underwriter);
        vm.expectRevert(IBondlineMarket.InvalidTerms.selector);
        market.createOfferWithAuthorization(t, BOND, 0, deadline, nonce, v, r, s);
        // The whole transaction reverted: no USDG moved and the nonce is still unused.
        assertFalse(usdg.authorizationState(underwriter, nonce));
    }

    function testFuzz_authorization_marketKeepsNothing(uint256 bond, bytes32 nonce) public {
        bond = bound(bond, 1, 1_000_000e6);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _auth(underwriterKey, underwriter, bond, nonce, deadline);
        vm.prank(underwriter);
        (, address cover) = market.createOfferWithAuthorization(_terms(), bond, 0, deadline, nonce, v, r, s);
        assertEq(usdg.balanceOf(address(market)), 0);
        assertEq(BondlineCover(cover).bond(), bond);
    }

    // ---------------------------------------------------------------- delist

    function test_delist() public {
        BondlineCover cover = _offer(_terms(), BOND);
        vm.prank(stranger);
        vm.expectRevert(IBondlineMarket.NotUnderwriter.selector);
        market.delist(0);

        vm.expectEmit(true, false, false, true, address(market));
        emit IBondlineMarket.OfferDelisted(0);
        vm.prank(underwriter);
        market.delist(0);
        assertFalse(market.offer(0).listed);
        assertFalse(cover.listed());

        vm.prank(underwriter);
        market.delist(0); // idempotent
    }
}
