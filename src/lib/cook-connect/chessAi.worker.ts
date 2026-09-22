import { findBestMove, type Level } from "./chessAi";

self.onmessage = (e: MessageEvent<{ id: number; fen: string; level: Level }>) => {
  const { id, fen, level } = e.data;
  (self as unknown as Worker).postMessage({ id, move: findBestMove(fen, level) });
};
