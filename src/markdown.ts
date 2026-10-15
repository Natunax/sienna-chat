import DOMPurify from "dompurify";
import { Marked, type Token, type TokensList } from "marked";

const marked = new Marked({ gfm: true, breaks: false });

// Rendering is the hot path while an answer streams. The text is split into
// top-level blocks and every block is rendered once and cached by its source,
// so a new delta only re-renders the block still being written.
const cache = new Map<string, string>();
const CACHE_LIMIT = 2000;

const PURIFY = { FORBID_TAGS: ["style", "form", "input", "button", "iframe"], FORBID_ATTR: ["style"] };

function renderBlock(token: Token, links: TokensList["links"]): string {
  const hit = cache.get(token.raw);
  if (hit !== undefined) return hit;
  const list = Object.assign([token], { links }) as TokensList;
  const html = DOMPurify.sanitize(marked.parser(list), PURIFY);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(token.raw, html);
  return html;
}

export interface Block {
  key: string;
  html: string;
}

export function renderBlocks(text: string): Block[] {
  const tokens = marked.lexer(text);
  const blocks: Block[] = [];
  tokens.forEach((token, index) => {
    if (token.type === "space") return;
    blocks.push({ key: `${index}`, html: renderBlock(token, tokens.links) });
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
