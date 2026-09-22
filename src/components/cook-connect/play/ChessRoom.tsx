"use client";

// A chess board and the room around it: who is playing, the move list, chat
// and video. Resign and draw sit under the board, where they belong.

import { useEffect } from "react";
import { useCook } from "../CookConnect";
import { Columns } from "../Columns";
import { useChess } from "@/lib/cook-connect/hooks/useChess";
import { joinMatch } from "@/lib/cook-connect/matches";
import { rooms } from "@/lib/cook-connect/types";
import {
  Avatar, Button, EmptyState, Loading, Panel, SectionHead, Spinner, Tag, cx,
} from "../ui";
import { BotIcon, FlagIcon, HandshakeIcon, TrophyIcon } from "../icons";
import { ChessBoard } from "./ChessBoard";
import { ChatPanel } from "./ChatPanel";
import { VideoPanel } from "./VideoPanel";

export function ChessRoom({ matchId }: { matchId: string }) {
  const { sb, userId, navigate, notify, onlineIds } = useCook();
  const chess = useChess(sb, userId, matchId);

  useEffect(() => {
    if (!chess.notice) return;
    notify(chess.notice);
    chess.setNotice(null);
  }, [chess.notice, chess.setNotice, notify, chess]);

  if (chess.loading) return <Columns><Loading label="Setting up the board" /></Columns>;

  if (!chess.row || !chess.match) {
    return (
      <Columns>
        <Panel>
          <EmptyState
            title="That board is gone"
            body="The game was closed, or the link was wrong."
            action={<Button variant="primary" onClick={() => navigate({ page: "play" })}>Back to the lobby</Button>}
          />
        </Panel>
      </Columns>
    );
  }

  const { row, game, myColor, isOver } = chess;
  const seatOpen = !row.white_id || !row.black_id;
  const drawOfferedToMe = !!row.draw_offer && row.draw_offer !== userId && !isOver;

  const sit = async () => {
    if (!userId) return;
    const ok = await joinMatch(sb, matchId, userId);
    if (!ok) notify("Both seats are taken.");
    await chess.reload();
  };

  const { moves } = chess;
  const pairs: { n: number; white: string; black?: string }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push({ n: i / 2 + 1, white: moves[i], black: moves[i + 1] });
  }

  const orientation: "white" | "black" = myColor === "b" ? "black" : "white";
  const canMove = !isOver && myColor && game.turn() === myColor ? myColor : null;

  return (
    <Columns
      rail={
        <>
          <Panel>
            <SectionHead title="Moves" count={moves.length} />
            <div className="max-h-[220px] overflow-y-auto p-2">
              {pairs.length === 0 ? (
                <p className="px-1 py-3 text-[12px] text-[var(--cc-ink-muted)]">
                  No moves yet. White opens.
                </p>
              ) : (
                <ol className="space-y-0.5">
                  {pairs.map((p) => (
                    <li key={p.n} className="flex items-baseline gap-2 rounded px-1 py-0.5 text-[12px]">
                      <span className="cc-num w-6 shrink-0 text-right text-[var(--cc-ink-faint)]">{p.n}.</span>
                      <span className="cc-num w-[68px] font-semibold">{p.white}</span>
                      <span className="cc-num w-[68px] text-[var(--cc-ink-muted)]">{p.black ?? ""}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Panel>

          <VideoPanel room={rooms.match(matchId)} title="Board video" />
          <ChatPanel room={rooms.match(matchId)} title="Board chat" height="h-[200px]" placeholder="Good game…" />
        </>
      }
    >
      <Panel className="mb-3">
        <div className="flex flex-wrap items-center gap-3 p-2.5">
          <PlayerChip
            id={row.black_id}
            name={chess.nameFor(row.black_id)}
            colour="Black"
            toMove={!isOver && game.turn() === "b"}
            isMe={myColor === "b"}
            online={row.black_id ? onlineIds.has(row.black_id) : undefined}
          />
          <span className="text-[var(--cc-ink-faint)]">vs</span>
          <PlayerChip
            id={row.white_id}
            name={chess.nameFor(row.white_id)}
            colour="White"
            toMove={!isOver && game.turn() === "w"}
            isMe={myColor === "w"}
            online={row.white_id ? onlineIds.has(row.white_id) : undefined}
          />
          <span className="ml-auto flex items-center gap-2 text-[12px]">
            {chess.thinking && (
              <span className="flex items-center gap-1.5 text-[var(--cc-ink-muted)]">
                <Spinner size={13} />
                thinking
              </span>
            )}
            <span className={cx(
              "font-semibold",
              isOver ? "text-[var(--cc-gold)]" : canMove ? "text-[var(--cc-live)]" : "text-[var(--cc-ink-muted)]",
            )}>
              {chess.status}
            </span>
          </span>
        </div>
      </Panel>

      {isOver && (
        <Panel className="mb-3 border-[var(--cc-gold)]">
          <div className="flex flex-wrap items-center gap-3 p-3">
            <span className="text-[var(--cc-gold)]"><TrophyIcon size={20} /></span>
            <p className="min-w-0 flex-1 text-[13px] font-semibold">{chess.status}</p>
            <Button variant="primary" onClick={() => navigate({ page: "play" })}>
              Another game
            </Button>
          </div>
        </Panel>
      )}

      {seatOpen && !myColor && !isOver && (
        <Panel className="mb-3">
          <div className="flex flex-wrap items-center gap-3 p-3">
            <p className="min-w-0 flex-1 text-[13px] text-[var(--cc-ink-muted)]">
              A seat is free at this board.
            </p>
            <Button variant="primary" onClick={() => void sit()}>Take it</Button>
          </div>
        </Panel>
      )}

      {drawOfferedToMe && (
        <Panel className="mb-3 border-[var(--cc-ember)]">
          <div className="flex flex-wrap items-center gap-3 p-3">
            <span className="text-[var(--cc-ember)]"><HandshakeIcon size={20} /></span>
            <p className="min-w-0 flex-1 text-[13px]">Your opponent offers a draw.</p>
            <Button variant="primary" onClick={() => void chess.answerDraw(true)}>Accept</Button>
            <Button onClick={() => void chess.answerDraw(false)}>Play on</Button>
          </div>
        </Panel>
      )}

      <ChessBoard
        fen={row.fen}
        orientation={orientation}
        canMove={canMove}
        lastMove={row.last_move}
        onMove={chess.move}
      />

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {myColor && !isOver && (
          <>
            <Button variant="danger" onClick={() => void chess.resign()}>
              <FlagIcon size={13} />
              Resign
            </Button>
            {!chess.vsBot && (
              <Button onClick={() => void chess.offerDraw()} disabled={row.draw_offer === userId}>
                <HandshakeIcon size={13} />
                {row.draw_offer === userId ? "Draw offered" : "Offer a draw"}
              </Button>
            )}
          </>
        )}
        <Button variant="ghost" onClick={() => navigate({ page: "play" })}>
          Back to the lobby
        </Button>
        {!myColor && !seatOpen && (
          <span className="text-[12px] text-[var(--cc-ink-muted)]">You are watching this game.</span>
        )}
      </div>
    </Columns>
  );
}

function PlayerChip({
  id, name, colour, toMove, isMe, online,
}: {
  id: string | null;
  name: string;
  colour: string;
  toMove: boolean;
  isMe: boolean;
  online?: boolean;
}) {
  const isBot = !!id?.startsWith("bot:");
  return (
    <span
      className={cx(
        "flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors duration-150",
        toMove ? "border-[var(--cc-live)] bg-[var(--cc-live-wash)]" : "border-[var(--cc-line)]",
      )}
    >
      {!id ? (
        <span className="h-6 w-6 rounded-full border border-dashed border-[var(--cc-line)]" />
      ) : isBot ? (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--cc-elevated)] text-[var(--cc-ink-faint)]">
          <BotIcon size={13} />
        </span>
      ) : (
        <Avatar id={id} name={name} size={24} online={online} />
      )}
      <span className="min-w-0">
        <span className={cx("block truncate text-[12px] font-semibold", isMe && "text-[var(--cc-ember)]")}>
          {isMe ? "You" : name}
        </span>
        <span className="block text-[10px] uppercase tracking-[0.07em] text-[var(--cc-ink-faint)]">{colour}</span>
      </span>
      {toMove && <Tag tone="live">to move</Tag>}
    </span>
  );
}
