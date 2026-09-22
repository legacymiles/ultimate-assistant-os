"use client";

// The board. Drawn here rather than pulled from a library so the pieces share
// one construction language with the rest of the app's icons, and so the board
// sizes itself from its container instead of needing a pixel width handed to it.
//
// Moves are click-then-click, which works the same with a mouse and a thumb.

import { useMemo, useState } from "react";
import { Chess, type Square } from "chess.js";
import { cx } from "../ui";

export interface MoveInput { from: string; to: string; promotion?: string }

interface Props {
  fen: string;
  orientation: "white" | "black";
  /** Which colour this viewer may move right now. Null means watching. */
  canMove: "w" | "b" | null;
  lastMove?: { from: string; to: string } | null;
  onMove: (move: MoveInput) => boolean;
}

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];

const LIGHT = "#c9c0ad";
const DARK = "#41505f";

/* ── Pieces ────────────────────────────────────────────────────── */

const PIECE_PATHS: Record<string, React.ReactNode> = {
  p: (
    <>
      <circle cx="22.5" cy="14" r="5" />
      <path d="M22.5 19c-4.5 0-6.5 3-5.5 6l-3 7h17l-3-7c1-3-1-6-5.5-6z" />
      <path d="M12 32h21l1.5 5h-24z" />
    </>
  ),
  r: (
    <>
      <path d="M12 12h4v3h4v-3h5v3h4v-3h4v8h-2v13h3v4H11v-4h3V20h-2z" />
    </>
  ),
  n: (
    <>
      <path d="M14 37h19c0-7-1-15-6-20-2-2.5-3-4-3-6l-3-3-1.5 3L16 12.5c-3 1.5-4 4.5-2.5 7L16 18l1.5 2c-2.5 3-4.5 7-3.5 17z" />
      <circle cx="19.8" cy="15.6" r="1.1" className="fill-current" />
    </>
  ),
  b: (
    <>
      <circle cx="22.5" cy="7.5" r="2" />
      <path d="M22.5 10c3.5 3 6 7 6 11s-2.5 6.5-6 7c-3.5-.5-6-3-6-7s2.5-8 6-11z" />
      <path d="M22.5 13v8M19 16.5h7" />
      <path d="M15 28h15l2 4H13zM11 37h23v-4H11z" />
    </>
  ),
  q: (
    <>
      <path d="M12 21l2-8 4 6 4.5-9 4.5 9 4-6 2 8z" />
      <circle cx="12" cy="11" r="1.8" />
      <circle cx="18" cy="9" r="1.8" />
      <circle cx="22.5" cy="7" r="2" />
      <circle cx="27" cy="9" r="1.8" />
      <circle cx="33" cy="11" r="1.8" />
      <path d="M12.6 22h19.8l-1.6 8H14.2z" />
      <path d="M11 37h23v-6H11z" />
    </>
  ),
  k: (
    <>
      <path d="M22.5 6v7M19 9h7" />
      <path d="M13 22c0-6 6-8 9.5-4 3.5-4 9.5-2 9.5 4l-2 8H15z" />
      <path d="M11 37h23v-6H11z" />
    </>
  ),
};

function Piece({ type, color }: { type: string; color: "w" | "b" }) {
  const fill = color === "w" ? "#f4f1e8" : "#1e232f";
  const stroke = color === "w" ? "#2a3040" : "#9aa3b5";
  return (
    <svg
      viewBox="0 0 45 45"
      className="pointer-events-none h-full w-full"
      style={{ filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.42))" }}
      aria-hidden="true"
    >
      <g fill={fill} stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
        {PIECE_PATHS[type]}
      </g>
    </svg>
  );
}

const PIECE_NAMES: Record<string, string> = {
  p: "pawn", r: "rook", n: "knight", b: "bishop", q: "queen", k: "king",
};

/* ── Board ─────────────────────────────────────────────────────── */

export function ChessBoard({ fen, orientation, canMove, lastMove, onMove }: Props) {
  const game = useMemo(() => new Chess(fen), [fen]);
  const [from, setFrom] = useState<Square | null>(null);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);

  const files = orientation === "white" ? FILES : [...FILES].reverse();
  const ranks = orientation === "white" ? RANKS : [...RANKS].reverse();

  const legalFrom = (square: Square) => game.moves({ square, verbose: true });
  const isMine = (square: Square) => {
    const piece = game.get(square);
    return !!piece && !!canMove && piece.color === canMove && game.turn() === canMove;
  };
  const needsPromotion = (f: Square, t: Square) =>
    legalFrom(f).some((m) => m.to === t && m.promotion);

  const targets = from ? new Set(legalFrom(from).map((m) => m.to)) : new Set<string>();

  const checkedKing = game.inCheck()
    ? game.board().flat().find((p) => p && p.type === "k" && p.color === game.turn())?.square
    : undefined;

  const attempt = (f: Square, t: Square, promo?: string) => {
    onMove({ from: f, to: t, promotion: promo });
    setFrom(null);
    setPromotion(null);
  };

  const clickSquare = (square: Square) => {
    if (from && targets.has(square)) {
      if (needsPromotion(from, square)) { setPromotion({ from, to: square }); return; }
      attempt(from, square);
      return;
    }
    setFrom(isMine(square) ? (from === square ? null : square) : null);
  };

  return (
    <div className="relative mx-auto w-full max-w-[min(560px,72vh)]">
      <div
        className="grid overflow-hidden rounded-[10px] border border-[var(--cc-line)] shadow-[var(--cc-shadow)]"
        style={{ gridTemplateColumns: "repeat(8, 1fr)" }}
        role="grid"
        aria-label="Chess board"
      >
        {ranks.map((rank, r) =>
          files.map((file, f) => {
            const square = `${file}${rank}` as Square;
            const piece = game.get(square);
            const isLight = (r + f) % 2 === 0;
            const isTarget = targets.has(square);
            const isCapture = isTarget && !!game.get(square);
            const isLast = lastMove && (lastMove.from === square || lastMove.to === square);
            const selectable = isMine(square) || isTarget;

            return (
              <button
                key={square}
                type="button"
                role="gridcell"
                onClick={() => clickSquare(square)}
                disabled={!canMove && !piece}
                aria-label={
                  piece
                    ? `${square}, ${piece.color === "w" ? "white" : "black"} ${PIECE_NAMES[piece.type]}`
                    : `${square}, empty`
                }
                className={cx(
                  "relative aspect-square w-full",
                  selectable ? "cursor-pointer" : "cursor-default",
                )}
                style={{ background: isLight ? LIGHT : DARK }}
              >
                {isLast && (
                  <span className="absolute inset-0" style={{ background: "rgba(240,135,60,0.34)" }} />
                )}
                {square === checkedKing && (
                  <span
                    className="absolute inset-0"
                    style={{
                      background:
                        "radial-gradient(circle, rgba(244,81,123,0.85) 0%, rgba(244,81,123,0.3) 58%, transparent 74%)",
                    }}
                  />
                )}
                {from === square && (
                  <span className="absolute inset-0" style={{ background: "rgba(52,209,122,0.36)" }} />
                )}

                {/* Rank and file labels ride the board edge, as on a real set. */}
                {f === 0 && (
                  <span
                    className="cc-num pointer-events-none absolute left-[3px] top-[2px] text-[9px] font-semibold"
                    style={{ color: isLight ? "#6f6757" : "#9daab8" }}
                  >
                    {rank}
                  </span>
                )}
                {r === 7 && (
                  <span
                    className="cc-num pointer-events-none absolute bottom-[1px] right-[3px] text-[9px] font-semibold"
                    style={{ color: isLight ? "#6f6757" : "#9daab8" }}
                  >
                    {file}
                  </span>
                )}

                {piece && (
                  <span className="absolute inset-[6%]">
                    <Piece type={piece.type} color={piece.color} />
                  </span>
                )}

                {isTarget && (
                  <span
                    className={cx(
                      "pointer-events-none absolute",
                      isCapture
                        ? "inset-[4%] rounded-full border-[3px] border-[rgba(27,32,48,0.42)]"
                        : "left-1/2 top-1/2 h-[22%] w-[22%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[rgba(27,32,48,0.36)]",
                    )}
                  />
                )}
              </button>
            );
          }),
        )}
      </div>

      {promotion && (
        <div className="absolute inset-0 flex items-center justify-center bg-[rgba(10,11,15,0.78)]">
          <div className="rounded-[var(--cc-radius)] border border-[var(--cc-line)] bg-[var(--cc-panel)] p-3">
            <p className="mb-2 text-center text-[12px] font-semibold">Promote to</p>
            <div className="flex gap-1.5">
              {(["q", "r", "b", "n"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => attempt(promotion.from, promotion.to, type)}
                  aria-label={`Promote to ${PIECE_NAMES[type]}`}
                  className="h-12 w-12 rounded-lg border border-[var(--cc-line)] bg-[var(--cc-elevated)] p-1
                             transition-colors duration-150 hover:border-[var(--cc-ember)]"
                >
                  <Piece type={type} color={canMove ?? "w"} />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => { setPromotion(null); setFrom(null); }}
              className="mt-2 w-full text-[11px] text-[var(--cc-ink-faint)] transition-colors hover:text-[var(--cc-ink)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
