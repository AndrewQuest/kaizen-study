<script module lang="ts">
  import type { ExportOptions, Format } from "$lib/exporter";
  // Remembered while the app is open.
  const last: { format: Format; quick: boolean; options: ExportOptions } = {
    format: "pdf",
    quick: false,
    options: { paper: "letter", landscape: false, margins: "normal", font: "medium", saveInk: false },
  };
</script>

<script lang="ts">
  import { save } from "$lib/dialogs";
  import { api, type Note } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import * as ex from "$lib/exporter";
  import { t } from "$lib/i18n/i18n.svelte";
  import Modal from "./Modal.svelte";

  let {
    note,
    topicId,
    subjectId,
    scope: initialScope,
    onclose,
  }: { note?: Note; topicId?: string; subjectId?: string; scope: ex.Scope; onclose: () => void } = $props();

  // svelte-ignore state_referenced_locally
  let scope = $state<ex.Scope>(initialScope);
  let format = $state<Format>(last.format);
  let quick = $state(last.quick);
  let o = $state<ExportOptions>({ ...last.options });
  let busy = $state(false);
  let doc = $state<ex.ExportDoc | null>(null);
  let preview = $state("");

  const scopes = $derived(
    (["note", "topic", "subject"] as ex.Scope[]).filter((s) => (s === "note" ? !!note : s === "topic" ? !!topicId : !!subjectId)),
  );
  const FORMATS: Format[] = ["pdf", "docx", "txt", "md", "print"];
  const paged = $derived(format === "pdf" || format === "docx" || format === "print");
  const idFor = (s: ex.Scope) => (s === "note" ? note!.id : s === "topic" ? topicId! : subjectId!);

  // Only the latest request wins when the scope changes quickly.
  let request = 0;
  $effect(() => {
    const [s, q] = [scope, quick];
    const mine = ++request;
    ex.collect(s, idFor(s), q, note)
      .then((d) => mine === request && (doc = d))
      .catch(app.fail.bind(app));
  });

  $effect(() => {
    const d = doc;
    const opts = { ...o };
    if (!d) return;
    const h = setTimeout(async () => (preview = await ex.documentHtml(d, opts, "preview")), 150);
    return () => clearTimeout(h);
  });

  const [pw, ph] = $derived(ex.PAPERS[o.paper]);
  const pageW = $derived((o.landscape ? ph : pw) * 96);
  const pageH = $derived((o.landscape ? pw : ph) * 96);
  const PREVIEW_W = 300;
  const scale = $derived(PREVIEW_W / pageW);

  async function run() {
    if (!doc) return;
    if (ex.isEmpty(doc)) return app.notify(t("export.empty"));
    Object.assign(last, { format, quick, options: { ...o } });
    busy = true;
    try {
      if (format === "print") {
        await api.exportPrint(await ex.documentHtml(doc, o, "print"));
        onclose();
        return;
      }
      const ext = format;
      const path = await save({
        defaultPath: ex.fileName(doc.title, ext),
        filters: [{ name: t(`export.${format}`), extensions: [ext] }],
      });
      if (!path) return;
      if (format === "pdf") await api.exportPdf(await ex.documentHtml(doc, o, "pdf"), path, ex.pageSetup(o));
      else if (format === "md") await api.saveExport(path, ex.encode(ex.toMarkdown(doc)));
      else if (format === "txt") await api.saveExport(path, ex.encode(await ex.toText(doc)));
      else {
        const { toDocx } = await import("$lib/exportDocx");
        await api.saveExport(path, await toDocx(doc, o));
      }
      app.notify(t("export.done", { name: path.split(/[\\/]/).pop()! }));
      onclose();
    } catch (e) {
      app.fail(e);
    } finally {
      busy = false;
    }
  }
</script>

<Modal title={t("export.title")} {onclose} width={760}>
  <div class="cols">
    <div class="form">
      {#if scopes.length > 1}
        <fieldset>
          <legend>{t("export.scope")}</legend>
          {#each scopes as s}
            <label class="radio"><input type="radio" bind:group={scope} value={s} /> {t(`export.scope_${s}`)}</label>
          {/each}
        </fieldset>
      {/if}
      {#if scope !== "note"}
        <label class="radio"><input type="checkbox" bind:checked={quick} /> {t("export.quick_notes")}</label>
      {/if}
      <fieldset>
        <legend>{t("export.format")}</legend>
        <div class="chips">
          {#each FORMATS as f}
            <button class="chip" class:on={format === f} onclick={() => (format = f)}>{t(`export.${f}`)}</button>
          {/each}
        </div>
      </fieldset>
      {#if paged}
        <div class="grid2">
          <label class="field">{t("export.paper")}
            <select bind:value={o.paper}>
              {#each ["letter", "a4", "legal", "a5"] as p}<option value={p}>{t(`export.${p}`)}</option>{/each}
            </select>
          </label>
          <label class="field">{t("export.orientation")}
            <select bind:value={o.landscape}>
              <option value={false}>{t("export.portrait")}</option>
              <option value={true}>{t("export.landscape")}</option>
            </select>
          </label>
          <label class="field">{t("export.margins")}
            <select bind:value={o.margins}>
              {#each ["narrow", "normal", "wide"] as m}<option value={m}>{t(`export.${m}`)}</option>{/each}
            </select>
          </label>
          <label class="field">{t("export.font")}
            <select bind:value={o.font}>
              {#each ["small", "medium", "large"] as f}<option value={f}>{t(`export.${f}`)}</option>{/each}
            </select>
          </label>
        </div>
        <label class="radio"><input type="checkbox" bind:checked={o.saveInk} /> {t("export.save_ink")}</label>
      {/if}
    </div>
    <div class="preview-col">
      <span class="faint">{t("export.preview")}</span>
      <div class="sheet-box" style:width="{PREVIEW_W}px" style:height="{Math.min(pageH * scale, 400)}px">
        <div class="sheet" style:width="{pageW}px" style:min-height="{pageH}px"
          style:padding="{ex.MARGINS[o.margins] * 96}px" style:transform="scale({scale})">
          {@html preview}
        </div>
      </div>
    </div>
  </div>
  {#snippet footer()}
    <button class="btn" onclick={onclose}>{t("common.cancel")}</button>
    <button class="btn primary" disabled={busy || !doc} onclick={run}>
      {busy ? t("export.working") : format === "print" ? t("export.go_print") : t("export.go")}
    </button>
  {/snippet}
</Modal>

<style>
  .cols { display: flex; gap: 20px; flex-wrap: wrap; }
  .form { flex: 1; min-width: 280px; display: grid; gap: 12px; align-content: start; }
  fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: 6px; }
  legend { font-weight: 600; margin-bottom: 4px; }
  .radio { display: flex; align-items: center; gap: 8px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { padding: 5px 12px; border: 1px solid var(--stroke-strong); border-radius: 16px; background: none; color: var(--text); }
  .chip.on { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .field { display: grid; gap: 4px; }
  .preview-col { display: grid; gap: 6px; align-content: start; }
  .sheet-box { overflow: hidden; border: 1px solid var(--stroke-strong); border-radius: 4px; background: #fff; }
  .sheet { transform-origin: top left; background: #fff; color: #111; box-sizing: border-box; }
  /* The page is always printed in the light theme: same colors here, also in dark mode. */
  .sheet {
    --text: #1a1a1a; --text-2: #5d5d5d; --text-3: #8a8a8a; --accent: #005fb8;
    --subtle: rgba(0, 0, 0, 0.037); --subtle-2: rgba(0, 0, 0, 0.06); --stroke: rgba(0, 0, 0, 0.0578); --stroke-strong: rgba(0, 0, 0, 0.14);
    --inline-code-bg: rgba(175, 184, 193, 0.28); --inline-code-fg: #1f2328;
    --code-bg: #f8f8f8; --code-fg: #1f1f1f; --code-border: rgba(0, 0, 0, 0.1); --code-muted: #6e7781;
    --tok-keyword: #0000ff; --tok-control: #af00db; --tok-string: #a31515; --tok-number: #098658; --tok-comment: #008000;
    --tok-function: #795e26; --tok-variable: #001080; --tok-type: #267f99; --tok-tag: #800000; --tok-regexp: #811f3f; --tok-punct: #1f1f1f;
    color: var(--text);
  }
</style>
