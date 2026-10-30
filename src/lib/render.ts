// Single Markdown → HTML pipeline: split-view preview, editor tables and every export
// (PDF / Word / text) and printing. Supports GFM, ```latex blocks (KaTeX),
// ![[attachment|width]] embeds and VS Code–style highlighted code.
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { convertFileSrc } from "@tauri-apps/api/core";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import type { Parser } from "@lezer/common";
import DOMPurify from "dompurify";
import katex from "katex";
import { Marked, type Tokens } from "marked";

export const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];
export const VIDEO_EXT = ["mp4", "webm"];
export const LATEX_LANGS = ["latex", "tex", "math", "katex"];
/** `![[file.png]]` or `![[file.png|300]]` (Obsidian syntax). */
export const EMBED_RE = /!\[\[([^\]|\n]+?)(?:\|(\d{1,4}))?\]\]/g;
/**
 * Inline math `$...$` with Pandoc's rules, so prices aren't taken as formulas: no space right
 * after the opening `$` or right before the closing one, and the closing `$` is not followed
 * by a digit ("$20 y $30" stays text). `\$` is a literal dollar sign.
 */
const INLINE_MATH_SRC = String.raw`\$(?![\s$])((?:\\\$|[^$\n])*?[^\s\\])\$(?!\d)`;
export const INLINE_MATH_RE = new RegExp(String.raw`(?<![\\$])` + INLINE_MATH_SRC, "g");
const INLINE_MATH_START = new RegExp("^" + INLINE_MATH_SRC);

let attachDir = "";
export function setAttachmentsDir(dir: string) {
  attachDir = dir;
}

export function attachmentUrl(name: string) {
  return convertFileSrc(`${attachDir}\\${name}`);
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** HTML for an attachment embed (image, video, or a "missing" placeholder). */
export function embedHtml(name: string, width?: number) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const style = width ? ` style="width:${width}px;max-width:100%"` : "";
  const src = escapeHtml(attachmentUrl(name.trim()));
  if (IMAGE_EXT.includes(ext)) return `<img class="embed" src="${src}" alt="${escapeHtml(name)}"${style}>`;
  if (VIDEO_EXT.includes(ext)) return `<video class="embed" src="${src}" title="${escapeHtml(name)}" controls preload="metadata"${style}></video>`;
  return `<span class="embed-missing">📎 ${escapeHtml(name)}</span>`;
}

export function latexHtml(source: string, display = true) {
  return katex.renderToString(source, { displayMode: display, throwOnError: false, output: "htmlAndMathml" });
}

// ---------- Code highlighting ----------

const parsers = new Map<string, Parser | null>();

async function loadParser(lang: string): Promise<Parser | null> {
  const key = lang.toLowerCase();
  if (parsers.has(key)) return parsers.get(key)!;
  const desc = LanguageDescription.matchLanguageName(languages, key, true);
  const parser = desc ? (await desc.load()).language.parser : null;
  parsers.set(key, parser);
  return parser;
}

function highlighted(code: string, lang: string) {
  const parser = parsers.get(lang.toLowerCase());
  if (!parser) return escapeHtml(code);
  let html = "";
  let pos = 0;
  highlightTree(parser.parse(code), classHighlighter, (from, to, classes) => {
    if (from > pos) html += escapeHtml(code.slice(pos, from));
    html += `<span class="${classes}">${escapeHtml(code.slice(from, to))}</span>`;
    pos = to;
  });
  return html + escapeHtml(code.slice(pos));
}

// ---------- Marked setup ----------

const md = new Marked({ gfm: true, breaks: true });
md.use({
  extensions: [
    {
      name: "embed",
      level: "inline",
      start: (src: string) => src.indexOf("![["),
      tokenizer(src: string) {
        const m = /^!\[\[([^\]|\n]+?)(?:\|(\d{1,4}))?\]\]/.exec(src);
        if (m) return { type: "embed", raw: m[0], name: m[1], width: m[2] ? Number(m[2]) : undefined };
      },
      renderer: (token) => embedHtml(token.name as string, token.width as number | undefined),
    },
    {
      name: "inlineMath",
      level: "inline",
      start: (src: string) => src.search(/(?<!\\)\$/),
      tokenizer(src: string) {
        const m = INLINE_MATH_START.exec(src);
        if (m) return { type: "inlineMath", raw: m[0], text: m[1] };
      },
      renderer: (token) => `<span class="latex-inline">${latexHtml(token.text as string, false)}</span>`,
    },
  ],
  renderer: {
    code({ text, lang }: Tokens.Code) {
      const l = (lang ?? "").trim().split(/\s+/)[0].toLowerCase();
      if (LATEX_LANGS.includes(l)) return `<div class="latex-block">${latexHtml(text)}</div>`;
      const label = l ? `<span class="code-lang">${escapeHtml(l)}</span>` : "";
      return `<pre class="code-block">${label}<code>${highlighted(text, l)}</code></pre>`;
    },
  },
});

const PURIFY = {
  USE_PROFILES: { html: true, mathMl: true, svg: true },
  // `annotation` keeps each formula's TeX source (used by TXT/Word export; hidden by KaTeX's CSS).
  ADD_TAGS: ["video", "semantics", "annotation"],
  ADD_ATTR: ["controls", "preload", "target", "encoding"],
};

/** Synchronous render of a small fragment (e.g. a table) without code highlighting. */
export const renderFragment = (source: string) =>
  DOMPurify.sanitize(md.parse(source, { async: false }) as string, PURIFY) as string;

/** Renders a whole Markdown document to sanitized HTML. */
export async function renderDocument(source: string): Promise<string> {
  const langs = new Set<string>();
  for (const m of source.matchAll(/^\s*```+\s*([\w#+.-]+)/gm)) {
    const l = m[1].toLowerCase();
    if (!LATEX_LANGS.includes(l)) langs.add(l);
  }
  await Promise.all([...langs].map(loadParser));
  return DOMPurify.sanitize(md.parse(source, { async: false }) as string, PURIFY) as string;
}
