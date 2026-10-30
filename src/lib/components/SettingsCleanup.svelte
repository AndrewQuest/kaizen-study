<script lang="ts">
  // Ajustes → Datos: attachments and LaTeX PDFs no note uses any more.
  import { ask } from "$lib/dialogs";
  import { api, type UnusedFile } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import { t } from "$lib/i18n/i18n.svelte";

  let files = $state<UnusedFile[] | null>(null);
  let chosen = $state<Set<string>>(new Set());
  let busy = $state(false);

  const key = (f: UnusedFile) => `${f.kind}/${f.name}`;
  const size = (b: number) =>
    b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`;
  const picked = $derived((files ?? []).filter((f) => chosen.has(key(f))));
  const pickedBytes = $derived(picked.reduce((a, f) => a + f.bytes, 0));

  async function scan() {
    busy = true;
    try {
      files = await api.scanUnused();
      chosen = new Set(files.map(key));
    } catch (e) {
      app.fail(e);
    } finally {
      busy = false;
    }
  }

  function toggle(f: UnusedFile) {
    const next = new Set(chosen);
    if (!next.delete(key(f))) next.add(key(f));
    chosen = next;
  }

  async function remove() {
    if (!picked.length) return;
    if (!(await ask(t("cleanup.confirm", { n: picked.length, size: size(pickedBytes) }), { kind: "warning" }))) return;
    try {
      await api.deleteUnused(picked.map((f) => [f.kind, f.name]));
      app.notify(t("cleanup.deleted"));
      await scan();
    } catch (e) {
      app.fail(e);
    }
  }
</script>

<div class="card block">
  <div class="row">
    <div class="grow">
      <div>{t("cleanup.title")}</div>
      <span class="faint">{t("cleanup.hint")}</span>
    </div>
    <button class="btn" disabled={busy} onclick={scan}>{busy ? t("cleanup.scanning") : t("cleanup.scan")}</button>
  </div>
  {#if files}
    {#if !files.length}
      <span class="faint">{t("cleanup.none")}</span>
    {:else}
      <span class="faint">{t("cleanup.found", { n: files.length, size: size(files.reduce((a, f) => a + f.bytes, 0)) })}</span>
      <div class="list">
        {#each files as f (key(f))}
          <label class="file">
            <input type="checkbox" checked={chosen.has(key(f))} onchange={() => toggle(f)} />
            <span class="kind">{t(`cleanup.kind_${f.kind}`)}</span>
            <span class="grow name">{f.name}</span>
            <span class="faint">{size(f.bytes)}</span>
          </label>
        {/each}
      </div>
      <div class="row">
        <span class="grow"></span>
        <button class="btn danger" disabled={!picked.length} onclick={remove}>{t("cleanup.delete")} ({size(pickedBytes)})</button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .block { display: grid; gap: 10px; padding: 14px 16px; }
  .list { display: grid; gap: 2px; max-height: 260px; overflow: auto; }
  .file { display: flex; align-items: center; gap: 10px; padding: 4px 0; border-top: 1px solid var(--stroke); }
  .kind { font-size: 12px; padding: 0 6px; border-radius: 8px; background: var(--subtle-2); white-space: nowrap; }
  .name { overflow-wrap: anywhere; }
</style>
