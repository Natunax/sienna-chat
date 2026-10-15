// Browser preview only (npm run dev, outside Tauri): fakes the Rust commands
// and a streamed answer so the layout can be checked without an API key.
// Production builds never import this file.

import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { Chat, ChatSummary } from "./api";

const now = Date.now();
const day = 86_400_000;

const sample: Chat = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Rust: Arc oder Rc?",
  createdAt: now - 3_600_000,
  updatedAt: now - 3_600_000,
  model: "claude-sonnet-5-5",
  effort: "medium",
  web: false,
  sessionId: null,
  costUsd: 0.0184,
  messages: [
    { id: "m1", role: "user", text: "Wann nehme ich in Rust Arc und wann Rc?" },
    {
      id: "m2",
      role: "assistant",
      thinking: "Unterschied: atomare Referenzzählung, Send/Sync, Kosten.",
      costUsd: 0.0184,
      text: [
        "Kurz: **`Rc`** für einen Thread, **`Arc`** sobald der Wert Threadgrenzen überquert.",
        "",
        "## Der Unterschied",
        "",
        "- `Rc<T>` zählt Referenzen *nicht atomar*. Das ist billiger, aber `Rc` ist weder `Send` noch `Sync`.",
        "- `Arc<T>` zählt atomar. Das kostet pro Klon ein paar Nanosekunden mehr, funktioniert aber mit `std::thread::spawn` und Tokio.",
        "",
        "```rust",
        "use std::sync::{Arc, Mutex};",
        "",
        "fn main() {",
        "    let counter = Arc::new(Mutex::new(0));",
        "    let handles: Vec<_> = (0..4)",
        "        .map(|_| {",
        "            let counter = Arc::clone(&counter);",
        "            std::thread::spawn(move || *counter.lock().unwrap() += 1)",
        "        })",
        "        .collect();",
        "    for handle in handles { handle.join().unwrap(); }",
        "}",
        "```",
        "",
        "| | `Rc` | `Arc` |",
        "|---|---|---|",
        "| Threads | einer | viele |",
        "| Kosten | gering | etwas höher |",
        "",
        "> Faustregel: Fang mit `Rc` an; der Compiler sagt dir, wann du `Arc` brauchst.",
        "",
        "Mehr dazu im [Rust Book](https://doc.rust-lang.org/book/ch16-03-shared-state.html).",
      ].join("\n"),
    },
  ],
};

const summaries: ChatSummary[] = [
  { id: sample.id, title: sample.title, updatedAt: sample.updatedAt },
  { id: "22222222-2222-4222-8222-222222222222", title: "Wochenplan Essen und Einkaufsliste", updatedAt: now - day - 1000 },
  { id: "33333333-3333-4333-8333-333333333333", title: "Tauri Fenster mit Vibrancy", updatedAt: now - 3 * day },
  { id: "44444444-4444-4444-8444-444444444444", title: "Reiseplanung Lissabon im Mai", updatedAt: now - 20 * day },
];

const answer =
  "Gern! Hier ist ein Vorschlag:\n\n1. **Montag:** Ofengemüse mit Feta\n2. **Dienstag:** Linsencurry\n3. **Mittwoch:** Pasta mit Zitrone und Spinat\n\nSoll ich dir die Einkaufsliste dazu schreiben?";

function streamAnswer(chatId: string) {
  let sent = 0;
  void emit("engine", { type: "session", chatId, sessionId: "55555555-5555-4555-8555-555555555555" });
  setTimeout(() => {
    void emit("engine", { type: "delta", chatId, text: "", thinking: "Der Nutzer möchte einen Plan." });
    const timer = setInterval(() => {
      const chunk = answer.slice(sent, sent + 6);
      sent += 6;
      if (chunk) void emit("engine", { type: "delta", chatId, text: chunk, thinking: "" });
      else {
        clearInterval(timer);
        void emit("engine", { type: "done", chatId, costUsd: 0.0062, error: null });
      }
    }, 32);
  }, 900);
}

export function installDevMock() {
  mockIPC(
    (cmd, args) => {
      const payload = args as Record<string, unknown> | undefined;
      switch (cmd) {
        case "key_status":
          return !new URLSearchParams(location.search).has("onboarding");
        case "chats_list":
          return summaries;
        case "chat_load":
          return payload?.id === sample.id ? sample : { ...sample, id: payload?.id, messages: sample.messages.slice(0, 1) };
        case "usage_get":
          return { month: "2026-10", usd: 12.4, budget: 100 };
        case "chat_send":
          streamAnswer((payload?.request as { chatId: string }).chatId);
          return null;
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
}

/** `?demo=chat` opens the sample chat, for README screenshots. */
export function openDemoChat() {
  if (new URLSearchParams(location.search).get("demo") !== "chat") return;
  const open = () => {
    const row = document.querySelector<HTMLButtonElement>(".chat-row-main");
    if (!row) return requestAnimationFrame(open);
    row.click();
    // Show the start of the answer rather than its end.
    setTimeout(() => document.querySelector(".scroller")?.scrollTo(0, 0), 600);
  };
  requestAnimationFrame(open);
}
