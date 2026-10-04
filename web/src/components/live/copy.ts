// Shared plain-words copy about how a cover runs, so every page says the same thing. Words only; every number on
// the pages that use these lines comes from the chain or a record.

/** Where fixed terms sit on the roadmap. One place to change if ROADMAP.md is renumbered. */
export const FIXED_TERMS_NOTE = "Fixed terms are roadmap item 1.";

export const HOW_A_COVER_RUNS = [
  "A cover runs until you close it or it pays out. There is no end date.",
  "The reserve stays locked until then, so the bond behind your cover can't be spent elsewhere.",
  "The price on the board assumes 30 days. A cover held longer takes on more risk for the same premium. " + FIXED_TERMS_NOTE,
] as const;

/** What settlement does, and doesn't, do. */
export const AFTER_SETTLEMENT =
  "When a cover settles, the bond pays you everything beyond your limit, up to the 30% cap, at the moment of settlement. " +
  "After that the agent is stopped. The stocks you still hold can keep moving, and the bond doesn't cover that.";
