// Dictation into the input field, as in Claude Code. The `sienna-voice` helper
// recognizes speech on this Mac only; its text lands in the input field and is
// never sent on its own.

import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { locale, type TextKey } from "./i18n";

export type VoiceState = "idle" | "starting" | "listening" | "finishing";

type VoiceEvent = { generation: number } & (
  | { type: "ready" | "limit" | "end" }
  | { type: "level"; value: number }
  | { type: "partial" | "final"; text: string }
  | { type: "error"; code: string }
);

interface Handlers {
  /** The whole dictated text so far; `final` once the helper heard the end. */
  onText: (text: string, final: boolean) => void;
  onNotice: (key: TextKey) => void;
}

export function useVoice(handlers: Handlers) {
  const [state, setState] = useState<VoiceState>("idle");
  const [level, setLevel] = useState(0);
  // The run whose events count; "pending" until `voice_start` answers.
  const current = useRef<number | "pending" | null>(null);
  // Events of this run and older ones are ignored (cancelled or replaced).
  const retired = useRef(0);
  // Stopped before `voice_start` answered: stop once it has.
  const started = useRef(false);
  const stopWhenStarted = useRef(false);
  const latest = useRef(handlers);
  latest.current = handlers;

  const reset = () => {
    if (typeof current.current === "number") retired.current = Math.max(retired.current, current.current);
    current.current = null;
    setState("idle");
    setLevel(0);
  };

  useEffect(() => {
    const stop = listen<VoiceEvent>("voice", ({ payload }) => {
      if (payload.generation <= retired.current) return;
      if (current.current === "pending") current.current = payload.generation;
      if (payload.generation !== current.current) return;
      switch (payload.type) {
        case "ready":
          setState((state) => (state === "starting" ? "listening" : state));
          break;
        case "level":
          setLevel(payload.value);
          break;
        case "partial":
        case "final":
          latest.current.onText(payload.text, payload.type === "final");
          break;
        case "limit":
          latest.current.onNotice("voice.limit");
          break;
        case "error":
          latest.current.onNotice(`voice.${payload.code}` as TextKey);
          reset();
          break;
        case "end":
          reset();
          break;
      }
    });
    // A reload or a closing window ends the microphone too.
    const leave = () => current.current !== null && void api.voiceCancel();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      void stop.then((unlisten) => unlisten());
      // Leaving the view never leaves the microphone on.
      if (current.current !== null) void api.voiceCancel();
    };
  }, []);

  const start = async () => {
    if (current.current !== null) return;
    current.current = "pending";
    started.current = false;
    stopWhenStarted.current = false;
    setState("starting");
    try {
      const generation = await api.voiceStart(locale().startsWith("de") ? "de" : "en");
      started.current = true;
      if (current.current === null) {
        // Cancelled while it started.
        retired.current = Math.max(retired.current, generation);
        void api.voiceCancel();
        return;
      }
      current.current = generation;
      if (stopWhenStarted.current) void api.voiceStop();
    } catch (reason) {
      started.current = true;
      latest.current.onNotice(reason === "voice.missing" ? "voice.missing" : "voice.failed");
      reset();
    }
  };

  /** Ends the microphone; the last words still arrive. */
  const stop = () => {
    if (current.current === null) return;
    setState("finishing");
    setLevel(0);
    if (!started.current) stopWhenStarted.current = true;
    else void api.voiceStop();
  };

  /** Ends at once; no more text arrives. */
  const cancel = () => {
    if (current.current === null) return;
    void api.voiceCancel();
    reset();
  };

  return { state, level, active: state !== "idle", start, stop, cancel };
}
