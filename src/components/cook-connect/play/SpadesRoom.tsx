"use client";

// A spades table: the board, the running score, and the room around it.

import { useEffect, useState } from "react";
import { useCook } from "../CookConnect";
import { Columns } from "../Columns";
import { useSpades } from "@/lib/cook-connect/hooks/useSpades";
import { useFxLevel, useGameStyle } from "@/lib/cook-connect/hooks/useGameStyle";
import { RANK_DISPLAY, SUIT_SYMBOLS, WINNING_SCORE, getRank, getSuit, getTeam } from "@/lib/cook-connect/spades";
import { joinNames, stageExplainer, waitingLine } from "@/lib/cook-connect/lobby";
import { accusableSeats, callHeadline, evidenceLine } from "@/lib/cook-connect/renege";
import { rooms } from "@/lib/cook-connect/types";
import {
  Avatar, Button, EmptyState, Loading, Panel, SectionHead, Tag, cx,
} from "../ui";
import { BotIcon, CheckIcon, ClockIcon, FlagIcon, PlayIcon } from "../icons";
import { SpadesTable } from "./SpadesTable";
import { ChatPanel } from "./ChatPanel";
import { CallAudio, VideoStage, useSeatVideo } from "./TableVideo";
import { useVideoCall } from "@/lib/cook-connect/hooks/useVideoCall";
import { PlayingCard } from "./PlayingCard";
import { GameOverPopup, HandOverPopup, OutOfTurnPopup, PopBar, useRankShift } from "./SpadesPopups";

const cardName = (card: string) => `${RANK_DISPLAY[getRank(card)]}${SUIT_SYMBOLS[getSuit(card)]}`;

export function SpadesRoom({ matchId }: { matchId: string }) {
  const { sb, userId, navigate, notify, profile } = useCook();
  const game = useSpades(sb, userId, matchId);
  // One video call per table: each player shows live on their own seat, and
  // one of them at a time is enlarged in the strip above the table.
  const video = useVideoCall(sb, profile, rooms.match(matchId));
  const seatVideo = useSeatVideo(video, game.table, userId);
  const [accusing, setAccusing] = useState(false);
  const style = useGameStyle();
  const [fxLevel, setFxLevel] = useFxLevel();
  const [crumbleTeam, setCrumbleTeam] = useState<number | null>(null);
  /** Which results screen was shrunk to a bar ("round:N" or "game:<round>"). */
  const [minimized, setMinimized] = useState<string | null>(null);
  /** A card waiting on "Are you sure you want to play out of turn?". */
  const [outOfTurn, setOutOfTurn] = useState<string | null>(null);

  const finished = game.state?.phase === "gameEnd" || game.match?.status === "done";
  const rank = useRankShift(sb, matchId, userId, finished && game.mySeat >= 0);

  // Matchmaking found an older waiting table; follow it there.
  useEffect(() => {
    if (game.movedTo && game.movedTo !== matchId) navigate({ page: "spades", matchId: game.movedTo });
  }, [game.movedTo, matchId, navigate]);

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
  const call = game.renigCall;
  const canCall = !waiting && !over && game.mySeat >= 0
    && (state?.phase === "bidding" || state?.phase === "playing");
  const myTeam = game.mySeat >= 0 ? getTeam(game.mySeat) : null;
  const winningTeam = call?.winningTeam ?? match.winning_team
    ?? (game.game.team1_score > game.game.team2_score ? 1 : 2);
  const handOver = !waiting && state?.phase === "roundEnd" && !!state.lastRound;
  const handKey = `round:${game.game.current_round}`;
  const gameKey = `game:${game.game.current_round}`;
  const teamNames = {
    1: game.table.filter((t) => t.team === 1).map((m) => (m.userId ? (m.seat === game.mySeat ? "You" : m.name.split(" ")[0]) : "open")).join(" & "),
    2: game.table.filter((t) => t.team === 2).map((m) => (m.userId ? (m.seat === game.mySeat ? "You" : m.name.split(" ")[0]) : "open")).join(" & "),
  };
  const nextGameLabel = game.iVotedRematch ? `Waiting (${game.rematchVotes}/${game.votesNeeded})` : "Next game";
  const seatFirst = (seat: number) => {
    const s = game.table.find((t) => t.seat === seat);
    return seat === game.mySeat ? "You" : s?.userId ? s.name.split(" ")[0] : "Open";
  };

  return (
    <Columns
      rail={
        <>
          <Panel>
            <SectionHead title="Score" count={`to ${WINNING_SCORE}`} />
            <div className="p-3">
              {[1, 2].map((team) => {
                const score = team === 1 ? game.game!.team1_score : game.game!.team2_score;
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
                        {Math.max(0, WINNING_SCORE - score)} to win
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
                . Dealer: <span className="font-semibold">{state ? seatFirst(state.dealer) : "—"}</span>.
              </p>
            </div>
          </Panel>

          <div className="hidden lg:block">
            <VideoStage
              call={video}
              tiles={seatVideo.tiles}
              onVideoCount={seatVideo.onVideoCount}
              onClose={seatVideo.close}
              waiting={waiting}
              place="rail"
            />
          </div>
          <ChatPanel
            room={rooms.match(matchId)}
            title="Table chat"
            height="h-[220px]"
            placeholder={waiting ? "Bots or wait?" : "Nice lead…"}
          />
        </>
      }
    >
      {/* Video gets its own room — above the table on a phone, in the side
          column on a laptop — never on top of the cards. */}
      <div className="lg:hidden">
        <VideoStage
          call={video}
          tiles={seatVideo.tiles}
          onVideoCount={seatVideo.onVideoCount}
          onClose={seatVideo.close}
          waiting={waiting}
        />
      </div>
      <CallAudio feeds={video.remoteFeeds} />

      {waiting ? (
        <WaitingRoom game={game} onLobby={() => navigate({ page: "play" })} />
      ) : (
        <>
          {call && (
            <Panel className={cx("mb-4", call.correct ? "border-[var(--cc-gold)]" : "border-[#5d2338]")}>
              <div className="flex flex-wrap items-start gap-3 p-3">
                <span className={call.correct ? "text-[var(--cc-gold)]" : "text-[var(--cc-loss)]"}>
                  <FlagIcon size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold">{callHeadline(call, game.nameOfSeat)}</p>
                  {call.byBot && (
                    <p className="text-[12px] text-[var(--cc-ink-muted)]">The computer spotted it.</p>
                  )}
                  {call.evidence && (
                    <>
                      <p className="mt-1 text-[12px] leading-relaxed text-[var(--cc-ink-muted)]">
                        {evidenceLine(call.evidence, game.nameOfSeat, cardName)}
                      </p>
                      <div className="mt-2 flex flex-wrap items-end gap-1.5">
                        {call.evidence.trick.map((play) => (
                          <div key={`${play.seat}-${play.card}`} className="flex flex-col items-center gap-1">
                            <PlayingCard
                              card={play.card}
                              size="sm"
                              className={cx(play.seat === call.evidence!.seat && "ring-2 ring-[var(--cc-loss)]")}
                            />
                            <span className="max-w-[54px] truncate text-[9px] text-[var(--cc-ink-faint)]">
                              {game.nameOfSeat(play.seat)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
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
            onCrumble={setCrumbleTeam}
            unlocked={game.unlocked}
            onToggleUnlock={canCall ? () => game.setUnlocked(!game.unlocked) : undefined}
            onCallRenig={canCall && !accusing ? () => setAccusing(true) : undefined}
            scores={{ team1: game.game.team1_score, team2: game.game.team2_score }}
            onDeal={() => void game.deal()}
            onAskOutOfTurn={(card) => setOutOfTurn(card)}
            tableId={matchId}
            seatVideo={seatVideo.seatVideo}
          />

          {outOfTurn && state?.phase === "playing" && (
            <OutOfTurnPopup
              card={outOfTurn}
              theme={style.theme}
              onCancel={() => setOutOfTurn(null)}
              onConfirm={() => { const card = outOfTurn; setOutOfTurn(null); void game.playOutOfTurn(card); }}
            />
          )}

          {/* End of a hand: results, then Next. It never deals by itself. */}
          {handOver && game.isSeated && (minimized === handKey ? (
            <PopBar
              text={game.iAmReady ? "Waiting for the others…" : `Hand ${state!.lastRound!.round} is over.`}
              action={game.iAmReady ? "Waiting…" : "Next hand"}
              onAction={() => void game.nextHand()}
              onOpen={() => setMinimized(null)}
            />
          ) : (
            <HandOverPopup
              recap={state!.lastRound!}
              totals={{ team1: game.game.team1_score, team2: game.game.team2_score }}
              myTeam={myTeam}
              nameOf={seatFirst}
              theme={style.theme}
              onNext={() => void game.nextHand()}
              iAmReady={game.iAmReady}
              waitingOn={game.waitingOnNext.map(game.firstName)}
              onMinimize={() => setMinimized(handKey)}
            />
          ))}

          {/* End of the game: the result and the leaderboard move, then Next game. */}
          {over && (minimized === gameKey || !game.isSeated ? (
            <PopBar
              text={myTeam === winningTeam ? "You won." : myTeam ? `Team ${winningTeam} took it.` : `Team ${winningTeam} won.`}
              action={game.isSeated ? nextGameLabel : "Lobby"}
              onAction={() => (game.isSeated ? void game.voteRematch() : navigate({ page: "play" }))}
              onOpen={() => setMinimized(null)}
            />
          ) : (
            <GameOverPopup
              won={myTeam === winningTeam}
              spectator={!myTeam}
              finalScore={{ team1: game.game.team1_score, team2: game.game.team2_score }}
              myTeam={myTeam}
              teamNames={teamNames}
              headline={call ? callHeadline(call, game.nameOfSeat) : null}
              theme={style.theme}
              rank={rank.shift}
              rankState={rank.state}
              onNext={() => void game.voteRematch()}
              nextLabel={nextGameLabel}
              nextDisabled={game.iVotedRematch}
              onLeaderboard={() => navigate({ page: "leaderboards" })}
              onLobby={() => navigate({ page: "play" })}
              onMinimize={() => setMinimized(gameKey)}
            />
          ))}

          {canCall && accusing && (
            <Panel className="mt-3 border-[var(--cc-ember)]">
              <div className="p-3">
                <p className="text-[13px] font-semibold">Who reneged?</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--cc-ink-muted)]">
                  The game ends as soon as you call it. If they really did renig, their team loses.
                  If they didn&apos;t, your team loses.
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {accusableSeats(game.mySeat).map((seat) => (
                    <Button
                      key={seat}
                      variant="danger"
                      onClick={() => { setAccusing(false); void game.callRenig(seat); }}
                    >
                      {game.table.find((t) => t.seat === seat)?.isBot && <BotIcon size={13} />}
                      {game.nameOfSeat(seat)}
                    </Button>
                  ))}
                  <Button variant="ghost" onClick={() => setAccusing(false)}>Never mind</Button>
                </div>
              </div>
            </Panel>
          )}

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

type SpadesHook = ReturnType<typeof useSpades>;

/**
 * Before the deal: who is here, and what they can do about it. One person can
 * start with computers straight away; two or three all have to agree. Chat
 * and video sit in the rail beside this the whole time.
 */
function WaitingRoom({ game, onLobby }: { game: SpadesHook; onLobby: () => void }) {
  const { lobby } = game;
  const names = (ids: string[]) => ids.map(game.firstName);
  const othersWaitingOn = lobby.waitingOn.filter((id) => game.firstName(id) !== "You");
  const iNeedToAgree = game.isSeated && !lobby.iAgreed;
  const startingNow = game.starting || game.busy || lobby.stage === "full";
  const botLine = lobby.botCount === 1 ? "1 computer player" : `${lobby.botCount} computer players`;

  return (
    <Panel className="mb-4">
      <SectionHead
        title={lobby.stage === "full" ? "Table full" : "Waiting for players"}
        count={`${lobby.humans} of 4`}
        action={startingNow ? <Tag tone="live">Starting</Tag> : undefined}
      />
      <div className="p-3 sm:p-4">
        {/* Who is here */}
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {game.table.map((seat) => {
            const agreed = !!seat.userId && lobby.agreed.includes(seat.userId);
            const away = !!seat.userId && lobby.away.includes(seat.userId);
            return (
              <li
                key={seat.seat}
                className={cx(
                  "flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5",
                  seat.userId ? "border-[var(--cc-line)] bg-[var(--cc-panel-2)]" : "border-dashed border-[var(--cc-line)] opacity-70",
                )}
              >
                {seat.userId ? (
                  <Avatar id={seat.userId} name={seat.name} url={seat.avatar} size={24} online={seat.online} />
                ) : (
                  <span className="h-6 w-6 shrink-0 rounded-full border border-dashed border-[var(--cc-line)]" />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-semibold">
                    {seat.userId ? game.firstName(seat.userId) : "Open seat"}
                  </span>
                  <span className="block truncate text-[10px] text-[var(--cc-ink-faint)]">
                    {!seat.userId
                      ? "waiting…"
                      : away
                        ? "stepped away"
                        : agreed
                          ? "agreed to bots"
                          : lobby.humans > 1 ? "deciding" : "here"}
                  </span>
                </span>
                {agreed && <span className="ml-auto shrink-0 text-[var(--cc-live)]"><CheckIcon size={13} /></span>}
              </li>
            );
          })}
        </ul>

        <p className="mt-3 text-[13px] leading-relaxed text-[var(--cc-ink-muted)]">
          {stageExplainer(lobby.stage)}
        </p>

        {/* Agreement status */}
        {lobby.humans > 1 && lobby.agreed.length > 0 && lobby.stage !== "full" && (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--cc-ember)]" role="status">
            <ClockIcon size={13} />
            {othersWaitingOn.length
              ? waitingLine(names(othersWaitingOn))
              : iNeedToAgree
                ? `${joinNames(names(lobby.agreed))} ${lobby.agreed.length === 1 ? "wants" : "want"} to play with bots. Your call.`
                : "Everyone agreed. Starting…"}
          </p>
        )}
        {lobby.away.length > 0 && lobby.stage !== "full" && (
          <p className="mt-1 text-[11px] text-[var(--cc-ink-faint)]">
            {joinNames(names(lobby.away))} {lobby.away.length === 1 ? "has" : "have"} stepped away and won&apos;t hold
            up the vote. A computer keeps the seat until they come back.
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {!game.isSeated ? (
            <Button variant="primary" onClick={() => void game.sit()}>Take a seat</Button>
          ) : startingNow ? (
            <Button variant="primary" disabled>
              <PlayIcon size={14} />
              Dealing…
            </Button>
          ) : lobby.iAgreed ? (
            <>
              <Button variant="primary" disabled>
                <CheckIcon size={14} />
                You agreed
              </Button>
              <Button onClick={() => void game.keepWaiting()}>Keep waiting instead</Button>
            </>
          ) : (
            <>
              <Button variant="primary" onClick={() => void game.agreeToBots()}>
                <BotIcon size={14} />
                {lobby.humans === 1 ? "Play bots now" : "Play with bots"}
              </Button>
              <Button
                onClick={() => {
                  void game.keepWaiting();
                  game.setNotice("Okay, keep waiting. Anyone who searches for players will be seated here.");
                }}
              >
                <ClockIcon size={14} />
                Keep waiting
              </Button>
            </>
          )}
          {game.isSeated && !startingNow ? (
            <Button variant="ghost" onClick={() => { void game.leaveTable(); onLobby(); }}>
              Leave the table
            </Button>
          ) : (
            <Button variant="ghost" onClick={onLobby}>Back to the lobby</Button>
          )}
        </div>
        {game.isSeated && !startingNow && lobby.stage !== "full" && (
          <p className="mt-2 text-[11px] text-[var(--cc-ink-faint)]">
            {lobby.humans === 1
              ? `Starting now adds ${botLine}.`
              : `Starting now adds ${botLine}, and needs everyone here to agree.`}
            {" "}If someone else sits down first, they take the seat instead.
          </p>
        )}
      </div>
    </Panel>
  );
}
