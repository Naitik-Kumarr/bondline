// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice An underwriter's terms for one offer, fixed when the offer is created.
struct Terms {
    /// @dev The only address allowed to trade accounts covered by this offer.
    address agent;
    /// @dev Smallest loss limit a buyer may choose, in basis points of principal.
    uint16 minLimitBps;
    /// @dev Largest loss limit a buyer may choose. Must be below the 30% cap.
    uint16 maxLimitBps;
    /// @dev Premium taken from every deposit, in basis points. At most 500 (5%).
    uint16 feeBps;
    /// @dev The most of a covered account that may sit in stocks. A buyer's rules may be stricter.
    uint16 maxStockBps;
    /// @dev Display name of the offer.
    string name;
}

/// @notice The rules a covered account's agent can't break. Fixed when the cover opens.
struct Rules {
    /// @dev Bit i set means the market's asset i may be traded.
    uint8 assetMask;
    /// @dev Most of the account's value that may sit in stocks after a buy, in basis points.
    uint16 maxStockBps;
    /// @dev Largest single trade, in basis points of account value.
    uint16 maxTradeBps;
    /// @dev Most that may be traded per day, in basis points of account value.
    uint32 maxDailyBps;
    /// @dev Largest shortfall of a fill against the oracle price, in basis points.
    uint16 maxSlippageBps;
    /// @dev Oldest price a trade may rely on, in seconds.
    uint32 maxPriceAge;
}

/// @notice Lifecycle of one covered account.
enum CoverStatus {
    None,
    Active,
    Settled,
    Closed
}

/// @notice Why a trade was refused. Every refusal is emitted as a receipt and changes nothing.
enum BlockReason {
    Stopped,
    Paused,
    ZeroAmount,
    AssetNotAllowed,
    PriceStale,
    TradeTooLarge,
    DailyLimit,
    InsufficientCash,
    InsufficientStock,
    StockShare,
    Slippage,
    MinOut,
    NoLiquidity
}

/// @notice A covered account's value at oracle prices, in USDG units (6 decimals).
struct Valuation {
    uint256 value;
    uint256 cash;
    uint256 stockValue;
    /// @dev Oldest `updatedAt` among the prices of stocks the account holds; 0 if it holds none.
    uint256 oldestUpdate;
    /// @dev False if a held stock's price is missing or not positive.
    bool pricesValid;
}

/// @notice The cover's book entry for one covered account.
struct Position {
    address user;
    uint16 limitBps;
    CoverStatus status;
    /// @dev Net USDG deposited, scaled down by withdrawals.
    uint256 principal;
    /// @dev USDG reserved from the bond for this account's worst case.
    uint256 reserve;
}

/// @notice Everything a dashboard or keeper needs about one covered account.
struct Health {
    CoverStatus status;
    /// @dev True if every held stock's price is valid and within the market's max price age.
    bool fresh;
    /// @dev True if `settle` would succeed right now.
    bool settleable;
    uint16 limitBps;
    uint256 principal;
    uint256 value;
    uint256 stockValue;
    uint256 loss;
    /// @dev The loss limit in USDG: principal x limitBps / 10000, rounded up.
    uint256 limit;
    /// @dev What `settle` would pay right now; 0 unless settleable.
    uint256 payoutNow;
    uint256 reserve;
}

/// @notice A market's registry entry for one offer.
struct Offer {
    address cover;
    address underwriter;
    address agent;
    bool listed;
}
