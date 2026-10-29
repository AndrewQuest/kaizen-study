<script lang="ts">
  // Markdown editor (CodeMirror 6): hybrid live preview or split view, formatting toolbar,
  // LaTeX blocks, attachments (paste / drag & drop / button), local dictation and the guide.
  import { onMount } from "svelte";
  import type { EditorView } from "@codemirror/view";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { open } from "@tauri-apps/plugin-dialog";
  import { api } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import * as cmd from "$lib/editor/commands";
  import { insertEmbeds } from "$lib/editor/media";
  import { createEditor, setHybrid, setLocked } from "$lib/editor/setup";
  import { t } from "$lib/i18n/i18n.svelte";
  import { IMAGE_EXT, VIDEO_EXT } from "$lib/render";
  import MarkdownGuide from "./MarkdownGuide.svelte";
  import MarkdownPreview from "./MarkdownPreview.svelte";

  let {
    value = $bindable(""),
    placeholder = "",
    oninput,
    locked = $bindable(false),
  }: {
    value?: string;
    placeholder?: string;
    oninput?: () => void;
    /** Reading mode (hybrid view only): no editing until double click or the lock button. */
    locked?: boolean;
  } = $props();

  let host: HTMLDivElement;
  let root: HTMLDivElement;
  let view: EditorView | undefined;
  let guideOpen = $state(false);
  let langMenu = $state(false);
  /** This editor's view mode; starts from the default chosen in Settings. */
  let mode = $state<"hybrid" | "split">(app.settings.editor_mode);
  let dictation = $state<"idle" | "recording" | "transcribing">("idle");

  const LANGS: [string, string][] = [
    ["", "Texto"], ["python", "Python"], ["javascript", "JavaScript"], ["typescript", "TypeScript"],
    ["java", "Java"], ["csharp", "C#"], ["cpp", "C++"], ["c", "C"], ["rust", "Rust"], ["go", "Go"],
    ["php", "PHP"], ["kotlin", "Kotlin"], ["swift", "Swift"], ["sql", "SQL"], ["html", "HTML"],
    ["css", "CSS"], ["json", "JSON"], ["bash", "Bash"], ["powershell", "PowerShell"],
  ];

  onMount(() => {
    view = createEditor({
      parent: host,
      doc: value,
      placeholder,
      hybrid: mode === "hybrid",
      locked: reading,
      onChange: (doc) => {
        value = doc;
        oninput?.();
      },
      onUnlock: unlockAt,
    });
    // Files dropped from Explorer arrive as Tauri drag-drop events (with their paths).
    const unlisten = getCurrentWebview().onDragDropEvent(async (e) => {
      if (e.payload.type !== "drop" || !view) return;
      const x = e.payload.position.x / devicePixelRatio;
      const y = e.payload.position.y / devicePixelRatio;
      const r = root.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom || reading) return;
      const pos = view.posAtCoords({ x, y }) ?? view.state.selection.main.head;
      await importPaths(e.payload.paths, pos);
    });
    return () => {
      view?.destroy();
      unlisten.then((f) => f());
      if (dictation === "recording") void api.dictationCancel();
    };
  });

  // External changes (e.g. notes loaded after mount) replace the document.
  $effect(() => {
    const v = value;
    if (view && v !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
    }
  });

  /** The lock only exists in the hybrid view (the split view's left side is for editing). */
  const reading = $derived(locked && mode === "hybrid");

  $effect(() => {
    const r = reading;
    if (view) setLocked(view, r);
  });

  /** Double click on the locked note: unlock and put the cursor where the user clicked. */
  function unlockAt(pos: number) {
    locked = false;
    if (!view) return;
    setLocked(view, false);
    view.focus();
    view.dispatch({ selection: { anchor: Math.min(pos, view.state.doc.length) }, scrollIntoView: true });
  }

  function toggleLock() {
    locked = !locked;
    if (!locked && view) {
      setLocked(view, false);
      view.focus();
    }
  }

  function toggleMode() {
    mode = mode === "hybrid" ? "split" : "hybrid";
    if (view) setHybrid(view, mode === "hybrid");
  }

  const run = (fn: (v: EditorView) => boolean) => () => view && fn(view);

  function insertExample(text: string) {
    guideOpen = false;
    if (view && text) cmd.insertBlock(view, text.endsWith("\n") ? text : text + "\n");
  }

  async function importPaths(paths: string[], pos?: number) {
    if (!view) return;
    const names: string[] = [];
    for (const p of paths) {
      try {
        names.push(await api.importAttachment(p));
      } catch (e) {
        app.notify(String(e), true, 6000);
      }
    }
    insertEmbeds(view, names, pos);
  }

  async function pickMedia() {
    const picked = await open({
      multiple: true,
      filters: [{ name: t("editor.media_filter"), extensions: [...IMAGE_EXT, ...VIDEO_EXT] }],
    });
    if (picked) await importPaths(Array.isArray(picked) ? picked : [picked]);
  }

  async function toggleDictation() {
    if (dictation === "transcribing" || reading) return;
    if (dictation === "idle") {
      try {
        await api.dictationStart(app.settings.dictation_device);
        dictation = "recording";
      } catch (e) {
        app.notify(String(e).includes("modelo") ? t("editor.no_model") : String(e), true, 6000);
      }
      return;
    }
    dictation = "transcribing";
    try {
      const text = await api.dictationStop(app.settings.dictation_lang);
      if (text && view) {
        const { from, to } = view.state.selection.main;
        const prev = view.state.sliceDoc(Math.max(0, from - 1), from);
        const insert = (prev && !/\s/.test(prev) ? " " : "") + text;
        view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: "input" });
        view.focus();
      }
    } catch (e) {
      app.notify(String(e), true, 8000);
    } finally {
      dictation = "idle";
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      void toggleDictation();
    }
  }

  type Tool = { label: string; title: string; run: () => void; cls?: string } | null;
  const tools: Tool[] = [
    { label: "H1", title: t("editor.h1"), run: run((v) => cmd.heading(v, 1)), cls: "h" },
    { label: "H2", title: t("editor.h2"), run: run((v) => cmd.heading(v, 2)), cls: "h" },
    { label: "H3", title: t("editor.h3"), run: run((v) => cmd.heading(v, 3)), cls: "h" },
    null,
    { label: "B", title: t("editor.bold"), run: run((v) => cmd.toggleInline(v, "**")), cls: "b" },
    { label: "I", title: t("editor.italic"), run: run((v) => cmd.toggleInline(v, "*")), cls: "i" },
    { label: "S", title: t("editor.strike"), run: run((v) => cmd.toggleInline(v, "~~")), cls: "s" },
    null,
    { label: "•", title: t("editor.bullet"), run: run(cmd.bulletList) },
    { label: "1.", title: t("editor.numbered"), run: run(cmd.numberedList) },
    { label: "☑", title: t("editor.task"), run: run(cmd.taskList) },
    { label: "❝", title: t("editor.quote"), run: run(cmd.quote) },
    null,
    { label: "`", title: t("editor.code"), run: run((v) => cmd.toggleInline(v, "`")), cls: "mono" },
    { label: "∑", title: t("editor.latex"), run: run(cmd.latexBlock), cls: "math" },
    { label: "🔗", title: t("editor.link"), run: run(cmd.link) },
    { label: "🖼", title: t("editor.media"), run: () => void pickMedia() },
    { label: "▦", title: t("editor.table"), run: run(cmd.table) },
    { label: "—", title: t("editor.rule"), run: run(cmd.rule) },
  ];
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="editor" bind:this={root} onkeydown={onkeydown}>
  <div class="toolbar" role="toolbar">
    {#each tools as tool}
      {#if tool}
        <!-- mousedown+preventDefault keeps the editor focused and the selection intact -->
        <button class="tool {tool.cls ?? ''}" title={tool.title} aria-label={tool.title} disabled={reading}
          onmousedown={(e) => e.preventDefault()} onclick={tool.run}>{tool.label}</button>
      {:else}
        <span class="sep"></span>
      {/if}
    {/each}
    <div class="menu-wrap">
      <button class="tool mono" title={t("editor.codeblock")} aria-label={t("editor.codeblock")} aria-expanded={langMenu} disabled={reading}
        onmousedown={(e) => e.preventDefault()} onclick={() => (langMenu = !langMenu)}>{"{ }"}</button>
      {#if langMenu}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="menu" onmousedown={(e) => e.preventDefault()}>
          <span class="faint menu-title">{t("editor.choose_language")}</span>
          {#each LANGS as [id, name]}
            <button onclick={() => { langMenu = false; if (view) cmd.codeBlock(view, id); }}>{name}</button>
          {/each}
        </div>
      {/if}
    </div>
    <span class="sep"></span>
    <button class="tool mic" class:rec={dictation === "recording"} disabled={dictation === "transcribing" || reading}
      title={dictation === "recording" ? t("editor.dictate_stop") : t("editor.dictate")}
      aria-label={dictation === "recording" ? t("editor.dictate_stop") : t("editor.dictate")}
      onmousedown={(e) => e.preventDefault()} onclick={toggleDictation}>
      {dictation === "recording" ? `⏺ ${t("editor.dictating")}` : dictation === "transcribing" ? `⏳ ${t("editor.transcribing")}` : "🎤"}
    </button>
    <select class="lang" title={t("editor.dictation_lang")} aria-label={t("editor.dictation_lang")} value={app.settings.dictation_lang}
      onchange={(e) => app.setSetting("dictation_lang", e.currentTarget.value as "es" | "en" | "auto")}>
      <option value="es">{t("editor.lang_es")}</option>
      <option value="en">{t("editor.lang_en")}</option>
      <option value="auto">{t("editor.lang_auto")}</option>
    </select>
    <span class="grow"></span>
    <button class="tool view-mode" title={t("editor.mode_toggle")} aria-label={t("editor.mode_toggle")}
      onmousedown={(e) => e.preventDefault()} onclick={toggleMode}>
      ◫ <span class="label">{mode === "hybrid" ? t("editor.mode_hybrid") : t("editor.mode_split")}</span>
    </button>
    <button class="tool guide" title={t("editor.guide")} aria-label={t("editor.guide")} onclick={() => (guideOpen = true)}>
      ? <span class="label">{t("editor.guide")}</span>
    </button>
  </div>
  <div class="panes" class:split={mode === "split"}>
    <div class="host-wrap">
      <div class="host" class:reading bind:this={host}></div>
      {#if mode === "hybrid"}
        <button class="lock" class:on={reading} onclick={toggleLock}
          title={reading ? t("editor.lock_hint") : t("editor.unlock_hint")} aria-pressed={reading}>
          {reading ? `🔒 ${t("editor.locked")}` : `🔓 ${t("editor.unlocked")}`}
        </button>
      {/if}
    </div>
    {#if mode === "split"}
      <MarkdownPreview source={value} />
    {/if}
  </div>
</div>

{#if langMenu}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="click-away" onclick={() => (langMenu = false)}></div>
{/if}

{#if guideOpen}
  <MarkdownGuide onclose={() => (guideOpen = false)} oninsert={insertExample} />
{/if}

<style>
  .editor {
    container-type: inline-size;
    display: flex; flex-direction: column; height: 100%; min-height: 0;
    border: 1px solid var(--stroke); border-radius: var(--radius); background: var(--card);
  }
  .toolbar {
    display: flex; align-items: center; flex-wrap: wrap; gap: 2px;
    padding: 4px 6px; border-bottom: 1px solid var(--stroke);
  }
  .tool {
    min-width: 36px; height: 36px; padding: 0 8px; border: 0; border-radius: var(--radius-sm);
    background: transparent; color: var(--text-2); font-size: 18px; line-height: 1; white-space: nowrap;
  }
  .tool:hover { background: var(--subtle-2); color: var(--text); }
  .tool:disabled { opacity: 0.6; }
  .tool.h { font-family: var(--font-display); font-weight: 700; font-size: 15px; }
  .tool.b { font-weight: 800; }
  .tool.i { font-style: italic; font-family: Georgia, serif; }
  .tool.s { text-decoration: line-through; }
  .tool.mono { font-family: var(--mono); font-weight: 600; }
  .tool.math { font-family: Georgia, serif; font-size: 20px; }
  .tool.guide, .tool.view-mode { color: var(--accent); font-weight: 600; font-size: 14px; }
  .tool.mic.rec { color: var(--danger); font-weight: 600; font-size: 14px; animation: blink 1.2s ease-in-out infinite; }
  @keyframes blink { 50% { opacity: 0.55; } }
  .lang { min-height: 30px; padding: 0 4px; font-size: 13px; border-color: transparent; background: transparent; }
  .sep { width: 1px; height: 22px; background: var(--stroke-strong); margin: 0 4px; }
  .panes { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
  .panes.split { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .panes.split .host-wrap { border-right: 1px solid var(--stroke); }
  .host-wrap { position: relative; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
  .host { flex: 1; min-height: 0; overflow: hidden; }
  .lock {
    position: absolute; right: 16px; bottom: 14px; z-index: 5;
    display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px;
    border: 1px solid var(--stroke-strong); border-radius: 999px;
    background: var(--layer-solid); color: var(--text-2); box-shadow: var(--shadow);
    font-size: 14px; font-weight: 600;
  }
  .lock:hover { color: var(--text); }
  .lock.on { background: var(--accent); color: var(--accent-text); border-color: transparent; }
  .host :global(.cm-editor) { height: 100%; }
  .menu-wrap { position: relative; }
  .menu {
    position: absolute; top: 34px; left: 0; z-index: 20; width: 180px; max-height: 320px; overflow: auto;
    display: grid; padding: 4px; background: var(--layer-solid);
    border: 1px solid var(--stroke-strong); border-radius: var(--radius); box-shadow: var(--shadow);
  }
  .menu-title { padding: 4px 8px; }
  .menu button { text-align: left; padding: 6px 10px; border: 0; border-radius: var(--radius-sm); background: none; }
  .menu button:hover { background: var(--subtle-2); }
  .click-away { position: fixed; inset: 0; z-index: 10; }
  /* Narrow editor: the text of the last buttons collapses to their icon (tooltip keeps it). */
  @container (max-width: 820px) {
    .tool .label { display: none; }
    .sep { display: none; }
    .tool { min-width: 34px; padding: 0 6px; }
  }
</style>
