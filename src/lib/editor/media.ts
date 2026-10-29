// Pasting into the editor: images/videos are copied to the attachments folder and embedded
// as ![[name]]; a pasted web address becomes a Markdown link ready for its title.
import { syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { EditorView } from "@codemirror/view";
import { api } from "$lib/api";
import { app } from "$lib/app.svelte";
import { IMAGE_EXT, VIDEO_EXT } from "$lib/render";

const MEDIA_EXT = [...IMAGE_EXT, ...VIDEO_EXT];
const URL_RE = /^https?:\/\/[^\s<>"]+$/i;

/** Inserts one `![[name]]` per file at `pos` (default: cursor), each on its own line. */
export function insertEmbeds(view: EditorView, names: string[], pos = view.state.selection.main.head) {
  if (!names.length) return;
  const line = view.state.doc.lineAt(pos);
  const before = line.text.trim() && pos !== line.from ? "\n" : "";
  const text = before + names.map((n) => `![[${n}]]`).join("\n") + "\n";
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
    scrollIntoView: true,
    userEvent: "input.paste",
  });
  view.focus();
}

function extensionOf(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (MEDIA_EXT.includes(fromName)) return fromName;
  // Screenshots from the clipboard come without a useful name.
  const fromType = file.type.split("/")[1]?.replace("jpeg", "jpg").replace("svg+xml", "svg") ?? "";
  return MEDIA_EXT.includes(fromType) ? fromType : "";
}

async function pasteFiles(view: EditorView, files: File[]) {
  const pos = view.state.selection.main.head;
  const names: string[] = [];
  for (const file of files) {
    const ext = extensionOf(file);
    const name = file.name && file.name.includes(".") ? file.name : `captura-${Date.now()}.${ext}`;
    try {
      names.push(await api.saveAttachment(name, new Uint8Array(await file.arrayBuffer())));
    } catch (e) {
      app.fail(e);
    }
  }
  insertEmbeds(view, names, Math.min(pos, view.state.doc.length));
}

/**
 * Pasted web address → Markdown link. With selected text, that text becomes the link
 * (`[text](url)`); otherwise `[](url)` is inserted with the cursor ready for the title.
 */
function pasteUrl(view: EditorView, url: string) {
  const { from, to } = view.state.selection.main;
  // Parentheses would end the Markdown link early (e.g. Wikipedia addresses).
  const safeUrl = url.replace(/\(/g, "%28").replace(/\)/g, "%29");
  const label = view.state.sliceDoc(from, to).replace(/[[\]]/g, "");
  const link = `[${label}](${safeUrl})`;
  view.dispatch({
    changes: { from, to, insert: link },
    // No label yet: cursor between the brackets. With a label: cursor after the link.
    selection: { anchor: label ? from + link.length : from + 1 },
    scrollIntoView: true,
    userEvent: "input.paste",
  });
}

function isInCode(view: EditorView, pos: number) {
  for (let n: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, -1); n; n = n.parent) {
    if (n.name === "FencedCode" || n.name === "CodeBlock" || n.name === "InlineCode") return true;
  }
  return false;
}

export const mediaPaste: Extension = EditorView.domEventHandlers({
  paste(e, view) {
    if (view.state.readOnly) return false;
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => extensionOf(f));
    if (files.length) {
      e.preventDefault();
      void pasteFiles(view, files);
      return true;
    }
    const text = e.clipboardData?.getData("text/plain")?.trim() ?? "";
    const sel = view.state.selection.main;
    // Inside code, or over a multi-line selection, paste addresses untouched.
    const multiline = view.state.sliceDoc(sel.from, sel.to).includes("\n");
    if (URL_RE.test(text) && view.state.selection.ranges.length === 1 && !multiline && !isInCode(view, sel.head)) {
      e.preventDefault();
      pasteUrl(view, text);
      return true;
    }
    return false;
  },
});
