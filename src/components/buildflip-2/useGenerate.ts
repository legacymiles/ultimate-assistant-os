"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Progress } from "@/lib/buildflip-2/ai/generate";
import type { Project } from "@/lib/buildflip-2/types";
import type { ComposerSubmit } from "./Composer";
import { useApp } from "./AppState";

/**
 * Drives one plan generation over Server-Sent Events.
 *
 * The request id is kept so a retry after a dropped connection resumes the same
 * plan rather than creating a second one (D5), and the project row exists on the
 * server from the first moment, so nothing typed is ever lost (R6).
 */

export interface GenerationState {
  running: boolean;
  progress: Progress | null;
  elapsedMs: number;
  project: Project | null;
  error: string | null;
  paywall: { moment: string; message: string } | null;
  demo: boolean;
}

export function useGenerate() {
  const { putProject, refresh } = useApp();
  const [state, setState] = useState<GenerationState>({
    running: false,
    progress: null,
    elapsedMs: 0,
    project: null,
    error: null,
    paywall: null,
    demo: false,
  });
  const abort = useRef<AbortController | null>(null);
  const lastInput = useRef<ComposerSubmit | null>(null);
  const startedAt = useRef(0);

  useEffect(() => {
    if (!state.running) return;
    const timer = setInterval(() => {
      setState((s) => ({ ...s, elapsedMs: Date.now() - startedAt.current }));
    }, 250);
    return () => clearInterval(timer);
  }, [state.running]);

  useEffect(() => () => abort.current?.abort(), []);

  const run = useCallback(
    async (input: ComposerSubmit, retryProjectId?: string) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      lastInput.current = input;
      startedAt.current = Date.now();

      setState({
        running: true,
        progress: { stage: "reading", label: "Starting up", pct: 0.03 },
        elapsedMs: 0,
        project: null,
        error: null,
        paywall: null,
        demo: false,
      });

      try {
        const res = await fetch("/api/buildflip-2/plan/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: input.prompt,
            sourceUrl: input.sourceUrl || undefined,
            images: input.images,
            requestId: input.requestId,
            projectId: retryProjectId,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          if (res.status === 402 && body.paywall) {
            setState((s) => ({
              ...s,
              running: false,
              paywall: {
                moment: String(body.moment ?? "secondPlan"),
                message: String(body.error ?? ""),
              },
            }));
            return;
          }
          setState((s) => ({
            ...s,
            running: false,
            error:
              (body.error as string | undefined) ??
              "We couldn't start that plan. Your idea is saved — try again.",
          }));
          return;
        }

        // A duplicate request short-circuits to the plan that already exists.
        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const body = (await res.json()) as { duplicate?: boolean; projectId?: string };
          if (body.duplicate && body.projectId) {
            await refresh({ quiet: true });
            setState((s) => ({ ...s, running: false }));
            return;
          }
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const eventLine = frame.split("\n").find((l) => l.startsWith("event: "));
            const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!eventLine || !dataLine) continue;
            const event = eventLine.slice(7).trim();
            let data: unknown;
            try {
              data = JSON.parse(dataLine.slice(6));
            } catch {
              continue;
            }

            if (event === "progress") {
              setState((s) => ({ ...s, progress: data as Progress }));
            } else if (event === "done") {
              const payload = data as { project: Project; demo: boolean };
              putProject(payload.project);
              setState((s) => ({
                ...s,
                running: false,
                project: payload.project,
                demo: payload.demo,
                progress: { stage: "done", label: "Done", pct: 1 },
              }));
            } else if (event === "error") {
              const payload = data as { error: string };
              await refresh({ quiet: true });
              setState((s) => ({ ...s, running: false, error: payload.error }));
            }
          }
        }

        setState((s) => (s.running ? { ...s, running: false } : s));
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          setState((s) => ({ ...s, running: false }));
          return;
        }
        setState((s) => ({
          ...s,
          running: false,
          error:
            "The connection dropped while building. Your idea is saved — hit Try again.",
        }));
      }
    },
    [putProject, refresh],
  );

  const retry = useCallback(
    (projectId?: string) => {
      if (!lastInput.current) return;
      void run(lastInput.current, projectId);
    },
    [run],
  );

  const cancel = useCallback(() => {
    abort.current?.abort();
    setState((s) => ({ ...s, running: false }));
  }, []);

  const dismiss = useCallback(() => {
    setState((s) => ({ ...s, error: null, paywall: null, project: null, progress: null }));
  }, []);

  return { ...state, run, retry, cancel, dismiss, canRetry: Boolean(lastInput.current) };
}
