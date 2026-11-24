// Everything the studio says to LiveTalking (C:\dev\livetalking, port 8010):
// /offer to open the WebRTC session, /humanaudio to hand it a wav, and
// /is_speaking + /interrupt_talk to pace and cut turns. LiveTalking does the
// lip sync and streams the face back.
//
// Field names are read from its web/client.js, docs/api.md and
// server/routes.py — not guessed. A wrong one fails silently with
// {"code": -1}, which is the worst bug to find live.

export const LIVETALKING_URL = "http://127.0.0.1:8010";

export interface OfferRequest {
  sdp: string;
  type: string;
}

export interface OfferAnswer {
  sdp: string;
  type: string;
  sessionid: number | string;
}

/** Narrow shape so tests can inject a fake without DOM fetch types. */
type Fetch = (url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/** LiveTalking answers `{code: 0, msg: "ok"}` on success. */
export function isOk(body: unknown): boolean {
  return !!body && typeof body === "object" && (body as { code?: unknown }).code === 0;
}

export class LiveTalking {
  constructor(
    private base: string = LIVETALKING_URL,
    private fetchFn: Fetch = ((url: string, init?: RequestInit) => fetch(url, init)) as Fetch,
  ) {}

  /** Is the server up? Answers false rather than throwing. */
  async reachable(timeoutMs = 1500): Promise<boolean> {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await this.fetchFn(`${this.base}/api/admin/config`, { signal: ctrl.signal });
      clearTimeout(t);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** The WebRTC handshake, exactly as web/client.js does it. */
  async offer(req: OfferRequest): Promise<OfferAnswer> {
    const res = await this.fetchFn(`${this.base}/offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sdp: req.sdp, type: req.type }),
    });
    if (!res.ok) throw new Error("LiveTalking refused the connection");
    return (await res.json()) as OfferAnswer;
  }

  /**
   * Hand one wav to the avatar. Returns false rather than throwing — a missed
   * line is survivable, an exception that kills the studio is not.
   */
  async speak(sessionid: string, wav: Blob): Promise<boolean> {
    const form = new FormData();
    form.append("sessionid", sessionid);
    form.append("file", wav, "speech.wav");
    try {
      // No Content-Type on purpose: fetch must set the multipart boundary.
      const res = await this.fetchFn(`${this.base}/humanaudio`, { method: "POST", body: form });
      return res.ok && isOk(await res.json());
    } catch {
      return false;
    }
  }

  private async post(path: string, sessionid: string): Promise<unknown> {
    const res = await this.fetchFn(`${this.base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionid }),
    });
    return res.json();
  }

  /**
   * `speak()` returns when LiveTalking ACCEPTS the audio, not when the avatar
   * stops talking — so this is the only way to pace turns.
   *
   * On any error it answers `true`. Guessing "busy" costs a pause; guessing
   * "free" makes the character talk over itself.
   */
  async isSpeaking(sessionid: string): Promise<boolean> {
    try {
      const body = (await this.post("/is_speaking", sessionid)) as { data?: unknown };
      return body?.data !== false;
    } catch {
      return true;
    }
  }

  /** Cut the current line short — the director's barge-in. */
  async interrupt(sessionid: string): Promise<void> {
    try {
      await this.post("/interrupt_talk", sessionid);
    } catch {
      /* a failed interrupt is not worth stopping the stream over */
    }
  }
}
