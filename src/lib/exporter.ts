// Export / print of notes (one note, a whole topic or a whole subject).
// Every format starts from the same Markdown → HTML pipeline ($lib/render):
// PDF and printing render the HTML in the `/export` window; Word walks the HTML DOM and
// builds a .docx (formulas as images via MathJax); TXT uses the rendered text.
import { api, type Note } from "./api";
import { t } from "./i18n/i18n.svelte";
import { isoDate } from "./format";
import { renderDocument } from "./render";

export type Scope = "note" | "topic" | "subject";
export type Format = "pdf" | "docx" | "txt" | "md" | "print";
export type Paper = "letter" | "a4" | "legal" | "a5";
export type Margins = "narrow" | "normal" | "wide";
export type FontSize = "small" | "medium" | "large";

export interface ExportOptions {
  paper: Paper;
  landscape: boolean;
  margins: Margins;
  font: FontSize;
  saveInk: boolean;
}

/** Inches (portrait). */
export const PAPERS: Record<Paper, [number, number]> = {
  letter: [8.5, 11],
  a4: [8.27, 11.69],
  legal: [8.5, 14],
  a5: [5.83, 8.27],
};
export const MARGINS: Record<Margins, number> = { narrow: 0.5, normal: 1, wide: 1.4 };
/** Points. */
export const FONT_PT: Record<FontSize, number> = { small: 10, medium: 11.5, large: 13 };

export interface Section {
  /** 1 = document title, 2 = topic (in a subject export), 3 = note. */
  level: number;
  title: string;
  md: string;
}

export interface ExportDoc {
  title: string;
  sections: Section[];
}

/** Markdown of a note, whatever its layout. */
function noteMarkdown(n: Note): string {
  if (n.layout === "latex") {
    return n.body_md
      .split(/\n\s*\n/)
      .filter((b) => b.trim())
      .map((b) => "```latex\n" + b.trim() + "\n```")
      .join("\n\n");
  }
  if (n.layout === "latexdoc") return "```text\n" + n.body_md + "\n```";
  return n.body_md;
}

async function quickNotes(topicId: string, level: number): Promise<Section[]> {
  // Quick notes already moved into a note are exported with that note.
  const sessions = (await api.listQuickNotes(topicId)).filter((s) => !s.notes_moved);
  if (!sessions.length) return [];
  const md = sessions
    .map((s) => `**${new Date(s.started_at).toLocaleString()}**\n\n${s.notes_md.trim()}`)
    .join("\n\n---\n\n");
  return [{ level, title: t("export.quick_notes_heading"), md }];
}

async function topicSections(topicId: string, level: number, withQuick: boolean): Promise<Section[]> {
  const notes = await api.listNotes(topicId);
  const out = notes.map((n) => ({ level, title: n.title || t("notes.untitled"), md: noteMarkdown(n) }));
  if (withQuick) out.push(...(await quickNotes(topicId, level)));
  return out;
}

/** Collects what to export. `id` is the note, topic or subject id depending on `scope`. */
export async function collect(scope: Scope, id: string, withQuick: boolean, note?: Note): Promise<ExportDoc> {
  if (scope === "note") {
    const n = note!;
    return { title: n.title || t("notes.untitled"), sections: [{ level: 1, title: n.title || t("notes.untitled"), md: noteMarkdown(n) }] };
  }
  if (scope === "topic") {
    const topic = await api.getTopic(id);
    return { title: topic.name, sections: [{ level: 1, title: topic.name, md: "" }, ...(await topicSections(id, 2, withQuick))] };
  }
  const subject = (await api.listSubjects(true)).find((s) => s.id === id);
  const sections: Section[] = [{ level: 1, title: subject?.name ?? "", md: "" }];
  for (const topic of await api.listTopics(id)) {
    const inner = await topicSections(topic.id, 3, withQuick);
    if (inner.length) sections.push({ level: 2, title: topic.name, md: "" }, ...inner);
  }
  return { title: subject?.name ?? "", sections };
}

export const isEmpty = (doc: ExportDoc) => !doc.sections.some((s) => s.md.trim());

/** "Title - YYYY-MM-DD.ext" without characters Windows doesn't allow. */
export const fileName = (title: string, ext: string) =>
  `${title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Kaizen"} - ${isoDate()}.${ext}`;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// ---------- Markdown ----------

export function toMarkdown(doc: ExportDoc): string {
  return doc.sections.map((s) => `${"#".repeat(s.level)} ${s.title}\n\n${s.md.trim()}`.trim()).join("\n\n") + "\n";
}

// ---------- HTML (PDF, print, preview, Word and TXT all start here) ----------

/** Body HTML: headings for titles + each section rendered. Videos become a text line. */
export async function bodyHtml(doc: ExportDoc): Promise<string> {
  const parts: string[] = [];
  for (const s of doc.sections) {
    parts.push(`<h${s.level} class="x-title">${escapeHtml(s.title)}</h${s.level}>`);
    if (s.md.trim()) parts.push(`<div class="x-note">${await renderDocument(s.md)}</div>`);
  }
  const html = parts.join("\n");
  // Videos can't go on paper: a line with the file name instead (`title` is set by embedHtml).
  return html.replace(
    /<video[^>]*?title="([^"]*)"[^>]*><\/video>/g,
    (_m, name) => `<p class="x-video">🎬 ${t("export.video", { name })}</p>`,
  );
}

export type Target = "pdf" | "print" | "preview";

/** Style of the exported page (font size, ink saving; page size only for printing). */
export function pageCss(o: ExportOptions, target: Target) {
  const [w, h] = PAPERS[o.paper];
  const size = o.landscape ? `${h}in ${w}in` : `${w}in ${h}in`;
  return `
${target !== "preview" ? `@page { size: ${size}; margin: ${MARGINS[o.margins]}in; }` : ""}
${target !== "preview" ? "html, body { background: #fff !important; color: #111; margin: 0; }" : ""}
.x-doc { font-size: ${FONT_PT[o.font]}pt; }
.x-doc .x-title { break-after: avoid; }
.x-doc h1.x-title { font-size: 1.9em; border-bottom: 2px solid #ccc; padding-bottom: 0.2em; }
.x-doc h2.x-title { font-size: 1.5em; margin-top: 1.2em; }
.x-doc h3.x-title { font-size: 1.25em; margin-top: 1em; }
.x-doc .x-note + .x-title { margin-top: 1.4em; }
.x-doc pre, .x-doc img, .x-doc table, .x-doc .latex-block { break-inside: avoid; }
.x-doc .code-block { white-space: pre-wrap; overflow: visible; padding-top: 12px; font-size: 0.85em; }
.x-doc .code-lang { display: none; }
.x-doc .x-video { color: #555; font-style: italic; }
.x-doc li:has(> input[type="checkbox"]) { list-style: none; margin-left: -1.2em; }
${
  o.saveInk
    ? `.x-doc { --code-bg: #fff; --subtle: #fff; --subtle-2: #fff; --inline-code-bg: #fff; --accent: #111; }
.x-doc pre, .x-doc .code-block, .x-doc code { background: #fff !important; border: 1px solid #bbb; }
.x-doc pre code { border: 0; }
.x-doc th { background: #fff !important; }
.x-doc a { color: #111 !important; }`
    : ""
}`;
}

export async function documentHtml(doc: ExportDoc, o: ExportOptions, target: Target) {
  return `<style>${pageCss(o, target)}</style><article class="md x-doc">${await bodyHtml(doc)}</article>`;
}

// ---------- TXT ----------

const texOf = (el: Element) => el.querySelector("annotation")?.textContent ?? el.textContent ?? "";

export async function toText(doc: ExportDoc): Promise<string> {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;white-space:normal";
  host.innerHTML = await bodyHtml(doc);
  host.querySelectorAll(".latex-block").forEach((el) => el.replaceWith(`\n${texOf(el).trim()}\n`));
  host.querySelectorAll(".latex-inline").forEach((el) => el.replaceWith(`$${texOf(el).trim()}$`));
  host.querySelectorAll("img").forEach((el) => el.replaceWith(`[${el.getAttribute("alt") ?? ""}]`));
  host.querySelectorAll("input[type=checkbox]").forEach((el) => el.replaceWith(el.hasAttribute("checked") ? "[x] " : "[ ] "));
  host.querySelectorAll("li").forEach((li) => {
    if (!li.querySelector(":scope > input, :scope > p > input") && !/^\[[ x]\] /.test(li.textContent ?? "")) {
      li.prepend(li.parentElement?.tagName === "OL" ? `${[...li.parentElement.children].indexOf(li) + 1}. ` : "• ");
    }
  });
  host.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href")!;
    if (href !== a.textContent) a.append(` (${href})`);
  });
  host.querySelectorAll(".code-lang").forEach((el) => el.remove());
  const underline = (h: Element, c: string) =>
    h.append(document.createElement("br"), c.repeat(Math.min(60, h.textContent!.length)));
  host.querySelectorAll("h1.x-title").forEach((h) => underline(h, "="));
  host.querySelectorAll("h2.x-title, h3.x-title").forEach((h) => underline(h, "-"));
  document.body.append(host);
  const text = host.innerText;
  host.remove();
  return text.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// ---------- Saving ----------

export const encode = (s: string) => new TextEncoder().encode(s.replace(/\r?\n/g, "\r\n"));

export function pageSetup(o: ExportOptions) {
  const [width, height] = PAPERS[o.paper];
  return { width, height, landscape: o.landscape, margin: MARGINS[o.margins] };
}
