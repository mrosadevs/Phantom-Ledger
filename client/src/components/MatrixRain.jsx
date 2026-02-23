import { useMemo } from "react";

const SYMBOLS = [
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "$", "%", "#", "+", "-", "=", ".", "0.00",
  "xlsx", "PDF", "SUM", "NET", "DR", "CR",
  "$0", "00", "##", "\u2192", "\u2193", "\u03A3",
];

const CHAR_COUNT = 40;

function hash(seed) {
  // Better distribution than sin-based
  let h = seed | 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = (h >> 16) ^ h;
  return (h & 0x7fffffff) / 0x7fffffff;
}

export default function MatrixRain() {
  const chars = useMemo(() => {
    return Array.from({ length: CHAR_COUNT }, (_, i) => {
      const r1 = hash(i * 137 + 51);
      const r2 = hash(i * 251 + 89);
      const r3 = hash(i * 397 + 23);
      const r4 = hash(i * 521 + 67);
      const r5 = hash(i * 659 + 41);

      const symbolIndex = Math.floor(r1 * SYMBOLS.length);
      const left = r2 * 96 + 2; // 2% to 98%
      const duration = 14 + r3 * 20; // 14s to 34s
      const delay = -(r4 * 34); // stagger across full cycle
      const size = 0.7 + r5 * 0.65;

      return {
        key: i,
        symbol: SYMBOLS[symbolIndex],
        style: {
          left: `${left.toFixed(1)}%`,
          animationDuration: `${duration.toFixed(1)}s`,
          animationDelay: `${delay.toFixed(1)}s`,
          fontSize: `${size.toFixed(2)}rem`,
        },
      };
    });
  }, []);

  return (
    <div className="matrix-rain" aria-hidden="true">
      {chars.map((c) => (
        <span key={c.key} className="matrix-char" style={c.style}>
          {c.symbol}
        </span>
      ))}
    </div>
  );
}
