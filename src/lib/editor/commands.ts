// Formatting commands used by the toolbar and keyboard shortcuts.
import { syntaxTree } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { EditorView, KeyBinding } from "@codemirror/view";
import { t } from "$lib/i18n/i18n.svelte";

const done = (view: EditorView) => {
  view.focus();
  return true;
};

/** Wraps the selection in `marker` (or removes it when already wrapped). */
export function toggleInline(view: EditorView, marker: string): boolean {
  const { state } = view;
  const m = marker.length;
  view.dispatch(
    state.changeByRange((r) => {
      const text = state.sliceDoc(r.from, r.to);
      if (state.sliceDoc(r.from - m, r.from) === marker && state.sliceDoc(r.to, r.to + m) === marker) {
        return {
          changes: [
            { from: r.from - m, to: r.from },
            { from: r.to, to: r.to + m },
          ],
          range: EditorSelection.range(r.from - m, r.to - m),
        };
      }
      if (text.length >= 2 * m && text.startsWith(marker) && text.endsWith(marker)) {
        return {
          changes: { from: r.from, to: r.to, insert: text.slice(m, -m) },
          range: EditorSelection.range(r.from, r.to - 2 * m),
        };
      }
      return {
        changes: { from: r.from, to: r.to, insert: marker + text + marker },
        range: EditorSelection.range(r.from + m, r.to + m),
      };
    }),
    { scrollIntoView: true, userEvent: "input" },
  );
  return done(view);
}

/** Any block prefix we know how to replace: heading, quote, task, bullet or numbered item. */
const BLOCK_PREFIX = /^(#{1,6} |> |[-*+] \[[ xX]\] |[-*+] |\d+[.)] )/;

/**
 * Sets (or toggles off) a line prefix on every selected line.
 * `prefix` may be a function of the line index (for numbered lists).
 */
export function toggleLinePrefix(view: EditorView, prefix: string | ((i: number) => string), has: RegExp): boolean {
  const { state } = view;
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) lines.add(n);
  }
  const nums = [...lines].sort((a, b) => a - b);
  const allHave = nums.every((n) => has.test(state.doc.line(n).text));
  const changes = nums.map((n, i) => {
    const line = state.doc.line(n);
    const existing = line.text.match(BLOCK_PREFIX)?.[0].length ?? 0;
    const insert = allHave ? "" : typeof prefix === "function" ? prefix(i) : prefix;
    return { from: line.from, to: line.from + existing, insert };
  });
  view.dispatch({ changes, scrollIntoView: true, userEvent: "input" });
  return done(view);
}

export const heading = (view: EditorView, level: number) =>
  toggleLinePrefix(view, "#".repeat(level) + " ", new RegExp(`^#{${level}} `));
export const bulletList = (view: EditorView) => toggleLinePrefix(view, "- ", /^[-*+] (?!\[[ xX]\] )/);
export const numberedList = (view: EditorView) => toggleLinePrefix(view, (i) => `${i + 1}. `, /^\d+[.)] /);
export const taskList = (view: EditorView) => toggleLinePrefix(view, "- [ ] ", /^[-*+] \[[ xX]\] /);
export const quote = (view: EditorView) => toggleLinePrefix(view, "> ", /^> /);

/** Inserts `text` as its own block (on a new line when the current line has content). */
export function insertBlock(view: EditorView, text: string, cursorOffset = text.length): boolean {
  let { from, to } = view.state.selection.main;
  // Never insert a block inside a closed code block: put it right after the block instead.
  const block = codeBlockAt(view, from);
  if (block !== null) {
    if (block === view.state.doc.length) view.dispatch({ changes: { from: block, insert: "\n" } });
    from = to = block + 1;
  }
  const line = view.state.doc.lineAt(from);
  const before = line.text.trim() ? (from === line.to ? "\n" : "\n\n") : "";
  view.dispatch({
    changes: { from, to, insert: before + text },
    selection: { anchor: from + before.length + cursorOffset },
    scrollIntoView: true,
    userEvent: "input",
  });
  return done(view);
}

/** End of the closed code block containing `pos` (end of its closing line), or null. */
function codeBlockAt(view: EditorView, pos: number): number | null {
  const { state } = view;
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    const closed = node.name === "CodeBlock" || (node.name === "FencedCode" && node.getChildren("CodeMark").length > 1);
    if (closed && pos > node.from) return state.doc.lineAt(node.to).to;
  }
  return null;
}

export function codeBlock(view: EditorView, lang = ""): boolean {
  const { state } = view;
  const r = state.selection.main;
  const body = state.sliceDoc(r.from, r.to);
  const opening = "```" + lang + "\n";
  return insertBlock(view, `${opening}${body}\n\`\`\`\n`, opening.length + body.length);
}

export function link(view: EditorView): boolean {
  const { state } = view;
  const r = state.selection.main;
  const text = state.sliceDoc(r.from, r.to) || t("editor.link_text");
  const url = "https://";
  const insert = `[${text}](${url})`;
  // With selected text, put the cursor on the URL; otherwise select the placeholder text.
  const selection = r.empty
    ? EditorSelection.range(r.from + 1, r.from + 1 + text.length)
    : EditorSelection.cursor(r.from + text.length + 3 + url.length);
  view.dispatch({ changes: { from: r.from, to: r.to, insert }, selection, scrollIntoView: true, userEvent: "input" });
  return done(view);
}

export function table(view: EditorView): boolean {
  const c1 = t("editor.column", { n: 1 });
  const c2 = t("editor.column", { n: 2 });
  return insertBlock(view, `| ${c1} | ${c2} |\n| --- | --- |\n|  |  |\n`, `| ${c1} | ${c2} |\n| --- | --- |\n| `.length);
}

export const rule = (view: EditorView) => insertBlock(view, "---\n");

/** ```latex block with the cursor inside, ready to type a formula. */
export const latexBlock = (view: EditorView) => insertBlock(view, "```latex\n\n```\n", "```latex\n".length);

export const formatKeymap: KeyBinding[] = [
  { key: "Mod-b", run: (v) => toggleInline(v, "**") },
  { key: "Mod-i", run: (v) => toggleInline(v, "*") },
  { key: "Mod-Shift-x", run: (v) => toggleInline(v, "~~") },
  { key: "Mod-e", run: (v) => toggleInline(v, "`") },
  { key: "Mod-Shift-e", run: (v) => codeBlock(v) },
  { key: "Mod-k", run: link },
];
