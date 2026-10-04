//! Every integer in vectors.json (from the TypeScript model, rounded half up to 1e-4 bps) must be reproduced exactly
//! by the integer-only Rust model. Regenerate the file with `npx tsx stylus/scripts/vectors.ts`.

use crate::math::{quote, Quote, QuoteError};

fn field(v: &serde_json::Value, k: &str) -> u64 {
    v[k].as_u64()
        .unwrap_or_else(|| panic!("missing {k} in {v}"))
}

#[test]
fn every_vector_matches_exactly() {
    let doc: serde_json::Value = serde_json::from_str(include_str!("../vectors.json")).unwrap();
    let vectors = doc["vectors"].as_array().unwrap();
    assert_eq!(vectors.len() as u64, doc["count"].as_u64().unwrap());
    assert!(vectors.len() >= 10_000);
    let mut mismatches = Vec::new();
    for v in vectors {
        let got = quote(
            field(v, "wBps"),
            field(v, "sigmaBps"),
            field(v, "termDays"),
            field(v, "limitBps"),
            field(v, "capBps"),
        )
        .unwrap();
        let want = Quote {
            p_hit: field(v, "pHitBps"),
            gap: field(v, "gapBps"),
            risk: field(v, "riskBps"),
            reserve: field(v, "reserveBps"),
            fair: field(v, "fairBps"),
        };
        if got != want {
            mismatches.push(format!("{v}\n  rust {got:?}\n  ts   {want:?}"));
        }
    }
    println!(
        "{} of {} vectors match exactly ({} outputs)",
        vectors.len() - mismatches.len(),
        vectors.len(),
        5 * (vectors.len() - mismatches.len())
    );
    assert!(
        mismatches.is_empty(),
        "{} mismatches, first:\n{}",
        mismatches.len(),
        mismatches[..mismatches.len().min(5)].join("\n")
    );
}

#[test]
fn doc_sanity_values() {
    // docs/PRICING.md: w 50%, sigma 50%, L 10%, cap 30%, 30 days: P 16.29%, gap 112.4 bps, risk 36.6, reserve 8.2, fair 44.8.
    let q = quote(5000, 5000, 30, 1000, 3000).unwrap();
    assert_eq!(
        q,
        Quote {
            p_hit: 16_294_650,
            gap: 1_123_714,
            risk: 366_211,
            reserve: 82_192,
            fair: 448_402
        }
    );
    // Careful (w 30%, TSLA sigma 54.57%): fair 13.1 bps. Bold (w 80%): 174.7 bps.
    assert_eq!(quote(3000, 5457, 30, 1000, 3000).unwrap().fair, 130_933);
    assert_eq!(quote(8000, 5457, 30, 1000, 3000).unwrap().fair, 1_747_361);
}

#[test]
fn all_cash_pays_only_the_reserve() {
    let q = quote(0, 5457, 30, 1000, 3000).unwrap();
    assert_eq!((q.p_hit, q.gap, q.risk), (0, 0, 0));
    assert_eq!(q.reserve, 82_192);
    assert_eq!(q.fair, q.reserve);
}

#[test]
fn gap_is_capped_by_the_band() {
    // w 100%, sigma 300%, L 29%, cap 30%: gap = band = 100 bps = 1_000_000 units.
    assert_eq!(
        quote(10_000, 30_000, 30, 2900, 3000).unwrap().gap,
        1_000_000
    );
}

#[test]
fn p_hit_never_exceeds_one() {
    let q = quote(10_000, 1_000_000, 36_500, 1, 10_000).unwrap();
    assert!(q.p_hit <= 100_000_000);
}

#[test]
fn rejects_inputs_outside_the_domain() {
    assert_eq!(
        quote(10_001, 5000, 30, 1000, 3000),
        Err(QuoteError::WBpsTooLarge)
    );
    assert_eq!(
        quote(5000, 1_000_001, 30, 1000, 3000),
        Err(QuoteError::SigmaBpsTooLarge)
    );
    assert_eq!(
        quote(5000, 5000, 0, 1000, 3000),
        Err(QuoteError::TermDaysOutOfRange)
    );
    assert_eq!(
        quote(5000, 5000, 36_501, 1000, 3000),
        Err(QuoteError::TermDaysOutOfRange)
    );
    assert_eq!(
        quote(5000, 5000, 30, 1000, 0),
        Err(QuoteError::CapBpsOutOfRange)
    );
    assert_eq!(
        quote(5000, 5000, 30, 1000, 10_001),
        Err(QuoteError::CapBpsOutOfRange)
    );
    assert_eq!(
        quote(5000, 5000, 30, 0, 3000),
        Err(QuoteError::LimitBpsOutOfRange)
    );
    assert_eq!(
        quote(5000, 5000, 30, 3000, 3000),
        Err(QuoteError::LimitBpsOutOfRange)
    );
}

#[test]
fn fair_is_within_one_unit_of_risk_plus_reserve() {
    let q = quote(8000, 5457, 30, 1000, 3000).unwrap();
    let sum = q.risk + q.reserve;
    assert!(q.fair == sum || q.fair + 1 == sum || q.fair == sum + 1);
}
