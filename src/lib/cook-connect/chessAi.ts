// A small chess engine for playing the computer: alpha-beta search with
// material and piece-square tables, captures-first move ordering, a short
// quiescence search, and iterative deepening under a time budget.
import { Chess, type Move } from "chess.js";

export type Level = "easy" | "medium" | "hard";

export const LEVEL_LABELS: Record<Level, string> = {
  easy: "Casual",
  medium: "Steady",
  hard: "Sharp",
};

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Tables read from White's point of view, rank 8 first (index 0 = a8).
const PST: Record<string, number[]> = {
  p: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  k: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
};

const MATE = 100_000;

/** Score from the side-to-move's point of view. */
function evaluate(game: Chess): number {
  let score = 0;
  const board = game.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = board[r][f];
      if (!sq) continue;
      const idx = sq.color === "w" ? r * 8 + f : (7 - r) * 8 + f;
      const v = VALUE[sq.type] + PST[sq.type][idx];
      score += sq.color === "w" ? v : -v;
    }
  }
  return game.turn() === "w" ? score : -score;
}

/** Captures first, then promotions, then checks — the cheapest way to prune more. */
function order(moves: Move[]): Move[] {
  return moves
    .map((m) => ({
      m,
      s: (m.captured ? 10 * VALUE[m.captured] - VALUE[m.piece] : 0)
        + (m.promotion ? 800 : 0)
        + (m.san.includes("+") ? 50 : 0),
    }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.m);
}

class Timeout extends Error {}

export interface EngineMove {
  from: string;
  to: string;
  promotion?: string;
}

export function findBestMove(fen: string, level: Level): EngineMove | null {
  const game = new Chess(fen);
  const root = game.moves({ verbose: true });
  if (!root.length) return null;

  if (level === "easy") {
    // One ply with a lot of noise: grabs free material, otherwise wanders.
    const scored = root
      .map((m) => {
        game.move(m);
        const s = -evaluate(game) + (game.isCheckmate() ? MATE : 0) + (Math.random() * 180 - 90);
        game.undo();
        return { m, s };
      })
      .sort((a, b) => b.s - a.s);
    const pick = Math.random() < 0.25
      ? scored[Math.floor(Math.random() * Math.min(4, scored.length))]
      : scored[0];
    return { from: pick.m.from, to: pick.m.to, promotion: pick.m.promotion };
  }

  const maxDepth = level === "medium" ? 2 : 4;
  const deadline = Date.now() + (level === "medium" ? 700 : 2200);
  let nodes = 0;

  const quiesce = (alpha: number, beta: number, depth: number): number => {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) throw new Timeout();
    const stand = evaluate(game);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (depth <= 0) return alpha;
    for (const m of order(game.moves({ verbose: true }).filter((x) => x.captured))) {
      game.move(m);
      const score = -quiesce(-beta, -alpha, depth - 1);
      game.undo();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  };

  const search = (depth: number, alpha: number, beta: number, ply: number): number => {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) throw new Timeout();
    if (game.isCheckmate()) return -MATE + ply;
    if (game.isDraw()) return 0;
    if (depth === 0) return quiesce(alpha, beta, 3);
    for (const m of order(game.moves({ verbose: true }))) {
      game.move(m);
      const score = -search(depth - 1, -beta, -alpha, ply + 1);
      game.undo();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  };

  let ordered = order(root);
  let best = ordered[0];
  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      let alpha = -Infinity;
      let bestThisDepth = ordered[0];
      const scores = new Map<Move, number>();
      for (const m of ordered) {
        game.move(m);
        const score = -search(depth - 1, -Infinity, -alpha, 1);
        game.undo();
        scores.set(m, score);
        if (score > alpha) { alpha = score; bestThisDepth = m; }
      }
      best = bestThisDepth;
      // Search the best move of this depth first at the next one.
      ordered = [...ordered].sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0));
      if (alpha > MATE - 100) break; // a forced mate; no point looking further
    } catch (e) {
      if (e instanceof Timeout) break; // keep the best move from the last full depth
      throw e;
    }
  }
  return { from: best.from, to: best.to, promotion: best.promotion };
}
