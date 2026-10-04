//! Bondline's reference price in integer arithmetic. No floats anywhere.
//!
//! The model is docs/PRICING.md and shared/src/pricing.ts `priceCover`:
//!
//! ```text
//!   sa   = w * sigma                                   account volatility
//!   P    = min(1, 2 * N(-L / (sa * sqrt(T))))          chance of touching the limit, T = termDays / 365
//!   gap  = min(band, 0.5826 * sa * sqrt(g))            band = cap - L, g = 1.5 / 252 = 1 / 168
//!   risk = 2 * P * gap
//!   reserve = band * 0.05 * T = band * termDays / 7300
//!   fair = risk + reserve
//! ```
//!
//! N(x) is Hart's rational approximation exactly as in the TypeScript model (coefficients in `consts.rs`, generated
//! from that file), evaluated in 1e30 fixed point on 256-bit integers. sqrt is an integer Newton square root and
//! exp is range reduction by ln 2 plus a Taylor series.
//!
//! Units: every output is in basis points scaled by 1e4, i.e. fraction * 1e8 (1 = 0.0001 bps, 100_000_000 = 100%).
//! Rounding: each output is rounded half up, once, from the exact value held at 1e30 precision. `fair` is the
//! rounding of the exact `risk + reserve`, not the sum of the two rounded values, so it can differ from
//! `risk + reserve` by 1 unit (0.0001 bps).

use crate::consts::*;
use alloy_primitives::U256;

/// Fixed-point scale of every intermediate: 1e30.
const SCALE_EXP: u32 = 30;
/// Output unit: 1e8 per whole fraction (basis points scaled by 1e4).
const OUT_UNIT: u64 = 100_000_000;
/// ln 2 at 1e30: 0.693147180559945309417232121458 (truncated).
const LN2: u128 = 693_147_180_559_945_309_417_232_121_458;

/// Input bounds. The model's domain is w in [0,1], sigma >= 0, 0 < L < cap <= 1, termDays > 0; the contract also
/// bounds sigma (at 1000x) and the term (at 100 years) so the 256-bit arithmetic cannot overflow.
pub const MAX_W_BPS: u64 = 10_000;
pub const MAX_SIGMA_BPS: u64 = 1_000_000;
pub const MAX_TERM_DAYS: u64 = 36_500;
pub const MAX_CAP_BPS: u64 = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuoteError {
    WBpsTooLarge,
    SigmaBpsTooLarge,
    TermDaysOutOfRange,
    CapBpsOutOfRange,
    LimitBpsOutOfRange,
}

/// The five outputs, in basis points scaled by 1e4.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Quote {
    pub p_hit: u64,
    pub gap: u64,
    pub risk: u64,
    pub reserve: u64,
    pub fair: u64,
}

fn s() -> U256 {
    U256::from(10u128.pow(SCALE_EXP))
}

fn u(x: u128) -> U256 {
    U256::from(x)
}

/// A coefficient stored as literal * 1e16, converted to the 1e30 scale.
fn coef(x: u128) -> U256 {
    u(x) * u(10u128.pow(SCALE_EXP - COEF_SCALE_EXP))
}

/// floor(sqrt(n)).
fn isqrt(n: U256) -> U256 {
    if n.is_zero() {
        return U256::ZERO;
    }
    let bits = 256 - n.leading_zeros();
    let mut x = U256::from(1u8) << bits.div_ceil(2);
    loop {
        let y = (x + n / x) >> 1;
        if y >= x {
            return x;
        }
        x = y;
    }
}

/// exp(-x) for x >= 0 at 1e30, truncated. Absolute error is a few 1e-30.
fn exp_neg(x: U256) -> U256 {
    let ln2 = u(LN2);
    let k = x / ln2;
    if k >= U256::from(256u16) {
        return U256::ZERO;
    }
    // r is in [0, ln2). exp(-r) = sum (-r)^n / n!, split into positive and negative sums so everything stays unsigned.
    let r = x - k * ln2;
    let mut term = s();
    let mut pos = s();
    let mut neg = U256::ZERO;
    for n in 1u64..=45 {
        term = term * r / s() / U256::from(n);
        if n % 2 == 1 {
            neg += term;
        } else {
            pos += term;
        }
    }
    (pos - neg) >> k.to::<usize>()
}

/// N(-z) for z >= 0 at 1e30: the lower tail of the standard normal, Hart's approximation as in `normalCdf`.
fn normal_tail(z: U256) -> U256 {
    if z > u(Z_MAX) * s() {
        return U256::ZERO;
    }
    let e = exp_neg(z * z / s() / U256::from(2u8));
    if z < coef(HART_CUTOFF) {
        let mut n = coef(HART_N[0]);
        for c in &HART_N[1..] {
            n = n * z / s() + coef(*c);
        }
        let mut d = coef(HART_D[0]);
        for c in &HART_D[1..] {
            d = d * z / s() + coef(*c);
        }
        e * n / d
    } else {
        let mut b = z + coef(CF_B0);
        for k in [4u8, 3, 2, 1] {
            b = z + U256::from(k) * s() * s() / b;
        }
        e * s() / b * s() / coef(CF_SQRT_2PI)
    }
}

/// Rounds a 1e30-scaled fraction to output units, half up.
fn to_units(v: U256) -> u64 {
    ((v * U256::from(OUT_UNIT) + s() / U256::from(2u8)) / s()).to::<u64>()
}

pub fn quote(
    w_bps: u64,
    sigma_bps: u64,
    term_days: u64,
    limit_bps: u64,
    cap_bps: u64,
) -> Result<Quote, QuoteError> {
    if w_bps > MAX_W_BPS {
        return Err(QuoteError::WBpsTooLarge);
    }
    if sigma_bps > MAX_SIGMA_BPS {
        return Err(QuoteError::SigmaBpsTooLarge);
    }
    if term_days == 0 || term_days > MAX_TERM_DAYS {
        return Err(QuoteError::TermDaysOutOfRange);
    }
    if cap_bps == 0 || cap_bps > MAX_CAP_BPS {
        return Err(QuoteError::CapBpsOutOfRange);
    }
    if limit_bps == 0 || limit_bps >= cap_bps {
        return Err(QuoteError::LimitBpsOutOfRange);
    }

    let one = s();
    // 1 bps = 1e26 at the 1e30 scale; w * sigma is in 1e-8, i.e. 1e22 at the 1e30 scale.
    let bps = u(10u128.pow(SCALE_EXP - 4));
    let limit = U256::from(limit_bps) * bps;
    let band = U256::from(cap_bps - limit_bps) * bps;
    let sa = U256::from(w_bps) * U256::from(sigma_bps) * u(10u128.pow(SCALE_EXP - 8));

    // sqrt(T) with T = termDays / 365, and sqrt(g) with g = 1.5 / 252 = 1 / 168.
    let sqrt_t = isqrt(U256::from(term_days) * one * one / U256::from(365u16));
    let sqrt_g = isqrt(one * one / U256::from(168u16));

    let (p_hit, gap) = if sa.is_zero() {
        (U256::ZERO, U256::ZERO)
    } else {
        let distance = limit * one / sa * one / sqrt_t;
        let p = (U256::from(2u8) * normal_tail(distance)).min(one);
        let raw_gap = sa * U256::from(5826u16) * sqrt_g / (U256::from(10_000u16) * one);
        (p, raw_gap.min(band))
    };
    let risk = U256::from(2u8) * p_hit * gap / one;
    let reserve = band * U256::from(term_days) / U256::from(7300u16);
    let fair = risk + reserve;

    Ok(Quote {
        p_hit: to_units(p_hit),
        gap: to_units(gap),
        risk: to_units(risk),
        reserve: to_units(reserve),
        fair: to_units(fair),
    })
}
