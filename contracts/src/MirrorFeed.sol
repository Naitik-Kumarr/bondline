// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {IMirrorFeed} from "./interfaces/IBondline.sol";

/// @title MirrorFeed
/// @notice A Chainlink-compatible price feed whose answers are pushed by one fixed keeper address.
/// @dev Robinhood Chain testnet has no Chainlink stock feeds, so Bondline runs two kinds of this feed:
///      - live feeds copy Chainlink's TSLA/USD and AMZN/USD answers from Robinhood Chain mainnet, with their
///        real timestamps, so a weekend price stays stale exactly as it is on mainnet;
///      - replay feeds replay those answers from a past week, sped up, with fresh timestamps.
///      The keeper is a stated trust assumption: it can't move anyone's money, but it sets the price.
contract MirrorFeed is IAggregatorV3, IMirrorFeed {
    struct Round {
        int256 answer;
        uint256 updatedAt;
    }

    /// @inheritdoc IMirrorFeed
    address public immutable keeper;

    uint8 private immutable _decimals;
    string private _description;

    /// @notice Id of the most recent round; 0 before the first push.
    uint80 public latestRound;

    mapping(uint80 roundId => Round) private _rounds;

    /// @param keeper_ The only address that may push answers. Fixed forever.
    /// @param decimals_ Decimals of every answer (Chainlink's stock feeds use 8).
    /// @param description_ What this feed is, e.g. "TSLA / USD (live mirror)".
    constructor(address keeper_, uint8 decimals_, string memory description_) {
        if (keeper_ == address(0)) revert NotKeeper();
        keeper = keeper_;
        _decimals = decimals_;
        _description = description_;
    }

    /// @inheritdoc IMirrorFeed
    /// @dev Timestamps must strictly increase and can't be in the future, so a keeper can't make an old
    ///      price look fresh by re-pushing it with an earlier time, or freeze a future one.
    function push(int256 answer, uint256 updatedAt) external {
        if (msg.sender != keeper) revert NotKeeper();
        if (answer <= 0) revert InvalidAnswer();
        if (updatedAt > block.timestamp) revert TimestampInFuture(updatedAt, block.timestamp);
        uint256 last = _rounds[latestRound].updatedAt;
        if (updatedAt <= last) revert TimestampNotNewer(updatedAt, last);

        uint80 roundId = latestRound + 1;
        latestRound = roundId;
        _rounds[roundId] = Round({answer: answer, updatedAt: updatedAt});
        emit AnswerUpdated(answer, roundId, updatedAt);
    }

    /// @inheritdoc IAggregatorV3
    function decimals() external view returns (uint8) {
        return _decimals;
    }

    /// @inheritdoc IAggregatorV3
    function description() external view returns (string memory) {
        return _description;
    }

    /// @inheritdoc IAggregatorV3
    function version() external pure returns (uint256) {
        return 1;
    }

    /// @inheritdoc IAggregatorV3
    function getRoundData(uint80 roundId)
        external
        view
        returns (uint80, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        if (roundId == 0 || roundId > latestRound) revert NoData(roundId);
        Round memory r = _rounds[roundId];
        return (roundId, r.answer, r.updatedAt, r.updatedAt, roundId);
    }

    /// @inheritdoc IAggregatorV3
    /// @dev Before the first push this returns zeros; consumers treat a non-positive answer as invalid.
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        roundId = latestRound;
        Round memory r = _rounds[roundId];
        return (roundId, r.answer, r.updatedAt, r.updatedAt, roundId);
    }
}
