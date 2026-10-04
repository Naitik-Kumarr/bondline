// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MirrorFeed} from "../src/MirrorFeed.sol";
import {IMirrorFeed} from "../src/interfaces/IBondline.sol";

contract MirrorFeedTest is Test {
    MirrorFeed internal feed;
    address internal keeper = makeAddr("keeper");

    function setUp() public {
        vm.warp(1_790_000_000);
        feed = new MirrorFeed(keeper, 8, "TSLA / USD");
    }

    function test_metadata() public view {
        assertEq(feed.keeper(), keeper);
        assertEq(feed.decimals(), 8);
        assertEq(feed.description(), "TSLA / USD");
        assertEq(feed.version(), 1);
        assertEq(feed.latestRound(), 0);
    }

    function test_constructor_rejectsZeroKeeper() public {
        vm.expectRevert(IMirrorFeed.NotKeeper.selector);
        new MirrorFeed(address(0), 8, "x");
    }

    function test_latestRoundData_isZeroBeforeFirstPush() public view {
        (uint80 id, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        assertEq(id, 0);
        assertEq(answer, 0);
        assertEq(updatedAt, 0);
    }

    function test_push_storesRoundAndEmits() public {
        vm.expectEmit(true, true, false, true, address(feed));
        emit IMirrorFeed.AnswerUpdated(370_45000000, 1, block.timestamp - 10);
        vm.prank(keeper);
        feed.push(370_45000000, block.timestamp - 10);

        (uint80 id, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
            feed.latestRoundData();
        assertEq(id, 1);
        assertEq(answer, 370_45000000);
        assertEq(startedAt, block.timestamp - 10);
        assertEq(updatedAt, block.timestamp - 10);
        assertEq(answeredInRound, 1);

        vm.warp(block.timestamp + 5);
        vm.prank(keeper);
        feed.push(371e8, block.timestamp);
        (id, answer,,,) = feed.getRoundData(1);
        assertEq(answer, 370_45000000);
        (id, answer,,,) = feed.getRoundData(2);
        assertEq(id, 2);
        assertEq(answer, 371e8);
    }

    function test_push_onlyKeeper() public {
        vm.expectRevert(IMirrorFeed.NotKeeper.selector);
        feed.push(1e8, block.timestamp);
    }

    function test_push_rejectsNonPositive() public {
        vm.startPrank(keeper);
        vm.expectRevert(IMirrorFeed.InvalidAnswer.selector);
        feed.push(0, block.timestamp);
        vm.expectRevert(IMirrorFeed.InvalidAnswer.selector);
        feed.push(-1, block.timestamp);
        vm.stopPrank();
    }

    function test_push_rejectsFutureTimestamp() public {
        vm.prank(keeper);
        vm.expectRevert(
            abi.encodeWithSelector(IMirrorFeed.TimestampInFuture.selector, block.timestamp + 1, block.timestamp)
        );
        feed.push(1e8, block.timestamp + 1);
    }

    function test_push_rejectsOlderOrEqualTimestamp() public {
        vm.startPrank(keeper);
        feed.push(1e8, block.timestamp);
        vm.expectRevert(
            abi.encodeWithSelector(IMirrorFeed.TimestampNotNewer.selector, block.timestamp, block.timestamp)
        );
        feed.push(2e8, block.timestamp);
        vm.expectRevert(
            abi.encodeWithSelector(IMirrorFeed.TimestampNotNewer.selector, block.timestamp - 1, block.timestamp)
        );
        feed.push(2e8, block.timestamp - 1);
        vm.stopPrank();
    }

    function test_getRoundData_unknownRound() public {
        vm.expectRevert(abi.encodeWithSelector(IMirrorFeed.NoData.selector, uint80(0)));
        feed.getRoundData(0);
        vm.expectRevert(abi.encodeWithSelector(IMirrorFeed.NoData.selector, uint80(1)));
        feed.getRoundData(1);
    }

    function testFuzz_push_monotonic(int256 answer, uint32 dt) public {
        answer = bound(answer, 1, type(int128).max);
        dt = uint32(bound(dt, 1, 30 days));
        vm.startPrank(keeper);
        feed.push(answer, block.timestamp);
        vm.warp(block.timestamp + dt);
        feed.push(answer + 1, block.timestamp);
        vm.stopPrank();
        (uint80 id, int256 latest,, uint256 updatedAt,) = feed.latestRoundData();
        assertEq(id, 2);
        assertEq(latest, answer + 1);
        assertEq(updatedAt, block.timestamp);
    }
}
