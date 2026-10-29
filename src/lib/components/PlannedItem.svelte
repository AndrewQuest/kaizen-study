<script lang="ts">
  import type { PlannedOccurrence } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import { t } from "$lib/i18n/i18n.svelte";

  let { item, onedit, showDate = false }: { item: PlannedOccurrence; onedit?: () => void; showDate?: string | false } = $props();
</script>

<div class="card item">
  <span class="time">{item.time}</span>
  <span class="dot" style:background={item.subject_color}></span>
  <div class="grow">
    <div class="row">
      <strong>{item.topic_name}</strong>
      {#if item.repeats}<span title={t("calendar.repeat")}>🔁</span>{/if}
    </div>
    <span class="faint">
      {#if showDate}{showDate} · {/if}{item.subject_name} · {t("common.minutes", { n: item.duration_min })}
      {#if item.template_id} · {t(`templates.${item.template_id}.name`)}{/if}
    </span>
  </div>
  {#if onedit}<button class="btn ghost" onclick={onedit}>{t("common.edit")}</button>{/if}
  <button class="btn primary" onclick={() => app.openStart(item.topic_id, item.template_id)}>▶ {t("calendar.start")}</button>
</div>

<style>
  .item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
  .time { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--accent); width: 44px; }
</style>
