// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BondlineInvariantSetup, Handler} from "./BondlineInvariants.t.sol";

/// @notice Proves the invariant handler reaches the deep paths (trades that execute, settles that pay), so the
///         invariants are checked against a book that actually moves, not an empty one.
contract HandlerSanity is BondlineInvariantSetup {
    function test_handlerReachesTradesAndSettles() public {
        Handler h = Handler(targetContracts()[0]);
        for (uint256 i; i < 600; ++i) {
            uint256 r = uint256(keccak256(abi.encode(i)));
            uint256 op = r % 12;
            if (op == 0) h.createOffer(r, uint16(r >> 8), uint16(r >> 24), r >> 40, r % 2 == 0);
            else if (op == 1) h.fund(r, r >> 8);
            else if (op == 2) h.release(r, r >> 8);
            else if (op == 3) h.open(r, r >> 8, uint16(r >> 16), r >> 32, uint16(r >> 64));
            else if (op == 4) h.deposit(r, r >> 8);
            else if (op == 5) h.withdraw(r, r >> 8);
            else if (op <= 8) h.trade(r, r % 3 != 0, r % 2 == 0, r >> 8);
            else if (op == 9) h.movePrices(int256(r % 10_001) - 5000, int256((r >> 16) % 10_001) - 5000, r >> 32);
            else if (op == 10) h.settle(r);
            else h.close(r);
        }
        emit log_named_uint("covers", h.coverCount());
        emit log_named_uint("accounts", h.accountCount());
        emit log_named_uint("trades", h.trades());
        emit log_named_uint("settles", h.settles());
        assertGt(h.trades(), 20);
        assertGt(h.settles(), 0);
        assertFalse(h.payoutExceededReserve());
    }
}
