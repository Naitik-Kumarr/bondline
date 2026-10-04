// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {Terms, Rules, Position, CoverStatus, Valuation} from "../../src/Types.sol";
import {IBondlineCover} from "../../src/interfaces/IBondline.sol";
import {MirrorFeed} from "../../src/MirrorFeed.sol";
import {AgentAccount} from "../../src/AgentAccount.sol";
import {BondlineCover} from "../../src/BondlineCover.sol";
import {BondlineMarket} from "../../src/BondlineMarket.sol";
import {OracleVenue} from "../../src/OracleVenue.sol";
import {MockUSDG} from "../mocks/MockUSDG.sol";
import {MockStock} from "../mocks/MockStock.sol";

/// @notice Halmos symbolic proofs for BondlineCover, run against the real BondlineCover, AgentAccount,
///         BondlineMarket, OracleVenue and MirrorFeed (with the test mocks for USDG and the Stock Tokens).
contract BondlineHalmosTest is Test {
    uint16 internal constant CAP = 3000;
    uint256 internal constant BPS = 10_000;

    MockUSDG usdg;
    MockStock tsla;
    MirrorFeed tslaFeed;
    BondlineMarket market;
    BondlineCover cover;

    address keeper = address(0xBEEF);
    address agent = address(0xA9E7);
    address user = address(0x1234);
    address underwriter = address(0x5678);

    function setUp() public {
        vm.warp(1_790_000_000);
        usdg = new MockUSDG();
        tsla = new MockStock("Tesla", "TSLA");
        tslaFeed = new MirrorFeed(keeper, 8, "TSLA / USD");
        address[] memory a = new address[](1);
        a[0] = address(tsla);
        address[] memory f = new address[](1);
        f[0] = address(tslaFeed);
        market = new BondlineMarket(
            address(usdg), address(new BondlineCover()), address(new AgentAccount()), a, f, 300, 10, "Replay"
        );
        tsla.mint(market.venue(), 1e30);
        usdg.mint(market.venue(), 1e30);
        usdg.mint(underwriter, 1e30);
        usdg.mint(user, 1e30);
        vm.prank(keeper);
        tslaFeed.push(400e8, block.timestamp);
    }

    function _terms(uint16 lo, uint16 hi, uint16 fee) internal view returns (Terms memory) {
        return Terms({agent: agent, minLimitBps: lo, maxLimitBps: hi, feeBps: fee, maxStockBps: 8000, name: "Sym"});
    }

    function _rules() internal pure returns (Rules memory) {
        return Rules({
            assetMask: 1,
            maxStockBps: 8000,
            maxTradeBps: 10_000,
            maxDailyBps: 100_000,
            maxSlippageBps: 50,
            maxPriceAge: 300
        });
    }

    function _offer(uint16 lo, uint16 hi, uint16 fee, uint256 bond) internal {
        vm.startPrank(underwriter);
        (, address c) = market.createOffer(_terms(lo, hi, fee));
        cover = BondlineCover(c);
        usdg.approve(c, bond);
        cover.fund(bond);
        vm.stopPrank();
    }

    function _open(uint16 limitBps, uint256 amount) internal returns (AgentAccount) {
        vm.startPrank(user);
        usdg.approve(address(cover), amount);
        address acct = cover.open(limitBps, _rules(), amount);
        vm.stopPrank();
        return AgentAccount(acct);
    }

    /// @dev Models a trading loss of `lost` USDG by moving cash out of the account to the venue, which is what
    ///      a losing sale would do. The cover and account code under test are untouched.
    function _lose(AgentAccount acct, uint256 lost) internal {
        address sink = market.venue();
        vm.prank(address(acct));
        usdg.transfer(sink, lost);
    }

    function _worst(uint256 principal, uint16 lim) internal pure returns (uint256) {
        return (principal * (CAP - lim) + BPS - 1) / BPS;
    }

    function _limitUp(uint256 principal, uint16 lim) internal pure returns (uint256) {
        return (principal * lim + BPS - 1) / BPS;
    }

    function _capPayout(uint256 principal, uint16 lim) internal pure returns (uint256) {
        return principal * (CAP - lim) / BPS;
    }


    // ---------------------------------------------------------------- shared setup and helpers

    /// @dev Bounds: a deposit is 1 USDG to 2^64 units (about 1.8e13 USDG), the limit is any value the market
    ///      accepts below the 30% cap, and the underwriter's bond is large enough to back every case.
    uint256 internal constant MAXD = 1 << 64;
    uint256 internal constant BIG_BOND = 1 << 80;

    function _setupCash(uint256 deposit, uint16 lim, uint256 bond) internal returns (AgentAccount acct) {
        return _setupCashFee(deposit, 100, lim, bond);
    }

    function _setupCashFee(uint256 deposit, uint16 fee, uint16 lim, uint256 bond) internal returns (AgentAccount acct) {
        vm.assume(deposit >= 1e6 && deposit <= MAXD);
        vm.assume(lim >= 1 && lim <= 2999);
        _offer(1, 2999, fee, bond);
        acct = _open(lim, deposit);
    }

    function _settle(AgentAccount acct) internal returns (bool ok, uint256 payout, bytes memory ret) {
        vm.prank(address(0xCAFE));
        (ok, ret) = address(cover).call(abi.encodeCall(IBondlineCover.settle, (address(acct))));
        if (ok) payout = abi.decode(ret, (uint256));
    }

    function _reachEnd(bool reach) internal pure {
        if (reach) assert(false); // witness: this path is reachable under the property's assumptions
    }

    // ---------------------------------------------------------------- property 1: payout <= reservation

    /// @dev Any single open (symbolic deposit, limit and bond), any loss from 0 to the whole account.
    function _p1_single(uint256 deposit, uint16 lim, uint256 bond, uint256 lost, bool reach) internal {
        vm.assume(bond <= BIG_BOND);
        AgentAccount acct = _setupCash(deposit, lim, bond);
        Position memory p = cover.position(address(acct));
        vm.assume(lost <= usdg.balanceOf(address(acct)));
        vm.assume(lost > _limitUp(p.principal, lim)); // settleable
        _lose(acct, lost);
        uint256 bondBefore = cover.bond();
        uint256 reservedBefore = cover.reserved();
        (bool ok, uint256 payout,) = _settle(acct);
        assert(ok); // the reserved bond always covers: settle never underflows or reverts here
        assert(payout <= p.reserve);
        assert(cover.bond() == bondBefore - payout);
        assert(cover.reserved() == reservedBefore - p.reserve);
        assert(cover.bond() >= cover.reserved());
        _reachEnd(reach);
    }

    /// @dev Open, then a second deposit, so the reservation is a sum of two rounded-up worst cases.
    function _p1_two_deposits(uint256 d1, uint256 d2, uint16 lim, uint256 lost, bool reach) internal {
        AgentAccount acct = _setupCash(d1, lim, BIG_BOND);
        vm.assume(d2 >= 1e6 && d2 <= MAXD);
        vm.startPrank(user);
        usdg.approve(address(cover), d2);
        cover.deposit(address(acct), d2);
        vm.stopPrank();
        Position memory p = cover.position(address(acct));
        vm.assume(lost <= usdg.balanceOf(address(acct)) && lost > _limitUp(p.principal, lim));
        _lose(acct, lost);
        (bool ok, uint256 payout,) = _settle(acct);
        assert(ok);
        assert(payout <= p.reserve);
        assert(cover.bond() >= cover.reserved());
        _reachEnd(reach);
    }

    /// @dev Open, lose `lost0`, withdraw `w`, then lose `lost` more and settle.
    function _p1_after_withdraw(uint256 deposit, uint16 fee, uint16 lim, uint256 lost0, uint256 w, uint256 lost, bool reach)
        internal
    {
        AgentAccount acct = _setupCashFee(deposit, fee, lim, BIG_BOND);
        vm.assume(lost0 < usdg.balanceOf(address(acct)));
        _lose(acct, lost0);
        vm.assume(w > 0 && w < usdg.balanceOf(address(acct)));
        vm.prank(user);
        cover.withdraw(address(acct), w);
        Position memory p = cover.position(address(acct));
        vm.assume(lost <= usdg.balanceOf(address(acct)) && lost > _limitUp(p.principal, lim));
        _lose(acct, lost);
        (bool ok, uint256 payout,) = _settle(acct);
        assert(ok);
        assert(payout <= p.reserve);
        assert(cover.bond() >= cover.reserved());
        _reachEnd(reach);
    }

    // ---------------------------------------------------------------- property 2: loss <= limit pays nothing

    /// @dev `gift` lets the account's value exceed the principal (a gain); `lost` is a loss at most the limit.
    function _p2_within_limit(uint256 deposit, uint16 lim, uint256 lost, uint256 gift, bool reach) internal {
        AgentAccount acct = _setupCash(deposit, lim, BIG_BOND);
        Position memory p = cover.position(address(acct));
        uint256 limit = _limitUp(p.principal, lim);
        vm.assume(gift <= MAXD && lost <= usdg.balanceOf(address(acct)));
        _lose(acct, lost);
        usdg.mint(address(acct), gift);
        uint256 value = usdg.balanceOf(address(acct));
        uint256 loss = p.principal > value ? p.principal - value : 0;
        vm.assume(loss <= limit);

        uint256[5] memory before_ = _snapshot(acct);
        (bool ok,, bytes memory ret) = _settle(acct);
        assert(!ok);
        assert(keccak256(ret) == keccak256(abi.encodeWithSelector(IBondlineCover.WithinLimit.selector, loss, limit)));
        uint256[5] memory after_ = _snapshot(acct);
        for (uint256 i; i < 5; ++i) assert(before_[i] == after_[i]);
        assert(cover.position(address(acct)).status == CoverStatus.Active);
        _reachEnd(reach);
    }

    function _snapshot(AgentAccount acct) internal view returns (uint256[5] memory s) {
        s[0] = usdg.balanceOf(address(cover));
        s[1] = usdg.balanceOf(address(acct));
        s[2] = usdg.balanceOf(user);
        s[3] = cover.bond();
        s[4] = cover.claimsPaid();
    }

    // ---------------------------------------------------------------- property 3: net loss equals the limit

    /// @dev loss - limit <= principal x (cap - limit) / 10000: the payout is uncapped, so value + payout lands on
    ///      principal - limit exactly, where limit = ceil(principal x limitBps / 10000).
    function _p3_cash(uint256 deposit, uint16 lim, uint256 lost, bool reach) internal {
        AgentAccount acct = _setupCash(deposit, lim, BIG_BOND);
        Position memory p = cover.position(address(acct));
        uint256 limit = _limitUp(p.principal, lim);
        vm.assume(lost <= usdg.balanceOf(address(acct)) && lost > limit);
        vm.assume(lost - limit <= _capPayout(p.principal, lim));
        _lose(acct, lost);
        uint256 value = usdg.balanceOf(address(acct));
        uint256 userBefore = usdg.balanceOf(user);
        (bool ok, uint256 payout,) = _settle(acct);
        assert(ok);
        assert(payout == lost - limit);
        assert(usdg.balanceOf(user) == userBefore + payout);
        assert(value + payout == p.principal - limit);
        assert(usdg.balanceOf(address(acct)) == value); // the account keeps its assets for the user to sweep
        _reachEnd(reach);
    }

    // ---------------------------------------------------------------- property 4: reservation >= worst case

    function _checkReserve(AgentAccount acct, uint16 lim) internal view {
        Position memory p = cover.position(address(acct));
        assert(p.reserve * BPS >= p.principal * (CAP - lim));
        assert(cover.reserved() >= p.reserve);
        assert(cover.bond() >= cover.reserved());
    }

    function _p4_deposit(uint256 d1, uint256 d2, uint16 lim, bool reach) internal {
        AgentAccount acct = _setupCash(d1, lim, BIG_BOND);
        _checkReserve(acct, lim);
        vm.assume(d2 >= 1e6 && d2 <= MAXD);
        vm.startPrank(user);
        usdg.approve(address(cover), d2);
        cover.deposit(address(acct), d2);
        vm.stopPrank();
        _checkReserve(acct, lim);
        _reachEnd(reach);
    }

    /// @dev A withdrawal after a prior loss `lost0`, so the account's value differs from the principal.
    function _p4_withdraw(uint256 deposit, uint16 fee, uint16 lim, uint256 lost0, uint256 w, bool reach) internal {
        AgentAccount acct = _setupCashFee(deposit, fee, lim, BIG_BOND);
        vm.assume(lost0 < usdg.balanceOf(address(acct)));
        _lose(acct, lost0);
        vm.assume(w > 0 && w <= usdg.balanceOf(address(acct)));
        vm.prank(user);
        cover.withdraw(address(acct), w);
        _checkReserve(acct, lim);
        _reachEnd(reach);
    }

    // ---------------------------------------------------------------- price-driven (real trade, real feed) cases

    /// @dev The agent really buys TSLA with 80% of the principal through AgentAccount.trade and OracleVenue,
    ///      then the feed moves to a symbolic price. The cover's `valuation` reads the real feed.
    function _setupStock(uint256 deposit, uint16 lim) internal returns (AgentAccount acct, uint256 bal) {
        acct = _setupCash(deposit, lim, BIG_BOND);
        uint256 usd = cover.position(address(acct)).principal * 8 / 10;
        vm.prank(agent);
        bool executed = acct.trade(address(tsla), true, usd, 0, "");
        assert(executed);
        bal = tsla.balanceOf(address(acct));
        assert(bal > 0);
    }

    function _movePrice(uint256 price) internal {
        vm.assume(price >= 1 && price <= (1 << 40));
        vm.warp(block.timestamp + 1);
        vm.prank(keeper);
        tslaFeed.push(int256(price), block.timestamp);
    }

    /// @dev The account's value from a formula written here (cash + balance x price / 1e20), not the contract's.
    function _value(AgentAccount acct, uint256 bal, uint256 price) internal view returns (uint256) {
        uint256 v = usdg.balanceOf(address(acct)) + bal * price / 1e20;
        assert(v == acct.valuation().value);
        return v;
    }

    function _p1_stock(uint256 deposit, uint16 lim, uint256 price, bool reach) internal {
        (AgentAccount acct, uint256 bal) = _setupStock(deposit, lim);
        _movePrice(price);
        Position memory p = cover.position(address(acct));
        uint256 value = _value(acct, bal, price);
        vm.assume(p.principal > value && p.principal - value > _limitUp(p.principal, lim));
        (bool ok, uint256 payout,) = _settle(acct);
        assert(ok);
        assert(payout <= p.reserve);
        assert(cover.bond() >= cover.reserved());
        _reachEnd(reach);
    }

    function _p2_stock(uint256 deposit, uint16 lim, uint256 price, bool reach) internal {
        (AgentAccount acct, uint256 bal) = _setupStock(deposit, lim);
        _movePrice(price);
        Position memory p = cover.position(address(acct));
        uint256 value = _value(acct, bal, price);
        uint256 loss = p.principal > value ? p.principal - value : 0;
        uint256 limit = _limitUp(p.principal, lim);
        vm.assume(loss <= limit);
        uint256[5] memory before_ = _snapshot(acct);
        (bool ok,, bytes memory ret) = _settle(acct);
        assert(!ok);
        assert(keccak256(ret) == keccak256(abi.encodeWithSelector(IBondlineCover.WithinLimit.selector, loss, limit)));
        uint256[5] memory after_ = _snapshot(acct);
        for (uint256 i; i < 5; ++i) assert(before_[i] == after_[i]);
        assert(cover.position(address(acct)).status == CoverStatus.Active);
        _reachEnd(reach);
    }

    function _p3_stock(uint256 deposit, uint16 lim, uint256 price, bool reach) internal {
        (AgentAccount acct, uint256 bal) = _setupStock(deposit, lim);
        _movePrice(price);
        Position memory p = cover.position(address(acct));
        uint256 value = _value(acct, bal, price);
        uint256 limit = _limitUp(p.principal, lim);
        vm.assume(p.principal > value && p.principal - value > limit);
        vm.assume(p.principal - value - limit <= _capPayout(p.principal, lim));
        uint256 userBefore = usdg.balanceOf(user);
        (bool ok, uint256 payout,) = _settle(acct);
        assert(ok);
        assert(payout == p.principal - value - limit);
        assert(usdg.balanceOf(user) == userBefore + payout);
        // The stocks stay in the account, still priced by the same feed: value afterwards is unchanged.
        assert(_value(acct, bal, price) == value);
        assert(value + payout == p.principal - limit);
        _reachEnd(reach);
    }

    // ---------------------------------------------------------------- property 5: the market keeps no USDG

    function _p5_createOffer(address uw, address ag, uint16 lo, uint16 hi, uint16 fee, uint16 ms, uint256 bond, bool reach)
        internal
    {
        vm.assume(bond > 0 && uw != address(0) && uw != address(market) && uw != address(usdg));
        Terms memory t = Terms({agent: ag, minLimitBps: lo, maxLimitBps: hi, feeBps: fee, maxStockBps: ms, name: "Sym"});
        usdg.mint(uw, bond);
        vm.startPrank(uw);
        (, address c) = market.createOffer(t);
        assert(usdg.balanceOf(address(market)) == 0);
        usdg.approve(c, bond);
        BondlineCover(c).fund(bond);
        vm.stopPrank();
        assert(usdg.balanceOf(address(market)) == 0);
        assert(usdg.balanceOf(c) >= bond);
        _reachEnd(reach);
    }

    struct AuthIn {
        address uw;
        uint256 bond;
        uint256 validBefore;
        bytes32 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    function _authDigest(AuthIn memory a) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                usdg.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), a.uw, address(market), a.bond, 0, a.validBefore, a.nonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", usdg.DOMAIN_SEPARATOR(), structHash));
    }

    /// @dev The signature is symbolic: it is assumed valid by constraining ecrecover (halmos models it as an
    ///      uninterpreted function of its four arguments) to return the signer, which is what a valid signature does.
    function _p5_auth(AuthIn memory a, Terms memory t, bool reach) internal {
        vm.assume(a.bond > 0 && a.uw != address(0) && a.uw != address(market) && a.uw != address(usdg));
        vm.assume(a.validBefore > block.timestamp);
        vm.assume(a.v == 27 || a.v == 28);
        vm.assume(uint256(a.s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0);
        vm.assume(ecrecover(_authDigest(a), a.v, a.r, a.s) == a.uw);
        usdg.mint(a.uw, a.bond);
        vm.prank(a.uw);
        (, address c) =
            market.createOfferWithAuthorization(t, a.bond, 0, a.validBefore, a.nonce, a.v, a.r, a.s);
        assert(usdg.balanceOf(address(market)) == 0);
        assert(usdg.balanceOf(c) == a.bond);
        assert(BondlineCover(c).bond() == a.bond);
        _reachEnd(reach);
    }

    // ---------------------------------------------------------------- instances (generated: one per bound set)

    function check_p1_single_d1e6(uint16 lim, uint256 bond, uint256 lost) public {
        _p1_single(1_000_000, lim, bond, lost, false);
    }

    function check_p1_two_deposits_d1e6(uint16 lim, uint256 lost) public {
        _p1_two_deposits(1_000_000, 777_777_777, lim, lost, false);
    }

    function check_p2_within_limit_d1e6(uint16 lim, uint256 lost, uint256 gift) public {
        _p2_within_limit(1_000_000, lim, lost, gift, false);
    }

    function check_p3_cash_d1e6(uint16 lim, uint256 lost) public {
        _p3_cash(1_000_000, lim, lost, false);
    }

    function check_p4_deposit_d1e6(uint16 lim) public {
        _p4_deposit(1_000_000, 777_777_777, lim, false);
    }

    function check_reach_p1_single_d1e6(uint16 lim, uint256 bond, uint256 lost) public {
        _p1_single(1_000_000, lim, bond, lost, true);
    }

    function check_reach_p1_two_deposits_d1e6(uint16 lim, uint256 lost) public {
        _p1_two_deposits(1_000_000, 777_777_777, lim, lost, true);
    }

    function check_reach_p2_within_limit_d1e6(uint16 lim, uint256 lost, uint256 gift) public {
        _p2_within_limit(1_000_000, lim, lost, gift, true);
    }

    function check_reach_p3_cash_d1e6(uint16 lim, uint256 lost) public {
        _p3_cash(1_000_000, lim, lost, true);
    }

    function check_reach_p4_deposit_d1e6(uint16 lim) public {
        _p4_deposit(1_000_000, 777_777_777, lim, true);
    }

    function check_p1_single_d123456789(uint16 lim, uint256 bond, uint256 lost) public {
        _p1_single(123_456_789, lim, bond, lost, false);
    }

    function check_p1_two_deposits_d123456789(uint16 lim, uint256 lost) public {
        _p1_two_deposits(123_456_789, 777_777_777, lim, lost, false);
    }

    function check_p2_within_limit_d123456789(uint16 lim, uint256 lost, uint256 gift) public {
        _p2_within_limit(123_456_789, lim, lost, gift, false);
    }

    function check_p3_cash_d123456789(uint16 lim, uint256 lost) public {
        _p3_cash(123_456_789, lim, lost, false);
    }

    function check_p4_deposit_d123456789(uint16 lim) public {
        _p4_deposit(123_456_789, 777_777_777, lim, false);
    }

    function check_reach_p1_single_d123456789(uint16 lim, uint256 bond, uint256 lost) public {
        _p1_single(123_456_789, lim, bond, lost, true);
    }

    function check_reach_p1_two_deposits_d123456789(uint16 lim, uint256 lost) public {
        _p1_two_deposits(123_456_789, 777_777_777, lim, lost, true);
    }

    function check_reach_p2_within_limit_d123456789(uint16 lim, uint256 lost, uint256 gift) public {
        _p2_within_limit(123_456_789, lim, lost, gift, true);
    }

    function check_reach_p3_cash_d123456789(uint16 lim, uint256 lost) public {
        _p3_cash(123_456_789, lim, lost, true);
    }

    function check_reach_p4_deposit_d123456789(uint16 lim) public {
        _p4_deposit(123_456_789, 777_777_777, lim, true);
    }

    function check_p1_single_d1e9(uint16 lim, uint256 bond, uint256 lost) public {
        _p1_single(1_000_000_000, lim, bond, lost, false);
    }

    function check_p1_two_deposits_d1e9(uint16 lim, uint256 lost) public {
        _p1_two_deposits(1_000_000_000, 777_777_777, lim, lost, false);
    }

    function check_p2_within_limit_d1e9(uint16 lim, uint256 lost, uint256 gift) public {
        _p2_within_limit(1_000_000_000, lim, lost, gift, false);
    }

    function check_p3_cash_d1e9(uint16 lim, uint256 lost) public {
        _p3_cash(1_000_000_000, lim, lost, false);
    }

    function check_p4_deposit_d1e9(uint16 lim) public {
        _p4_deposit(1_000_000_000, 777_777_777, lim, false);
    }

    function check_reach_p1_single_d1e9(uint16 lim, uint256 bond, uint256 lost) public {
        _p1_single(1_000_000_000, lim, bond, lost, true);
    }

    function check_reach_p1_two_deposits_d1e9(uint16 lim, uint256 lost) public {
        _p1_two_deposits(1_000_000_000, 777_777_777, lim, lost, true);
    }

    function check_reach_p2_within_limit_d1e9(uint16 lim, uint256 lost, uint256 gift) public {
        _p2_within_limit(1_000_000_000, lim, lost, gift, true);
    }

    function check_reach_p3_cash_d1e9(uint16 lim, uint256 lost) public {
        _p3_cash(1_000_000_000, lim, lost, true);
    }

    function check_reach_p4_deposit_d1e9(uint16 lim) public {
        _p4_deposit(1_000_000_000, 777_777_777, lim, true);
    }

    function check_p1_single_d2p50(uint16 lim, uint256 bond, uint256 lost) public {
        _p1_single((1 << 50), lim, bond, lost, false);
    }

    function check_p1_two_deposits_d2p50(uint16 lim, uint256 lost) public {
        _p1_two_deposits((1 << 50), 777_777_777, lim, lost, false);
    }

    function check_p2_within_limit_d2p50(uint16 lim, uint256 lost, uint256 gift) public {
        _p2_within_limit((1 << 50), lim, lost, gift, false);
    }

    function check_p3_cash_d2p50(uint16 lim, uint256 lost) public {
        _p3_cash((1 << 50), lim, lost, false);
    }

    function check_p4_deposit_d2p50(uint16 lim) public {
        _p4_deposit((1 << 50), 777_777_777, lim, false);
    }

    function check_reach_p1_single_d2p50(uint16 lim, uint256 bond, uint256 lost) public {
        _p1_single((1 << 50), lim, bond, lost, true);
    }

    function check_reach_p1_two_deposits_d2p50(uint16 lim, uint256 lost) public {
        _p1_two_deposits((1 << 50), 777_777_777, lim, lost, true);
    }

    function check_reach_p2_within_limit_d2p50(uint16 lim, uint256 lost, uint256 gift) public {
        _p2_within_limit((1 << 50), lim, lost, gift, true);
    }

    function check_reach_p3_cash_d2p50(uint16 lim, uint256 lost) public {
        _p3_cash((1 << 50), lim, lost, true);
    }

    function check_reach_p4_deposit_d2p50(uint16 lim) public {
        _p4_deposit((1 << 50), 777_777_777, lim, true);
    }

    function check_p1_stock_d1e9(uint16 lim, uint256 price) public {
        _p1_stock(1000000000, lim, price, false);
    }

    function check_p2_stock_d1e9(uint16 lim, uint256 price) public {
        _p2_stock(1000000000, lim, price, false);
    }

    function check_p3_stock_d1e9(uint16 lim, uint256 price) public {
        _p3_stock(1000000000, lim, price, false);
    }

    function check_p1_stock_d1e6(uint16 lim, uint256 price) public {
        _p1_stock(1000000, lim, price, false);
    }

    function check_p2_stock_d1e6(uint16 lim, uint256 price) public {
        _p2_stock(1000000, lim, price, false);
    }

    function check_p3_stock_d1e6(uint16 lim, uint256 price) public {
        _p3_stock(1000000, lim, price, false);
    }

    function check_p5_createOffer(address uw, address ag, uint16 lo, uint16 hi, uint16 fee, uint16 ms, uint256 bond) public {
        _p5_createOffer(uw, ag, lo, hi, fee, ms, bond, false);
    }

    function check_p5_createOfferWithAuthorization(address uw, uint16 lo, uint16 hi, uint16 fee, uint16 ms, uint256 bond, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) public {
        Terms memory t = Terms({agent: agent, minLimitBps: lo, maxLimitBps: hi, feeBps: fee, maxStockBps: ms, name: "Sym"});
        _p5_auth(AuthIn(uw, bond, validBefore, nonce, v, r, s), t, false);
    }

    function check_reach_p1_stock_d1e9(uint16 lim, uint256 price) public {
        _p1_stock(1000000000, lim, price, true);
    }

    function check_reach_p2_stock_d1e9(uint16 lim, uint256 price) public {
        _p2_stock(1000000000, lim, price, true);
    }

    function check_reach_p3_stock_d1e9(uint16 lim, uint256 price) public {
        _p3_stock(1000000000, lim, price, true);
    }

    function check_reach_p1_stock_d1e6(uint16 lim, uint256 price) public {
        _p1_stock(1000000, lim, price, true);
    }

    function check_reach_p2_stock_d1e6(uint16 lim, uint256 price) public {
        _p2_stock(1000000, lim, price, true);
    }

    function check_reach_p3_stock_d1e6(uint16 lim, uint256 price) public {
        _p3_stock(1000000, lim, price, true);
    }

    function check_reach_p5_createOffer(address uw, address ag, uint16 lo, uint16 hi, uint16 fee, uint16 ms, uint256 bond) public {
        _p5_createOffer(uw, ag, lo, hi, fee, ms, bond, true);
    }

    function check_reach_p5_createOfferWithAuthorization(address uw, uint16 lo, uint16 hi, uint16 fee, uint16 ms, uint256 bond, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) public {
        Terms memory t = Terms({agent: agent, minLimitBps: lo, maxLimitBps: hi, feeBps: fee, maxStockBps: ms, name: "Sym"});
        _p5_auth(AuthIn(uw, bond, validBefore, nonce, v, r, s), t, true);
    }

    function check_attempt_p2_within_limit_symbolic_deposit(uint256 deposit, uint256 lost, uint256 gift) public {
        _p2_within_limit(deposit, 1000, lost, gift, false);
    }

    function check_attempt_p3_cash_symbolic_deposit(uint256 deposit, uint256 lost) public {
        _p3_cash(deposit, 1000, lost, false);
    }

    // ---------------------------------------------------------------- withdraw instances (generated)

    function check_p1_after_withdraw_pow2_l1(uint256 w, uint256 lost) public {
        _p1_after_withdraw(1 << 27, 0, 1, 0, w, lost, false);
    }

    function check_p4_withdraw_pow2_l1(uint256 w) public {
        _p4_withdraw(1 << 27, 0, 1, 0, w, false);
    }

    function check_reach_p1_after_withdraw_pow2_l1(uint256 w, uint256 lost) public {
        _p1_after_withdraw(1 << 27, 0, 1, 0, w, lost, true);
    }

    function check_reach_p4_withdraw_pow2_l1(uint256 w) public {
        _p4_withdraw(1 << 27, 0, 1, 0, w, true);
    }

    function check_p1_after_withdraw_pow2_l500(uint256 w, uint256 lost) public {
        _p1_after_withdraw(1 << 27, 0, 500, 0, w, lost, false);
    }

    function check_p4_withdraw_pow2_l500(uint256 w) public {
        _p4_withdraw(1 << 27, 0, 500, 0, w, false);
    }

    function check_reach_p1_after_withdraw_pow2_l500(uint256 w, uint256 lost) public {
        _p1_after_withdraw(1 << 27, 0, 500, 0, w, lost, true);
    }

    function check_reach_p4_withdraw_pow2_l500(uint256 w) public {
        _p4_withdraw(1 << 27, 0, 500, 0, w, true);
    }

    function check_p1_after_withdraw_pow2_l777(uint256 w, uint256 lost) public {
        _p1_after_withdraw(1 << 27, 0, 777, 0, w, lost, false);
    }

    function check_p4_withdraw_pow2_l777(uint256 w) public {
        _p4_withdraw(1 << 27, 0, 777, 0, w, false);
    }

    function check_reach_p1_after_withdraw_pow2_l777(uint256 w, uint256 lost) public {
        _p1_after_withdraw(1 << 27, 0, 777, 0, w, lost, true);
    }

    function check_reach_p4_withdraw_pow2_l777(uint256 w) public {
        _p4_withdraw(1 << 27, 0, 777, 0, w, true);
    }

    function check_p1_after_withdraw_pow2_l1000(uint256 w, uint256 lost) public {
        _p1_after_withdraw(1 << 27, 0, 1000, 0, w, lost, false);
    }

    function check_p4_withdraw_pow2_l1000(uint256 w) public {
        _p4_withdraw(1 << 27, 0, 1000, 0, w, false);
    }

    function check_reach_p1_after_withdraw_pow2_l1000(uint256 w, uint256 lost) public {
        _p1_after_withdraw(1 << 27, 0, 1000, 0, w, lost, true);
    }

    function check_reach_p4_withdraw_pow2_l1000(uint256 w) public {
        _p4_withdraw(1 << 27, 0, 1000, 0, w, true);
    }

    function check_p1_after_withdraw_pow2_l2000(uint256 w, uint256 lost) public {
        _p1_after_withdraw(1 << 27, 0, 2000, 0, w, lost, false);
    }

    function check_p4_withdraw_pow2_l2000(uint256 w) public {
        _p4_withdraw(1 << 27, 0, 2000, 0, w, false);
    }

    function check_reach_p1_after_withdraw_pow2_l2000(uint256 w, uint256 lost) public {
        _p1_after_withdraw(1 << 27, 0, 2000, 0, w, lost, true);
    }

    function check_reach_p4_withdraw_pow2_l2000(uint256 w) public {
        _p4_withdraw(1 << 27, 0, 2000, 0, w, true);
    }

    function check_p1_after_withdraw_pow2_l2999(uint256 w, uint256 lost) public {
        _p1_after_withdraw(1 << 27, 0, 2999, 0, w, lost, false);
    }

    function check_p4_withdraw_pow2_l2999(uint256 w) public {
        _p4_withdraw(1 << 27, 0, 2999, 0, w, false);
    }

    function check_reach_p1_after_withdraw_pow2_l2999(uint256 w, uint256 lost) public {
        _p1_after_withdraw(1 << 27, 0, 2999, 0, w, lost, true);
    }

    function check_reach_p4_withdraw_pow2_l2999(uint256 w) public {
        _p4_withdraw(1 << 27, 0, 2999, 0, w, true);
    }

    function check_p4_withdraw_fixed_x0_w1wei(uint16 lim) public {
        _p4_withdraw(123_456_789, 100, lim, 0, 1, false);
    }

    function check_reach_p4_withdraw_fixed_x0_w1wei(uint16 lim) public {
        _p4_withdraw(123_456_789, 100, lim, 0, 1, true);
    }

    function check_p4_withdraw_fixed_x0_w20(uint16 lim) public {
        _p4_withdraw(123_456_789, 100, lim, 0, 20000000, false);
    }

    function check_reach_p4_withdraw_fixed_x0_w20(uint16 lim) public {
        _p4_withdraw(123_456_789, 100, lim, 0, 20000000, true);
    }

    function check_p4_withdraw_fixed_x10_w1wei(uint16 lim) public {
        _p4_withdraw(123_456_789, 100, lim, 10000000, 1, false);
    }

    function check_reach_p4_withdraw_fixed_x10_w1wei(uint16 lim) public {
        _p4_withdraw(123_456_789, 100, lim, 10000000, 1, true);
    }

    function check_p4_withdraw_fixed_x10_w20(uint16 lim) public {
        _p4_withdraw(123_456_789, 100, lim, 10000000, 20000000, false);
    }

    function check_reach_p4_withdraw_fixed_x10_w20(uint16 lim) public {
        _p4_withdraw(123_456_789, 100, lim, 10000000, 20000000, true);
    }

    function check_p4_withdraw_fixed_x100_w1wei(uint16 lim) public {
        _p4_withdraw(123_456_789, 100, lim, 100000000, 1, false);
    }

    function check_reach_p4_withdraw_fixed_x100_w1wei(uint16 lim) public {
        _p4_withdraw(123_456_789, 100, lim, 100000000, 1, true);
    }

    function check_p4_withdraw_fixed_x100_w20(uint16 lim) public {
        _p4_withdraw(123_456_789, 100, lim, 100000000, 20000000, false);
    }

    function check_reach_p4_withdraw_fixed_x100_w20(uint16 lim) public {
        _p4_withdraw(123_456_789, 100, lim, 100000000, 20000000, true);
    }

    function check_p1_after_withdraw_fixed_x0_w20(uint16 lim, uint256 lost) public {
        _p1_after_withdraw(123_456_789, 100, lim, 0, 20_000_000, lost, false);
    }

    function check_reach_p1_after_withdraw_fixed_x0_w20(uint16 lim, uint256 lost) public {
        _p1_after_withdraw(123_456_789, 100, lim, 0, 20_000_000, lost, true);
    }

    function check_p1_after_withdraw_fixed_x10_w20(uint16 lim, uint256 lost) public {
        _p1_after_withdraw(123_456_789, 100, lim, 10000000, 20_000_000, lost, false);
    }

    function check_reach_p1_after_withdraw_fixed_x10_w20(uint16 lim, uint256 lost) public {
        _p1_after_withdraw(123_456_789, 100, lim, 10000000, 20_000_000, lost, true);
    }
}
