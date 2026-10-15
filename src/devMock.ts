// Browser preview only (npm run dev, outside Tauri): fakes the Rust commands
// and a streamed answer so the layout can be checked without an API key.
// Production builds never import this file.

import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { Chat, ChatSummary, Project } from "./api";

const now = Date.now();
const day = 86_400_000;

const english = (new URLSearchParams(location.search).get("lang") ?? "de").toLowerCase().startsWith("en");

const sampleText = english
  ? {
      title: "Rust: Arc or Rc?",
      question: "When do I use Arc and when Rc in Rust?",
      thinking: "Difference: atomic reference counting, Send/Sync, cost.",
      intro: "In short: **`Rc`** for one thread, **`Arc`** as soon as the value crosses threads.",
      heading: "## The difference",
      rc: "- `Rc<T>` counts references *non-atomically*. That is cheaper, but `Rc` is neither `Send` nor `Sync`.",
      arc: "- `Arc<T>` counts atomically. Each clone costs a few nanoseconds more, but it works with `std::thread::spawn` and Tokio.",
      table: ["| Threads | one | many |", "| Cost | low | a bit higher |"],
      rule: "> Rule of thumb: start with `Rc`; the compiler tells you when you need `Arc`.",
      more: "More in the [Rust Book](https://doc.rust-lang.org/book/ch16-03-shared-state.html).",
      others: ["Weekly meal plan and shopping list", "Tauri window with vibrancy", "Trip to Lisbon in May"],
      answer:
        "Sure! Here is an idea:\n\n1. **Monday:** Roasted vegetables with feta\n2. **Tuesday:** Lentil curry\n3. **Wednesday:** Lemon spinach pasta\n\nShall I write the shopping list too?",
      think: "The user wants a plan.",
      generated: "Weekly plan with three dishes",
    }
  : {
      title: "Rust: Arc oder Rc?",
      question: "Wann nehme ich in Rust Arc und wann Rc?",
      thinking: "Unterschied: atomare Referenzzählung, Send/Sync, Kosten.",
      intro: "Kurz: **`Rc`** für einen Thread, **`Arc`** sobald der Wert Threadgrenzen überquert.",
      heading: "## Der Unterschied",
      rc: "- `Rc<T>` zählt Referenzen *nicht atomar*. Das ist billiger, aber `Rc` ist weder `Send` noch `Sync`.",
      arc: "- `Arc<T>` zählt atomar. Das kostet pro Klon ein paar Nanosekunden mehr, funktioniert aber mit `std::thread::spawn` und Tokio.",
      table: ["| Threads | einer | viele |", "| Kosten | gering | etwas höher |"],
      rule: "> Faustregel: Fang mit `Rc` an; der Compiler sagt dir, wann du `Arc` brauchst.",
      more: "Mehr dazu im [Rust Book](https://doc.rust-lang.org/book/ch16-03-shared-state.html).",
      others: ["Wochenplan Essen und Einkaufsliste", "Tauri Fenster mit Vibrancy", "Reiseplanung Lissabon im Mai"],
      answer:
        "Gern! Hier ist ein Vorschlag:\n\n1. **Montag:** Ofengemüse mit Feta\n2. **Dienstag:** Linsencurry\n3. **Mittwoch:** Pasta mit Zitrone und Spinat\n\nSoll ich dir die Einkaufsliste dazu schreiben?",
      think: "Der Nutzer möchte einen Plan.",
      generated: "Wochenplan mit drei Gerichten",
    };

const sample: Chat = {
  id: "11111111-1111-4111-8111-111111111111",
  title: sampleText.title,
  createdAt: now - 3_600_000,
  updatedAt: now - 3_600_000,
  model: "claude-sonnet-5-5",
  effort: "medium",
  web: false,
  costUsd: 0.0184,
  sessionId: "55555555-5555-4555-8555-555555555555",
  context: {
    used: 18_400,
    window: 200_000,
    categories: [
      { name: "System prompt", tokens: 2_100, kind: "used" },
      { name: "System tools", tokens: 3_300, kind: "used" },
      { name: "Messages", tokens: 13_000, kind: "used" },
      { name: "Autocompact buffer", tokens: 33_000, kind: "buffer" },
      { name: "Free space", tokens: 148_600, kind: "free" },
    ],
  },
  messages: [
    { id: "m1", role: "user", text: sampleText.question },
    {
      id: "m2",
      role: "assistant",
      turnEnd: "66666666-6666-4666-8666-666666666666",
      thinking: sampleText.thinking,
      costUsd: 0.0184,
      text: [
        sampleText.intro,
        "",
        sampleText.heading,
        "",
        sampleText.rc,
        sampleText.arc,
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
        ...sampleText.table,
        "",
        sampleText.rule,
        "",
        sampleText.more,
      ].join("\n"),
    },
  ],
};

const summaries: ChatSummary[] = [
  { id: sample.id, title: sample.title, updatedAt: sample.updatedAt },
  { id: "22222222-2222-4222-8222-222222222222", title: sampleText.others[0], updatedAt: now - day - 1000 },
  { id: "33333333-3333-4333-8333-333333333333", title: sampleText.others[1], updatedAt: now - 3 * day },
  { id: "44444444-4444-4444-8444-444444444444", title: sampleText.others[2], updatedAt: now - 20 * day },
];

const projects: Project[] = [
  { id: "77777777-7777-4777-8777-777777777777", name: "acme-shop", path: "/Users/demo/code/acme-shop", createdAt: now },
  { id: "88888888-8888-4888-8888-888888888888", name: "quokka-api", path: "/Users/demo/code/quokka-api", createdAt: now },
];
summaries.push({
  id: "99999999-9999-4999-8999-999999999999",
  title: english ? "How does login work?" : "Wie funktioniert der Login?",
  updatedAt: now - 2 * 3_600_000,
  projectId: projects[0].id,
});

const answer = sampleText.answer;

function streamAnswer(chatId: string) {
  let sent = 0;
  void emit("engine", { type: "session", chatId, sessionId: "55555555-5555-4555-8555-555555555555" });
  setTimeout(() => {
    void emit("engine", { type: "delta", chatId, text: "", thinking: sampleText.think });
    const timer = setInterval(() => {
      const chunk = answer.slice(sent, sent + 6);
      sent += 6;
      if (chunk) void emit("engine", { type: "delta", chatId, text: chunk, thinking: "" });
      else {
        clearInterval(timer);
        void emit("engine", {
          type: "done",
          chatId,
          costUsd: 0.0062,
          turnEnd: crypto.randomUUID(),
          error: null,
        });
        void emit("engine", { type: "context", chatId, used: 9_850, window: 200_000 });
      }
    }, 32);
  }, 900);
}

export function installDevMock() {
  mockIPC(
    (cmd, args) => {
      const payload = args as Record<string, unknown> | undefined;
      switch (cmd) {
        case "app_language":
          return new URLSearchParams(location.search).get("lang") ?? "de-DE";
        case "key_status":
          return !new URLSearchParams(location.search).has("onboarding");
        case "chats_list":
          return summaries;
        case "chat_load":
          if (payload?.id === sample.id) return sample;
          return {
            ...sample,
            id: payload?.id,
            title: summaries.find((entry) => entry.id === payload?.id)?.title ?? sample.title,
            messages: sample.messages.slice(0, 1),
          };
        case "usage_get":
          return {
            month: "2026-10",
            usd: 12.4,
            budget: 100,
            byModel: { "claude-sonnet-5-5": 9.85, "claude-opus-5-5": 2.31, "claude-haiku-5-5": 0.24 },
          };
        case "plugin:dialog|open":
          // Tests can set window.__nextFolder to pick a different folder.
          return (window as { __nextFolder?: string }).__nextFolder ?? "/Users/demo/code/acme-shop";
        case "projects_list":
          return projects;
        case "project_add": {
          const { id, path } = payload as { id: string; path: string };
          const existing = projects.find((entry) => entry.path === path);
          if (existing) return existing;
          const project = { id, path, name: path.split("/").pop() ?? path, createdAt: Date.now() };
          projects.push(project);
          return project;
        }
        case "project_rename":
        case "project_remove":
          return null;
        case "project_check":
          return (payload as { path: string }).path;
        case "chat_compact": {
          const chatId = (payload?.request as { chatId: string }).chatId;
          void emit("engine", { type: "compacting", chatId });
          setTimeout(() => {
            void emit("engine", { type: "compacted", chatId, trigger: "manual", before: 18_400, after: 4_200 });
            void emit("engine", { type: "compactDone", chatId, costUsd: 0.004, error: null });
          }, 1500);
          return null;
        }
        case "chat_title":
          setTimeout(
            () => void emit("engine", { type: "title", chatId: payload?.chatId, title: sampleText.generated }),
            600,
          );
          return null;
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

/** `?demo=chat` opens the sample chat and `?lang=en` switches to English, for README screenshots. */
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
