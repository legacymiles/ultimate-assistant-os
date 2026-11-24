"use client";

// The Director booth — the owner's private side of the stream. Everything in
// here is off camera: the mic orb (its ring follows your voice), the Talkback
// switch, where each voice goes, the actor's performance, the private thread
// between you and Alex, and the command bar.
//
// Its hue is a cool blue (#8ab4ff) that appears nowhere on the public side:
// warm white is Alex's on-air voice, blue is the private channel. Status is
// always a word and an icon too, never the colour alone.

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Check, ChevronDown, CircleAlert, Headphones, Keyboard, Lock, Mic, MicOff, Radio, RotateCcw, Send, SlidersHorizontal, X,
} from "lucide-react";
import { COMMAND_TYPES } from "@/lib/ai-live-studio/command";
import { EMOTIONS, EMOTION_LABEL } from "@/lib/ai-live-studio/performance";
import { LISTEN_LABEL, type ListenMode } from "@/lib/ai-live-studio/routing";
import type { DirEntry, DirectorApi } from "./useDirector";
import type { Studio } from "./useStudio";

function micTitle(d: DirectorApi): string {
  if (d.mic === "unsupported") return "This browser can't listen";
  if (d.mic === "blocked") return "Microphone blocked";
  if (d.mic === "error") return "The mic stopped — tap to retry";
  if (d.mic === "starting") return "Starting your mic…";
  if (!d.on) return "Director mode off";
  if (d.prefs.listenMode === "push") return d.holding ? "Listening — keep holding" : "Hold to talk";
  if (d.mic === "hearing") return "Hearing you…";
  return d.prefs.listenMode === "wake" ? "Say “Alex” first" : "Listening to you";
}

function micHelp(d: DirectorApi): string {
  if (d.mic === "unsupported") return "Use Chrome or Edge for voice — typed directions still work.";
  if (d.mic === "blocked") return "Allow the microphone for this site, then tap the mic.";
  if (!d.on) return "Tap the mic to start. Alex follows what you say and never answers you on air.";
  if (d.prefs.listenMode === "push") return "Press and hold the mic, or hold the ` key.";
  return d.micLabel || "Your microphone";
}

function deviceName(id: string, d: DirectorApi): string {
  const dev = d.outputs.find((x) => x.deviceId === (id || "default"));
  const label = dev?.label.replace(/^(Default|Communications) - /, "") ?? "";
  return label || (id ? "Chosen device" : "Default speakers");
}

function Thread({ d, name }: { d: DirectorApi; name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [d.entries.length, d.interim, d.entries]);

  if (!d.entries.length && !d.interim) {
    return (
      <div className="als-thread" ref={ref}>
        <div className="als-thread-empty">
          <b>Direct {name} like an actor.</b>
          Say “{name}, be a little more sarcastic” or “Respond to Mike next — tell him that&rsquo;s a ridiculous question.” He follows it on air and never
          says a word about it. Turn Talkback on to talk with him privately.
        </div>
      </div>
    );
  }
  return (
    <div className="als-thread" ref={ref} role="log" aria-live="polite" aria-label="Private conversation with Alex">
      {d.entries.map((e) => (
        <Entry key={e.id} e={e} d={d} name={name} />
      ))}
      {d.interim && (
        <div className="als-you interim" aria-hidden="true">
          {d.interim}…
        </div>
      )}
    </div>
  );
}

function Entry({ e, d, name }: { e: DirEntry; d: DirectorApi; name: string }) {
  if (e.role === "note") return <div className="als-dnote">{e.text}</div>;
  if (e.role === "alex") {
    return (
      <div className="als-alex">
        <span className="w">
          {name.toUpperCase()} · PRIVATE{e.silent ? " · TEXT ONLY" : ""}
        </span>
        {e.text}
        {e.silent && <span className="why">{e.silent}</span>}
      </div>
    );
  }
  const type = e.type && e.type !== "direction" ? COMMAND_TYPES.find((t) => t.id === e.type)?.label : null;
  return (
    <>
      <div className="als-you" data-status={e.status}>
        <span className="src" aria-label={e.source === "mic" ? "Said" : "Typed"}>
          {e.source === "mic" ? <Mic size={10} aria-hidden="true" /> : <Keyboard size={10} aria-hidden="true" />}
          {type && <span>{type}</span>}
        </span>
        {e.text || <i>(no words)</i>}
        {e.status === "working" && <span className="dots" aria-label="Working" />}
      </div>
      {e.status === "confirm" && (
        <div className="als-ask" role="group" aria-label="Did you say that?">
          <span>Not sure I heard that right — apply it?</span>
          <button className="als-chip" onClick={() => d.confirm(e.id, true)}>
            Apply
          </button>
          <button className="als-chip" onClick={() => d.confirm(e.id, false)}>
            Discard
          </button>
        </div>
      )}
      {e.status === "ignored" && <div className="als-ack muted">Discarded</div>}
      {e.acks?.map((a, i) => (
        <div key={i} className="als-ack">
          <Check size={11} aria-hidden="true" />
          {a}
        </div>
      ))}
      {e.problems?.map((p, i) => (
        <div key={`p${i}`} className="als-ack warn">
          <CircleAlert size={11} aria-hidden="true" />
          {p}
        </div>
      ))}
      {e.clarify && (
        <div className="als-ask" role="group" aria-label={e.clarify.question}>
          <span>{e.clarify.question}</span>
          {e.clarify.options.map((o, i) => (
            <button key={i} className="als-chip" onClick={() => d.choose(e.id, i)}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function PerformancePanel({ studio }: { studio: Studio }) {
  const { perf, setPerformance, pendingNext } = studio;
  return (
    <div className="als-perfpanel" id="als-perfpanel">
      <div className="als-blabel">Emotion</div>
      <div className="als-chips" role="group" aria-label="Emotion">
        {EMOTIONS.map((e) => (
          <button key={e} className="als-chip" aria-pressed={perf.emotion === e} onClick={() => setPerformance({ emotion: e })}>
            {EMOTION_LABEL[e]}
          </button>
        ))}
      </div>
      <label className="als-bfield">
        <span>
          Eye contact <b className="mono">{perf.eyeContact}</b>
        </span>
        <input
          className="als-range priv" type="range" min={0} max={10} name="eyeContact" value={perf.eyeContact}
          style={{ ["--p" as string]: `${perf.eyeContact * 10}%` }}
          onChange={(e) => setPerformance({ eyeContact: Number(e.target.value) })}
        />
      </label>
      <label className="als-bfield">
        <span>
          Head movement <b className="mono">{perf.headMotion}</b>
        </span>
        <input
          className="als-range priv" type="range" min={0} max={10} name="headMotion" value={perf.headMotion}
          style={{ ["--p" as string]: `${perf.headMotion * 10}%` }}
          onChange={(e) => setPerformance({ headMotion: Number(e.target.value) })}
        />
      </label>
      <label className="als-btoggle">
        <span>Reactions — a laugh, a “whoa”</span>
        <input type="checkbox" name="reactions" checked={perf.reactions} onChange={(e) => setPerformance({ reactions: e.target.checked })} />
      </label>
      {(perf.avoid.length > 0 || perf.notes.length > 0 || pendingNext.length > 0) && (
        <div className="als-standing">
          {pendingNext.map((n) => (
            <span key={`n-${n}`} className="als-word next">
              Next: {n}
            </span>
          ))}
          {perf.notes.map((n) => (
            <span key={`s-${n}`} className="als-word">
              {n}
              <button aria-label={`Drop the direction: ${n}`} onClick={() => setPerformance({ notes: perf.notes.filter((x) => x !== n) })}>
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          ))}
          {perf.avoid.map((a) => (
            <span key={`a-${a}`} className="als-word">
              Avoiding {a}
              <button aria-label={`Stop avoiding ${a}`} onClick={() => setPerformance({ avoid: perf.avoid.filter((x) => x !== a) })}>
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      <button
        className="als-ghost sm"
        onClick={() => setPerformance({ emotion: "neutral", eyeContact: 8, headMotion: 5, reactions: true, notes: [], avoid: [] })}
      >
        <RotateCcw size={12} aria-hidden="true" />
        Reset to his normal self
      </button>
    </div>
  );
}

export function DirectorBooth({
  studio, d, boothRef, open, onClose,
}: {
  studio: Studio;
  d: DirectorApi;
  boothRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [routing, setRouting] = useState(false);
  const [perfOpen, setPerfOpen] = useState(false);
  const { settings, perf, items, selectedId } = studio;
  const push = d.prefs.listenMode === "push";
  const type = COMMAND_TYPES.find((t) => t.id === d.compose.type) ?? COMMAND_TYPES[0];
  const targetId = d.compose.targetId ?? selectedId;
  const target = targetId ? items.find((i) => i.id === targetId) : undefined;
  const summary = [
    perf.emotion !== "neutral" ? EMOTION_LABEL[perf.emotion].toLowerCase() : "",
    ...perf.avoid.map((a) => `avoiding ${a}`),
    perf.notes.length ? `${perf.notes.length} note${perf.notes.length > 1 ? "s" : ""}` : "",
  ].filter(Boolean);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    d.send(draft);
    if (draft.trim() || (d.compose.type !== "direction" && d.compose.type !== "say")) setDraft("");
  };

  return (
    <aside className="als-booth" ref={boothRef} data-open={open ? "true" : "false"} data-on={d.on ? "true" : "false"} data-mic={d.mic} aria-label="Director booth — private, never on stream">
      <div className="als-booth-head">
        <h2>Director booth</h2>
        <span className="lock">
          <Lock size={11} aria-hidden="true" />
          never on stream
        </span>
        <button className="als-booth-close" onClick={onClose} aria-label="Close the Director booth">
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="als-orbrow">
        <button
          className="als-orb"
          aria-pressed={d.on}
          aria-label={d.on ? (push ? "Hold to talk to Alex" : "Stop listening (Director mode off)") : "Start listening (Director mode on)"}
          onClick={() => {
            if (!d.on || !push) void d.setDirectorMode(!d.on);
          }}
          onPointerDown={() => push && d.on && d.hold(true)}
          onPointerUp={() => push && d.hold(false)}
          onPointerLeave={() => push && d.holding && d.hold(false)}
        >
          <span className="ring" aria-hidden="true" />
          <span className="halo" aria-hidden="true" />
          {d.mic === "blocked" || d.mic === "unsupported" ? <MicOff size={28} aria-hidden="true" /> : <Mic size={28} aria-hidden="true" />}
        </button>
        <div className="als-orbtxt">
          <div className="s" role="status">
            {micTitle(d)}
          </div>
          <div className="d">{micHelp(d)}</div>
          <label className="sr" htmlFor="als-listen">
            Listening mode
          </label>
          <span className="als-selwrap">
            <select id="als-listen" name="listenMode" className="als-bselect" value={d.prefs.listenMode} onChange={(e) => d.setListenMode(e.target.value as ListenMode)}>
              {(Object.keys(LISTEN_LABEL) as ListenMode[]).map((m) => (
                <option key={m} value={m}>
                  {LISTEN_LABEL[m]}
                </option>
              ))}
            </select>
            <ChevronDown size={12} aria-hidden="true" />
          </span>
        </div>
      </div>

      <div className="als-tb" role="group" aria-label="Talkback">
        <button aria-pressed={!d.prefs.talkback} onClick={() => d.setTalkback(false)}>
          Talkback off
        </button>
        <button aria-pressed={d.prefs.talkback} onClick={() => d.setTalkback(true)}>
          Talkback on
        </button>
      </div>

      <div className="als-route">
        <p>
          <Headphones size={12} aria-hidden="true" /> {settings.name} talks to you on <b>{deviceName(d.prefs.privateSink, d)}</b>
          {d.alexTalking && <span className="talking"> · talking now</span>}
          <br />
          <Radio size={12} aria-hidden="true" /> Stream audio on <b>{studio.canRoute ? deviceName(studio.publicSink, d) : "Default speakers"}</b>
          <button
            className="als-link" aria-expanded={routing}
            onClick={() => {
              if (!routing) void d.refreshDevices();
              setRouting((r) => !r);
            }}
          >

            {routing ? "Done" : "Change"}
          </button>
        </p>
        {d.verdict.mode === "text" && (
          <p className="warn" role="status">
            <CircleAlert size={12} aria-hidden="true" /> {d.verdict.why}
          </p>
        )}
        {routing && (
          <div className="als-routepanel">
            <label className="als-bfield">
              <span>Private output — your headphones</span>
              <select className="als-bselect wide" name="privateOutput" value={d.prefs.privateSink} onChange={(e) => d.setPrivateSink(e.target.value)} onFocus={() => void d.refreshDevices()}>
                <option value="">Default speakers</option>
                {d.outputs.filter((o) => o.deviceId !== "default" && o.deviceId !== "communications").map((o) => (
                  <option key={o.deviceId} value={o.deviceId}>
                    {o.label || "Output device"}
                  </option>
                ))}
              </select>
            </label>
            <label className="als-bfield">
              <span>Stream output — what OBS captures</span>
              <select
                className="als-bselect wide" name="streamOutput" value={studio.publicSink} disabled={!studio.canRoute}
                onChange={(e) => studio.setPublicSink(e.target.value)} onFocus={() => void d.refreshDevices()}
              >
                <option value="">Default speakers</option>
                {d.outputs.filter((o) => o.deviceId !== "default" && o.deviceId !== "communications").map((o) => (
                  <option key={o.deviceId} value={o.deviceId}>
                    {o.label || "Output device"}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              Talkback only plays when these are different hardware. Best setup: stream on a virtual cable OBS captures, Talkback on your headphones.
              {!d.outputs.some((o) => o.label) && " Turn the mic on once to see device names."}
            </p>
          </div>
        )}
      </div>

      {perfOpen && <PerformancePanel studio={studio} />}

      <Thread d={d} name={settings.name} />

      <form className="als-cmdbar" onSubmit={submit}>
        <div className="als-types" role="group" aria-label="Command type">
          {COMMAND_TYPES.map((t) => (
            <button type="button" key={t.id} className="als-type" aria-pressed={d.compose.type === t.id} onClick={() => d.setCompose({ type: t.id, targetId: d.compose.targetId })}>
              {t.label}
            </button>
          ))}
        </div>
        {target && d.compose.type !== "direction" && d.compose.type !== "say" && d.compose.type !== "subject" && (
          <div className="als-target">
            <span>
              For <b>@{target.handle}</b>: “{target.text.slice(0, 48)}”
            </span>
            <button
              type="button" aria-label="Clear the selected comment"
              onClick={() => {
                d.setCompose({ type: d.compose.type, targetId: null });
                studio.setSelectedId(null);
              }}
            >
              <X size={11} aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="als-cmdrow">
          <label className="sr" htmlFor="als-direct">
            {type.label}
          </label>
          <input
            id="als-direct" ref={d.composerRef} name="direction" className="als-input priv" value={draft} maxLength={280} autoComplete="off" spellCheck
            placeholder={type.placeholder} onChange={(e) => setDraft(e.target.value)}
          />
          <button className="als-psend" type="submit" aria-label={`Send: ${type.label}`}>
            <Send size={15} aria-hidden="true" />
          </button>
        </div>
        <div className="als-cmdfoot">
          <button type="button" className="als-link" aria-expanded={perfOpen} aria-controls="als-perfpanel" onClick={() => setPerfOpen((o) => !o)}>
            <SlidersHorizontal size={12} aria-hidden="true" />
            Performance{summary.length ? `: ${summary.join(" · ")}` : ""}
          </button>
          <button type="button" className="als-link end" onClick={d.endSession}>
            End session
          </button>
        </div>
      </form>
    </aside>
  );
}
