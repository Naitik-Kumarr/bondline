// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Math as OzMath} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Math as ModelMath} from "./HalmosMath.sol";

/// @notice The halmos proofs run against a build in which OpenZeppelin's `Math.mulDiv` is replaced by the closed
///         form `x * y / d` (halmos cannot decide the 512-bit `mulmod` inside the original). This suite checks, by
///         differential fuzzing under the default build (which uses the real library), that the closed form returns
///         exactly what OpenZeppelin returns whenever `x * y` fits in 256 bits, which every halmos test guarantees.
///         Run: `forge test --match-contract MathModelTest` (set FOUNDRY_FUZZ_RUNS for more runs).
contract MathModelTest is Test {
    function _fits(uint256 x, uint256 y) internal pure returns (bool) {
        return y == 0 || x <= type(uint256).max / y;
    }

    function testFuzz_floorMatchesOpenZeppelin(uint256 x, uint256 y, uint256 d) public pure {
        vm.assume(d != 0 && _fits(x, y));
        assertEq(ModelMath.mulDiv(x, y, d), OzMath.mulDiv(x, y, d));
    }

    function testFuzz_ceilMatchesOpenZeppelin(uint256 x, uint256 y, uint256 d) public pure {
        vm.assume(d != 0 && _fits(x, y));
        assertEq(
            ModelMath.mulDiv(x, y, d, ModelMath.Rounding.Ceil), OzMath.mulDiv(x, y, d, OzMath.Rounding.Ceil)
        );
        assertEq(
            ModelMath.mulDiv(x, y, d, ModelMath.Rounding.Floor), OzMath.mulDiv(x, y, d, OzMath.Rounding.Floor)
        );
    }

    /// @dev The ranges the halmos tests use: amounts up to 2**64 and divisors that are the contract's constants.
    function testFuzz_boundedLikeHalmos(uint64 x, uint64 y, uint8 pick) public pure {
        uint256[4] memory ds = [uint256(10_000), 1e20, uint256(x) + 1, uint256(y) + 1];
        uint256 d = ds[pick % 4];
        assertEq(ModelMath.mulDiv(x, y, d), OzMath.mulDiv(x, y, d));
        assertEq(
            ModelMath.mulDiv(x, y, d, ModelMath.Rounding.Ceil), OzMath.mulDiv(x, y, d, OzMath.Rounding.Ceil)
        );
    }

    function test_zeroDenominatorRevertsLikeOpenZeppelin() public {
        vm.expectRevert();
        this.model(1, 2, 0);
        vm.expectRevert();
        this.oz(1, 2, 0);
    }

    function model(uint256 x, uint256 y, uint256 d) external pure returns (uint256) {
        return ModelMath.mulDiv(x, y, d);
    }

    function oz(uint256 x, uint256 y, uint256 d) external pure returns (uint256) {
        return OzMath.mulDiv(x, y, d);
    }
}
