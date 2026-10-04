// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BondlinePricerEvm} from "../src/BondlinePricerEvm.sol";

interface Vm {
    function readFile(string calldata path) external view returns (string memory);
    function parseJsonUintArray(string calldata json, string calldata key) external pure returns (uint256[] memory);
}

/// Every integer in vectors.flat.json (the TypeScript model rounded half up to 1e-4 bps, the same rows as
/// ../vectors.json) must be reproduced exactly by the EVM twin. Regenerate with `npx tsx stylus/scripts/vectors.ts`.
contract PricerVectorsTest {
    bool public constant IS_TEST = true;
    Vm private constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    event log_named_uint(string key, uint256 val);

    error Mismatch(uint256 row, uint256 output, uint256 got, uint256 want);

    BondlinePricerEvm private pricer;

    function setUp() public {
        pricer = new BondlinePricerEvm();
    }

    function test_everyVectorMatchesExactly() public {
        uint256[] memory flat = vm.parseJsonUintArray(vm.readFile("test/vectors.flat.json"), ".flat");
        require(flat.length % 10 == 0 && flat.length / 10 >= 10_000, "unexpected vector file");
        uint256 rows = flat.length / 10;
        for (uint256 i = 0; i < rows; ++i) {
            uint256 o = i * 10;
            (uint256 a, uint256 b, uint256 c, uint256 d, uint256 e) =
                pricer.quote(flat[o], flat[o + 1], flat[o + 2], flat[o + 3], flat[o + 4]);
            if (a != flat[o + 5]) revert Mismatch(i, 0, a, flat[o + 5]);
            if (b != flat[o + 6]) revert Mismatch(i, 1, b, flat[o + 6]);
            if (c != flat[o + 7]) revert Mismatch(i, 2, c, flat[o + 7]);
            if (d != flat[o + 8]) revert Mismatch(i, 3, d, flat[o + 8]);
            if (e != flat[o + 9]) revert Mismatch(i, 4, e, flat[o + 9]);
        }
        emit log_named_uint("vectors matching exactly", rows);
        emit log_named_uint("outputs matching exactly", rows * 5);
    }

    function test_docSanityValues() public view {
        // docs/PRICING.md: w 50%, sigma 50%, L 10%, cap 30%, 30 days: P 16.29%, gap 112.4 bps, risk 36.6, reserve 8.2, fair 44.8.
        (uint256 a, uint256 b, uint256 c, uint256 d, uint256 e) = pricer.quote(5000, 5000, 30, 1000, 3000);
        require(a == 16_294_650 && b == 1_123_714 && c == 366_211 && d == 82_192 && e == 448_402, "sanity");
        // Careful (w 30%, TSLA sigma 54.57%): fair 13.1 bps. Bold (w 80%): 174.7 bps.
        (,,,, e) = pricer.quote(3000, 5457, 30, 1000, 3000);
        require(e == 130_933, "careful");
        (,,,, e) = pricer.quote(8000, 5457, 30, 1000, 3000);
        require(e == 1_747_361, "bold");
    }

    function test_allCashPaysOnlyTheReserve() public view {
        (uint256 a, uint256 b, uint256 c, uint256 d, uint256 e) = pricer.quote(0, 5457, 30, 1000, 3000);
        require(a == 0 && b == 0 && c == 0 && d == 82_192 && e == d, "all cash");
    }

    function test_gapIsCappedByTheBand() public view {
        (, uint256 gap,,,) = pricer.quote(10_000, 30_000, 30, 2900, 3000);
        require(gap == 1_000_000, "band cap");
    }

    function test_pHitNeverExceedsOne() public view {
        (uint256 p,,,,) = pricer.quote(10_000, 1_000_000, 36_500, 1, 10_000);
        require(p <= 100_000_000, "p > 1");
    }

    function test_rejectsInputsOutsideTheDomain() public view {
        _expect(abi.encodeCall(pricer.quote, (10_001, 5000, 30, 1000, 3000)), BondlinePricerEvm.WBpsTooLarge.selector);
        _expect(abi.encodeCall(pricer.quote, (5000, 1_000_001, 30, 1000, 3000)), BondlinePricerEvm.SigmaBpsTooLarge.selector);
        _expect(abi.encodeCall(pricer.quote, (5000, 5000, 0, 1000, 3000)), BondlinePricerEvm.TermDaysOutOfRange.selector);
        _expect(abi.encodeCall(pricer.quote, (5000, 5000, 36_501, 1000, 3000)), BondlinePricerEvm.TermDaysOutOfRange.selector);
        _expect(abi.encodeCall(pricer.quote, (5000, 5000, 30, 1000, 0)), BondlinePricerEvm.CapBpsOutOfRange.selector);
        _expect(abi.encodeCall(pricer.quote, (5000, 5000, 30, 1000, 10_001)), BondlinePricerEvm.CapBpsOutOfRange.selector);
        _expect(abi.encodeCall(pricer.quote, (5000, 5000, 30, 0, 3000)), BondlinePricerEvm.LimitBpsOutOfRange.selector);
        _expect(abi.encodeCall(pricer.quote, (5000, 5000, 30, 3000, 3000)), BondlinePricerEvm.LimitBpsOutOfRange.selector);
        // Inputs above u64 are rejected too (the Stylus build saturates them to u64::MAX before the same checks).
        _expect(abi.encodeCall(pricer.quote, (type(uint256).max, 5000, 30, 1000, 3000)), BondlinePricerEvm.WBpsTooLarge.selector);
    }

    function test_fairIsWithinOneUnitOfRiskPlusReserve() public view {
        (,, uint256 risk, uint256 reserve, uint256 fair) = pricer.quote(8000, 5457, 30, 1000, 3000);
        uint256 sum = risk + reserve;
        require(fair == sum || fair + 1 == sum || fair == sum + 1, "fair");
    }

    /// Gas of one typical quote (Careful's worst case: w 30%, sigma 54.57%, L 10%, 30 days), measured in this test EVM.
    function test_gasOfATypicalQuote() public {
        uint256 g = gasleft();
        pricer.quote(3000, 5457, 30, 1000, 3000);
        emit log_named_uint("gas, typical quote (call included)", g - gasleft());
        g = gasleft();
        pricer.quote(8000, 5457, 30, 1000, 3000);
        emit log_named_uint("gas, Bold quote (call included)", g - gasleft());
        g = gasleft();
        pricer.quote(10_000, 1_000_000, 36_500, 1, 10_000);
        emit log_named_uint("gas, extreme quote (call included)", g - gasleft());
    }

    function _expect(bytes memory data, bytes4 selector) private view {
        (bool ok, bytes memory ret) = address(pricer).staticcall(data);
        require(!ok && ret.length >= 4 && bytes4(ret) == selector, "expected revert");
    }
}
