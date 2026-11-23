// ---------------------------------------------------------------------------
// The little picture on each game's tile in the console. A glossy candy square
// in the game's own hue with a white drawing of what is in it, so a parent
// scanning ten games finds "the fish one" by eye before reading a word.
// ---------------------------------------------------------------------------

import type { GameId } from "@/lib/baby-no-scroll/types";

const W = { fill: "none", stroke: "#fff", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function Art({ id }: { id: GameId }) {
  switch (id) {
    case "balloons":
      return (
        <>
          <ellipse cx="10" cy="9" rx="5" ry="6" fill="#fff" />
          <path d="M10 15l-1 1.4h2zM10 16.4c0 2 1.6 2.6 1 4.6" {...W} strokeWidth={1.2} />
          <ellipse cx="17" cy="7" rx="3.2" ry="3.8" fill="#fff" opacity=".7" />
        </>
      );
    case "music":
      return (
        <>
          <path d="M9 18V6l10-2v12" {...W} />
          <circle cx="7" cy="18" r="2.4" fill="#fff" />
          <circle cx="17" cy="16" r="2.4" fill="#fff" />
        </>
      );
    case "bubbles":
      return (
        <>
          <circle cx="10" cy="13" r="6" {...W} />
          <circle cx="17.5" cy="7" r="3" {...W} />
          <path d="M7.5 10.5a3.4 3.4 0 0 1 2.5-1.5" {...W} strokeWidth={1.4} />
        </>
      );
    case "fireworks":
      return (
        <>
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2;
            return (
              <path
                key={i}
                d={`M${12 + Math.cos(a) * 3.5} ${10 + Math.sin(a) * 3.5}L${12 + Math.cos(a) * 7.5} ${10 + Math.sin(a) * 7.5}`}
                {...W}
              />
            );
          })}
          <circle cx="12" cy="10" r="1.6" fill="#fff" />
        </>
      );
    case "jelly":
      return (
        <>
          <path d="M4.5 18c0-7 3-11.5 7.5-11.5S19.5 11 19.5 18c-2 1.2-13 1.2-15 0z" fill="#fff" />
          <circle cx="9.5" cy="13" r="1.1" fill="currentColor" />
          <circle cx="14.5" cy="13" r="1.1" fill="currentColor" />
        </>
      );
    case "aquarium":
      return (
        <>
          <path d="M4 12c3-4.5 8.5-4.5 12 0-3.5 4.5-9 4.5-12 0zM16 12l4-3v6z" fill="#fff" />
          <circle cx="8" cy="11.3" r="1" fill="currentColor" />
        </>
      );
    case "zoom":
      return (
        <>
          <path d="M3.5 15v-3l2.5-4h8l3.5 4h3v3z" fill="#fff" />
          <circle cx="7.5" cy="16" r="2" fill="currentColor" stroke="#fff" strokeWidth="1.4" />
          <circle cx="16.5" cy="16" r="2" fill="currentColor" stroke="#fff" strokeWidth="1.4" />
        </>
      );
    case "peekaboo":
      return (
        <>
          <path d="M8.5 9.5C7.5 5 8 3 9.3 3s1.7 2.5 1.2 6.5M15.5 9.5c1-4.5.5-6.5-.8-6.5s-1.7 2.5-1.2 6.5" fill="#fff" />
          <circle cx="12" cy="13.5" r="5.5" fill="#fff" />
          <circle cx="10" cy="13" r=".9" fill="currentColor" />
          <circle cx="14" cy="13" r=".9" fill="currentColor" />
        </>
      );
    case "faces":
      return (
        <>
          <circle cx="12" cy="13.5" r="6.5" fill="#fff" />
          <path d="M5.5 9.5L4 3.5l5 3.5M18.5 9.5L20 3.5l-5 3.5" fill="#fff" />
          <circle cx="9.6" cy="12.6" r="1" fill="currentColor" />
          <circle cx="14.4" cy="12.6" r="1" fill="currentColor" />
          <path d="M10 16c1.2 1 2.8 1 4 0" {...W} stroke="currentColor" strokeWidth={1.3} />
        </>
      );
    case "sparkle":
      return <path d="M4 17c3-6 5 2 8-4s5 1 8-5" {...W} strokeWidth={2.4} />;
    case "eggs":
    default:
      return (
        <>
          <path d="M12 3.5c3.6 0 6 5.2 6 9.3A6 6 0 0 1 6 12.8c0-4.1 2.4-9.3 6-9.3z" fill="#fff" />
          <path d="M6.6 11.5l2.4 1.6 2.2-1.8 2.2 1.8 2.2-1.6 1.8 1" {...W} stroke="currentColor" strokeWidth={1.3} />
        </>
      );
  }
}

export function GameGlyph({ id, hue, on }: { id: GameId; hue: number; on: boolean }) {
  return (
    <span
      className="grid h-11 w-11 shrink-0 place-items-center rounded-xl transition-transform duration-300"
      style={{
        color: `hsl(${hue} 80% 40%)`,
        background: `radial-gradient(80% 80% at 30% 22%, hsl(${hue} 95% 74%), hsl(${hue} 82% 46%) 70%, hsl(${hue} 80% 36%))`,
        boxShadow: on
          ? `0 0 0 2px hsl(${hue} 85% 62% / .6), 0 8px 22px hsl(${hue} 85% 50% / .35), inset 0 1px 0 rgba(255,255,255,.45)`
          : "inset 0 1px 0 rgba(255,255,255,.4), 0 4px 10px rgba(0,0,0,.3)",
        transform: on ? "scale(1.06) rotate(-4deg)" : undefined,
      }}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6">
        <Art id={id} />
      </svg>
    </span>
  );
}
