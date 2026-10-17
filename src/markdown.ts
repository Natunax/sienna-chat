import DOMPurify from "dompurify";
import { Marked, type Token, type TokensList } from "marked";

const marked = new Marked({ gfm: true, breaks: false });

// Rendering is the hot path while an answer streams. The text is split into
// top-level blocks and every block is rendered once and cached by its source,
// so a new delta only re-renders the block still being written.
const cache = new Map<string, string>();
const CACHE_LIMIT = 2000;

const PURIFY = { FORBID_TAGS: ["style", "form", "input", "button", "iframe"], FORBID_ATTR: ["style"] };

// An answer must not dress up as the app: no ids, and classes only for the
// code language. A link shows where it goes before it is clicked.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  node.removeAttribute("id");
  if (node.tagName !== "CODE" || !/^language-[\w+-]+$/.test(node.getAttribute("class") ?? "")) {
    node.removeAttribute("class");
  }
  if (node.tagName === "A") node.setAttribute("title", node.getAttribute("href") ?? "");
});

function renderBlock(token: Token, links: TokensList["links"], keep: boolean): string {
  const hit = cache.get(token.raw);
  if (hit !== undefined) return hit;
  const list = Object.assign([token], { links }) as TokensList;
  const html = DOMPurify.sanitize(marked.parser(list), PURIFY);
  // A block still growing in a streamed answer would only push finished ones out.
  if (!keep) return html;
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(token.raw, html);
  return html;
}

export interface Block {
  key: string;
  html: string;
}

// While an answer streams, its text only grows: the finished blocks of the
// last lexing stay, and only the text from the last block on is lexed again.
// A few recent texts are kept, for compared answers streaming side by side.
type Lexed = { text: string; tokens: Token[]; links: TokensList["links"] };
const recent: Lexed[] = [];

function lexGrowing(text: string): Lexed {
  const before = recent.find((entry) => text.startsWith(entry.text));
  let lexed: Lexed;
  if (before) {
    const last = before.tokens.findLastIndex((token) => token.type !== "space");
    const kept = last > 0 ? before.tokens.slice(0, last) : [];
    const offset = kept.reduce((sum, token) => sum + token.raw.length, 0);
    const rest = marked.lexer(text.slice(offset));
    lexed = { text, tokens: [...kept, ...rest], links: { ...before.links, ...rest.links } };
    recent.splice(recent.indexOf(before), 1);
  } else {
    const tokens = marked.lexer(text);
    lexed = { text, tokens, links: tokens.links };
  }
  recent.unshift(lexed);
  if (recent.length > 4) recent.pop();
  return lexed;
}

/** `final` is false while the answer streams: its last block is still growing. */
export function renderBlocks(text: string, final = true): Block[] {
  // A finished answer is lexed as a whole, so nothing depends on how it streamed.
  const lexed = final ? { tokens: marked.lexer(text) as Token[], links: null } : lexGrowing(text);
  const tokens = lexed.tokens;
  const links = lexed.links ?? (tokens as TokensList).links;
  const blocks: Block[] = [];
  const last = tokens.findLastIndex((token) => token.type !== "space");
  tokens.forEach((token, index) => {
    if (token.type === "space") return;
    blocks.push({ key: `${index}`, html: renderBlock(token, links, final || index !== last) });
  });
  return blocks;
}

type Highlighter = typeof import("highlight.js").default;
let highlighter: Promise<Highlighter> | null = null;

/** Loads highlight.js on first use so it never weighs on startup. */
export function loadHighlighter(): Promise<Highlighter> {
  highlighter ??= import("highlight.js/lib/common").then((module) => module.default);
  return highlighter;
}
