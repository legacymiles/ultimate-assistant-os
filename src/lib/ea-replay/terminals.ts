// ---------------------------------------------------------------------------
// EA World › Terminals — the three outside trading terminals EA World links to.
//
// None of them can run an MT4 bot, which is why Replay is EA World's own. What
// each one adds is the market around a bot: OpenTerminal is the live board
// (quotes, charts, macro, news — no keys), Vibe-Trading is an AI research
// agent that writes and backtests strategy ideas, and Fincept is the heavy
// desktop terminal for fundamentals and portfolio work.
//
// They run on the PC (tools/ea-terminals installs and starts them), not on
// Vercel. Ports are fixed so this page knows where to look, and chosen to stay
// clear of the hub's own dev server on 3000.
// ---------------------------------------------------------------------------

export interface TerminalApp {
  id: string;
  name: string;
  repo: string;
  license: string;
  /** What it is for, from EA World's point of view. */
  role: string;
  /** What it is built on and how it runs here. */
  runs: string;
  /** Where it answers on the PC, when it is a web app. */
  url?: string;
  /** Can it be shown inside EA World? Vibe-Trading forbids framing (X-Frame-Options: DENY). */
  embeddable: boolean;
  /** The one line that starts it, for copying. */
  start: string;
  needs: string;
}

export const TERMINALS: TerminalApp[] = [
  {
    id: "openterminal",
    name: "OpenTerminal",
    repo: "https://github.com/ErTasselli/OpenTerminal",
    license: "MIT",
    role: "The live board. Watchlist, charts with indicators, quotes, crypto, macro and yield curve, news and an economic calendar — all from free public data, no keys. Keep it beside a replay to see what the market was doing around a session.",
    runs: "Next.js + Express, on this PC",
    url: "http://localhost:3400",
    embeddable: true,
    start: "powershell -ExecutionPolicy Bypass -File tools\\ea-terminals\\start.ps1 -Only openterminal",
    needs: "Node 20+",
  },
  {
    id: "vibe-trading",
    name: "Vibe-Trading",
    repo: "https://github.com/HKUDS/Vibe-Trading",
    license: "MIT",
    role: "An AI research agent for strategies. Describe an idea in words and it pulls data, writes the strategy, backtests it and reports return and drawdown. Use it to pressure-test an idea before it becomes an EA.",
    runs: "Python 3.11 + FastAPI web UI, on this PC",
    url: "http://localhost:8899",
    embeddable: false,
    start: "powershell -ExecutionPolicy Bypass -File tools\\ea-terminals\\start.ps1 -Only vibe-trading",
    needs: "Python 3.11+ and an LLM key (OpenRouter works, or your Claude Code login)",
  },
  {
    id: "fincept",
    name: "Fincept Terminal",
    repo: "https://github.com/Fincept-Corporation/FinceptTerminal",
    license: "AGPL-3.0",
    role: "The heavyweight desktop terminal: fundamentals, economics, portfolio analytics, a quant lab and AI research agents. It is a native Windows app, so it opens beside EA World rather than inside it.",
    runs: "C++/Qt desktop app, Windows installer",
    embeddable: false,
    start: "powershell -ExecutionPolicy Bypass -File tools\\ea-terminals\\start.ps1 -Only fincept",
    needs: "Windows x64 (the installer is fetched by install.ps1)",
  },
];
