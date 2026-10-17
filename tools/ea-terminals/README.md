# EA World › Terminals

Three outside trading terminals, installed and started on this PC and opened
from `/apps/ea-world/terminals`.

| Terminal | What it adds | Where it runs |
|---|---|---|
| [OpenTerminal](https://github.com/ErTasselli/OpenTerminal) (MIT) | Live board: charts, quotes, macro, news, calendar. No keys. | http://localhost:3400 (API :4400). Can be shown inside EA World. |
| [Vibe-Trading](https://github.com/HKUDS/Vibe-Trading) (MIT) | AI research agent: idea → data → strategy → backtest. | http://localhost:8899. Sends `X-Frame-Options: DENY`, so it opens in its own tab. |
| [Fincept Terminal](https://github.com/Fincept-Corporation/FinceptTerminal) (AGPL-3.0) | Desktop terminal: fundamentals, economics, portfolio, quant lab. | Native Windows app. |

```powershell
# once
powershell -ExecutionPolicy Bypass -File tools\ea-terminals\install.ps1
# every time
powershell -ExecutionPolicy Bypass -File tools\ea-terminals\start.ps1
```

They install to `%USERPROFILE%\Projects\ea-terminals` (outside this repo), so
none of their code is committed or deployed. They need Git, Node 20+, and
Python 3.11+. Vibe-Trading also needs an LLM provider: run
`vibe-trading init` once, then pick OpenRouter or `claude-cli`.

## Why the replay isn't in one of these

None of the three can run an MT4 Expert Advisor. A replay that shows what your
bot would have done needs the bot's rules and a simulated MT4 broker (spread,
latency, stop level, slippage, commission). Those live in EA World, so
**Replay** is EA World's own studio (`/apps/ea-world/replay`). It uses the
same charting library as OpenTerminal (TradingView lightweight-charts).
