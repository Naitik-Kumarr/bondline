// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {Rules, BlockReason, Valuation} from "./Types.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {IAgentAccount, IOracleVenue} from "./interfaces/IBondline.sol";
import {PriceMath} from "./libraries/PriceMath.sol";

/// @title AgentAccount
/// @notice One user's covered account, created as a clone by a `BondlineCover`.
///         - The agent, one fixed address, can only call `trade`, and only inside the rules fixed at open.
///         - A trade outside the rules doesn't revert: it emits `Blocked` and changes nothing. Refusals are receipts.
///         - The AI's decision JSON travels in the transaction input; the event carries its keccak256.
///         - The agent can never withdraw. While the cover is active, only the cover moves money out.
///         - The cover can stop the agent; the user can pause and resume it.
///         - After a settle or close, the cover releases the account and the user can sweep everything out.
contract AgentAccount is IAgentAccount, Initializable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;

    /// @inheritdoc IAgentAccount
    address public owner;
    /// @inheritdoc IAgentAccount
    address public agent;
    /// @inheritdoc IAgentAccount
    address public cover;
    /// @inheritdoc IAgentAccount
    address public market;

    address public usdg;
    address public venue;

    /// @inheritdoc IAgentAccount
    bool public paused;
    /// @inheritdoc IAgentAccount
    bool public stopped;
    /// @inheritdoc IAgentAccount
    bool public released;

    Rules private _rules;
    address[] private _assets;
    address[] private _feeds;

    uint256 private _day;
    uint256 private _dayVolume;

    /// @dev What `trade` will do, worked out before anything moves.
    struct Plan {
        bool blocked;
        BlockReason reason;
        uint256 observed;
        uint256 limit;
        uint256 usd;
        uint256 amountIn;
        uint256 out;
        uint256 price;
    }

    modifier onlyCover() {
        if (msg.sender != cover) revert NotCover();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        _disableInitializers();
    }

    /// @inheritdoc IAgentAccount
    /// @dev Called by the cover in the same transaction that clones this account.
    function initialize(
        address owner_,
        address agent_,
        address market_,
        address usdg_,
        address venue_,
        address[] calldata assets_,
        address[] calldata feeds_,
        Rules calldata rules_
    ) external initializer {
        cover = msg.sender;
        owner = owner_;
        agent = agent_;
        market = market_;
        usdg = usdg_;
        venue = venue_;
        _assets = assets_;
        _feeds = feeds_;
        _rules = rules_;
    }

    // ---------------------------------------------------------------- agent

    /// @inheritdoc IAgentAccount
    function trade(address asset, bool isBuy, uint256 usdAmount, uint256 minOut, bytes calldata decision)
        external
        nonReentrant
        returns (bool executed)
    {
        if (msg.sender != agent) revert NotAgent();
        bytes32 decisionHash = keccak256(decision);

        Plan memory p = _plan(asset, isBuy, usdAmount, minOut);
        if (p.blocked) {
            emit Blocked(asset, isBuy, usdAmount, p.reason, p.observed, p.limit, decisionHash);
            return false;
        }

        uint256 today = block.timestamp / 1 days;
        if (today > _day) {
            _day = today;
            _dayVolume = 0;
        }
        _dayVolume += p.usd;

        if (isBuy) {
            IERC20(usdg).forceApprove(venue, p.amountIn);
            p.out = IOracleVenue(venue).buy(asset, p.amountIn, minOut);
        } else {
            IERC20(asset).forceApprove(venue, p.amountIn);
            p.out = IOracleVenue(venue).sell(asset, p.amountIn, minOut);
        }

        Valuation memory v = _valuation();
        emit Traded(asset, isBuy, p.usd, p.amountIn, p.out, p.price, v.value, v.stockValue, decisionHash);
        return true;
    }

    // ---------------------------------------------------------------- user

    /// @inheritdoc IAgentAccount
    function pause() external onlyOwner {
        if (stopped) revert AlreadyStopped();
        if (paused) revert AlreadyPaused();
        paused = true;
        emit AgentPaused();
    }

    /// @inheritdoc IAgentAccount
    function resume() external onlyOwner {
        if (stopped) revert AlreadyStopped();
        if (!paused) revert NotPaused();
        paused = false;
        emit AgentResumed();
    }

    /// @inheritdoc IAgentAccount
    function sweep() external nonReentrant onlyOwner {
        if (!released) revert NotReleased();
        _sweep(usdg);
        for (uint256 i; i < _assets.length; ++i) {
            _sweep(_assets[i]);
        }
    }

    /// @inheritdoc IAgentAccount
    function sweepToken(address token) external nonReentrant onlyOwner {
        if (!released) revert NotReleased();
        _sweep(token);
    }

    // ---------------------------------------------------------------- cover

    /// @inheritdoc IAgentAccount
    /// @dev Used by the cover for the user's withdrawals while the cover is active.
    function pay(address to, uint256 amount) external onlyCover nonReentrant {
        IERC20(usdg).safeTransfer(to, amount);
    }

    /// @inheritdoc IAgentAccount
    function stop() external onlyCover {
        if (stopped) return;
        stopped = true;
        emit AgentStopped();
    }

    /// @inheritdoc IAgentAccount
    function release() external onlyCover {
        if (released) return;
        released = true;
        emit Released();
    }

    // ---------------------------------------------------------------- views

    /// @inheritdoc IAgentAccount
    function rules() external view returns (Rules memory) {
        return _rules;
    }

    /// @inheritdoc IAgentAccount
    function assets() external view returns (address[] memory) {
        return _assets;
    }

    /// @inheritdoc IAgentAccount
    function feeds() external view returns (address[] memory) {
        return _feeds;
    }

    /// @inheritdoc IAgentAccount
    function dayVolume() public view returns (uint256 day, uint256 volume) {
        day = block.timestamp / 1 days;
        volume = day > _day ? 0 : _dayVolume;
    }

    /// @inheritdoc IAgentAccount
    function valuation() external view returns (Valuation memory) {
        return _valuation();
    }

    // ---------------------------------------------------------------- internals

    function _valuation() private view returns (Valuation memory v) {
        v.cash = IERC20(usdg).balanceOf(address(this));
        v.pricesValid = true;
        bool holdsStock = false;
        uint256 n = _assets.length;
        for (uint256 i; i < n; ++i) {
            uint256 bal = IERC20(_assets[i]).balanceOf(address(this));
            if (bal > 0) {
                (int256 answer, uint256 updatedAt) = _read(_feeds[i]);
                if (answer > 0) {
                    // forge-lint: disable-next-line(unsafe-typecast)
                    v.stockValue += PriceMath.usdForStock(bal, uint256(answer)); // answer > 0 checked above
                    if (!holdsStock || updatedAt < v.oldestUpdate) v.oldestUpdate = updatedAt;
                    holdsStock = true;
                } else {
                    v.pricesValid = false;
                }
            }
        }
        v.value = v.cash + v.stockValue;
    }

    function _read(address feed) private view returns (int256 answer, uint256 updatedAt) {
        try IAggregatorV3(feed).latestRoundData() returns (
            uint80 roundId, int256 a, uint256 startedAt, uint256 u, uint80 answeredInRound
        ) {
            // An incomplete or carried-over round is treated as no price.
            if (startedAt > u || answeredInRound < roundId) return (0, 0);
            return (a, u);
        } catch {
            return (0, 0);
        }
    }

    /// @dev Checks every rule in a fixed order and returns the first one broken, or the trade to execute.
    function _plan(address asset, bool isBuy, uint256 usdAmount, uint256 minOut)
        private
        view
        returns (Plan memory p)
    {
        Rules memory r = _rules;
        if (stopped) return _blocked(p, BlockReason.Stopped, 1, 0);
        if (paused) return _blocked(p, BlockReason.Paused, 1, 0);
        if (usdAmount == 0) return _blocked(p, BlockReason.ZeroAmount, 0, 1);

        (bool known, uint256 idx) = _indexOf(asset);
        if (!known || (uint256(r.assetMask) & (1 << idx)) == 0) {
            return _blocked(p, BlockReason.AssetNotAllowed, known ? idx : type(uint256).max, r.assetMask);
        }

        Valuation memory v = _valuation();
        if (_checkPrices(p, v, idx, r.maxPriceAge)) return p;
        if (_size(p, asset, isBuy, usdAmount)) return p;
        if (_checkLimits(p, v, r, isBuy)) return p;
        _checkFill(p, asset, isBuy, minOut, r.maxSlippageBps);
    }

    /// @dev Every price the trade relies on must be valid and fresh: the traded stock's and every held stock's.
    function _checkPrices(Plan memory p, Valuation memory v, uint256 idx, uint32 maxAge)
        private
        view
        returns (bool blocked)
    {
        (int256 answer, uint256 updatedAt) = _read(_feeds[idx]);
        if (!v.pricesValid || answer <= 0) {
            _blocked(p, BlockReason.PriceStale, type(uint256).max, maxAge);
            return true;
        }
        uint256 oldest = updatedAt;
        if (v.oldestUpdate > 0 && v.oldestUpdate < oldest) oldest = v.oldestUpdate;
        uint256 priceAge = PriceMath.age(oldest);
        if (priceAge > maxAge) {
            _blocked(p, BlockReason.PriceStale, priceAge, maxAge);
            return true;
        }
        // forge-lint: disable-next-line(unsafe-typecast)
        p.price = uint256(answer); // answer > 0 checked above
    }

    /// @dev Works out the USDG value of the trade and what goes in: USDG for a buy, stock tokens for a sell.
    function _size(Plan memory p, address asset, bool isBuy, uint256 usdAmount) private view returns (bool blocked) {
        if (isBuy) {
            p.usd = usdAmount;
            p.amountIn = usdAmount;
            return false;
        }
        uint256 bal = IERC20(asset).balanceOf(address(this));
        uint256 holding = PriceMath.usdForStock(bal, p.price);
        if (usdAmount == type(uint256).max) {
            p.amountIn = bal;
            p.usd = holding;
        } else {
            p.amountIn = PriceMath.stockForUsdUp(usdAmount, p.price);
            p.usd = usdAmount;
            if (p.amountIn > bal) {
                _blocked(p, BlockReason.InsufficientStock, usdAmount, holding);
                return true;
            }
        }
        if (p.amountIn > 0) return false;
        _blocked(p, BlockReason.ZeroAmount, 0, 1);
        return true;
    }

    /// @dev Size rules, daily volume, cash, and the cap on how much of the account sits in stocks.
    function _checkLimits(Plan memory p, Valuation memory v, Rules memory r, bool isBuy)
        private
        view
        returns (bool blocked)
    {
        uint256 maxTrade = v.value * r.maxTradeBps / BPS;
        if (p.usd > maxTrade) {
            _blocked(p, BlockReason.TradeTooLarge, p.usd, maxTrade);
            return true;
        }
        (, uint256 traded) = dayVolume();
        uint256 maxDaily = v.value * r.maxDailyBps / BPS;
        if (traded + p.usd > maxDaily) {
            _blocked(p, BlockReason.DailyLimit, traded + p.usd, maxDaily);
            return true;
        }
        if (!isBuy) return false;
        if (p.usd > v.cash) {
            _blocked(p, BlockReason.InsufficientCash, p.usd, v.cash);
            return true;
        }
        uint256 shareAfter = Math.mulDiv(v.stockValue + p.usd, BPS, v.value, Math.Rounding.Ceil);
        if (shareAfter > r.maxStockBps) {
            _blocked(p, BlockReason.StockShare, shareAfter, r.maxStockBps);
            return true;
        }
    }

    /// @dev The venue's fill against the oracle: the spread must be within the slippage rule, the fill must
    ///      meet the agent's own minimum, and the venue must hold enough to pay it.
    function _checkFill(Plan memory p, address asset, bool isBuy, uint256 minOut, uint16 maxSlippageBps) private view {
        uint256 oracleOut;
        uint256 venuePrice;
        uint256 venueUpdatedAt;
        if (isBuy) {
            oracleOut = PriceMath.stockForUsd(p.amountIn, p.price);
            (p.out, venuePrice, venueUpdatedAt) = IOracleVenue(venue).quoteBuy(asset, p.amountIn);
        } else {
            oracleOut = PriceMath.usdForStock(p.amountIn, p.price);
            (p.out, venuePrice, venueUpdatedAt) = IOracleVenue(venue).quoteSell(asset, p.amountIn);
        }
        // The venue reads the same feed in the same block; a different price would mean a different feed.
        if (venuePrice != p.price || venueUpdatedAt > block.timestamp) {
            _blocked(p, BlockReason.PriceStale, venuePrice, p.price);
            return;
        }
        uint256 slip = 0;
        if (oracleOut < 1) slip = BPS;
        else if (p.out < oracleOut) slip = Math.mulDiv(oracleOut - p.out, BPS, oracleOut, Math.Rounding.Ceil);
        if (slip > maxSlippageBps) {
            _blocked(p, BlockReason.Slippage, slip, maxSlippageBps);
            return;
        }
        if (p.out < minOut || p.out == 0) {
            _blocked(p, BlockReason.MinOut, p.out, minOut);
            return;
        }
        uint256 liquidity = IERC20(isBuy ? asset : usdg).balanceOf(venue);
        if (liquidity < p.out) _blocked(p, BlockReason.NoLiquidity, p.out, liquidity);
    }

    function _blocked(Plan memory p, BlockReason reason, uint256 observed, uint256 limit)
        private
        pure
        returns (Plan memory)
    {
        p.blocked = true;
        p.reason = reason;
        p.observed = observed;
        p.limit = limit;
        return p;
    }

    function _indexOf(address asset) private view returns (bool, uint256) {
        uint256 n = _assets.length;
        for (uint256 i; i < n; ++i) {
            if (_assets[i] == asset) return (true, i);
        }
        return (false, 0);
    }

    function _sweep(address token) private {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) {
            IERC20(token).safeTransfer(owner, bal);
            emit Swept(owner, token, bal);
        }
    }
}
