// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PricerConsts as C} from "./PricerConsts.sol";

/// @title BondlinePricerEvm
/// @notice The EVM twin of the Stylus `BondlinePricer` (../../src/math.rs): the same model (docs/PRICING.md,
///         shared/src/pricing.ts), the same integer fixed-point steps, the same ABI, the same outputs. A reference
///         price from a simple published model, not actuarial. No storage, no admin, no state.
///
///   sa   = w * sigma                                   account volatility
///   P    = min(1, 2 * N(-L / (sa * sqrt(T))))          chance of touching the limit, T = termDays / 365
///   gap  = min(band, 0.5826 * sa * sqrt(g))            band = cap - L, g = 1.5 / 252 = 1 / 168
///   risk = 2 * P * gap
///   reserve = band * 0.05 * T = band * termDays / 7300
///   fair = risk + reserve
///
/// N(x) is Hart's rational approximation exactly as in the TypeScript model (coefficients generated from it into
/// PricerConsts.sol), evaluated in 1e30 fixed point on uint256. No floats. sqrt is an integer Newton square root;
/// exp is range reduction by ln 2 plus a Taylor series.
///
/// Units: every output is basis points scaled by 1e4, i.e. fraction * 1e8 (1 = 0.0001 bps, 100_000_000 = 100%).
/// Rounding: each output is rounded half up, once, from the exact value held at 1e30 precision. `fair` is the
/// rounding of the exact `risk + reserve`, so it can differ from `riskBps + reserveBps` by 1 unit.
contract BondlinePricerEvm {
    error WBpsTooLarge();
    error SigmaBpsTooLarge();
    error TermDaysOutOfRange();
    error CapBpsOutOfRange();
    error LimitBpsOutOfRange();

    struct Quote {
        uint256 pHit;
        uint256 gap;
        uint256 risk;
        uint256 reserve;
        uint256 fair;
    }

    /// Fixed-point scale of every intermediate: 1e30.
    uint256 private constant S = 1e30;
    /// Output unit: 1e8 per whole fraction.
    uint256 private constant OUT_UNIT = 1e8;
    /// ln 2 at 1e30: 0.693147180559945309417232121458 (truncated).
    uint256 private constant LN2 = 693_147_180_559_945_309_417_232_121_458;
    /// One basis point at the 1e30 scale.
    uint256 private constant BPS = 1e26;
    /// Taylor terms for exp(-r), r < ln 2: the 45th term is below 1e-60.
    uint256 private constant EXP_TERMS = 45;

    /// The model's fair price for one cover, every output in basis points scaled by 1e4 (1 = 0.0001 bps).
    /// @param wBps share of the account in stocks, 0..10000
    /// @param sigmaBps annual volatility of the most volatile allowed stock (5457 = 54.57%), 0..1_000_000
    /// @param termDays the cover's term, 1..36500
    /// @param limitBps the loss limit, 0 < limitBps < capBps
    /// @param capBps the cover's cap, 1..10000
    /// @return pHitBps chance the account touches its limit within the term
    /// @return gapBps expected overshoot past the limit when a jump crosses it, capped at the band
    /// @return riskBps 2 * pHit * gap
    /// @return reserveBps band * 5% * term
    /// @return fairBps risk + reserve
    function quote(uint256 wBps, uint256 sigmaBps, uint256 termDays, uint256 limitBps, uint256 capBps)
        external
        pure
        returns (uint256 pHitBps, uint256 gapBps, uint256 riskBps, uint256 reserveBps, uint256 fairBps)
    {
        Quote memory q = _quote(wBps, sigmaBps, termDays, limitBps, capBps);
        return (q.pHit, q.gap, q.risk, q.reserve, q.fair);
    }

    function _quote(uint256 w, uint256 sigma, uint256 term, uint256 limitBps, uint256 capBps)
        private
        pure
        returns (Quote memory q)
    {
        if (w > 10_000) revert WBpsTooLarge();
        if (sigma > 1_000_000) revert SigmaBpsTooLarge();
        if (term == 0 || term > 36_500) revert TermDaysOutOfRange();
        if (capBps == 0 || capBps > 10_000) revert CapBpsOutOfRange();
        if (limitBps == 0 || limitBps >= capBps) revert LimitBpsOutOfRange();

        uint256 band = (capBps - limitBps) * BPS;
        // w * sigma is in 1e-8, i.e. 1e22 at the 1e30 scale.
        (uint256 pHit, uint256 gap) = _hitAndGap(w * sigma * 1e22, limitBps * BPS, term, band);
        uint256 risk = 2 * pHit * gap / S;
        uint256 reserve = band * term / 7300;

        q.pHit = _units(pHit);
        q.gap = _units(gap);
        q.risk = _units(risk);
        q.reserve = _units(reserve);
        q.fair = _units(risk + reserve);
    }

    function _hitAndGap(uint256 sa, uint256 limit, uint256 term, uint256 band)
        private
        pure
        returns (uint256 pHit, uint256 gap)
    {
        if (sa == 0) return (0, 0);
        // sqrt(T) with T = termDays / 365, and sqrt(g) with g = 1.5 / 252 = 1 / 168.
        uint256 sqrtT = _isqrt(term * S * S / 365);
        uint256 sqrtG = _isqrt(S * S / 168);
        uint256 distance = limit * S / sa * S / sqrtT;
        pHit = 2 * _normalTail(distance);
        if (pHit > S) pHit = S;
        uint256 rawGap = sa * 5826 * sqrtG / (10_000 * S);
        gap = rawGap < band ? rawGap : band;
    }

    /// Rounds a 1e30-scaled fraction to output units, half up.
    function _units(uint256 v) private pure returns (uint256) {
        return (v * OUT_UNIT + S / 2) / S;
    }

    /// N(-z) for z >= 0 at 1e30: the lower tail of the standard normal, Hart's approximation as in `normalCdf`.
    function _normalTail(uint256 z) private pure returns (uint256) {
        if (z > C.Z_MAX * S) return 0;
        uint256 e = _expNeg(z * z / S / 2);
        if (z < C.HART_CUTOFF) {
            uint256 n = C.HART_N0;
            n = n * z / S + C.HART_N1;
            n = n * z / S + C.HART_N2;
            n = n * z / S + C.HART_N3;
            n = n * z / S + C.HART_N4;
            n = n * z / S + C.HART_N5;
            n = n * z / S + C.HART_N6;
            uint256 d = C.HART_D0;
            d = d * z / S + C.HART_D1;
            d = d * z / S + C.HART_D2;
            d = d * z / S + C.HART_D3;
            d = d * z / S + C.HART_D4;
            d = d * z / S + C.HART_D5;
            d = d * z / S + C.HART_D6;
            d = d * z / S + C.HART_D7;
            return e * n / d;
        }
        uint256 b = z + C.CF_B0;
        b = z + 4 * S * S / b;
        b = z + 3 * S * S / b;
        b = z + 2 * S * S / b;
        b = z + 1 * S * S / b;
        return e * S / b * S / C.CF_SQRT_2PI;
    }

    /// exp(-x) for x >= 0 at 1e30, truncated. Absolute error is a few 1e-30.
    function _expNeg(uint256 x) private pure returns (uint256) {
        uint256 k = x / LN2;
        if (k >= 256) return 0;
        uint256 r = x - k * LN2; // in [0, ln 2)
        // exp(-r) = sum (-r)^n / n!, split into positive and negative sums so everything stays unsigned.
        uint256 term = S;
        uint256 pos = S;
        uint256 neg = 0;
        for (uint256 n = 1; n <= EXP_TERMS; ++n) {
            term = term * r / S / n;
            if (n % 2 == 1) neg += term;
            else pos += term;
        }
        return (pos - neg) >> k;
    }

    /// floor(sqrt(n)): integer Newton iteration from a power of two above the root.
    function _isqrt(uint256 n) private pure returns (uint256 x) {
        if (n == 0) return 0;
        x = 2 ** ((_bitLength(n) + 1) / 2);
        for (;;) {
            uint256 y = (x + n / x) >> 1;
            if (y >= x) return x;
            x = y;
        }
    }

    /// Bits needed to write n (n > 0): floor(log2 n) + 1.
    function _bitLength(uint256 n) private pure returns (uint256 r) {
        if (n >> 128 > 0) { n >>= 128; r += 128; }
        if (n >> 64 > 0) { n >>= 64; r += 64; }
        if (n >> 32 > 0) { n >>= 32; r += 32; }
        if (n >> 16 > 0) { n >>= 16; r += 16; }
        if (n >> 8 > 0) { n >>= 8; r += 8; }
        if (n >> 4 > 0) { n >>= 4; r += 4; }
        if (n >> 2 > 0) { n >>= 2; r += 2; }
        if (n >> 1 > 0) { r += 1; }
        r += 1;
    }
}
