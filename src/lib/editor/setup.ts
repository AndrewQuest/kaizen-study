import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { StreamLanguage } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { formatKeymap } from "./commands";
import { livePreview } from "./livePreview";
import { mediaPaste } from "./media";
import { spellcheck } from "./spellcheck";
import { editorTheme, highlight } from "./theme";

/** Live preview on (hybrid view) or off (split view: plain Markdown + separate preview). */
const previewMode = new Compartment();

export function setHybrid(view: EditorView, hybrid: boolean) {
  view.dispatch({ effects: previewMode.reconfigure(hybrid ? livePreview : []) });
}

/**
 * Reading mode ("locked"): the note can't be edited, so it never gets focus and everything stays
 * rendered; links open with a plain click and task checkboxes still toggle. Double click unlocks.
 */
const lockMode = new Compartment();

export function setLocked(view: EditorView, locked: boolean) {
  view.dispatch({ effects: lockMode.reconfigure(locked ? EditorView.editable.of(false) : []) });
}

/** Markdown + styling, shared by the editor and the read-only viewer. */
export const markdownExtensions = (hybrid = true): Extension[] => [
  // Code-block languages are loaded lazily the first time they appear.
  // pasteURLAsLink off: our paste handler (media.ts) builds the links, escaping parentheses.
  markdown({ base: markdownLanguage, codeLanguages: languages, pasteURLAsLink: false }),
  highlight,
  previewMode.of(hybrid ? livePreview : []),
  editorTheme,
  EditorView.lineWrapping,
];

export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  placeholder?: string;
  readOnly?: boolean;
  hybrid?: boolean;
  /** Starts in reading mode (see `setLocked`). */
  locked?: boolean;
  onChange?: (doc: string) => void;
  /** Double click on a locked note: asks to unlock, with the document position clicked. */
  onUnlock?: (pos: number) => void;
}

const editing = (placeholder: string, onChange?: (doc: string) => void): Extension[] => [
  history(),
  keymap.of([...formatKeymap, indentWithTab, ...defaultKeymap, ...historyKeymap]),
  placeholderExt(placeholder),
  EditorView.contentAttributes.of({ lang: "es" }),
  EditorView.updateListener.of((u) => {
    if (u.docChanged) onChange?.(u.state.doc.toString());
  }),
];

export function createEditor({
  parent, doc, placeholder = "", readOnly = false, hybrid = true, locked = false, onChange, onUnlock,
}: EditorOptions): EditorView {
  const extensions: Extension[] = [markdownExtensions(hybrid)];
  if (readOnly) {
    extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
  } else {
    extensions.push(
      editing(placeholder, onChange),
      spellcheck,
      mediaPaste,
      lockMode.of(locked ? EditorView.editable.of(false) : []),
      EditorView.domEventHandlers({
        dblclick(e, view) {
          if (view.state.facet(EditorView.editable)) return false;
          e.preventDefault();
          onUnlock?.(view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.doc.length);
          return true;
        },
      }),
    );
  }
  return new EditorView({ parent, state: EditorState.create({ doc, extensions }) });
}

/** Plain editor with LaTeX syntax highlighting (for LaTeX notes). */
export function createLatexEditor({ parent, doc, placeholder = "", onChange }: EditorOptions): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        StreamLanguage.define(stex),
        highlight,
        editorTheme,
        EditorView.lineWrapping,
        editing(placeholder, onChange),
        EditorView.theme({ ".cm-content": { fontFamily: "var(--mono)", fontSize: "14px" } }),
      ],
    }),
  });
}
