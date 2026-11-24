// Scoped styles the research sections share (lab.css is shared and not
// edited from here). Everything is under .h3l so nothing leaks.

const CSS = `
.h3l .rs-root .panel-head { flex-wrap: wrap; }
.h3l .rs-root { min-width: 0; }
.h3l .rs-split { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); align-items: start; }
.h3l .rs-split-wide { display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr); align-items: start; }
@media (min-width: 1180px) { .h3l .rs-split-wide { grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); } }
.h3l .rs-form { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); }
.h3l .rs-form .span { grid-column: 1 / -1; }
.h3l .rs-kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 14px; font-size: 12.5px; }
.h3l .rs-kv > dt { color: var(--ink-3); font-family: var(--font-h3-mono), monospace; font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; padding-top: 2px; }
.h3l .rs-kv > dd { margin: 0; color: var(--ink-2); min-width: 0; }
.h3l .seg { display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 2px; border: 1px solid var(--line-2); border-radius: 6px; background: var(--bg-grain); }
.h3l .seg button { all: unset; box-sizing: border-box; position: relative; padding: 4px 9px; border-radius: 4px; font-size: 11.5px; color: var(--ink-2); cursor: pointer; white-space: nowrap; }
.h3l .seg button:hover { color: var(--ink); }
.h3l .seg button:focus-visible { outline: 2px solid var(--amber); outline-offset: 1px; }
.h3l .seg button[aria-pressed="true"] { color: var(--ink); }
.h3l .seg button .seg-fill { position: absolute; inset: 0; border-radius: 4px; z-index: 0; }
.h3l .seg button .seg-label { position: relative; z-index: 1; display: inline-flex; align-items: center; gap: 5px; }
.h3l .seg button .master-dot { width: 5px; height: 5px; border-radius: 99px; background: var(--amber); box-shadow: 0 0 6px rgba(242,169,59,.7); flex: none; }
.h3l .knob-row { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 10px; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(38,42,50,.6); }
.h3l .knob-row:last-child { border-bottom: 0; }
@media (max-width: 640px) { .h3l .knob-row { grid-template-columns: 1fr; gap: 4px; } }
.h3l .knob-name { font-size: 12px; color: var(--ink-2); }
.h3l .knob-name small { display: block; color: var(--ink-4); font-size: 10.5px; }
.h3l .rs-tabs { display: inline-flex; gap: 2px; border: 1px solid var(--line-2); border-radius: 6px; padding: 2px; }
.h3l .rs-tabs button { all: unset; cursor: pointer; padding: 3px 9px; border-radius: 4px; font-size: 11.5px; color: var(--ink-3); }
.h3l .rs-tabs button[aria-pressed="true"] { background: var(--raise); color: var(--ink); }
.h3l .rs-tabs button:focus-visible { outline: 2px solid var(--amber); }
.h3l .rs-strip { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
.h3l .rs-strip > * { flex: 0 0 auto; }
.h3l .rs-frame { position: relative; width: 132px; }
.h3l .rs-frame img { width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: 4px; border: 1px solid var(--line); display: block; background: var(--bg-grain); }
.h3l .rs-frame[data-hit="true"] img { border-color: var(--bad); box-shadow: 0 0 0 2px var(--bad-dim); }
.h3l .rs-frame .tc { position: absolute; left: 4px; bottom: 4px; font-family: var(--font-h3-mono), monospace; font-size: 10px; background: rgba(10,11,13,.8); padding: 0 4px; border-radius: 3px; color: var(--ink-2); }
.h3l .rs-thumb-sm { width: 72px; aspect-ratio: 16/9; object-fit: cover; border-radius: 3px; border: 1px solid var(--line); background: var(--bg-grain); display: block; }
.h3l .rs-video { width: 100%; aspect-ratio: 16/9; background: #000; border-radius: 5px; border: 1px solid var(--line); display: block; }
.h3l .rs-arm { border-top: 2px solid var(--amber); }
.h3l .rs-arm.exp { border-top-color: var(--cyan); }
.h3l .rs-sticky { position: sticky; top: 56px; }
@media (max-width: 1179px) { .h3l .rs-sticky { position: static; } }
.h3l .rs-pill-list { display: flex; flex-wrap: wrap; gap: 5px; }
.h3l .rs-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-2); cursor: pointer; }
.h3l .rs-check input { accent-color: var(--amber); }
.h3l .rs-drop { border: 1px dashed var(--line-2); border-radius: var(--r); padding: 22px; text-align: center; color: var(--ink-2); cursor: pointer; transition: border-color 160ms var(--ease), background 160ms var(--ease); }
.h3l .rs-drop[data-over="true"], .h3l .rs-drop:hover { border-color: var(--amber-line); background: var(--amber-dim); }
.h3l .rs-drop:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }
.h3l .rs-timeline { display: flex; height: 46px; border-radius: 5px; overflow: hidden; border: 1px solid var(--line); background: var(--bg-grain); }
.h3l .rs-timeline > div { position: relative; min-width: 2px; border-right: 1px solid var(--bg); background-size: cover; background-position: center; }
.h3l .rs-timeline > div span { position: absolute; left: 3px; top: 2px; font-family: var(--font-h3-mono), monospace; font-size: 9.5px; color: var(--ink); text-shadow: 0 0 3px #000; }
.h3l .rs-progress { height: 4px; border-radius: 99px; background: var(--raise); overflow: hidden; }
.h3l .rs-progress > i { display: block; height: 100%; background: var(--amber); }
.h3l .rs-wipe { position: relative; width: 100%; aspect-ratio: 16/9; overflow: hidden; border-radius: 5px; border: 1px solid var(--line); background: #000; touch-action: none; user-select: none; cursor: ew-resize; }
.h3l .rs-wipe img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
.h3l .rs-wipe .handle { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--ink); transform: translateX(-1px); }
.h3l .rs-wipe .handle:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }
.h3l .rs-wipe .handle::after { content: ""; position: absolute; top: 50%; left: 50%; width: 22px; height: 22px; transform: translate(-50%, -50%); border-radius: 99px; background: var(--ink); box-shadow: 0 2px 10px rgba(0,0,0,.6); }
.h3l .rs-wipe .tag { position: absolute; top: 8px; font-family: var(--font-h3-mono), monospace; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; padding: 2px 6px; border-radius: 3px; background: rgba(10,11,13,.75); }
.h3l .rs-wbar { display: grid; grid-template-columns: 150px minmax(0,1fr) 34px; gap: 10px; align-items: center; font-size: 12px; }
.h3l .rs-issue { border: 1px solid var(--line); border-left: 3px solid var(--warn); border-radius: 5px; padding: 10px 12px; background: var(--panel-2); display: grid; gap: 6px; }
.h3l .rs-issue[data-sev="high"] { border-left-color: var(--bad); }
.h3l .rs-issue[data-sev="low"] { border-left-color: var(--ink-4); }
.h3l .rs-issue[aria-pressed="true"] { box-shadow: 0 0 0 1px var(--amber-line); }
.h3l .rs-live-stats { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 11.5px; color: var(--ink-3); }
.h3l .rs-live-stats b { color: var(--ink); font-weight: 500; }
.h3l .rs-lint { display: grid; gap: 4px; font-size: 12px; }
.h3l .rs-lint div { display: grid; grid-template-columns: 52px minmax(0,1fr); gap: 8px; }
.h3l details.rs-more > summary { cursor: pointer; color: var(--ink-3); font-size: 11.5px; list-style: none; }
.h3l details.rs-more > summary::-webkit-details-marker { display: none; }
.h3l .rs-scroll { max-height: 520px; overflow: auto; }
.h3l .ledger-host { height: min(78vh, 760px); overflow: auto; border-top: 1px solid var(--line); }
.h3l .ledger-host > div { height: 100%; }
`;

export function ResearchStyles() {
  return <style>{CSS}</style>;
}
