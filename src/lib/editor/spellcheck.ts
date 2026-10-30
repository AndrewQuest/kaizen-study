// Spell checking for the Markdown editor, backed by the Hunspell dictionaries in Rust.
// Misspelled words get a red wavy underline; right-click shows suggestions,
// "Add to dictionary" and "Ignore". Code, URLs and the word being typed are skipped.
import { syntaxTree } from "@codemirror/language";
import { type Extension, type Range, StateEffect } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { api } from "$lib/api";
import { app } from "$lib/app.svelte";
import { INLINE_MATH_RE } from "$lib/render";
import { t } from "$lib/i18n/i18n.svelte";

const SKIP_NODES = new Set([
  "InlineCode", "FencedCode", "CodeBlock", "URL", "Autolink", "HTMLBlock", "HTMLTag", "Comment", "LinkLabel",
]);
const WORD = /\p{L}[\p{L}\p{M}'’]*/gu;

/** "langs|word" → correct? Shared by every editor. */
const cache = new Map<string, boolean>();
const ignored = new Set<string>();
const recheck = StateEffect.define<null>();
const misspelledMark = Decoration.mark({ class: "cm-misspelled" });

const langs = () => app.settings.spell_langs.split(",").filter(Boolean);
const enabled = () => app.settings.spell_enabled && langs().length > 0;
const key = (word: string) => `${app.settings.spell_langs}|${word}`;

interface Word {
  from: number;
  to: number;
  text: string;
}

/** Words in the visible part of the document, excluding code, URLs and HTML. */
function visibleWords(view: EditorView): Word[] {
  const { state } = view;
  const out: Word[] = [];
  for (const { from, to } of view.visibleRanges) {
    const skip: [number, number][] = [];
    syntaxTree(state).iterate({
      from,
      to,
      enter: (n) => {
        if (SKIP_NODES.has(n.name)) {
          skip.push([n.from, n.to]);
          return false;
        }
      },
    });
    const text = state.sliceDoc(from, to);
    for (const m of text.matchAll(INLINE_MATH_RE)) skip.push([from + m.index!, from + m.index! + m[0].length]);
    for (const m of text.matchAll(WORD)) {
      const start = from + m.index!;
      const word = m[0].replace(/['’]+$/, "");
      if (word.length < 2 || skip.some(([a, b]) => start >= a && start < b)) continue;
      out.push({ from: start, to: start + word.length, text: word });
    }
  }
  return out;
}

const spellPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    private timer: ReturnType<typeof setTimeout> | undefined;

    constructor(readonly view: EditorView) {
      this.refresh();
    }

    update(u: ViewUpdate) {
      const lockChanged = u.startState.facet(EditorView.editable) !== u.state.facet(EditorView.editable);
      if (lockChanged || u.docChanged || u.viewportChanged || u.selectionSet || u.transactions.some((tr) => tr.effects.some((e) => e.is(recheck)))) {
        this.refresh();
      }
    }

    refresh() {
      // Reading mode (locked note): no underlines, nothing to correct.
      if (!enabled() || !this.view.state.facet(EditorView.editable)) {
        this.decorations = Decoration.none;
        return;
      }
      const words = visibleWords(this.view);
      const head = this.view.hasFocus ? this.view.state.selection.main.head : -1;
      const marks: Range<Decoration>[] = [];
      const unknown = new Set<string>();
      for (const w of words) {
        const ok = cache.get(key(w.text));
        if (ok === undefined) unknown.add(w.text);
        // Don't flag the word being typed right now.
        else if (!ok && !ignored.has(w.text.toLowerCase()) && !(head >= w.from && head <= w.to)) {
          marks.push(misspelledMark.range(w.from, w.to));
        }
      }
      this.decorations = Decoration.set(marks);
      if (unknown.size) this.fetch([...unknown]);
    }

    fetch(words: string[]) {
      clearTimeout(this.timer);
      this.timer = setTimeout(async () => {
        try {
          const result = await api.spellCheck(words, langs());
          words.forEach((w, i) => cache.set(key(w), result[i]));
          this.view.dispatch({ effects: recheck.of(null) });
        } catch {
          // Checking is best-effort; never interrupt writing.
        }
      }, 250);
    }

    destroy() {
      clearTimeout(this.timer);
    }
  },
  { decorations: (v) => v.decorations },
);

// ---------- Context menu ----------

let openMenu: HTMLElement | null = null;

function closeMenu() {
  openMenu?.remove();
  openMenu = null;
  removeEventListener("mousedown", onOutside, true);
  removeEventListener("keydown", onEscape, true);
}
const onOutside = (e: MouseEvent) => {
  if (openMenu && !openMenu.contains(e.target as Node)) closeMenu();
};
const onEscape = (e: KeyboardEvent) => {
  if (e.key === "Escape") closeMenu();
};

function menuItem(label: string, run: () => void, cls = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `spell-item ${cls}`;
  b.textContent = label;
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", () => {
    closeMenu();
    run();
  });
  return b;
}

async function showMenu(view: EditorView, word: Word, x: number, y: number) {
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "spell-menu";
  menu.setAttribute("role", "menu");
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const title = document.createElement("div");
  title.className = "spell-title";
  title.textContent = t("spell.suggestions");
  menu.append(title);
  const list = document.createElement("div");
  list.textContent = "…";
  menu.append(list);
  menu.append(document.createElement("hr"));
  menu.append(
    menuItem(t("spell.add"), async () => {
      await api.dictionaryAdd(word.text);
      for (const k of [...cache.keys()]) if (k.endsWith(`|${word.text}`)) cache.delete(k);
      view.dispatch({ effects: recheck.of(null) });
    }),
    menuItem(t("spell.ignore"), () => {
      ignored.add(word.text.toLowerCase());
      view.dispatch({ effects: recheck.of(null) });
    }),
  );
  document.body.append(menu);
  openMenu = menu;
  addEventListener("mousedown", onOutside, true);
  addEventListener("keydown", onEscape, true);

  // Keep the menu inside the window.
  const r = menu.getBoundingClientRect();
  if (r.right > innerWidth) menu.style.left = `${Math.max(4, innerWidth - r.width - 4)}px`;
  if (r.bottom > innerHeight) menu.style.top = `${Math.max(4, innerHeight - r.height - 4)}px`;

  const suggestions = await api.spellSuggest(word.text, langs()).catch(() => []);
  if (openMenu !== menu) return;
  list.textContent = "";
  if (!suggestions.length) {
    const none = document.createElement("div");
    none.className = "spell-none";
    none.textContent = t("spell.no_suggestions");
    list.append(none);
  }
  for (const s of suggestions) {
    list.append(
      menuItem(
        s,
        () => {
          // The text may have changed while the menu was open: replace only if it still matches.
          if (view.state.sliceDoc(word.from, word.to) === word.text) {
            view.dispatch({ changes: { from: word.from, to: word.to, insert: s }, userEvent: "input.spell" });
          }
          view.focus();
        },
        "suggestion",
      ),
    );
  }
}

const contextMenu = EditorView.domEventHandlers({
  contextmenu(e, view) {
    if (!enabled() || !view.state.facet(EditorView.editable)) return false;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos == null) return false;
    const word = visibleWords(view).find((w) => pos >= w.from && pos <= w.to);
    if (!word || cache.get(key(word.text)) !== false || ignored.has(word.text.toLowerCase())) return false;
    e.preventDefault();
    void showMenu(view, word, e.clientX, e.clientY);
    return true;
  },
});

export const spellcheck: Extension = [
  spellPlugin,
  contextMenu,
  // Our checker replaces the browser's one (which can't choose languages).
  EditorView.contentAttributes.of({ spellcheck: "false" }),
];
