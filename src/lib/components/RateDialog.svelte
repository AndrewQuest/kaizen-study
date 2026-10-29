<script lang="ts">
  import { api } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import { duration } from "$lib/format";
  import { t } from "$lib/i18n/i18n.svelte";
  import Modal from "./Modal.svelte";

  let rating = $state(0);
  const finished = app.justFinished!;

  async function close(save: boolean) {
    if (save && rating) await api.rateSession(finished.id, rating).catch(app.fail.bind(app));
    app.justFinished = null;
    if (app.view === "session") app.view = "today";
    app.refresh();
  }
</script>

<Modal title={t("session.rate_title")} onclose={() => close(false)} width={420}>
  <p>{t("session.rate_body", { time: duration(finished.focus) })}</p>
  <div class="stars" role="radiogroup">
    {#each [1, 2, 3, 4, 5] as n}
      <button class:on={n <= rating} onclick={() => (rating = n)} aria-label={String(n)}>★</button>
    {/each}
  </div>
  {#snippet footer()}
    <button class="btn" onclick={() => close(false)}>{t("session.rate_skip")}</button>
    <button class="btn primary" disabled={!rating} onclick={() => close(true)}>{t("common.save")}</button>
  {/snippet}
</Modal>

<style>
  .stars { display: flex; gap: 4px; justify-content: center; }
  .stars button { font-size: 36px; background: none; border: 0; color: var(--subtle-2); transition: transform 0.1s; }
  .stars button:hover { transform: scale(1.15); }
  .stars .on { color: #f2c200; }
</style>
