// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Position} from "../src/Types.sol";
import {AgentAccount} from "../src/AgentAccount.sol";
import {BondlineCover} from "../src/BondlineCover.sol";
import {BaseTest} from "./Base.t.sol";

/// @notice quoteDeposit must quote exactly what a deposit charges, odd amounts included. Without this, a quote that
///         rounds the fee differently from the deposit passed the whole suite (an independent verifier's hand-made
///         mutant at BondlineCover.quoteDeposit did).
contract QuoteDepositTest is BaseTest {
    function testFuzz_quoteDeposit_matchesTheRealDeposit(uint256 amount, uint16 limitBps) public {
        amount = bound(amount, 1e6, 2000e6);
        limitBps = uint16(bound(limitBps, 500, 2000));
        BondlineCover cover = _offer(_terms(), 10_000e6);

        (uint256 fee, uint256 net, uint256 reserveNeeded) = cover.quoteDeposit(amount, limitBps);
        AgentAccount acct = _open(cover, limitBps, amount);

        Position memory p = cover.position(address(acct));
        assertEq(cover.premiums(), fee, "fee");
        assertEq(p.principal, net, "net");
        assertEq(p.reserve, reserveNeeded, "reserve");
        assertEq(usdg.balanceOf(address(acct)), net, "account funded with net");
    }

    function test_quoteDeposit_oddAmountRoundsTheFeeDown() public {
        BondlineCover cover = _offer(_terms(), 10_000e6);
        (uint256 fee, uint256 net,) = cover.quoteDeposit(123_456_789, 1000);
        assertEq(fee, 1_234_567); // 1% of 123.456789 USDG, rounded down
        assertEq(net, 122_222_222);
    }
}
