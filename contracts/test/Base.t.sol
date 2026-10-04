// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {Terms, Rules, Health, Position, CoverStatus} from "../src/Types.sol";
import {MirrorFeed} from "../src/MirrorFeed.sol";
import {OracleVenue} from "../src/OracleVenue.sol";
import {AgentAccount} from "../src/AgentAccount.sol";
import {BondlineCover} from "../src/BondlineCover.sol";
import {BondlineMarket} from "../src/BondlineMarket.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";
import {MockStock} from "./mocks/MockStock.sol";

/// @notice Shared fixture: mock USDG and Stock Tokens, keeper-pushed feeds, the clone implementations and a
///         market whose demo exchange is stocked. Prices: TSLA $400, AMZN $200.
abstract contract BaseTest is Test {
    uint32 internal constant MAX_AGE = 300;
    uint16 internal constant SPREAD = 10;
    int256 internal constant TSLA_PRICE = 400e8;
    int256 internal constant AMZN_PRICE = 200e8;

    MockUSDG internal usdg;
    MockStock internal tsla;
    MockStock internal amzn;
    MirrorFeed internal tslaFeed;
    MirrorFeed internal amznFeed;
    AgentAccount internal accountImpl;
    BondlineCover internal coverImpl;
    BondlineMarket internal market;
    OracleVenue internal venue;

    address internal keeper = makeAddr("keeper");
    address internal agent = makeAddr("agent");
    address internal user = makeAddr("user");
    address internal stranger = makeAddr("stranger");
    address internal underwriter;
    uint256 internal underwriterKey;

    function setUp() public virtual {
        vm.warp(1_790_000_000);
        (underwriter, underwriterKey) = makeAddrAndKey("underwriter");

        usdg = new MockUSDG();
        tsla = new MockStock("Tesla", "TSLA");
        amzn = new MockStock("Amazon", "AMZN");
        tslaFeed = new MirrorFeed(keeper, 8, "TSLA / USD");
        amznFeed = new MirrorFeed(keeper, 8, "AMZN / USD");
        _setPrices(TSLA_PRICE, AMZN_PRICE);

        accountImpl = new AgentAccount();
        coverImpl = new BondlineCover();
        market = _newMarket(MAX_AGE, "Replay");
        venue = OracleVenue(market.venue());
        _stock(address(venue));

        usdg.mint(underwriter, 1_000_000e6);
        usdg.mint(user, 1_000_000e6);
        usdg.mint(stranger, 1_000_000e6);
    }

    // ---------------------------------------------------------------- builders

    function _assets() internal view returns (address[] memory a) {
        a = new address[](2);
        a[0] = address(tsla);
        a[1] = address(amzn);
    }

    function _feeds() internal view returns (address[] memory f) {
        f = new address[](2);
        f[0] = address(tslaFeed);
        f[1] = address(amznFeed);
    }

    function _newMarket(uint32 maxAge, string memory label) internal returns (BondlineMarket) {
        return new BondlineMarket(
            address(usdg), address(coverImpl), address(accountImpl), _assets(), _feeds(), maxAge, SPREAD, label
        );
    }

    function _stock(address v) internal {
        usdg.mint(v, 1_000_000e6);
        tsla.mint(v, 10_000e18);
        amzn.mint(v, 10_000e18);
    }

    function _terms() internal view returns (Terms memory) {
        return Terms({agent: agent, minLimitBps: 500, maxLimitBps: 2000, feeBps: 100, maxStockBps: 8000, name: "Bold 1%"});
    }

    function _rules() internal pure returns (Rules memory) {
        return Rules({
            assetMask: 3,
            maxStockBps: 8000,
            maxTradeBps: 10_000,
            maxDailyBps: 100_000,
            maxSlippageBps: 50,
            maxPriceAge: 300
        });
    }

    // ---------------------------------------------------------------- actions

    /// @dev Advances one second and pushes both prices with the new timestamp (feeds need newer timestamps).
    function _setPrices(int256 tslaPrice, int256 amznPrice) internal {
        vm.warp(block.timestamp + 1);
        vm.startPrank(keeper);
        tslaFeed.push(tslaPrice, block.timestamp);
        amznFeed.push(amznPrice, block.timestamp);
        vm.stopPrank();
    }

    /// @dev Moves both prices down by `dropBps` from the base prices.
    function _drop(uint256 dropBps) internal {
        _setPrices(
            TSLA_PRICE * int256(10_000 - dropBps) / 10_000, AMZN_PRICE * int256(10_000 - dropBps) / 10_000
        );
    }

    function _offer(Terms memory t, uint256 bondAmount) internal returns (BondlineCover cover) {
        return _offerIn(market, t, bondAmount);
    }

    function _offerIn(BondlineMarket m, Terms memory t, uint256 bondAmount) internal returns (BondlineCover cover) {
        vm.prank(underwriter);
        (, address c) = m.createOffer(t);
        cover = BondlineCover(c);
        if (bondAmount > 0) {
            vm.startPrank(underwriter);
            usdg.approve(c, bondAmount);
            cover.fund(bondAmount);
            vm.stopPrank();
        }
    }

    function _open(BondlineCover cover, uint16 limitBps, uint256 amount) internal returns (AgentAccount) {
        return _openWith(cover, limitBps, _rules(), amount);
    }

    function _openWith(BondlineCover cover, uint16 limitBps, Rules memory r, uint256 amount)
        internal
        returns (AgentAccount)
    {
        vm.startPrank(user);
        usdg.approve(address(cover), amount);
        address a = cover.open(limitBps, r, amount);
        vm.stopPrank();
        return AgentAccount(a);
    }

    function _trade(AgentAccount acct, address asset, bool isBuy, uint256 usd) internal returns (bool) {
        vm.prank(agent);
        return acct.trade(asset, isBuy, usd, 0, bytes('{"action":"trade"}'));
    }

    /// @dev A standard book: 1% premium offer with a 10,000 USDG bond, a 1,000 USDG cover at a 10% limit,
    ///      and the agent buys 792 USDG of TSLA (80% of the 990 principal).
    function _invested() internal returns (BondlineCover cover, AgentAccount acct) {
        cover = _offer(_terms(), 10_000e6);
        acct = _open(cover, 1000, 1000e6);
        assertTrue(_trade(acct, address(tsla), true, 792e6));
    }

    function _signReceive(
        uint256 key,
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(
            abi.encode(usdg.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), from, to, value, validAfter, validBefore, nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdg.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(key, digest);
    }
}
