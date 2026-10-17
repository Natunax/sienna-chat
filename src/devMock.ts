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

// A project chat: Claude reads, asks to change a file, then to run the tests.
// Approvals waiting for an answer, by request id (two answers can wait at once).
const waitingOn = new Map<string, (decision: string) => void>();

function ask(chatId: string, request: Record<string, unknown>): Promise<string> {
  void emit("engine", { type: "permission", chatId, ...request });
  return new Promise((resolve) => {
    waitingOn.set(String(request.id), (decision) => {
      void emit("engine", { type: "permissionGone", chatId, id: request.id });
      resolve(decision);
    });
  });
}

async function streamCodeAnswer(chatId: string) {
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  void emit("engine", { type: "session", chatId, sessionId: "55555555-5555-4555-8555-555555555555" });
  await pause(500);
  void emit("engine", {
    type: "delta",
    chatId,
    text: english ? "I'll look at how the cart adds up first." : "Ich sehe mir zuerst an, wie der Warenkorb rechnet.",
    thinking: "",
  });
  await pause(300);
  // A look around first, folded into one line in the answer.
  const look = [
    ["l1", "Bash", "ls -la && git log --oneline | head -20 && cat README* 2>/dev/null | head -80 && sed -n 80,400p docs/architecture.md | head -150"],
    ["l2", "Glob", "**/*.{json,md,ts,tsx}"],
    ["l3", "Grep", "total|quantity|discount|coupon|shipping|tax|currency|rounding|price"],
  ];
  for (const [id, name, detail] of look) {
    void emit("engine", { type: "tool", chatId, id, name, detail });
    if (name === "Bash") void emit("engine", { type: "toolResult", chatId, id, failed: false, output: "total 48\ndrwxr-xr-x  12 dev  staff   384 Oct 16 09:12 .\n3f2a1c9 fix: round totals\n" });
    await pause(300);
  }
  // A helper looks for the tests meanwhile; its steps go under its call.
  void emit("engine", { type: "tool", chatId, id: "ag1", name: "Agent", agent: "Explore", detail: english ? "Find the cart tests" : "Warenkorb-Tests finden" });
  void emit("engine", { type: "helper", chatId, id: "ag1", state: "running", steps: 0, summary: english ? "Looking for test files" : "Sucht Testdateien" });
  // It reports back a little later, while Claude goes on.
  setTimeout(() => {
    void emit("engine", { type: "helper", chatId, id: "ag1", state: "done", steps: 3, summary: null });
    const report = english
      ? "The cart tests are in `src/cart.test.ts`. `total` is covered for single items only; quantities have no test."
      : "Die Warenkorb-Tests stehen in `src/cart.test.ts`. `total` ist nur für einzelne Artikel getestet, Mengen haben keinen Test.";
    void emit("engine", { type: "toolResult", chatId, id: "ag1", failed: false, output: report });
  }, 2500);
  for (const [id, name, detail] of [["ag1a", "Glob", "**/*.test.ts"], ["ag1b", "Read", "src/cart.test.ts"], ["ag1c", "Grep", "describe\\(\"cart"]]) {
    void emit("engine", { type: "tool", chatId, id, parent: "ag1", name, detail });
    await pause(150);
  }
  void emit("engine", { type: "tool", chatId, id: "t1", name: "Read", detail: "src/cart.ts" });
  await pause(400);
  void emit("engine", {
    type: "delta",
    chatId,
    text: english ? "\n\nThe total ignores the quantity. I'll fix it:" : "\n\nDie Summe ignoriert die Menge. Ich korrigiere das:",
    thinking: "",
  });
  await pause(200);
  void emit("engine", { type: "tool", chatId, id: "t2", name: "Edit", detail: "src/cart.ts" });
  const edit = await ask(chatId, {
    id: crypto.randomUUID(),
    toolUseId: "t2",
    tool: "Edit",
    path: "src/cart.ts",
    before: "export function total(items: Item[]) {\n  return items.reduce((sum, item) => sum + item.price, 0);\n}",
    after:
      "export function total(items: Item[]) {\n  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);\n}",
  });
  if (edit === "deny") {
    void emit("engine", { type: "toolResult", chatId, id: "t2", failed: true, output: "" });
    void emit("engine", { type: "delta", chatId, text: english ? "Okay, I left the file as it is. How should I go on?" : "Gut, ich lasse die Datei, wie sie ist. Wie soll ich weitermachen?", thinking: "" });
  } else {
    void emit("engine", { type: "tool", chatId, id: "t3", name: "Bash", detail: "npm test -- cart" });
    const run = await ask(chatId, {
      id: crypto.randomUUID(),
      toolUseId: "t3",
      tool: "Bash",
      command: "npm test -- cart",
      description: english ? "Run the cart tests" : "Warenkorb-Tests ausführen",
    });
    if (run === "deny") void emit("engine", { type: "toolResult", chatId, id: "t3", failed: true, output: "" });
    else
      void emit("engine", {
        type: "toolResult",
        chatId,
        id: "t3",
        failed: false,
        output: " ✓ cart › total counts the quantity (3 ms)\n ✓ cart › empty cart is 0 (1 ms)\n\nTests: 2 passed, 2 total",
      });
    void emit("engine", {
      type: "delta",
      chatId,
      text: english
        ? "`total` now multiplies by `quantity`, and the cart tests pass."
        : "`total` rechnet jetzt mit `quantity`, und die Warenkorb-Tests laufen durch.",
      thinking: "",
    });
  }
  await pause(200);
  void emit("engine", { type: "done", chatId, costUsd: 0.021, turnEnd: crypto.randomUUID(), error: null });
}

function streamTemplate(chatId: string, format: string) {
  const data =
    format === "review"
      ? {
          summary: english ? "Two things to look at before committing." : "Zwei Punkte vor dem Commit.",
          findings: [
            { severity: "high", file: "src/cart.ts", line: 12, issue: english ? "Quantity can be negative." : "Die Menge kann negativ sein.", fix: english ? "Clamp it at 0." : "Auf 0 begrenzen." },
            { severity: "low", file: "src/cart.test.ts", issue: english ? "No test for an empty cart." : "Kein Test für einen leeren Warenkorb." },
          ],
        }
      : format === "changelog"
        ? {
            title: "v0.4.0",
            sections: [
              { heading: english ? "Added" : "Neu", items: [english ? "Quantities in the cart" : "Mengen im Warenkorb"] },
              { heading: english ? "Fixed" : "Behoben", items: [english ? "Total ignored the quantity" : "Summe ignorierte die Menge"] },
            ],
          }
        : { tasks: [{ title: english ? "Write the shopping list" : "Einkaufsliste schreiben", priority: "high" }, { title: english ? "Book the table" : "Tisch reservieren", priority: "low", detail: english ? "Friday evening" : "Freitagabend" }] };
  setTimeout(() => {
    void emit("engine", { type: "done", chatId, costUsd: 0.012, turnEnd: crypto.randomUUID(), structured: data, error: null });
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
        case "chat_send": {
          const request = payload?.request as { chatId: string; projectDir?: string | null; lane?: boolean; format?: string | null };
          const text = String((request as { text?: string }).text ?? "");
          // Claude going on by itself after its answer, as when a helper reports back.
          if (/auto-test/i.test(text)) {
            streamAnswer(request.chatId);
            setTimeout(() => {
              void emit("engine", { type: "autoTurn", chatId: request.chatId });
              void emit("engine", { type: "delta", chatId: request.chatId, text: english ? "The helper is done: the tests pass." : "Der Helfer ist fertig: Die Tests laufen durch.", thinking: "" });
            }, 6000);
            setTimeout(() => void emit("engine", { type: "done", chatId: request.chatId, costUsd: 0.003, turnEnd: crypto.randomUUID(), error: null }), 7500);
            return null;
          }
          if (/artefakt|artifact|rechner|calculator/i.test(text)) {
            streamArtifact(request.chatId, /blau|blue/i.test(text));
            return null;
          }
          if (request.format) streamTemplate(request.chatId, request.format);
          else if (request.projectDir) void streamCodeAnswer(request.chatId);
          else streamAnswer(request.chatId);
          return null;
        }
        case "chat_revert_files": {
          const request = payload?.request as { chatId: string; messageId: string };
          setTimeout(() => void emit("engine", { type: "filesReverted", chatId: request.chatId, messageId: request.messageId, files: ["src/cart.ts"], error: null }), 300);
          return null;
        }
        case "project_guess_check":
          return "npm test";
        case "artifact_stage":
          // The browser preview has no artifact scheme: the page itself comes back.
          return `mock:${(payload as { content: string }).content}${MOCK_MEASURE}`;
        case "artifact_save":
          return true;
        case "project_files":
          return [
            "README.md", "package.json", "tsconfig.json", "docs", "docs/architecture.md", "docs/read me.md",
            "src", "src/cart.ts", "src/cart.test.ts", "src/checkout", "src/checkout/payment.ts",
            "src/checkout/shipping.ts", "src/components", "src/components/CartView.tsx",
            "src/components/CheckoutButton.tsx", "src/legacy", "src/legacy/old-cart.ts", "src/main.ts",
          ].map((path) => ({ path, dir: !path.includes(".") }));
        case "voice_start":
          return startDictation();
        case "voice_stop":
          finishDictation();
          return null;
        case "voice_cancel":
          dictation?.timers.forEach(clearTimeout);
          dictation = null;
          return null;
        case "chat_steer": {
          // The running answer takes it in at its next step.
          const steer = payload as { chatId: string; id: string };
          setTimeout(() => void emit("engine", { type: "steered", chatId: steer.chatId, id: steer.id }), 700);
          return null;
        }
        case "chat_permission":
          {
            const answer = payload as { id: string; decision: string };
            waitingOn.get(answer.id)?.(answer.decision);
            waitingOn.delete(answer.id);
          }
          return null;
        case "workcopy_create":
          return "/mock/copies/1/work";
        case "workcopy_changes":
          return [
            { path: "src/cart.ts", kind: "modified" },
            { path: "src/cart.test.ts", kind: "added" },
          ];
        case "workcopy_apply":
          return { applied: ["src/cart.ts"], conflicts: ["src/cart.test.ts"] };
        case "workcopy_discard":
          return null;
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
}

// The browser preview's copy of the measuring script Rust adds (artifact.rs).
const MOCK_MEASURE = String.raw`<script>(()=>{const send=()=>{const d=document,body=d.body;if(!body)return;const W=innerWidth,H=innerHeight,clips=new Map();const cut=(a,c)=>({left:Math.max(a.left,c.left),top:Math.max(a.top,c.top),right:Math.min(a.right,c.right),bottom:Math.min(a.bottom,c.bottom)});const clipOf=e=>{if(!e||e===body||e===d.documentElement)return{left:-1/0,top:-1/0,right:1/0,bottom:1/0};if(clips.has(e))return clips.get(e);let c=clipOf(e.parentElement);const s=getComputedStyle(e);if(s.overflowX!=='visible'||s.overflowY!=='visible')c=cut(c,e.getBoundingClientRect());clips.set(e,c);return c};let l=1/0,t=1/0,r=-1/0,b=-1/0;const add=(x,e)=>{const c=cut(x,clipOf(e));const w=c.right-c.left,h=c.bottom-c.top;if(w<1||h<1||(w>=W-1&&h>=H-1))return;l=Math.min(l,c.left+scrollX);t=Math.min(t,c.top+scrollY);r=Math.max(r,c.right+scrollX);b=Math.max(b,c.bottom+scrollY)};const walk=d.createTreeWalker(body,4);const range=d.createRange();for(let n=walk.nextNode(),i=0;n&&i<4000;n=walk.nextNode(),i++){if(n.nodeValue.trim()&&n.parentElement){range.selectNodeContents(n);add(range.getBoundingClientRect(),n.parentElement)}}const all=body.querySelectorAll('*');for(let i=0;i<all.length&&i<4000;i++){const e=all[i];const s=getComputedStyle(e);if(s.visibility==='hidden'||s.opacity==='0')continue;if(/^(IMG|SVG|CANVAS|VIDEO|INPUT|BUTTON|SELECT|TEXTAREA|PROGRESS|METER)$/i.test(e.tagName)){add(e.getBoundingClientRect(),e.parentElement);continue}const bg=s.backgroundColor,shown=(bg&&bg!=='transparent'&&!/rgba\([^)]*,\s*0\)$/.test(bg))||s.backgroundImage!=='none'||parseFloat(s.borderTopWidth)>0||parseFloat(s.borderLeftWidth)>0||s.boxShadow!=='none';if(shown)add(e.getBoundingClientRect(),e.parentElement)}if(!(r>l&&b>t)){l=0;t=0;r=d.documentElement.scrollWidth;b=d.documentElement.scrollHeight}const bs=getComputedStyle(body),hs=getComputedStyle(d.documentElement),px=v=>parseFloat(v)||0;parent.postMessage({sienna:'size',l:l,t:t,w:r-l,h:b-t,vw:innerWidth,vh:innerHeight,pl:px(bs.paddingLeft)+px(bs.marginLeft)+px(hs.paddingLeft),pt:px(bs.paddingTop)+px(bs.marginTop)+px(hs.paddingTop)},'*')};let q=0;const later=()=>{clearTimeout(q);q=setTimeout(send,120)};addEventListener('load',send);addEventListener('resize',later);try{new ResizeObserver(later).observe(document.documentElement)}catch(e){}})()</script>`;

// An answer that makes an artifact: a small calculator, blue on request.
function streamArtifact(chatId: string, blue: boolean) {
  const color = blue ? "#2563eb" : "#b5552f";
  // Screenshots and checks can hand in a page of their own.
  const custom = (window as { __mockArtifact?: string }).__mockArtifact;
  const content = custom ?? `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:15px -apple-system,system-ui,sans-serif;margin:0;padding:32px;color:#1c1917}
h1{font-size:20px;margin:0 0 16px}label{display:block;margin:12px 0 4px;color:#57534e}
input{font:inherit;padding:8px 10px;border:1px solid #d6d3d1;border-radius:8px;width:200px}
button{margin-top:16px;font:inherit;padding:8px 14px;border:0;border-radius:8px;background:${color};color:#fff}
output{display:block;margin-top:16px;font-size:24px;font-weight:600}</style></head><body>
<h1>${english ? "Monthly budget" : "Monatsbudget"}</h1>
<label>${english ? "Income" : "Einnahmen"}</label><input id="i" type="number" value="3200">
<label>${english ? "Spending" : "Ausgaben"}</label><input id="o" type="number" value="2450">
<button onclick="r.textContent=(i.value-o.value).toFixed(2)+' €'">${english ? "Calculate" : "Berechnen"}</button>
<output id="r"></output></body></html>`;
  void emit("engine", { type: "session", chatId, sessionId: "55555555-5555-4555-8555-555555555555" });
  setTimeout(() => {
    void emit("engine", {
      type: "artifact",
      chatId,
      artifact: { id: "budget-calculator", title: english ? "Budget calculator" : "Budget-Rechner", kind: "html", content },
    });
  }, 500);
  setTimeout(() => {
    const text = english
      ? "I built a small budget calculator; it is open on the right."
      : "Ich habe einen kleinen Budget-Rechner gebaut, er ist rechts offen.";
    void emit("engine", { type: "delta", chatId, text, thinking: "" });
    void emit("engine", { type: "done", chatId, costUsd: 0.014, turnEnd: crypto.randomUUID(), error: null });
  }, 900);
}

// Dictation: a sentence that arrives word by word, with a level that moves.
let dictation: { generation: number; timers: number[]; heard: string } | null = null;
let dictations = 0;

function startDictation(): number {
  dictation?.timers.forEach(clearTimeout);
  const generation = ++dictations;
  const words = (english ? "Add a test for the empty cart" : "Schreib einen Test für den leeren Warenkorb").split(" ");
  const run = { generation, timers: [] as number[], heard: "" };
  dictation = run;
  const later = (ms: number, event: Record<string, unknown>) =>
    run.timers.push(window.setTimeout(() => void emit("voice", { ...event, generation }), ms));
  later(300, { type: "ready" });
  words.forEach((_, index) => {
    const text = words.slice(0, index + 1).join(" ");
    run.timers.push(window.setTimeout(() => (run.heard = text), 700 + index * 380));
    later(700 + index * 380, { type: "partial", text });
  });
  for (let ms = 350; ms < 700 + words.length * 380; ms += 90) later(ms, { type: "level", value: Math.random() });
  return generation;
}

function finishDictation() {
  const run = dictation;
  if (!run) return;
  run.timers.forEach(clearTimeout);
  dictation = null;
  const text = run.heard ? `${run.heard}.` : "";
  setTimeout(() => {
    void emit("voice", { type: "final", text, generation: run.generation });
    void emit("voice", { type: "end", generation: run.generation });
  }, 400);
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
