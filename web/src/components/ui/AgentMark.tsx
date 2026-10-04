import { cn } from "@/lib/cn";

/**
 * A deterministic geometric mark generated from an address: a 3×3 tile of circles, diamonds, triangles and bars,
 * mirrored left-to-right so it reads as one identity. Same address, same mark, on the server and the client.
 * No faces, no randomness at render time.
 */

const BACKGROUNDS = ["#edeefd", "#fde8dc", "#f4f2ed", "#f5f5fe"] as const;
const INKS = ["#1f1f1f", "#7c83ee", "#f2a37a", "#4a50c2", "#e7875a"] as const;
/** Pairs of inks that sit well together on each background. */
const SCHEMES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, 2],
  [1, 2],
  [3, 4],
  [0, 4],
  [3, 2],
];

type Shape =
  | "circle"
  | "dot"
  | "diamond"
  | "tri-tl"
  | "tri-tr"
  | "tri-bl"
  | "tri-br"
  | "square"
  | "bar"
  | "empty";

const SHAPES: Shape[] = ["circle", "dot", "diamond", "tri-tl", "tri-tr", "tri-bl", "tri-br", "square", "bar", "empty"];

const MIRROR: Partial<Record<Shape, Shape>> = {
  "tri-tl": "tri-tr",
  "tri-tr": "tri-tl",
  "tri-bl": "tri-br",
  "tri-br": "tri-bl",
};

/** FNV-1a seeded xorshift: a small, stable byte stream from the address. */
function byteStream(seed: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let x = h || 0x9e3779b9;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x & 0xff;
  };
}

function shapePath(shape: Shape, cx: number, cy: number): { d?: string; circle?: [number, number, number] } {
  const s = 5; // half a cell
  switch (shape) {
    case "circle":
      return { circle: [cx, cy, 4.3] };
    case "dot":
      return { circle: [cx, cy, 2.2] };
    case "diamond":
      return { d: `M${cx} ${cy - 4.8}L${cx + 4.8} ${cy}L${cx} ${cy + 4.8}L${cx - 4.8} ${cy}Z` };
    case "tri-tl":
      return { d: `M${cx - s} ${cy - s}H${cx + s}L${cx - s} ${cy + s}Z` };
    case "tri-tr":
      return { d: `M${cx - s} ${cy - s}H${cx + s}V${cy + s}Z` };
    case "tri-bl":
      return { d: `M${cx - s} ${cy - s}L${cx + s} ${cy + s}H${cx - s}Z` };
    case "tri-br":
      return { d: `M${cx + s} ${cy - s}V${cy + s}H${cx - s}Z` };
    case "square":
      return { d: `M${cx - 4} ${cy - 4}h8v8h-8Z` };
    case "bar":
      return { d: `M${cx - 4.6} ${cy - 1.8}h9.2a1.8 1.8 0 0 1 0 3.6h-9.2a1.8 1.8 0 0 1 0-3.6Z` };
    default:
      return {};
  }
}

export function agentMarkSpec(address: string) {
  const next = byteStream(address.toLowerCase());
  const bg = BACKGROUNDS[next() % BACKGROUNDS.length];
  const [a, b] = SCHEMES[next() % SCHEMES.length];
  // Left and middle columns; the right column mirrors the left.
  const cells: { shape: Shape; ink: string }[] = [];
  for (let i = 0; i < 6; i++) {
    cells.push({ shape: SHAPES[next() % SHAPES.length], ink: next() % 3 === 0 ? INKS[b] : INKS[a] });
  }
  // Keep enough weight: at least four filled cells.
  let filled = cells.filter((c) => c.shape !== "empty").length;
  for (let i = 0; filled < 4 && i < cells.length; i++) {
    if (cells[i].shape === "empty") {
      cells[i].shape = i % 2 ? "dot" : "circle";
      filled++;
    }
  }
  return { bg, cells };
}

export function AgentMark({
  address,
  size = 32,
  className,
  title,
}: {
  address: string;
  size?: number;
  className?: string;
  /** Accessible name. Omit when the address is already shown next to it. */
  title?: string;
}) {
  const { bg, cells } = agentMarkSpec(address);
  const centers = [10, 20, 30];
  const items: { shape: Shape; ink: string; cx: number; cy: number }[] = [];
  for (let row = 0; row < 3; row++) {
    const left = cells[row * 2];
    const mid = cells[row * 2 + 1];
    items.push({ ...left, cx: centers[0], cy: centers[row] });
    items.push({ ...mid, cx: centers[1], cy: centers[row] });
    items.push({ shape: MIRROR[left.shape] ?? left.shape, ink: left.ink, cx: centers[2], cy: centers[row] });
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <rect width="40" height="40" rx="11" fill={bg} />
      <rect x="0.5" y="0.5" width="39" height="39" rx="10.5" fill="none" stroke="rgb(31 31 31 / 0.06)" />
      {items.map((it, i) => {
        const p = shapePath(it.shape, it.cx, it.cy);
        if (p.circle) return <circle key={i} cx={p.circle[0]} cy={p.circle[1]} r={p.circle[2]} fill={it.ink} />;
        if (p.d) return <path key={i} d={p.d} fill={it.ink} />;
        return null;
      })}
    </svg>
  );
}
