// US equities trade 24/5 on Chainlink's feeds on Robinhood Chain: they pause from Friday 20:00 New York time and
// restart on Sunday 20:00 New York time (Monday 00:00 UTC while New York is on daylight time). Pure, so it runs on
// the server and the client and can be checked with a one-line script.

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

function ny(ms: number) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { weekday: p.weekday as string, hour: Number(p.hour), minute: Number(p.minute) };
}

/** True between Sunday 20:00 and Friday 20:00 New York time. */
export function equitiesOpen(nowMs: number): boolean {
  const { weekday, hour } = ny(nowMs);
  if (weekday === "Sat") return false;
  if (weekday === "Sun") return hour >= 20;
  if (weekday === "Fri") return hour < 20;
  return true;
}

/** The next Sunday 20:00 New York time after `nowMs`, in unix milliseconds (found hour by hour, DST-safe). */
export function nextWeeklyRestart(nowMs: number): number {
  const HOUR = 3_600_000;
  const start = Math.floor(nowMs / HOUR) * HOUR + HOUR;
  for (let i = 0; i < 24 * 9; i++) {
    const t = start + i * HOUR;
    const p = ny(t);
    if (p.weekday === "Sun" && p.hour === 20 && p.minute === 0) return t;
  }
  return start;
}
