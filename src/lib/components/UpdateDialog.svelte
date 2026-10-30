<script lang="ts">
  // Checks GitHub Releases once at startup (installed app only) and asks before updating.
  import { onMount } from "svelte";
  import { check, type Update } from "@tauri-apps/plugin-updater";
  import { relaunch } from "@tauri-apps/plugin-process";
  import { app } from "$lib/app.svelte";
  import { t } from "$lib/i18n/i18n.svelte";
  import Modal from "./Modal.svelte";

  let update = $state<Update | null>(null);
  let progress = $state<string | null>(null);

  onMount(() => {
    // Only the installed release checks (not dev builds nor tests).
    if (!app.info?.autostart_default) return;
    const h = setTimeout(() => check().then((u) => (update = u)).catch(() => {}), 8000);
    return () => clearTimeout(h);
  });

  async function install() {
    const u = update!;
    let total = 0;
    let done = 0;
    progress = t("update.downloading", { p: "" });
    try {
      await u.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        else if (e.event === "Progress") {
          done += e.data.chunkLength;
          progress = t("update.downloading", { p: total ? `${Math.round((done * 100) / total)} %` : "" });
        }
      });
      await relaunch();
    } catch (e) {
      progress = null;
      app.notify(t("update.error", { e: String(e) }), true, 8000);
    }
  }
</script>

{#if update}
  <Modal title={t("update.title")} onclose={() => !progress && (update = null)} width={460}>
    <p>{t("update.body", { version: update.version, current: update.currentVersion })}</p>
    {#if update.body}
      <h3>{t("update.notes")}</h3>
      <p class="notes">{update.body}</p>
    {/if}
    {#if progress}<p class="faint">{progress}</p>{/if}
    {#snippet footer()}
      <button class="btn" disabled={!!progress} onclick={() => (update = null)}>{t("update.later")}</button>
      <button class="btn primary" disabled={!!progress} onclick={install}>{t("update.now")}</button>
    {/snippet}
  </Modal>
{/if}

<style>
  .notes { white-space: pre-wrap; max-height: 220px; overflow: auto; }
</style>
