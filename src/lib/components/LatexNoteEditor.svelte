<script lang="ts">
  // LaTeX notes: "latex" = formulas rendered with KaTeX; "latexdoc" = full document compiled
  // to PDF with Tectonic (optional download).
  import { onMount } from "svelte";
  import type { EditorView } from "@codemirror/view";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { save } from "@tauri-apps/plugin-dialog";
  import { api, type ToolProgress } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import { createLatexEditor } from "$lib/editor/setup";
  import { t } from "$lib/i18n/i18n.svelte";
  import { latexHtml } from "$lib/render";

  let {
    value = $bindable(""),
    noteId,
    title,
    layout,
    oninput,
  }: { value?: string; noteId: string; title: string; layout: "latex" | "latexdoc"; oninput?: () => void } = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;
  let installed = $state<boolean | null>(null);
  let installing = $state<string | null>(null);
  let compiling = $state(false);
  let pdfUrl = $state<string | null>(null);
  let log = $state("");
  let failed = $state(false);
  let compileTimer: ReturnType<typeof setTimeout> | undefined;

  const blocks = $derived(
    layout === "latex" ? value.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean) : [],
  );

  onMount(() => {
    view = createLatexEditor({
      parent: host,
      doc: value,
      onChange: (doc) => {
        value = doc;
        oninput?.();
        if (layout === "latexdoc") scheduleCompile();
      },
    });
    const unlisten = listen<ToolProgress>("tools://progress", (e) => {
      if (e.payload.tool !== "tectonic") return;
      const { done, total } = e.payload;
      installing = total ? `${Math.round((done / total) * 100)} %` : `${(done / 1048576).toFixed(1)} MB`;
    });
    if (layout === "latexdoc") {
      api.toolsStatus().then((s) => {
        installed = s.latex;
        if (s.latex) void compile();
      });
    }
    return () => {
      clearTimeout(compileTimer);
      view?.destroy();
      unlisten.then((f) => f());
    };
  });

  $effect(() => {
    const v = value;
    if (view && v !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
    }
  });

  function scheduleCompile() {
    clearTimeout(compileTimer);
    if (installed) compileTimer = setTimeout(compile, 1000);
  }

  async function compile() {
    if (compiling) return scheduleCompile();
    compiling = true;
    try {
      const r = await api.latexCompile(noteId, value);
      log = r.log;
      failed = !r.pdf;
      // FitH: the built-in PDF viewer fits the page to the panel width.
      if (r.pdf) pdfUrl = `${convertFileSrc(r.pdf)}?v=${Date.now()}#view=FitH`;
    } catch (e) {
      failed = true;
      log = String(e);
    } finally {
      compiling = false;
    }
  }

  async function install() {
    installing = "0 %";
    try {
      await api.latexInstall();
      installed = true;
      await compile();
    } catch (e) {
      app.notify(String(e), true, 8000);
    } finally {
      installing = null;
    }
  }

  async function exportPdf() {
    const dest = await save({
      defaultPath: `${(title || "documento").replace(/[\\/:*?"<>|]/g, "-")}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!dest) return;
    await api.latexExport(noteId, dest).then(() => app.notify(t("latex.export_done")), app.fail.bind(app));
  }
</script>

<div class="latex">
  {#if layout === "latexdoc"}
    <div class="bar">
      {#if installed}
        <span class="status" class:err={failed}>
          {compiling ? `⏳ ${t("latex.compiling")}` : failed ? `⚠ ${t("latex.error")}` : pdfUrl ? `✓ ${t("latex.compiled")}` : ""}
        </span>
        <span class="grow"></span>
        <button class="btn" onclick={compile} disabled={compiling}>{t("latex.compile")}</button>
        <button class="btn" onclick={exportPdf} disabled={!pdfUrl || failed}>{t("latex.export")}</button>
      {:else}
        <span class="faint">{t("latex.formulas_hint")}</span>
      {/if}
    </div>
  {:else}
    <div class="bar"><span class="faint">{t("latex.formulas_hint")}</span></div>
  {/if}

  <div class="panes" class:doc={layout === "latexdoc"}>
    <div class="host" bind:this={host}></div>
    <div class="out">
      {#if layout === "latex"}
        <div class="formulas">
          {#each blocks as b, i (i + b)}
            <div class="formula">{@html latexHtml(b)}</div>
          {/each}
        </div>
      {:else if installed === false}
        <div class="install">
          <p>{t("latex.not_installed")}</p>
          <p class="faint">{t("latex.first_run")}</p>
          <button class="btn primary" onclick={install} disabled={installing !== null}>
            {installing ? t("latex.installing", { p: installing }) : t("latex.install")}
          </button>
        </div>
      {:else if failed && !compiling}
        <pre class="log">{log}</pre>
      {:else if pdfUrl}
        <iframe title="PDF" src={pdfUrl}></iframe>
      {:else}
        <p class="faint center">{installed ? t("latex.first_run") : ""}</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .latex { display: flex; flex-direction: column; height: 100%; min-height: 0; border: 1px solid var(--stroke); border-radius: var(--radius); background: var(--card); }
  .bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--stroke); min-height: 44px; }
  .status { font-size: 13px; color: var(--break); }
  .status.err { color: var(--danger); }
  .panes { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .panes.doc { grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); }
  .host { min-height: 0; overflow: hidden; border-right: 1px solid var(--stroke); }
  .host :global(.cm-editor) { height: 100%; }
  .out { min-height: 0; overflow: auto; display: flex; flex-direction: column; }
  .formulas { display: grid; gap: 4px; padding: 12px 16px; }
  .formula { overflow-x: auto; padding: 4px 0; border-bottom: 1px dashed var(--stroke); }
  iframe { flex: 1; width: 100%; border: 0; background: #fff; }
  .install { display: grid; gap: 10px; justify-items: start; padding: 20px; }
  .log { margin: 0; padding: 12px; white-space: pre-wrap; font: 12px var(--mono); color: var(--danger); }
  .center { text-align: center; padding: 20px; }
</style>
