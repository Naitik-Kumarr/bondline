// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Terms, Rules, BlockReason, Valuation, Position, Health, Offer} from "../Types.sol";

/// @notice A Chainlink-compatible feed whose answers are pushed by one fixed keeper address.
interface IMirrorFeed {
    /// @notice Chainlink's standard event, so existing tooling can read it.
    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

    error NotKeeper();
    error InvalidAnswer();
    error TimestampNotNewer(uint256 updatedAt, uint256 latestUpdatedAt);
    error TimestampInFuture(uint256 updatedAt, uint256 blockTimestamp);
    error NoData(uint80 roundId);

    function keeper() external view returns (address);

    function push(int256 answer, uint256 updatedAt) external;
}

/// @notice The demo exchange: fills Bondline accounts at the oracle price, less a fixed spread,
///         from inventory the team supplies. Testnet Stock Tokens have no market.
interface IOracleVenue {
    event Bought(address indexed account, address indexed asset, uint256 usdgIn, uint256 amountOut, uint256 price);
    event Sold(address indexed account, address indexed asset, uint256 amountIn, uint256 usdgOut, uint256 price);

    error NotBondlineAccount(address caller);
    error UnknownAsset(address asset);
    error StalePrice(address asset, uint256 updatedAt);
    error InvalidPrice(address asset);
    error InsufficientOutput(uint256 out, uint256 minOut);
    error ZeroAmount();

    function market() external view returns (address);

    function usdg() external view returns (address);

    function spreadBps() external view returns (uint16);

    function maxPriceAge() external view returns (uint32);

    function feedOf(address asset) external view returns (address);

    /// @return out Stock tokens for `usdgIn`, after the spread.
    /// @return price The oracle price used (8 decimals).
    /// @return updatedAt When that price was published.
    function quoteBuy(address asset, uint256 usdgIn) external view returns (uint256 out, uint256 price, uint256 updatedAt);

    /// @return out USDG for `amountIn` stock tokens, after the spread.
    function quoteSell(address asset, uint256 amountIn)
        external
        view
        returns (uint256 out, uint256 price, uint256 updatedAt);

    function buy(address asset, uint256 usdgIn, uint256 minOut) external returns (uint256 out);

    function sell(address asset, uint256 amountIn, uint256 minOut) external returns (uint256 out);
}

/// @notice One user's covered account. The agent can only trade it, inside fixed rules; only the cover
///         moves money in or out while the cover is active.
interface IAgentAccount {
    /// @notice A trade inside the rules. `decisionHash` is keccak256 of the AI's decision JSON, which is
    ///         in this transaction's input.
    event Traded(
        address indexed asset,
        bool isBuy,
        uint256 usdAmount,
        uint256 amountIn,
        uint256 amountOut,
        uint256 price,
        uint256 valueAfter,
        uint256 stockValueAfter,
        bytes32 indexed decisionHash
    );
    /// @notice A refused trade: nothing changed. `observed` broke `limit` for `reason`.
    event Blocked(
        address indexed asset,
        bool isBuy,
        uint256 usdAmount,
        BlockReason reason,
        uint256 observed,
        uint256 limit,
        bytes32 indexed decisionHash
    );
    event AgentPaused();
    event AgentResumed();
    event AgentStopped();
    event Released();
    event Swept(address indexed to, address indexed token, uint256 amount);

    error NotAgent();
    error NotCover();
    error NotOwner();
    error AlreadyStopped();
    error NotReleased();
    error AlreadyPaused();
    error NotPaused();

    function owner() external view returns (address);

    function agent() external view returns (address);

    function cover() external view returns (address);

    function market() external view returns (address);

    function rules() external view returns (Rules memory);

    function paused() external view returns (bool);

    function stopped() external view returns (bool);

    function released() external view returns (bool);

    function assets() external view returns (address[] memory);

    function feeds() external view returns (address[] memory);

    /// @notice USDG traded so far in the current UTC day.
    function dayVolume() external view returns (uint256 day, uint256 volume);

    /// @notice Cash plus stocks at oracle prices. Never reverts on stale prices; check `oldestUpdate`.
    function valuation() external view returns (Valuation memory);

    /// @notice The agent's only power. Refusals emit `Blocked` and change nothing.
    /// @param usdAmount USDG to spend (buy) or the USDG value to sell; type(uint256).max sells everything.
    /// @param minOut Least stock tokens (buy) or USDG (sell) the agent accepts.
    /// @param decision The AI's decision JSON. Only its hash is stored in the event.
    function trade(address asset, bool isBuy, uint256 usdAmount, uint256 minOut, bytes calldata decision)
        external
        returns (bool executed);

    function pause() external;

    function resume() external;

    /// @notice After a settle or close: the user takes everything (USDG and every stock) out.
    function sweep() external;

    /// @notice After a settle or close: the user takes one token out. Useful if another token is paused.
    function sweepToken(address token) external;

    // Cover only
    function initialize(
        address owner_,
        address agent_,
        address market_,
        address usdg_,
        address venue_,
        address[] calldata assets_,
        address[] calldata feeds_,
        Rules calldata rules_
    ) external;

    function pay(address to, uint256 amount) external;

    function stop() external;

    function release() external;
}

/// @notice One underwriter's bond behind one agent. Covers many accounts.
interface IBondlineCover {
    event Funded(address indexed from, uint256 amount, uint256 bond);
    event BondReleased(address indexed to, uint256 amount, uint256 bond);
    event Opened(address indexed account, address indexed user, uint16 limitBps, Rules rules);
    event Deposited(
        address indexed account, address indexed from, uint256 amount, uint256 fee, uint256 net, uint256 reserveAdded
    );
    event Withdrawn(address indexed account, address indexed user, uint256 amount, uint256 principal, uint256 reserve);
    event Settled(
        address indexed account,
        address indexed user,
        address indexed caller,
        uint256 value,
        uint256 loss,
        uint256 limit,
        uint256 payout
    );
    event Closed(address indexed account, address indexed user);
    event Delisted();

    error NotMarket();
    error NotUnderwriter();
    error NotUser();
    error NotListed();
    error UnknownAccount(address account);
    error NotActive(address account);
    error LimitOutOfRange(uint16 limitBps, uint16 minLimitBps, uint16 maxLimitBps);
    error InvalidRules();
    error DepositTooSmall(uint256 amount, uint256 minimum);
    error InsufficientCapacity(uint256 needed, uint256 free);
    error InsufficientFreeBond(uint256 amount, uint256 free);
    error StalePrices(uint256 oldestUpdate, uint256 maxPriceAge);
    error InvalidPrices();
    error WithinLimit(uint256 loss, uint256 limit);
    error InsufficientCash(uint256 amount, uint256 cash);
    error ZeroAmount();
    error ZeroAddress();

    function market() external view returns (address);

    function underwriter() external view returns (address);

    function agent() external view returns (address);

    function listed() external view returns (bool);

    function terms() external view returns (Terms memory);

    function capBps() external view returns (uint16);

    function bond() external view returns (uint256);

    function reserved() external view returns (uint256);

    /// @notice Bond not reserved for any account's worst case: what can still be sold or released.
    function free() external view returns (uint256);

    /// @notice Lifetime premiums received and claims paid, for dashboards.
    function premiums() external view returns (uint256);

    function claimsPaid() external view returns (uint256);

    function isAccount(address account) external view returns (bool);

    function position(address account) external view returns (Position memory);

    function accountCount() external view returns (uint256);

    function accountAt(uint256 index) external view returns (address);

    function health(address account) external view returns (Health memory);

    /// @notice The bond a deposit of `amount` at `limitBps` would reserve, and its premium.
    function quoteDeposit(uint256 amount, uint16 limitBps)
        external
        view
        returns (uint256 fee, uint256 net, uint256 reserveNeeded);

    function initialize(address underwriter_, Terms calldata terms_) external;

    function fund(uint256 amount) external;

    function release(address to, uint256 amount) external;

    function open(uint16 limitBps, Rules calldata rules, uint256 amount) external returns (address account);

    function deposit(address account, uint256 amount) external;

    function withdraw(address account, uint256 amount) external;

    function settle(address account) external returns (uint256 payout);

    function close(address account) external;

    function delist() external;
}

/// @notice The factory and registry of offers. No owner.
interface IBondlineMarket {
    event OfferCreated(
        uint256 indexed id, address indexed cover, address indexed underwriter, address agent, Terms terms
    );
    event OfferFunded(uint256 indexed id, address indexed underwriter, uint256 bond);
    event OfferDelisted(uint256 indexed id);

    error InvalidTerms();
    error UnknownOffer(uint256 id);
    error NotUnderwriter();
    error ZeroBond();
    error LengthMismatch();
    error TooManyAssets();
    error ZeroAddress();

    function label() external view returns (string memory);

    function usdg() external view returns (address);

    function venue() external view returns (address);

    function coverImplementation() external view returns (address);

    function accountImplementation() external view returns (address);

    function maxPriceAge() external view returns (uint32);

    function capBps() external view returns (uint16);

    function assets() external view returns (address[] memory);

    function feeds() external view returns (address[] memory);

    function offerCount() external view returns (uint256);

    function offer(uint256 id) external view returns (Offer memory);

    function offers() external view returns (Offer[] memory);

    function isOffer(address cover) external view returns (bool);

    function idOf(address cover) external view returns (uint256);

    function capacity(uint256 id) external view returns (uint256);

    function createOffer(Terms calldata terms) external returns (uint256 id, address cover);

    /// @notice One USDG signature, one transaction: pulls `bond` with EIP-3009 from `msg.sender`, creates the
    ///         offer with `msg.sender` as underwriter, and funds it. The market keeps no USDG.
    function createOfferWithAuthorization(
        Terms calldata terms,
        uint256 bond,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 id, address cover);

    function delist(uint256 id) external;
}
