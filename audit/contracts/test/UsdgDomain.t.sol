// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";

/// @notice USDG exposes neither `version()` nor `eip712Domain()`, so Bondline hardcodes its EIP-712 domain.
///         These tests prove the hardcoded domain reproduces the DOMAIN_SEPARATOR read from Robinhood Chain testnet.
contract UsdgDomainTest is Test {
    address internal constant USDG = 0x7E955252E15c84f5768B83c41a71F9eba181802F;
    uint256 internal constant CHAIN_ID = 46630;
    /// @dev `cast call 0x7E95...802F "DOMAIN_SEPARATOR()(bytes32)"` on Robinhood Chain testnet, 4 Oct 2026.
    bytes32 internal constant ONCHAIN_DOMAIN_SEPARATOR =
        0xb1debe91e09d82163fd9cddaab89359061c0671664e1611258a3c3de7c2d950b;

    function test_hardcodedDomainMatchesChain() public pure {
        bytes32 typehash = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
        bytes32 separator = keccak256(abi.encode(typehash, keccak256("Global Dollar"), keccak256("1"), CHAIN_ID, USDG));
        assertEq(separator, ONCHAIN_DOMAIN_SEPARATOR);
    }

    function test_mockDomainMatchesChainAtTheRealAddress() public {
        vm.chainId(CHAIN_ID);
        MockUSDG mock = new MockUSDG();
        vm.etch(USDG, address(mock).code);
        assertEq(MockUSDG(USDG).DOMAIN_SEPARATOR(), ONCHAIN_DOMAIN_SEPARATOR);
    }

    function test_typehashesAreTheStandardOnes() public {
        MockUSDG mock = new MockUSDG();
        assertEq(
            mock.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
            0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8
        );
        assertEq(
            mock.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(),
            0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267
        );
    }
}
