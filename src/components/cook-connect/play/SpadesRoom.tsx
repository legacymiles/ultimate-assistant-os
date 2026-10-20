"use client";

// A spades table: the board, the running score, and the room around it.

import { useEffect, useState } from "react";
import { useCook } from "../CookConnect";
import { Columns } from "../Columns";
import { useSpades } from "@/lib/cook-connect/hooks/useSpades";
import { WINNING_SCORE, getTeam, renegeRuleOn, RENEGE_PENALTY_TRICKS } from "@/lib/cook-connect/spades";
import { useFxLevel, useGameStyle } from "@/lib/cook-connect/hooks/useGameStyle";
import { rooms } from "@/lib/cook-connect/types";
import {
  Button, EmptyState, Loading, Panel, SectionHead, Tag, cx,
} from "../ui";
import { BotIcon, PlayIcon, TrophyIcon } from "../icons";
import { SpadesTable } from "./SpadesTable";
import { ChatPanel } from "./ChatPanel";
import { VideoPanel } from "./VideoPanel";

export function SpadesRoom({ matchId }: { matchId: string }) {
  const { sb, userId, navigate, notify } = useCook();
  const game = useSpades(sb, userId, matchId);
  const style = useGameStyle();
  const [fxLevel, setFxLevel] = useFxLevel();
  const [crumbleTeam, setCrumbleTeam] = useState<number | null>(null);

  // The hook raises its own notices; surface them through the app's toast.
  useEffect(() => {
    if (!game.notice) return;
    notify(game.notice);
    game.setNotice(null);
  }, [game.notice, game.setNotice, notify, game]);

  if (game.loading) return <Columns><Loading label="Setting the table" /></Columns>;

  if (!game.match || !game.game) {
    return (
      <Columns>
        <Panel>
          <EmptyState
            title="That table is gone"
            body="It was closed, or the link was wrong. The lobby will have another."
            action={<Button variant="primary" onClick={() => navigate({ page: "play" })}>Back to the lobby</Button>}
          />
        </Panel>
      </Columns>
    );
  }

  const { match, state } = game;
  const waiting = match.status === "pending" || !state;
  const over = state?.phase === "gameEnd" || match.status === "done";
  const myTeam = game.mySeat >= 0 ? getTeam(game.mySeat) : null;
  const winningTeam = match.winning_team
    ?? (game.game.team1_score > game.game.team2_score ? 1 : 2);

  return (
    <Columns
      rail={
        <>
          <Panel>
            <SectionHead title="Score" count={`to ${WINNING_SCORE}`} />
            <div className="p-3">
              {[1, 2].map((team) => {
                const score = team === 1 ? game.game!.team1_score : game.game!.team2_score;
                const bags = team === 1 ? game.game!.team1_bags : game.game!.team2_bags;
                const members = game.table.filter((t) => t.team === team);
                return (
                  <div
                    key={team}
                    className={cx(
                      "flex items-center gap-3 rounded-lg px-2 py-2",
                      team === 1 && "mb-1",
                      myTeam === team && "bg-[var(--cc-ember-wash)]",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[12px] font-semibold">
                        Team {team}
                        {myTeam === team && <Tag tone="ember">You</Tag>}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--cc-ink-faint)]">
                        {members.map((m) => (m.userId ? m.name.split(" ")[0] : "open")).join(" & ")}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className={cx("cc-num block text-[19px] font-bold leading-none", crumbleTeam === team && "fx-crumble")}>
                        {score}
                      </span>
                      <span className="cc-num block text-[10px] text-[var(--cc-ink-faint)]">
                        {bags} bag{bags === 1 ? "" : "s"}
                      </span>
                    </span>
                  </div>
                );
              })}
              <p className="mt-2 border-t border-[var(--cc-line-soft)] pt-2 text-[11px] leading-relaxed text-[var(--cc-ink-faint)]">
                Round <span className="cc-num">{game.game!.current_round}</span>
                {state && state.phase !== "gameEnd" && (
                  <> · trick <span className="cc-num">{Math.min(13, state.trickNumber)}</span> of 13</>
                )}
                . Ten bags costs a hundred points.
              </p>
              {state && (
                <label
                  className={cx(
                    "mt-2 flex items-start gap-2 border-t border-[var(--cc-line-soft)] pt-2 text-[11px] leading-relaxed",
                    state.phase === "bidding" && game.isSeated ? "cursor-pointer" : "opacity-70",
                  )}
                  title={state.phase === "bidding" ? undefined : "House rules change while everyone is bidding"}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={renegeRuleOn(state)}
                    disabled={state.phase !== "bidding" || !game.isSeated}
                    onChange={(e) => void game.setRenegeRule(e.target.checked)}
                  />
                  <span>
                    <span className="font-semibold">Renege rule</span>
                    <span className="block text-[var(--cc-ink-faint)]">
                      Off-suit plays are allowed. Get caught and your team gives up {RENEGE_PENALTY_TRICKS} tricks.
                    </span>
                  </span>
                </label>
              )}
            </div>
          </Panel>

          <VideoPanel room={rooms.match(matchId)} title="Table video" />
          <ChatPanel room={rooms.match(matchId)} title="Table chat" height="h-[220px]" placeholder="Nice lead…" />
        </>
      }
    >
      {waiting ? (
        <Panel className="mb-4">
          <SectionHead title="Waiting for players" count={`${game.seats.length} of 4`} />
          <div className="p-4">
            <p className="text-[13px] leading-relaxed text-[var(--cc-ink-muted)]">
              The hand deals itself the moment four seats are taken. If you would rather not wait, the
              computer will take whatever is left, and hand the seat back if someone real turns up.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {!game.isSeated && (
                <Button variant="primary" onClick={() => void game.sit()}>
                  Take a seat
                </Button>
              )}
              {game.isSeated && (
                <Button variant="primary" onClick={() => void game.startWithBots()}>
                  <BotIcon size={14} />
                  Start with computer players
                </Button>
              )}
              <Button onClick={() => navigate({ page: "play" })}>Back to the lobby</Button>
            </div>
          </div>
        </Panel>
      ) : (
        <>
          {over && (
            <Panel className="mb-4 border-[var(--cc-gold)]">
              <div className="flex flex-wrap items-center gap-3 p-3">
                <span className="text-[var(--cc-gold)]"><TrophyIcon size={22} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold">
                    {myTeam === winningTeam ? "You won." : myTeam ? "Team " + winningTeam + " took it." : `Team ${winningTeam} won.`}
                  </p>
                  <p className="cc-num text-[12px] text-[var(--cc-ink-muted)]">
                    {game.game.team1_score} – {game.game.team2_score}
                  </p>
                </div>
                <Button
                  variant="primary"
                  disabled={game.iVotedRematch}
                  onClick={() => void game.voteRematch()}
                >
                  <PlayIcon size={14} />
                  {game.iVotedRematch
                    ? `Waiting (${game.rematchVotes}/${game.votesNeeded})`
                    : "Play again"}
                </Button>
                <Button onClick={() => navigate({ page: "play" })}>Lobby</Button>
              </div>
            </Panel>
          )}

          <SpadesTable
            state={state!}
            table={game.table}
            mySeat={game.mySeat}
            onBid={(bid) => void game.makeBid(bid)}
            onPlay={(card) => void game.playCard(card)}
            theme={style.theme}
            fxLevel={fxLevel}
            onFxLevel={setFxLevel}
            round={game.game.current_round}
            onCallRenege={() => void game.callRenege()}
            onCrumble={setCrumbleTeam}
          />

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {game.iLeft ? (
              <Button variant="primary" onClick={() => void game.retakeSeat()}>
                Take my seat back
              </Button>
            ) : game.isSeated && !over ? (
              <Button variant="danger" onClick={() => void game.quit()}>
                Leave the table
              </Button>
            ) : !game.isSeated ? (
              <Button variant="primary" onClick={() => void game.sit()}>
                Take a seat
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => navigate({ page: "play" })}>
              Back to the lobby
            </Button>
            {game.iLeft && (
              <span className="text-[12px] text-[var(--cc-ink-muted)]">
                A computer player is holding your seat.
              </span>
            )}
          </div>
        </>
      )}
    </Columns>
  );
}
