"use client";

// The table itself: four seats around a trick, your hand fanned underneath,
// and the bidding box when it is your turn to call.
//
// Seats are drawn relative to you — you are always at the bottom — because a
// partnership game is only readable when "across from me" means your partner.

import { useEffect } from "react";
import type { GameState } from "@/lib/cook-connect/spades";
import { getSuit, getTeam, isValidPlay, sortHand } from "@/lib/cook-connect/spades";
import type { FxLevel, GameTheme, SuitKey } from "@/lib/cook-connect/gameStyle";
import type { SeatView } from "@/lib/cook-connect/hooks/useSpades";
import { Avatar, Button, Tag, cx } from "../ui";
import { BotIcon } from "../icons";
import { PlayingCard } from "./PlayingCard";
import { Burst, FxStage, clashStyle, useSpadesMoments, type NilFx } from "./SpadesFx";

interface Props {
  state: GameState;
  table: SeatView[];
  mySeat: number;
  onBid: (bid: number) => void;
  onPlay: (card: string) => void;
  /** The active Game Play Design Styling theme. */
  theme: GameTheme;
  fxLevel: FxLevel;
  onFxLevel: (level: FxLevel) => void;
  /** The hand being played, so moments are tied to it. */
  round: number;
  /** The team whose score should crumble (they just got set). */
  onCrumble?: (team: number | null) => void;
  /** "Renig" pressed: every card in your hand can be played. Only you see this. */
  unlocked?: boolean;
  onToggleUnlock?: () => void;
  /** "Call renig": opens the room's opponent picker. */
  onCallRenig?: () => void;
}

const FX_LEVELS: { id: FxLevel; label: string }[] = [
  { id: "full", label: "Full" },
  { id: "quick", label: "Quick" },
  { id: "off", label: "Off" },
];

/** Where each seat sits on screen, given which seat is yours. */
const POSITIONS = ["bottom", "left", "top", "right"] as const;
type Position = (typeof POSITIONS)[number];

/** How far a won trick travels when it sweeps to the seat that took it. */
const SWEEP: Record<Position, { x: string; y: string }> = {
  bottom: { x: "0px", y: "160px" },
  left: { x: "-200px", y: "0px" },
  top: { x: "0px", y: "-160px" },
  right: { x: "200px", y: "0px" },
};

export function SpadesTable({
  state, table, mySeat, onBid, onPlay, theme, fxLevel, onFxLevel, round, onCrumble,
  unlocked = false, onToggleUnlock, onCallRenig,
}: Props) {
  const seated = mySeat >= 0;
  const viewFrom = seated ? mySeat : 0;
  const positionOf = (seat: number): Position => POSITIONS[(seat - viewFrom + 4) % 4];

  const myHand = seated ? sortHand(state.hands[mySeat] ?? []) : [];
  const myTurn = seated && state.currentTurn === mySeat;
  const nameOf = (seat: number) =>
    seat === mySeat ? "You" : table.find((t) => t.seat === seat)?.name.split(" ")[0] ?? "Someone";

  // The moments read only a settled call (state.renigCall), never the secret record.
  const fx = useSpadesMoments({ state, round, theme, level: fxLevel, nameOf });
  const { clash } = fx;

  // Tell the score board when a team's score should crumble.
  useEffect(() => { onCrumble?.(fx.crumbleTeam); }, [fx.crumbleTeam]); // eslint-disable-line react-hooks/exhaustive-deps

  // A finished trick is held while it fights, then swept to the winner.
  const shownTrick = clash && state.currentTrick.length === 0 ? clash.trick : state.currentTrick;
  const sweeping = !!clash && clash.phase === "sweep" && state.currentTrick.length === 0;
  const sweepTo = sweeping ? SWEEP[positionOf(clash!.winner)] : null;
  const clashColor = clash ? theme.suits[getSuit(clash.trick.find((t) => t.seat === clash.winner)!.card) as SuitKey].color : "";

  return (
    <div className="flex flex-col gap-3">
      {/* The table */}
      <div
        className={cx("relative mx-auto grid w-full max-w-[560px] gap-2 rounded-[18px] border border-[#243244] p-3", fx.shake)}
        style={{
          gridTemplateAreas: '"tl top tr" "left center right" "bl bottom br"',
          gridTemplateColumns: "minmax(0,1fr) minmax(0,1.6fr) minmax(0,1fr)",
          gridTemplateRows: "auto minmax(126px,auto) auto",
          background: `radial-gradient(ellipse at center, ${theme.felt[0]} 0%, ${theme.felt[1]} 72%)`,
        }}
      >
        <FxStage banner={fx.banner} />
        {table.map((seat) => {
          const position = positionOf(seat.seat);
          return (
            <div key={seat.seat} style={{ gridArea: position }} className="flex items-center justify-center">
              <SeatPlate
                seat={seat}
                position={position}
                isMe={seat.seat === mySeat}
                bid={state.bids[seat.seat]}
                tricks={state.tricksWon[seat.seat] ?? 0}
                turn={state.currentTurn === seat.seat && state.phase !== "gameEnd"}
                dealer={state.dealer === seat.seat}
                cardsLeft={(state.hands[seat.seat] ?? []).length}
                showCardsLeft={state.phase === "playing"}
                nil={fx.shields[seat.seat]}
                nilColor={theme.nilShield.color}
                nilText={theme.nilShield.text}
              />
            </div>
          );
        })}

        {/* The trick */}
        <div style={{ gridArea: "center" }} className="relative flex items-center justify-center">
          {shownTrick.length === 0 ? (
            <p className="max-w-[22ch] text-center text-[12px] leading-snug text-[var(--cc-ink-faint)]">
              {state.phase === "bidding"
                ? "Everyone calls how many tricks they will take."
                : state.phase === "gameEnd"
                  ? "Game over."
                  : "Waiting for the lead."}
            </p>
          ) : (
            <div
              className={cx("flex items-center gap-1.5", sweeping && "cc-trick-sweep")}
              style={sweepTo ? ({ "--cc-sweep-x": sweepTo.x, "--cc-sweep-y": sweepTo.y } as React.CSSProperties) : undefined}
            >
              {shownTrick.map((play) => {
                const player = table.find((t) => t.seat === play.seat);
                const look = clashStyle(state.currentTrick.length === 0 ? clash : null, play, theme);
                return (
                  <div key={`${play.seat}-${play.card}`} className="flex flex-col items-center gap-1">
                    <div className={look.className} style={look.style}>
                      <PlayingCard card={play.card} size="md" />
                      {look.hit && <span className={look.hit} aria-hidden="true" />}
                      {look.callout && <span className="fx-callout">{look.callout}</span>}
                    </div>
                    <span className="max-w-[54px] truncate text-[9px] text-[var(--cc-ink-faint)]">
                      {player?.name.split(" ")[0] ?? ""}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {clash?.phase === "clash" && clash.dur > 0 && state.currentTrick.length === 0 && (
            <div
              key={clash.id}
              className="fx-stage"
              style={{ "--fx-dur": `${clash.dur}ms`, "--fx-color": clashColor } as React.CSSProperties}
              aria-hidden="true"
            >
              <Burst count={6 + theme.clash.intensity * 5} emoji={clash.steal ? theme.confetti : undefined} />
            </div>
          )}

          {state.spadeBroken && state.phase === "playing" && (
            <span className="absolute -bottom-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--cc-ink-faint)]">
              Spades broken
            </span>
          )}
        </div>
      </div>

      {/* Bidding */}
      {seated && state.phase === "bidding" && myTurn && (
        <div className="rounded-[var(--cc-radius)] border border-[var(--cc-ember)] bg-[var(--cc-ember-wash)] p-3">
          <p className="text-[13px] font-semibold">How many tricks will you take?</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--cc-ink-muted)]">
            Nil is a bet that you take none — worth a hundred if you pull it off, and a hundred
            against you if you do not.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1">
            {Array.from({ length: 14 }, (_, n) => (
              <button
                key={n}
                type="button"
                onClick={() => onBid(n)}
                className={cx(
                  "cc-num h-8 min-w-[34px] rounded-md border px-2 text-[13px] font-semibold",
                  "transition-colors duration-150",
                  n === 0
                    ? "border-[var(--cc-gold)] text-[var(--cc-gold)] hover:bg-[rgba(232,194,106,0.14)]"
                    : "border-[var(--cc-line)] bg-[var(--cc-elevated)] hover:border-[var(--cc-ember)] hover:text-[var(--cc-ember)]",
                )}
              >
                {n === 0 ? "Nil" : n}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Your hand */}
      {seated && (
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--cc-ink-faint)]">
              Your hand
              <span className="cc-num ml-1.5 normal-case tracking-normal">{myHand.length}</span>
            </span>
            <span className="flex items-center gap-2">
              {state.phase === "playing" && (
                <span className={cx("text-[12px] font-semibold", myTurn ? "text-[var(--cc-live)]" : "text-[var(--cc-ink-faint)]")}>
                  {myTurn ? "Your turn" : `${table.find((t) => t.seat === state.currentTurn)?.name ?? "Someone"} to play`}
                </span>
              )}
              {onToggleUnlock && (state.phase === "playing" || state.phase === "bidding") && myHand.length > 0 && (
                <button
                  type="button"
                  onClick={onToggleUnlock}
                  aria-pressed={unlocked}
                  title={unlocked ? "Back to following suit" : "Unlock every card in your hand"}
                  className={cx(
                    "rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors duration-150",
                    unlocked
                      ? "border-[var(--cc-ember)] bg-[var(--cc-ember-wash)] text-[var(--cc-ember)]"
                      : "border-[var(--cc-line)] bg-[var(--cc-elevated)] text-[var(--cc-ink-muted)] hover:text-[var(--cc-ink)]",
                  )}
                >
                  Renig
                </button>
              )}
            </span>
          </div>

          <div className="flex flex-wrap items-end gap-1 rounded-[var(--cc-radius)] border border-[var(--cc-line)] bg-[var(--cc-panel)] p-2">
            {myHand.length === 0 ? (
              <p className="px-1 py-3 text-[12px] text-[var(--cc-ink-muted)]">
                Your hand is empty — the round is over.
              </p>
            ) : (
              myHand.map((card) => {
                const legal = myTurn
                  && state.phase === "playing"
                  && isValidPlay(card, state.hands[mySeat] ?? [], state.currentTrick, state.spadeBroken);
                const playable = legal || (unlocked && myTurn && state.phase === "playing");
                return (
                  <PlayingCard
                    key={card}
                    card={card}
                    size="lg"
                    playable={playable}
                    dimmed={state.phase === "playing" && myTurn && !playable}
                    onClick={() => onPlay(card)}
                  />
                );
              })
            )}
          </div>

          {myTurn && state.phase === "playing" && (
            <p className="mt-1.5 text-[11px] text-[var(--cc-ink-faint)]">
              {unlocked
                ? "Every card is unlocked. Play anything — but if someone calls renig on you and you broke the rules, your team loses."
                : "Follow the suit that was led if you can. Cards you cannot legally play are dimmed."}
            </p>
          )}
        </div>
      )}

      {/* Renig calls and how much of the show to play */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {seated && onCallRenig && (state.phase === "playing" || state.phase === "bidding") ? (
          <Button onClick={onCallRenig} title="Accuse an opponent. Right and their team loses; wrong and yours does.">
            Call renig
          </Button>
        ) : <span />}
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--cc-ink-faint)]">
          <span title={`Theme: ${theme.name}`}>{theme.icon} Effects</span>
          <div className="flex overflow-hidden rounded-md border border-[var(--cc-line)]">
            {FX_LEVELS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => onFxLevel(l.id)}
                className={cx(
                  "px-2 py-1 text-[11px] font-semibold transition-colors",
                  fxLevel === l.id ? "bg-[var(--cc-ember-wash)] text-[var(--cc-ember)]" : "hover:bg-[var(--cc-elevated)]",
                )}
                aria-pressed={fxLevel === l.id}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!seated && (
        <p className="rounded-[var(--cc-radius)] border border-[var(--cc-line)] bg-[var(--cc-panel)] p-3 text-[13px] text-[var(--cc-ink-muted)]">
          You are watching this table. Take a free seat to play.
        </p>
      )}
    </div>
  );
}

function SeatPlate({
  seat, position, isMe, bid, tricks, turn, dealer, cardsLeft, showCardsLeft, nil, nilColor, nilText,
}: {
  nil?: NilFx;
  nilColor: string;
  nilText: string;
  seat: SeatView;
  position: Position;
  isMe: boolean;
  bid: number | null;
  tricks: number;
  turn: boolean;
  dealer: boolean;
  cardsLeft: number;
  showCardsLeft: boolean;
}) {
  const empty = !seat.userId;
  const team = getTeam(seat.seat);

  return (
    <div
      className={cx(
        nil && "fx-nil",
        nil === "pulse" && "is-pulse",
        nil === "shatter" && "is-shatter",
        "flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5",
        "transition-colors duration-150",
        turn
          ? "cc-turn border-[var(--cc-live)] bg-[var(--cc-live-wash)]"
          : "border-[var(--cc-line)] bg-[var(--cc-panel)]",
        position === "top" && "flex-row-reverse",
        empty && "border-dashed opacity-70",
      )}
      style={nil ? ({ "--fx-color": nilColor } as React.CSSProperties) : undefined}
    >
      {nil && nil !== "shatter" && <span className="fx-nil-label">{nilText}</span>}
      {empty ? (
        <span className="h-7 w-7 rounded-full border border-dashed border-[var(--cc-line)]" />
      ) : seat.isBot ? (
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--cc-elevated)] text-[var(--cc-ink-faint)]">
          <BotIcon size={14} />
        </span>
      ) : (
        <Avatar id={seat.userId} name={seat.name} url={seat.avatar} size={28} online={seat.online} />
      )}

      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={cx("truncate text-[12px] font-semibold", isMe && "text-[var(--cc-ember)]")}>
            {empty ? "Open seat" : isMe ? "You" : seat.name.split(" ")[0]}
          </span>
          {dealer && <Tag>D</Tag>}
        </div>
        <div className="cc-num flex items-center gap-1.5 whitespace-nowrap text-[11px] text-[var(--cc-ink-faint)]">
          <span title={`Team ${team}`}>T{team}</span>
          <span title="Bid and tricks taken">
            {bid === null ? "—" : bid === 0 ? "nil" : bid}
            <span className="text-[var(--cc-ink-muted)]">/{tricks}</span>
          </span>
          {showCardsLeft && <span title="Cards left">· {cardsLeft}</span>}
        </div>
      </div>
    </div>
  );
}
