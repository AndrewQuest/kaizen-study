<script lang="ts">
  import { api, type Stats } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import { duration } from "$lib/format";
  import { t } from "$lib/i18n/i18n.svelte";
  import BarChart from "$lib/components/BarChart.svelte";

  let range = $state(28);
  let stats = $state<Stats | null>(null);

  $effect(() => {
    void app.revision;
    api.stats(range).then((s) => (stats = s)).catch(app.fail.bind(app));
  });

  const subjectMax = $derived(Math.max(1, ...(stats?.by_subject.map((s) => s.seconds) ?? [1])));
</script>

<div class="page">
  <div class="page-head">
    <h1 class="grow">{t("stats.title")}</h1>
    <select bind:value={range}>
      {#each [7, 28, 90] as n}<option value={n}>{t("stats.last_days", { n })}</option>{/each}
    </select>
  </div>

  {#if stats}
    <div class="kpis">
      {#each [["stats.today", duration(stats.today_seconds)], ["stats.total", duration(stats.total_seconds)], ["stats.sessions", stats.session_count], ["stats.streak", `🔥 ${stats.streak}`], ["stats.best_streak", `🏆 ${stats.best_streak}`]] as [k, v]}
        <div class="card kpi"><span class="muted">{t(k as string)}</span><strong>{v}</strong></div>
      {/each}
    </div>

    {#if stats.total_seconds === 0}
      <div class="card empty">{t("stats.empty")}</div>
    {:else}
      <div class="card">
        <h3>{t("stats.last_days", { n: range })}</h3>
        <BarChart data={stats.daily} />
      </div>
      <div class="card">
        <h3>{t("stats.by_subject")}</h3>
        <div class="bars">
          {#each stats.by_subject as s}
            <span>{s.name}</span>
            <div class="track"><div class="fill" style:width="{(s.seconds / subjectMax) * 100}%" style:background={s.color}></div></div>
            <span class="muted num">{duration(s.seconds)}</span>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 12px; }
  .kpi { display: grid; gap: 4px; }
  .kpi strong { font-family: var(--font-display); font-size: 22px; font-weight: 600; }
  .page > .card + .card { margin-top: 12px; }
  .card h3 { margin-bottom: 12px; }
  .bars { display: grid; grid-template-columns: max-content 1fr max-content; gap: 10px 14px; align-items: center; }
  .track { height: 10px; background: var(--subtle); border-radius: 5px; overflow: hidden; }
  .fill { height: 100%; border-radius: 5px; }
  .num { font-variant-numeric: tabular-nums; }
</style>
