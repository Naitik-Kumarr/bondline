//! BondlinePricer: Bondline's reference price as a Stylus (Rust/WASM) contract. See README.md and docs/PRICING.md.
//! One pure function, `quote`, in integer fixed-point math. The Solidity markets do not call it; it is a published,
//! on-chain, callable copy of the model in shared/src/pricing.ts.
#![cfg_attr(not(any(test, feature = "export-abi")), no_std)]

extern crate alloc;

mod consts;
pub mod math;

#[cfg(test)]
mod tests;

use alloc::vec;
use alloc::vec::Vec;
use alloy_primitives::U256;
use alloy_sol_types::sol;
use stylus_sdk::prelude::*;

sol! {
    error WBpsTooLarge();
    error SigmaBpsTooLarge();
    error TermDaysOutOfRange();
    error CapBpsOutOfRange();
    error LimitBpsOutOfRange();
}

#[derive(SolidityError)]
pub enum PricerError {
    WBpsTooLarge(WBpsTooLarge),
    SigmaBpsTooLarge(SigmaBpsTooLarge),
    TermDaysOutOfRange(TermDaysOutOfRange),
    CapBpsOutOfRange(CapBpsOutOfRange),
    LimitBpsOutOfRange(LimitBpsOutOfRange),
}

impl From<math::QuoteError> for PricerError {
    fn from(e: math::QuoteError) -> Self {
        use math::QuoteError::*;
        match e {
            WBpsTooLarge => PricerError::WBpsTooLarge(self::WBpsTooLarge {}),
            SigmaBpsTooLarge => PricerError::SigmaBpsTooLarge(self::SigmaBpsTooLarge {}),
            TermDaysOutOfRange => PricerError::TermDaysOutOfRange(self::TermDaysOutOfRange {}),
            CapBpsOutOfRange => PricerError::CapBpsOutOfRange(self::CapBpsOutOfRange {}),
            LimitBpsOutOfRange => PricerError::LimitBpsOutOfRange(self::LimitBpsOutOfRange {}),
        }
    }
}

#[storage]
#[entrypoint]
pub struct BondlinePricer;

#[public]
#[allow(non_snake_case)]
impl BondlinePricer {
    /// The model's fair price for one cover, every output in basis points scaled by 1e4 (1 = 0.0001 bps).
    ///
    /// Inputs: wBps = share of the account in stocks (0..10000); sigmaBps = annual volatility of the most volatile
    /// allowed stock (e.g. 5457 = 54.57%, at most 1,000,000); termDays = the cover's term (1..36500); limitBps = the
    /// loss limit (0 < limitBps < capBps); capBps = the cover's cap (1..10000).
    /// Outputs: pHitBps = chance the account touches its limit in the term; gapBps = expected overshoot when a jump
    /// crosses the limit; riskBps = 2 * pHit * gap; reserveBps = band * 5% * term; fairBps = risk + reserve.
    /// Each is rounded half up once from the exact value; fair is the rounding of the exact sum.
    pub fn quote(
        wBps: U256,
        sigmaBps: U256,
        termDays: U256,
        limitBps: U256,
        capBps: U256,
    ) -> Result<(U256, U256, U256, U256, U256), PricerError> {
        // Anything above u64 is above every bound; saturate so the bound check reports it.
        let clamp = |x: U256| -> u64 { x.try_into().unwrap_or(u64::MAX) };
        let q = math::quote(
            clamp(wBps),
            clamp(sigmaBps),
            clamp(termDays),
            clamp(limitBps),
            clamp(capBps),
        )?;
        Ok((
            U256::from(q.p_hit),
            U256::from(q.gap),
            U256::from(q.risk),
            U256::from(q.reserve),
            U256::from(q.fair),
        ))
    }
}

/// Prints the Solidity ABI (for `cargo stylus export-abi`).
#[cfg(feature = "export-abi")]
pub fn print_abi() {
    stylus_sdk::abi::export::print_from_args::<BondlinePricer>();
}
