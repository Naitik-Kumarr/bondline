// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {Terms, Rules, CoverStatus, Valuation, Position, Health} from "./Types.sol";
import {IBondlineCover, IBondlineMarket, IAgentAccount} from "./interfaces/IBondline.sol";
import {PriceMath} from "./libraries/PriceMath.sol";

/// @title BondlineCover
/// @notice One underwriter's USDG bond behind one agent, created as a clone by a `BondlineMarket`.
///
///         What the cover pays: the moment a covered account's loss passes its limit, anyone may `settle` it at
///         fresh prices. Settling stops the agent and pays, once, from the bond to the user:
///             min(loss - limit, principal x (cap - limit) / 10000)
///         so the user is made whole down to their limit, up to a 30% drop. The stocks stay in the account.
///
///         The bond is always enough: every deposit reserves its worst case, net x (cap - limit) / 10000
///         (rounded up), and is refused unless the free bond already covers it. The underwriter can release
///         only free bond and can't block a payout.
contract BondlineCover is IBondlineCover, Initializable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;

    /// @notice Smallest deposit, 1 USDG, so every deposit pays a real premium and dust can't clutter the book.
    uint256 public constant MIN_DEPOSIT = 1e6;
    /// @notice Largest slippage rule a buyer may set.
    uint16 public constant MAX_SLIPPAGE_BPS = 500;
    /// @notice Largest daily-volume rule a buyer may set: 10x the account's value.
    uint32 public constant MAX_DAILY_BPS = 100_000;

    /// @inheritdoc IBondlineCover
    address public market;
    /// @inheritdoc IBondlineCover
    address public underwriter;
    address public usdg;
    address public accountImplementation;
    /// @inheritdoc IBondlineCover
    uint16 public capBps;
    uint32 public maxPriceAge;
    /// @inheritdoc IBondlineCover
    bool public listed;

    Terms private _terms;

    /// @inheritdoc IBondlineCover
    uint256 public bond;
    /// @inheritdoc IBondlineCover
    uint256 public reserved;
    /// @inheritdoc IBondlineCover
    uint256 public premiums;
    /// @inheritdoc IBondlineCover
    uint256 public claimsPaid;

    mapping(address account => Position) private _positions;
    address[] private _accounts;

    modifier onlyUser(address account) {
        Position storage pos = _positions[account];
        if (pos.status == CoverStatus.None) revert UnknownAccount(account);
        if (msg.sender != pos.user) revert NotUser();
        _;
    }

    constructor() {
        _disableInitializers();
    }

    /// @inheritdoc IBondlineCover
    /// @dev Called by the market in the same transaction that clones this cover. The market validates `terms_`.
    function initialize(address underwriter_, Terms calldata terms_) external initializer {
        if (underwriter_ == address(0) || terms_.agent == address(0)) revert ZeroAddress();
        IBondlineMarket m = IBondlineMarket(msg.sender);
        market = msg.sender;
        underwriter = underwriter_;
        usdg = m.usdg();
        accountImplementation = m.accountImplementation();
        capBps = m.capBps();
        maxPriceAge = m.maxPriceAge();
        _terms = terms_;
        listed = true;
    }

    // ---------------------------------------------------------------- bond

    /// @inheritdoc IBondlineCover
    /// @dev Anyone may add to the bond. It then belongs to the underwriter's offer.
    function fund(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        bond += amount;
        IERC20(usdg).safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount, bond);
    }

    /// @inheritdoc IBondlineCover
    function release(address to, uint256 amount) external nonReentrant {
        if (msg.sender != underwriter) revert NotUnderwriter();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 available = bond - reserved;
        if (amount > available) revert InsufficientFreeBond(amount, available);
        bond -= amount;
        IERC20(usdg).safeTransfer(to, amount);
        emit BondReleased(to, amount, bond);
    }

    /// @inheritdoc IBondlineCover
    function delist() external {
        if (msg.sender != market) revert NotMarket();
        if (!listed) return;
        listed = false;
        emit Delisted();
    }

    // ---------------------------------------------------------------- cover

    /// @inheritdoc IBondlineCover
    function open(uint16 limitBps, Rules calldata rules, uint256 amount)
        external
        nonReentrant
        returns (address account)
    {
        if (!listed) revert NotListed();
        Terms storage t = _terms;
        if (limitBps < t.minLimitBps || limitBps > t.maxLimitBps) {
            revert LimitOutOfRange(limitBps, t.minLimitBps, t.maxLimitBps);
        }
        IBondlineMarket m = IBondlineMarket(market);
        address[] memory assets_ = m.assets();
        if (!_validRules(rules, assets_.length, t.maxStockBps)) revert InvalidRules();

        account = Clones.clone(accountImplementation);
        IAgentAccount(account).initialize(msg.sender, t.agent, market, usdg, m.venue(), assets_, m.feeds(), rules);

        _positions[account] =
            Position({user: msg.sender, limitBps: limitBps, status: CoverStatus.Active, principal: 0, reserve: 0});
        _accounts.push(account);
        emit Opened(account, msg.sender, limitBps, rules);

        _deposit(account, amount);
    }

    /// @inheritdoc IBondlineCover
    /// @dev Anyone may add money to an active cover; only its user can take money out.
    function deposit(address account, uint256 amount) external nonReentrant {
        _deposit(account, amount);
    }

    /// @inheritdoc IBondlineCover
    /// @dev Needs fresh prices. The principal shrinks by the share of value taken out, so the loss ratio, and
    ///      the payout it implies, can't grow by withdrawing. The reserve shrinks to the new worst case.
    function withdraw(address account, uint256 amount) external nonReentrant onlyUser(account) {
        Position storage pos = _positions[account];
        if (pos.status != CoverStatus.Active) revert NotActive(account);
        if (amount == 0) revert ZeroAmount();

        Valuation memory v = _freshValuation(account);
        if (amount > v.cash) revert InsufficientCash(amount, v.cash);

        uint256 principal = Math.mulDiv(pos.principal, v.value - amount, v.value);
        uint256 reserve = _worstCase(principal, pos.limitBps);
        reserved -= pos.reserve - reserve;
        pos.reserve = reserve;
        pos.principal = principal;

        IAgentAccount(account).pay(msg.sender, amount);
        emit Withdrawn(account, msg.sender, amount, principal, reserve);
    }

    /// @inheritdoc IBondlineCover
    function settle(address account) external nonReentrant returns (uint256 payout) {
        Position storage pos = _positions[account];
        if (pos.status == CoverStatus.None) revert UnknownAccount(account);
        if (pos.status != CoverStatus.Active) revert NotActive(account);

        Valuation memory v = _freshValuation(account);
        uint256 limit = _limit(pos.principal, pos.limitBps);
        uint256 loss = pos.principal > v.value ? pos.principal - v.value : 0;
        if (loss <= limit) revert WithinLimit(loss, limit);
        payout = Math.min(loss - limit, pos.principal * (capBps - pos.limitBps) / BPS);

        pos.status = CoverStatus.Settled;
        reserved -= pos.reserve;
        pos.reserve = 0;
        bond -= payout;
        claimsPaid += payout;

        IAgentAccount(account).stop();
        IAgentAccount(account).release();
        IERC20(usdg).safeTransfer(pos.user, payout);
        emit Settled(account, pos.user, msg.sender, v.value, loss, limit, payout);
    }

    /// @inheritdoc IBondlineCover
    /// @dev Works at any price and moves no tokens, so it works even if USDG is paused or the user is frozen.
    function close(address account) external nonReentrant onlyUser(account) {
        Position storage pos = _positions[account];
        if (pos.status != CoverStatus.Active) revert NotActive(account);
        pos.status = CoverStatus.Closed;
        reserved -= pos.reserve;
        pos.reserve = 0;
        IAgentAccount(account).stop();
        IAgentAccount(account).release();
        emit Closed(account, msg.sender);
    }

    // ---------------------------------------------------------------- views

    /// @inheritdoc IBondlineCover
    function agent() external view returns (address) {
        return _terms.agent;
    }

    /// @inheritdoc IBondlineCover
    function terms() external view returns (Terms memory) {
        return _terms;
    }

    /// @inheritdoc IBondlineCover
    function free() public view returns (uint256) {
        return bond - reserved;
    }

    /// @inheritdoc IBondlineCover
    function isAccount(address account) external view returns (bool) {
        return _positions[account].status != CoverStatus.None;
    }

    /// @inheritdoc IBondlineCover
    function position(address account) external view returns (Position memory) {
        return _positions[account];
    }

    /// @inheritdoc IBondlineCover
    function accountCount() external view returns (uint256) {
        return _accounts.length;
    }

    /// @inheritdoc IBondlineCover
    function accountAt(uint256 index) external view returns (address) {
        return _accounts[index];
    }

    /// @inheritdoc IBondlineCover
    function health(address account) external view returns (Health memory h) {
        Position memory pos = _positions[account];
        h.status = pos.status;
        h.limitBps = pos.limitBps;
        h.principal = pos.principal;
        h.reserve = pos.reserve;
        if (pos.status == CoverStatus.None) return h;

        Valuation memory v = IAgentAccount(account).valuation();
        h.value = v.value;
        h.stockValue = v.stockValue;
        h.fresh = _isFresh(v);
        h.limit = _limit(pos.principal, pos.limitBps);
        h.loss = pos.principal > v.value ? pos.principal - v.value : 0;
        if (pos.status == CoverStatus.Active && h.fresh && h.loss > h.limit) {
            h.settleable = true;
            h.payoutNow = Math.min(h.loss - h.limit, pos.principal * (capBps - pos.limitBps) / BPS);
        }
    }

    /// @inheritdoc IBondlineCover
    function quoteDeposit(uint256 amount, uint16 limitBps)
        external
        view
        returns (uint256 fee, uint256 net, uint256 reserveNeeded)
    {
        fee = amount * _terms.feeBps / BPS;
        net = amount - fee;
        reserveNeeded = _worstCase(net, limitBps);
    }

    // ---------------------------------------------------------------- internals

    function _deposit(address account, uint256 amount) private {
        Position storage pos = _positions[account];
        if (pos.status == CoverStatus.None) revert UnknownAccount(account);
        if (pos.status != CoverStatus.Active) revert NotActive(account);
        if (!listed) revert NotListed();
        if (amount < MIN_DEPOSIT) revert DepositTooSmall(amount, MIN_DEPOSIT);

        uint256 fee = amount * _terms.feeBps / BPS;
        uint256 net = amount - fee;
        uint256 reserveAdded = _worstCase(net, pos.limitBps);

        // The premium joins the bond first; then the free bond must cover this deposit's worst case.
        bond += fee;
        premiums += fee;
        uint256 available = bond - reserved;
        if (reserveAdded > available) revert InsufficientCapacity(reserveAdded, available);
        reserved += reserveAdded;
        pos.reserve += reserveAdded;
        pos.principal += net;

        IERC20(usdg).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(usdg).safeTransfer(account, net);
        emit Deposited(account, msg.sender, amount, fee, net, reserveAdded);
    }

    function _freshValuation(address account) private view returns (Valuation memory v) {
        v = IAgentAccount(account).valuation();
        if (!v.pricesValid) revert InvalidPrices();
        if (!_isFresh(v)) revert StalePrices(v.oldestUpdate, maxPriceAge);
    }

    /// @dev Fresh if every held stock's price is valid and within the market's max age. Cash alone is fresh.
    function _isFresh(Valuation memory v) private view returns (bool) {
        if (!v.pricesValid) return false;
        if (v.oldestUpdate == 0) return v.stockValue == 0;
        return PriceMath.age(v.oldestUpdate) <= maxPriceAge;
    }

    /// @dev The loss limit in USDG, rounded up so the user's limit is never shaved.
    function _limit(uint256 principal, uint16 limitBps) private pure returns (uint256) {
        return Math.mulDiv(principal, limitBps, BPS, Math.Rounding.Ceil);
    }

    /// @dev The most `settle` can ever pay on `principal`, rounded up so the reserve always covers it.
    function _worstCase(uint256 principal, uint16 limitBps) private view returns (uint256) {
        return Math.mulDiv(principal, capBps - limitBps, BPS, Math.Rounding.Ceil);
    }

    function _validRules(Rules calldata r, uint256 assetCount, uint16 offerMaxStockBps) private view returns (bool) {
        if (r.assetMask == 0 || uint256(r.assetMask) >= (1 << assetCount)) return false;
        if (r.maxStockBps > offerMaxStockBps) return false;
        if (r.maxTradeBps == 0 || r.maxTradeBps > BPS) return false;
        if (r.maxDailyBps == 0 || r.maxDailyBps > MAX_DAILY_BPS) return false;
        if (r.maxSlippageBps > MAX_SLIPPAGE_BPS) return false;
        if (r.maxPriceAge == 0 || r.maxPriceAge > maxPriceAge) return false;
        return true;
    }
}
