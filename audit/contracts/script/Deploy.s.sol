// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";

import {MirrorFeed} from "../src/MirrorFeed.sol";
import {AgentAccount} from "../src/AgentAccount.sol";
import {BondlineCover} from "../src/BondlineCover.sol";
import {BondlineMarket} from "../src/BondlineMarket.sol";
import {MockUSDG} from "../test/mocks/MockUSDG.sol";
import {MockStock} from "../test/mocks/MockStock.sol";

/// @notice Deploys Bondline: four keeper-pushed feeds (live and replay, TSLA and AMZN), the two clone
///         implementations, and the Live and Replay markets (each deploys its own demo exchange).
///
///         Env: DEPLOYER_PRIVATE_KEY, KEEPER_PRIVATE_KEY (only its address is used, except LOCAL=true),
///         USDG / TSLA / AMZN (testnet addresses), LIVE_MAX_PRICE_AGE (default 90000: Chainlink's 24h
///         heartbeat plus an hour), REPLAY_MAX_PRICE_AGE (default 300), SPREAD_BPS (default 10).
///         LOCAL=true deploys mocks for USDG and the stocks, seeds balances, stocks the venues and pushes a
///         first price on every feed, for a local Anvil chain.
///
///         Writes deployments/raw-<chainId>.json; scripts/sync-deployment.mjs merges it into the record.
contract Deploy is Script {
    struct Deployed {
        address usdg;
        address tsla;
        address amzn;
        address tslaLive;
        address amznLive;
        address tslaReplay;
        address amznReplay;
        address accountImpl;
        address coverImpl;
        address live;
        address replay;
    }

    function run() external returns (Deployed memory d) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 keeperKey = vm.envUint("KEEPER_PRIVATE_KEY");
        address keeper = vm.addr(keeperKey);
        bool local = vm.envOr("LOCAL", false);
        uint32 liveMaxAge = uint32(vm.envOr("LIVE_MAX_PRICE_AGE", uint256(90_000)));
        uint32 replayMaxAge = uint32(vm.envOr("REPLAY_MAX_PRICE_AGE", uint256(300)));
        uint16 spread = uint16(vm.envOr("SPREAD_BPS", uint256(10)));

        vm.startBroadcast(deployerKey);
        if (local) {
            d.usdg = address(new MockUSDG());
            d.tsla = address(new MockStock("Tesla", "TSLA"));
            d.amzn = address(new MockStock("Amazon", "AMZN"));
        } else {
            d.usdg = vm.envAddress("USDG");
            d.tsla = vm.envAddress("TSLA");
            d.amzn = vm.envAddress("AMZN");
        }

        d.tslaLive = address(new MirrorFeed(keeper, 8, "TSLA / USD - live mirror of Chainlink on Robinhood Chain mainnet"));
        d.amznLive = address(new MirrorFeed(keeper, 8, "AMZN / USD - live mirror of Chainlink on Robinhood Chain mainnet"));
        d.tslaReplay = address(new MirrorFeed(keeper, 8, "TSLA / USD - replay of Chainlink, 28 Sep - 2 Oct 2026, sped up"));
        d.amznReplay = address(new MirrorFeed(keeper, 8, "AMZN / USD - replay of Chainlink, 28 Sep - 2 Oct 2026, sped up"));

        d.accountImpl = address(new AgentAccount());
        d.coverImpl = address(new BondlineCover());

        address[] memory assets = new address[](2);
        assets[0] = d.tsla;
        assets[1] = d.amzn;
        address[] memory liveFeeds = new address[](2);
        liveFeeds[0] = d.tslaLive;
        liveFeeds[1] = d.amznLive;
        address[] memory replayFeeds = new address[](2);
        replayFeeds[0] = d.tslaReplay;
        replayFeeds[1] = d.amznReplay;

        d.live = address(new BondlineMarket(d.usdg, d.coverImpl, d.accountImpl, assets, liveFeeds, liveMaxAge, spread, "Live"));
        d.replay = address(
            new BondlineMarket(d.usdg, d.coverImpl, d.accountImpl, assets, replayFeeds, replayMaxAge, spread, "Replay")
        );

        if (local) _seedLocal(d, vm.addr(deployerKey));
        vm.stopBroadcast();

        if (local) {
            vm.startBroadcast(keeperKey);
            MirrorFeed(d.tslaLive).push(370_45000000, block.timestamp);
            MirrorFeed(d.amznLive).push(251_65000000, block.timestamp);
            MirrorFeed(d.tslaReplay).push(372_90000000, block.timestamp);
            MirrorFeed(d.amznReplay).push(248_97000000, block.timestamp);
            vm.stopBroadcast();
        }

        _write(d, liveMaxAge, replayMaxAge, spread);
    }

    /// @dev Local only: 1M USDG and 10k of each stock to the deployer, and each demo exchange stocked.
    function _seedLocal(Deployed memory d, address deployer) private {
        MockUSDG(d.usdg).mint(deployer, 1_000_000e6);
        MockStock(d.tsla).mint(deployer, 10_000e18);
        MockStock(d.amzn).mint(deployer, 10_000e18);
        address[2] memory venues = [BondlineMarket(d.live).venue(), BondlineMarket(d.replay).venue()];
        for (uint256 i; i < 2; ++i) {
            MockUSDG(d.usdg).mint(venues[i], 200_000e6);
            MockStock(d.tsla).mint(venues[i], 1_000e18);
            MockStock(d.amzn).mint(venues[i], 1_000e18);
        }
    }

    function _write(Deployed memory d, uint32 liveMaxAge, uint32 replayMaxAge, uint16 spread) private {
        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "block", block.number);
        vm.serializeUint(o, "timestamp", block.timestamp);
        vm.serializeAddress(o, "usdg", d.usdg);
        vm.serializeAddress(o, "tsla", d.tsla);
        vm.serializeAddress(o, "amzn", d.amzn);
        vm.serializeAddress(o, "tslaLiveFeed", d.tslaLive);
        vm.serializeAddress(o, "amznLiveFeed", d.amznLive);
        vm.serializeAddress(o, "tslaReplayFeed", d.tslaReplay);
        vm.serializeAddress(o, "amznReplayFeed", d.amznReplay);
        vm.serializeAddress(o, "accountImplementation", d.accountImpl);
        vm.serializeAddress(o, "coverImplementation", d.coverImpl);
        vm.serializeAddress(o, "liveMarket", d.live);
        vm.serializeAddress(o, "liveVenue", BondlineMarket(d.live).venue());
        vm.serializeAddress(o, "replayMarket", d.replay);
        vm.serializeAddress(o, "replayVenue", BondlineMarket(d.replay).venue());
        vm.serializeUint(o, "liveMaxPriceAge", liveMaxAge);
        vm.serializeUint(o, "replayMaxPriceAge", replayMaxAge);
        string memory json = vm.serializeUint(o, "spreadBps", spread);
        string memory path = string.concat(vm.projectRoot(), "/../deployments/raw-", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console.log("wrote", path);
        console.log("live market", d.live);
        console.log("replay market", d.replay);
    }
}
