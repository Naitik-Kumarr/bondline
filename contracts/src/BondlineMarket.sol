// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

import {Terms, Offer} from "./Types.sol";
import {IBondlineMarket, IBondlineCover} from "./interfaces/IBondline.sol";
import {IUSDG} from "./interfaces/IUSDG.sol";
import {OracleVenue} from "./OracleVenue.sol";

/// @title BondlineMarket
/// @notice The factory and registry of offers: each offer is one underwriter's USDG bond behind one AI agent.
///         No owner and no admin. Its configuration (USDG, feeds, venue, price age) is fixed at deploy.
///
///         `createOfferWithAuthorization` underwrites with one USDG signature and one transaction: it pulls the
///         bond with EIP-3009 `receiveWithAuthorization` (always from `msg.sender`, so nobody can front-run or
///         redirect a signature), creates the offer and funds it. The market never keeps USDG.
contract BondlineMarket is IBondlineMarket, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;

    /// @notice A settle pays the loss beyond the limit up to a 30% drop.
    uint16 public constant CAP_BPS = 3000;
    /// @notice Largest premium an offer may charge: 5% of each deposit.
    uint16 public constant MAX_FEE_BPS = 500;
    /// @notice Most assets a market may list (an account's asset mask is 8 bits).
    uint256 public constant MAX_ASSETS = 8;
    /// @notice Longest offer name, in bytes.
    uint256 public constant MAX_NAME_BYTES = 64;

    /// @inheritdoc IBondlineMarket
    address public immutable usdg;
    /// @inheritdoc IBondlineMarket
    address public immutable venue;
    /// @inheritdoc IBondlineMarket
    address public immutable coverImplementation;
    /// @inheritdoc IBondlineMarket
    address public immutable accountImplementation;
    /// @inheritdoc IBondlineMarket
    uint32 public immutable maxPriceAge;

    /// @inheritdoc IBondlineMarket
    string public label;

    address[] private _assets;
    address[] private _feeds;
    Offer[] private _offers;
    mapping(address cover => uint256) private _idPlusOne;

    /// @param usdg_ Paxos USDG, the only money in Bondline.
    /// @param coverImplementation_ The `BondlineCover` every offer clones.
    /// @param accountImplementation_ The `AgentAccount` every covered account clones.
    /// @param assets_ The Stock Tokens agents may trade here, in a fixed order (asset i is bit i of a mask).
    /// @param feeds_ One 8-decimal price feed per asset.
    /// @param maxPriceAge_ Oldest price that settle, withdraw and the venue accept, in seconds.
    /// @param spreadBps_ The demo exchange's fixed spread against the oracle price.
    /// @param label_ "Live" or "Replay".
    constructor(
        address usdg_,
        address coverImplementation_,
        address accountImplementation_,
        address[] memory assets_,
        address[] memory feeds_,
        uint32 maxPriceAge_,
        uint16 spreadBps_,
        string memory label_
    ) {
        if (usdg_ == address(0) || coverImplementation_ == address(0) || accountImplementation_ == address(0)) {
            revert ZeroAddress();
        }
        if (assets_.length != feeds_.length) revert LengthMismatch();
        if (assets_.length == 0 || assets_.length > MAX_ASSETS) revert TooManyAssets();
        for (uint256 i; i < assets_.length; ++i) {
            if (assets_[i] == address(0) || feeds_[i] == address(0)) revert ZeroAddress();
        }
        usdg = usdg_;
        coverImplementation = coverImplementation_;
        accountImplementation = accountImplementation_;
        maxPriceAge = maxPriceAge_;
        label = label_;
        _assets = assets_;
        _feeds = feeds_;
        venue = address(new OracleVenue(usdg_, assets_, feeds_, spreadBps_, maxPriceAge_));
    }

    // ---------------------------------------------------------------- offers

    /// @inheritdoc IBondlineMarket
    function createOffer(Terms calldata terms) external nonReentrant returns (uint256 id, address cover) {
        return _create(msg.sender, terms);
    }

    /// @inheritdoc IBondlineMarket
    function createOfferWithAuthorization(
        Terms calldata terms,
        uint256 bond,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256 id, address cover) {
        if (bond == 0) revert ZeroBond();
        IUSDG(usdg).receiveWithAuthorization(msg.sender, address(this), bond, validAfter, validBefore, nonce, v, r, s);
        (id, cover) = _create(msg.sender, terms);
        IERC20(usdg).forceApprove(cover, bond);
        IBondlineCover(cover).fund(bond);
        emit OfferFunded(id, msg.sender, bond);
    }

    /// @inheritdoc IBondlineMarket
    /// @dev Stops new covers and deposits on the offer. Existing covers keep their protection.
    function delist(uint256 id) external {
        if (id >= _offers.length) revert UnknownOffer(id);
        Offer storage o = _offers[id];
        if (msg.sender != o.underwriter) revert NotUnderwriter();
        if (!o.listed) return;
        o.listed = false;
        IBondlineCover(o.cover).delist();
        emit OfferDelisted(id);
    }

    // ---------------------------------------------------------------- views

    /// @inheritdoc IBondlineMarket
    function capBps() external pure returns (uint16) {
        return CAP_BPS;
    }

    /// @inheritdoc IBondlineMarket
    function assets() external view returns (address[] memory) {
        return _assets;
    }

    /// @inheritdoc IBondlineMarket
    function feeds() external view returns (address[] memory) {
        return _feeds;
    }

    /// @inheritdoc IBondlineMarket
    function offerCount() external view returns (uint256) {
        return _offers.length;
    }

    /// @inheritdoc IBondlineMarket
    function offer(uint256 id) external view returns (Offer memory) {
        if (id >= _offers.length) revert UnknownOffer(id);
        return _offers[id];
    }

    /// @inheritdoc IBondlineMarket
    function offers() external view returns (Offer[] memory) {
        return _offers;
    }

    /// @inheritdoc IBondlineMarket
    function isOffer(address cover) external view returns (bool) {
        return _idPlusOne[cover] != 0;
    }

    /// @inheritdoc IBondlineMarket
    function idOf(address cover) external view returns (uint256) {
        uint256 idPlusOne = _idPlusOne[cover];
        if (idPlusOne == 0) revert UnknownOffer(type(uint256).max);
        return idPlusOne - 1;
    }

    /// @inheritdoc IBondlineMarket
    function capacity(uint256 id) external view returns (uint256) {
        if (id >= _offers.length) revert UnknownOffer(id);
        return IBondlineCover(_offers[id].cover).free();
    }

    // ---------------------------------------------------------------- internals

    function _create(address underwriter, Terms calldata terms) private returns (uint256 id, address cover) {
        if (!_validTerms(terms)) revert InvalidTerms();
        cover = Clones.clone(coverImplementation);
        id = _offers.length;
        _offers.push(Offer({cover: cover, underwriter: underwriter, agent: terms.agent, listed: true}));
        _idPlusOne[cover] = id + 1;
        IBondlineCover(cover).initialize(underwriter, terms);
        emit OfferCreated(id, cover, underwriter, terms.agent, terms);
    }

    function _validTerms(Terms calldata t) private pure returns (bool) {
        if (t.agent == address(0)) return false;
        if (t.minLimitBps == 0 || t.minLimitBps > t.maxLimitBps || t.maxLimitBps >= CAP_BPS) return false;
        if (t.feeBps > MAX_FEE_BPS) return false;
        if (t.maxStockBps == 0 || t.maxStockBps > BPS) return false;
        if (bytes(t.name).length == 0 || bytes(t.name).length > MAX_NAME_BYTES) return false;
        return true;
    }
}
