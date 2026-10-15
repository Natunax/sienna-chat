// Turns dropped, pasted or picked files into attachments. Images and PDFs go
// to Claude as base64; text files (code, Markdown, CSV and the like) as plain
// text with their file name, so Claude reads them directly.

import type { OutgoingAttachment } from "./api";
import { t } from "./i18n";

export const TEXT_MEDIA_TYPE = "text/plain";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
// Text is sent as tokens and again with every later message of the chat
// (cached, but still), so it is kept smaller than a PDF.
const MAX_TEXT_BYTES = 512 * 1024;

const TEXT_EXTENSIONS = new Set(
  (
    "txt text md markdown mdx rst adoc org csv tsv json jsonc jsonl ndjson yaml yml toml ini cfg conf properties " +
    "xml html htm css scss sass less svg js mjs cjs jsx ts mts cts tsx vue svelte astro py pyi rb php pl lua r " +
    "rs go java kt kts scala swift m mm c h cc cpp cxx hpp hh cs fs fsx vb dart ex exs erl hs ml clj elm zig nim " +
    "sh bash zsh fish ps1 bat cmd sql graphql gql proto prisma tf hcl nix dockerfile makefile mk cmake gradle " +
    "gitignore gitattributes editorconfig env log diff patch tex bib srt vtt"
  ).split(" "),
);
// Well-known files without an extension.
const TEXT_NAMES = new Set(["dockerfile", "makefile", "readme", "license", "changelog", "procfile", "gemfile"]);

function extension(name: string): string {
  const base = name.toLowerCase();
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1) : "";
}

export function isTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  if (["application/json", "application/xml", "application/x-yaml", "application/sql"].includes(file.type)) {
    return true;
  }
  const name = file.name.toLowerCase();
  return TEXT_EXTENSIONS.has(extension(name)) || TEXT_NAMES.has(name);
}

/** The types the file picker offers; text files are matched by extension. */
export const PICKER_ACCEPT = [
  ...IMAGE_TYPES,
  "application/pdf",
  ...[...TEXT_EXTENSIONS].map((ext) => `.${ext}`),
].join(",");

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(t("composer.readError"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

async function readText(file: File): Promise<string> {
  // A strict decoder rejects binary files that only look like text by name.
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    if (text.includes("\u0000")) throw new Error("binary");
    return text;
  } catch {
    throw t("composer.notText");
  }
}

export async function readAttachment(file: File): Promise<OutgoingAttachment> {
  const isPdf = file.type === "application/pdf";
  const isImage = IMAGE_TYPES.includes(file.type);

  if (isImage || isPdf) {
    if (file.size > (isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)) {
      throw isPdf ? t("composer.pdfSize") : t("composer.imageSize");
    }
    const url = await readAsDataUrl(file);
    return {
      name: file.name || t("app.image"),
      mediaType: file.type,
      data: url.slice(url.indexOf(",") + 1),
      previewUrl: isPdf ? undefined : URL.createObjectURL(file),
    };
  }

  if (isTextFile(file)) {
    if (file.size > MAX_TEXT_BYTES) throw t("composer.textSize");
    return { name: file.name, mediaType: TEXT_MEDIA_TYPE, data: await readText(file) };
  }

  throw t("composer.fileType");
}
