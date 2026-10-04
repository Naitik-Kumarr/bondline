// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {IOracleVenue, IAgentAccount, IBondlineCover, IBondlineMarket} from "./interfaces/IBondline.sol";
import {PriceMath} from "./libraries/PriceMath.sol";

/// @title OracleVenue
/// @notice The demo exchange. Testnet Stock Tokens have no market, so this fills Bondline accounts at the
///         oracle price, less a fixed spread, from inventory the team supplies.
/// @dev Deployed by its market, which it trusts to say which covers are real. Only accounts those covers
///      created may trade: anyone else could front-run the public replay prices and drain the inventory.
///      There is no admin and no withdrawal: inventory leaves only through trades.
contract OracleVenue is IOracleVenue, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;

    /// @inheritdoc IOracleVenue
    address public immutable market;
    /// @inheritdoc IOracleVenue
    address public immutable usdg;
    /// @inheritdoc IOracleVenue
    uint16 public immutable spreadBps;
    /// @inheritdoc IOracleVenue
    uint32 public immutable maxPriceAge;

    /// @inheritdoc IOracleVenue
    mapping(address asset => address feed) public feedOf;

    /// @dev Called by the market's constructor, so `msg.sender` is the market.
    constructor(
        address usdg_,
        address[] memory assets_,
        address[] memory feeds_,
        uint16 spreadBps_,
        uint32 maxPriceAge_
    ) {
        market = msg.sender;
        usdg = usdg_;
        spreadBps = spreadBps_;
        maxPriceAge = maxPriceAge_;
        for (uint256 i; i < assets_.length; ++i) {
            feedOf[assets_[i]] = feeds_[i];
        }
    }

    modifier onlyAccount() {
        _checkAccount(msg.sender);
        _;
    }

    /// @inheritdoc IOracleVenue
    function quoteBuy(address asset, uint256 usdgIn)
        public
        view
        returns (uint256 out, uint256 price, uint256 updatedAt)
    {
        (price, updatedAt) = _price(asset);
        out = PriceMath.stockForUsd(usdgIn, price) * (BPS - spreadBps) / BPS;
    }

    /// @inheritdoc IOracleVenue
    function quoteSell(address asset, uint256 amountIn)
        public
        view
        returns (uint256 out, uint256 price, uint256 updatedAt)
    {
        (price, updatedAt) = _price(asset);
        out = PriceMath.usdForStock(amountIn, price) * (BPS - spreadBps) / BPS;
    }

    /// @inheritdoc IOracleVenue
    function buy(address asset, uint256 usdgIn, uint256 minOut) external nonReentrant onlyAccount returns (uint256 out) {
        if (usdgIn == 0) revert ZeroAmount();
        uint256 price;
        (out, price,) = quoteBuy(asset, usdgIn);
        if (out < minOut || out == 0) revert InsufficientOutput(out, minOut);
        IERC20(usdg).safeTransferFrom(msg.sender, address(this), usdgIn);
        IERC20(asset).safeTransfer(msg.sender, out);
        emit Bought(msg.sender, asset, usdgIn, out, price);
    }

    /// @inheritdoc IOracleVenue
    function sell(address asset, uint256 amountIn, uint256 minOut) external nonReentrant onlyAccount returns (uint256 out) {
        if (amountIn == 0) revert ZeroAmount();
        uint256 price;
        (out, price,) = quoteSell(asset, amountIn);
        if (out < minOut || out == 0) revert InsufficientOutput(out, minOut);
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(usdg).safeTransfer(msg.sender, out);
        emit Sold(msg.sender, asset, amountIn, out, price);
    }

    function _price(address asset) private view returns (uint256 price, uint256 updatedAt) {
        address feed = feedOf[asset];
        if (feed == address(0)) revert UnknownAsset(asset);
        (uint80 roundId, int256 answer, uint256 startedAt, uint256 updated, uint80 answeredInRound) =
            IAggregatorV3(feed).latestRoundData();
        updatedAt = updated;
        if (answer <= 0 || startedAt > updated || answeredInRound < roundId) revert InvalidPrice(asset);
        if (PriceMath.age(updatedAt) > maxPriceAge) revert StalePrice(asset, updatedAt);
        // forge-lint: disable-next-line(unsafe-typecast)
        price = uint256(answer); // answer > 0 checked above
    }

    /// @dev A Bondline account is one a market-registered cover created. Uses a raw static call so an
    ///      address without code, or with the wrong return shape, gets a clean revert.
    function _checkAccount(address caller) private view {
        (bool ok, bytes memory data) = caller.staticcall(abi.encodeCall(IAgentAccount.cover, ()));
        if (!ok || data.length != 32) revert NotBondlineAccount(caller);
        address cover = abi.decode(data, (address));
        if (!IBondlineMarket(market).isOffer(cover) || !IBondlineCover(cover).isAccount(caller)) {
            revert NotBondlineAccount(caller);
        }
    }
}
