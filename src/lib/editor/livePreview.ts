// Hybrid ("live preview") Markdown: the syntax marks (#, **, `, >, - [ ], ```…) are hidden
// and the text is shown formatted, except on the line/element the cursor is on, where the
// raw Markdown reappears so it can be edited. When the editor loses focus everything renders.
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type Range, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { api } from "$lib/api";
import { renderMarkdown } from "$lib/markdown";
import { EMBED_RE, IMAGE_EXT, LATEX_LANGS, VIDEO_EXT, attachmentUrl, latexHtml } from "$lib/render";
import { t } from "$lib/i18n/i18n.svelte";

// ---------- Widgets ----------

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-md-bullet";
    el.textContent = "•";
    return el;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM() {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.className = "cm-md-checkbox";
    box.setAttribute("aria-label", "tarea");
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-md-hr";
    return el;
  }
}

/** Header bar of a code block: language label + copy button. */
class FenceWidget extends WidgetType {
  constructor(
    readonly lang: string,
    readonly code: string,
  ) {
    super();
  }
  eq(other: FenceWidget) {
    return other.lang === this.lang && other.code === this.code;
  }
  toDOM() {
    const bar = document.createElement("span");
    bar.className = "cm-md-fence";
    const label = document.createElement("span");
    label.className = "cm-md-fence-lang";
    label.textContent = this.lang || t("editor.plain_text");
    const copy = document.createElement("button");
    copy.className = "cm-md-fence-copy";
    copy.type = "button";
    copy.textContent = t("editor.copy");
    // mousedown (not click): the editor would otherwise move the cursor first and re-render.
    copy.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void navigator.clipboard.writeText(this.code).then(() => {
        copy.textContent = t("editor.copied");
        setTimeout(() => (copy.textContent = t("editor.copy")), 1200);
      });
    });
    bar.append(label, copy);
    return bar;
  }
  ignoreEvent(e: Event) {
    return (e.target as HTMLElement).classList.contains("cm-md-fence-copy");
  }
}

class LatexWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  eq(other: LatexWidget) {
    return other.source === this.source;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-md-latex";
    el.innerHTML = latexHtml(this.source);
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

/** `![[file|width]]` rendered as an image or video from the attachments folder. */
class EmbedWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly width: number | undefined,
  ) {
    super();
  }
  eq(other: EmbedWidget) {
    return other.name === this.name && other.width === this.width;
  }
  toDOM() {
    const ext = this.name.split(".").pop()?.toLowerCase() ?? "";
    const wrap = document.createElement("span");
    wrap.className = "cm-md-embed";
    const missing = () => {
      wrap.textContent = `📎 ${t("editor.missing_file", { name: this.name })}`;
      wrap.classList.add("missing");
    };
    let el: HTMLImageElement | HTMLVideoElement;
    if (IMAGE_EXT.includes(ext)) {
      el = document.createElement("img");
      el.alt = this.name;
    } else if (VIDEO_EXT.includes(ext)) {
      el = document.createElement("video");
      el.controls = true;
      el.preload = "metadata";
    } else {
      missing();
      return wrap;
    }
    el.src = attachmentUrl(this.name);
    el.onerror = missing;
    if (this.width) el.style.width = `${this.width}px`;
    wrap.append(el);
    return wrap;
  }
  // Let the video controls work; clicking an image places the cursor to edit it.
  ignoreEvent(e: Event) {
    return (e.target as HTMLElement).tagName === "VIDEO";
  }
}

class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  eq(other: TableWidget) {
    return other.source === this.source;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-md-table";
    el.innerHTML = renderMarkdown(this.source);
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

// ---------- Inline / line decorations (view plugin) ----------

const INLINE_CLASS: Record<string, string> = {
  Emphasis: "cm-md-em",
  StrongEmphasis: "cm-md-strong",
  Strikethrough: "cm-md-strike",
  InlineCode: "cm-md-code",
};
const INLINE_MARKS = new Set(["EmphasisMark", "CodeMark", "StrikethroughMark"]);

function children(node: SyntaxNode, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let ch = node.firstChild; ch; ch = ch.nextSibling) if (ch.name === name) out.push(ch);
  return out;
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const decos: Range<Decoration>[] = [];
  const focused = view.hasFocus;
  const ranges = state.selection.ranges;

  /** True when the cursor/selection touches [from, to]. Nothing is "active" without focus. */
  const touches = (from: number, to: number) => focused && ranges.some((r) => r.from <= to && r.to >= from);
  const lineActive = (from: number, to = from) => touches(doc.lineAt(from).from, doc.lineAt(to).to);
  const hide = (from: number, to: number) => {
    if (to > from) decos.push(Decoration.replace({}).range(from, to));
  };
  const mark = (from: number, to: number, cls: string) => {
    if (to > from) decos.push(Decoration.mark({ class: cls }).range(from, to));
  };
  const linkMark = (from: number, to: number) => {
    if (to > from) decos.push(Decoration.mark({ class: "cm-md-link", attributes: { title: t("editor.link_hint") } }).range(from, to));
  };
  /** Ranges where `![[…]]` must not be rendered (code). */
  const codeRanges: [number, number][] = [];
  const lineClass = (pos: number, cls: string) => decos.push(Decoration.line({ class: cls }).range(doc.lineAt(pos).from));
  const nextIsSpace = (pos: number) => state.sliceDoc(pos, pos + 1) === " ";

  const { from, to } = view.viewport;
  syntaxTree(state).iterate({
    from,
    to,
    enter: (ref) => {
      const name = ref.name;
      const node = ref.node;

      if (name.startsWith("ATXHeading")) {
        lineClass(ref.from, `cm-md-h cm-md-h${name.slice(10)}`);
        if (!lineActive(ref.from)) {
          for (const m of children(node, "HeaderMark")) {
            if (m.from === ref.from) hide(m.from, nextIsSpace(m.to) ? m.to + 1 : m.to);
            else hide(state.sliceDoc(m.from - 1, m.from) === " " ? m.from - 1 : m.from, m.to);
          }
        }
        return;
      }
      if (name === "SetextHeading1" || name === "SetextHeading2") {
        lineClass(ref.from, `cm-md-h cm-md-h${name.endsWith("1") ? 1 : 2}`);
        return;
      }

      if (name in INLINE_CLASS) {
        mark(ref.from, ref.to, INLINE_CLASS[name]);
        if (!touches(ref.from, ref.to)) {
          for (let ch = node.firstChild; ch; ch = ch.nextSibling) if (INLINE_MARKS.has(ch.name)) hide(ch.from, ch.to);
        }
        return;
      }

      if (name === "Link") {
        const marks = children(node, "LinkMark");
        if (marks.length >= 2) {
          linkMark(marks[0].to, marks[1].from);
          if (!touches(ref.from, ref.to)) {
            hide(ref.from, marks[0].to);
            hide(marks[1].from, ref.to);
          }
        }
        return false;
      }
      if (name === "URL" || name === "Autolink") {
        linkMark(ref.from, ref.to);
        return false;
      }

      if (name === "QuoteMark") {
        lineClass(ref.from, "cm-md-quote");
        if (!lineActive(ref.from)) hide(ref.from, nextIsSpace(ref.to) ? ref.to + 1 : ref.to);
        return;
      }

      if (name === "ListMark") {
        const item = node.parent;
        const task = item?.getChild("Task");
        const active = lineActive(ref.from);
        if (task) {
          if (!active) hide(ref.from, task.from);
        } else if (item?.parent?.name === "BulletList") {
          if (!active) decos.push(Decoration.replace({ widget: new BulletWidget() }).range(ref.from, ref.to));
          else mark(ref.from, ref.to, "cm-md-listmark");
        } else {
          mark(ref.from, ref.to, "cm-md-listmark");
        }
        return;
      }

      if (name === "TaskMarker") {
        const checked = /x/i.test(state.sliceDoc(ref.from, ref.to));
        if (!lineActive(ref.from)) {
          decos.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(ref.from, ref.to));
        }
        if (checked && node.parent) mark(ref.to, node.parent.to, "cm-md-task-done");
        return;
      }

      if (name === "HorizontalRule") {
        if (!lineActive(ref.from)) decos.push(Decoration.replace({ widget: new RuleWidget() }).range(ref.from, ref.to));
        return;
      }

      if (name === "InlineCode") codeRanges.push([ref.from, ref.to]);
      if (name === "FencedCode") {
        codeRanges.push([ref.from, ref.to]);
        const first = doc.lineAt(ref.from);
        const last = doc.lineAt(ref.to);
        const fences = children(node, "CodeMark");
        const closed = fences.length > 1 && last.number > first.number;
        const info = node.getChild("CodeInfo");
        const lang = info ? state.sliceDoc(info.from, info.to) : "";
        const body = node.getChild("CodeText");
        for (let n = first.number; n <= last.number; n++) {
          let cls = "cm-md-codeblock";
          if (n === first.number) cls += " cm-md-codeblock-begin";
          if (n === last.number && closed) cls += " cm-md-codeblock-end";
          else if (n !== first.number) cls += " cm-md-codeline";
          decos.push(Decoration.line({ class: cls }).range(doc.line(n).from));
        }
        if (!touches(first.from, last.to)) {
          const code = body ? state.sliceDoc(body.from, body.to) : "";
          decos.push(Decoration.replace({ widget: new FenceWidget(lang, code) }).range(first.from, first.to));
          if (closed) hide(last.from, last.to);
        }
        return false;
      }

      if (name === "CodeBlock") {
        codeRanges.push([ref.from, ref.to]);
        for (let n = doc.lineAt(ref.from).number; n <= doc.lineAt(ref.to).number; n++) {
          decos.push(Decoration.line({ class: "cm-md-codeblock cm-md-indented" }).range(doc.line(n).from));
        }
        return false;
      }
    },
  });

  // Attachment embeds (not part of the Markdown grammar): scan the visible text.
  const text = state.sliceDoc(from, to);
  for (const m of text.matchAll(EMBED_RE)) {
    const start = from + m.index!;
    const end = start + m[0].length;
    if (codeRanges.some(([a, b]) => start >= a && start < b) || lineActive(start, end)) continue;
    decos.push(
      Decoration.replace({ widget: new EmbedWidget(m[1].trim(), m[2] ? Number(m[2]) : undefined) }).range(start, end),
    );
  }
  return Decoration.set(decos, true);
}

const livePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        u.focusChanged ||
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ---------- Tables (multi-line → must come from a state field) ----------

const setFocus = StateEffect.define<boolean>();

function buildTables(state: EditorState, focused: boolean): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const tree = ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state);
  tree.iterate({
    enter: (ref) => {
      if (ref.name !== "Table" && ref.name !== "FencedCode") return;
      const from = state.doc.lineAt(ref.from).from;
      const to = state.doc.lineAt(ref.to).to;
      const active = focused && state.selection.ranges.some((r) => r.from <= to && r.to >= from);
      if (ref.name === "Table") {
        if (!active) {
          decos.push(Decoration.replace({ widget: new TableWidget(state.sliceDoc(from, to)), block: true }).range(from, to));
        }
        return false;
      }
      // ```latex blocks render as a formula when the cursor is outside (and the block is closed).
      const info = ref.node.getChild("CodeInfo");
      const lang = info ? state.sliceDoc(info.from, info.to).trim().toLowerCase() : "";
      const closed = ref.node.getChildren("CodeMark").length > 1;
      if (LATEX_LANGS.includes(lang) && closed && !active) {
        const body = ref.node.getChild("CodeText");
        const source = body ? state.sliceDoc(body.from, body.to) : "";
        decos.push(Decoration.replace({ widget: new LatexWidget(source), block: true }).range(from, to));
      }
      return false;
    },
  });
  return Decoration.set(decos, true);
}

const tableField = StateField.define<{ focused: boolean; decos: DecorationSet }>({
  create: (state) => ({ focused: false, decos: buildTables(state, false) }),
  update(value, tr) {
    let focused = value.focused;
    for (const e of tr.effects) if (e.is(setFocus)) focused = e.value;
    if (tr.docChanged || tr.selection || focused !== value.focused || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
      return { focused, decos: buildTables(tr.state, focused) };
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
});

// ---------- Interaction ----------

/** Clicking a rendered checkbox toggles `[ ]` ⇄ `[x]` in the text. */
const checkboxClicks = EditorView.domEventHandlers({
  mousedown(e, view) {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("cm-md-checkbox")) return false;
    e.preventDefault();
    if (view.state.readOnly) return true;
    const pos = view.posAtDOM(target);
    const text = view.state.sliceDoc(pos, pos + 3);
    if (/^\[[ xX]\]$/.test(text)) {
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: text[1] === " " ? "x" : " " } });
    }
    return true;
  },
});

/** URL of the link at `pos` (Markdown link, autolink or bare URL), if any. */
function linkAt(view: EditorView, pos: number): string | null {
  const { state } = view;
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === "URL" || node.name === "Autolink") return state.sliceDoc(node.from, node.to).replace(/^<|>$/g, "");
    if (node.name === "Link") {
      const url = node.getChild("URL");
      return url ? state.sliceDoc(url.from, url.to) : null;
    }
  }
  return null;
}

/** Links open with Ctrl + click while editing, and with a plain click in reading mode (locked). */
const linkClicks = EditorView.domEventHandlers({
  mousedown(e, view) {
    const reading = !view.state.facet(EditorView.editable);
    if (!(e.ctrlKey || e.metaKey || reading) || e.button !== 0) return false;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    const url = pos == null ? null : linkAt(view, pos);
    if (!url || !/^https?:\/\//i.test(url)) return false;
    e.preventDefault();
    void api.openExternal(url);
    return true;
  },
});

export const livePreview: Extension = [
  livePlugin,
  tableField,
  EditorView.focusChangeEffect.of((_state, focusing) => setFocus.of(focusing)),
  checkboxClicks,
  linkClicks,
];
