// Editor look. Colors come from CSS variables (src/app.css) so light/dark follow the app theme.
// Code-block token colors mirror VS Code's "Light+" / "Dark+" themes.
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const editorTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "15px", color: "var(--text)", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font)", lineHeight: "1.7", overflow: "auto" },
  ".cm-content": { padding: "12px 0 30vh", caretColor: "var(--accent)", maxWidth: "860px", margin: "0 auto" },
  ".cm-line": { padding: "0 18px" },
  ".cm-placeholder": { color: "var(--text-3)", fontStyle: "italic" },
  "&.cm-editor .cm-selectionBackground": { background: "var(--accent-soft)" },

  // Headings
  ".cm-md-h": { fontFamily: "var(--font-display)", fontWeight: "600", lineHeight: "1.35" },
  ".cm-md-h1": { fontSize: "1.85em", paddingTop: "0.45em", paddingBottom: "0.1em" },
  ".cm-md-h2": { fontSize: "1.45em", paddingTop: "0.4em" },
  ".cm-md-h3": { fontSize: "1.22em", paddingTop: "0.3em" },
  ".cm-md-h4": { fontSize: "1.08em", paddingTop: "0.2em" },
  ".cm-md-h5, .cm-md-h6": { fontSize: "1em", color: "var(--text-2)" },

  // Inline
  ".cm-md-strong": { fontWeight: "700" },
  ".cm-md-em": { fontStyle: "italic" },
  ".cm-md-strike": { textDecoration: "line-through", color: "var(--text-3)" },
  ".cm-md-code": {
    fontFamily: "var(--mono)",
    fontSize: "0.88em",
    background: "var(--inline-code-bg)",
    color: "var(--inline-code-fg)",
    borderRadius: "4px",
    padding: "1px 5px",
  },
  ".cm-md-link": { color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: "3px" },

  // Blocks
  ".cm-md-quote": {
    borderLeft: "3px solid var(--accent)",
    background: "var(--subtle)",
    color: "var(--text-2)",
    paddingLeft: "15px !important",
  },
  ".cm-md-bullet": { color: "var(--accent)", fontWeight: "700", display: "inline-block", width: "1ch", textAlign: "center" },
  ".cm-md-listmark": { color: "var(--accent)", fontWeight: "600" },
  ".cm-md-checkbox": {
    width: "15px",
    height: "15px",
    margin: "0 4px 0 0",
    verticalAlign: "-2px",
    accentColor: "var(--accent)",
    cursor: "pointer",
  },
  ".cm-md-task-done": { color: "var(--text-3)", textDecoration: "line-through" },
  ".cm-md-hr": {
    display: "inline-block",
    width: "100%",
    verticalAlign: "middle",
    borderTop: "2px solid var(--stroke-strong)",
  },

  // Code blocks (VS Code style)
  ".cm-md-codeblock": {
    fontFamily: "var(--mono)",
    fontSize: "13.5px",
    lineHeight: "1.6",
    background: "var(--code-bg)",
    color: "var(--code-fg)",
    caretColor: "var(--code-fg)",
    paddingLeft: "18px !important",
    paddingRight: "18px !important",
    marginLeft: "18px",
    marginRight: "18px",
    borderLeft: "1px solid var(--code-border)",
    borderRight: "1px solid var(--code-border)",
  },
  ".cm-md-codeblock-begin": {
    counterReset: "codeline",
    borderTop: "1px solid var(--code-border)",
    borderTopLeftRadius: "8px",
    borderTopRightRadius: "8px",
    paddingTop: "4px",
    color: "var(--code-muted)",
  },
  ".cm-md-codeblock-end": {
    borderBottom: "1px solid var(--code-border)",
    borderBottomLeftRadius: "8px",
    borderBottomRightRadius: "8px",
    paddingBottom: "4px",
    color: "var(--code-muted)",
  },
  ".cm-md-codeline": { position: "relative", paddingLeft: "3.4em !important" },
  ".cm-md-codeline::before": {
    counterIncrement: "codeline",
    content: "counter(codeline)",
    position: "absolute",
    left: "0",
    width: "2.5em",
    textAlign: "right",
    color: "var(--code-lineno)",
    userSelect: "none",
    pointerEvents: "none",
  },
  ".cm-md-indented": { borderRadius: "6px", border: "1px solid var(--code-border)" },
  ".cm-md-fence": {
    display: "inline-flex",
    width: "100%",
    alignItems: "center",
    justifyContent: "space-between",
    fontFamily: "var(--font)",
    fontSize: "12px",
  },
  ".cm-md-fence-lang": { color: "var(--code-muted)", textTransform: "lowercase", letterSpacing: "0.03em" },
  ".cm-md-fence-copy": {
    border: "1px solid var(--code-border)",
    background: "transparent",
    color: "var(--code-muted)",
    borderRadius: "4px",
    padding: "0 8px",
    fontSize: "12px",
    lineHeight: "20px",
    cursor: "pointer",
  },
  ".cm-md-fence-copy:hover": { color: "var(--code-fg)", background: "var(--code-hover)" },

  // Inline math
  ".cm-md-math": { padding: "0 1px", cursor: "text" },
  ".cm-md-math-src": { fontFamily: "var(--mono)", fontSize: "0.9em", color: "var(--tok-number)" },

  // Spell checking
  ".cm-misspelled": {
    textDecoration: "underline wavy var(--danger)",
    textDecorationSkipInk: "none",
    textUnderlineOffset: "3px",
  },

  // Tables (rendered HTML widget)
  ".cm-md-table": { padding: "4px 18px", overflowX: "auto", cursor: "text" },
  ".cm-md-table table": { borderCollapse: "collapse", fontSize: "14px" },
  ".cm-md-table th, .cm-md-table td": { border: "1px solid var(--stroke-strong)", padding: "5px 12px", textAlign: "left" },
  ".cm-md-table th": { background: "var(--subtle-2)", fontWeight: "600" },
});

export const highlight = syntaxHighlighting(
  HighlightStyle.define([
    // Markdown syntax (only visible on the line being edited)
    { tag: [t.processingInstruction, t.contentSeparator], color: "var(--text-3)" },
    { tag: t.heading, fontWeight: "600" },
    { tag: t.url, color: "var(--text-3)" },
    { tag: t.monospace, fontFamily: "var(--mono)" },
    { tag: t.labelName, color: "var(--code-muted)" },
    { tag: t.quote, color: "var(--text-2)" },
    // Code tokens (VS Code Light+ / Dark+)
    { tag: [t.keyword, t.operatorKeyword, t.definitionKeyword, t.modifier, t.self, t.bool, t.null, t.atom], color: "var(--tok-keyword)" },
    { tag: [t.controlKeyword, t.moduleKeyword], color: "var(--tok-control)" },
    { tag: [t.string, t.special(t.string), t.attributeValue, t.character], color: "var(--tok-string)" },
    { tag: [t.number, t.integer, t.float, t.escape], color: "var(--tok-number)" },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--tok-comment)" },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName)), t.macroName], color: "var(--tok-function)" },
    { tag: [t.variableName, t.propertyName, t.attributeName, t.definition(t.variableName)], color: "var(--tok-variable)" },
    { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName), t.standard(t.typeName)], color: "var(--tok-type)" },
    { tag: [t.tagName, t.angleBracket], color: "var(--tok-tag)" },
    { tag: t.regexp, color: "var(--tok-regexp)" },
    { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: "var(--tok-punct)" },
    { tag: t.invalid, color: "var(--danger)" },
  ]),
);
