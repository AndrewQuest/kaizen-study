<script lang="ts">
  // GitHub-style consistency map: one square per day, columns are weeks (Monday first).
  import { duration } from "$lib/format";
  import { t } from "$lib/i18n/i18n.svelte";

  let { daily }: { daily: { date: string; seconds: number }[] } = $props();

  const CELL = 12, GAP = 3;
  const level = (s: number) => (s <= 0 ? 0 : s < 30 * 60 ? 1 : s < 60 * 60 ? 2 : s < 120 * 60 ? 3 : 4);

  const cells = $derived.by(() => {
    if (!daily.length) return [];
    const first = new Date(daily[0].date + "T00:00");
    const offset = (first.getDay() + 6) % 7; // rows: Monday = 0
    return daily.map((d, i) => {
      const k = i + offset;
      return { ...d, col: Math.floor(k / 7), row: k % 7, level: level(d.seconds) };
    });
  });
  const cols = $derived(cells.length ? cells[cells.length - 1].col + 1 : 0);
</script>

<div class="heat">
  <svg viewBox="0 0 {cols * (CELL + GAP)} {7 * (CELL + GAP)}" role="img" aria-label={t("calendar.heatmap")}>
    {#each cells as c (c.date)}
      <rect x={c.col * (CELL + GAP)} y={c.row * (CELL + GAP)} width={CELL} height={CELL} rx="2" class="l{c.level}">
        <title>{c.date}: {duration(c.seconds)}</title>
      </rect>
    {/each}
  </svg>
  <div class="legend faint">
    {t("calendar.heatmap_less")}
    {#each [0, 1, 2, 3, 4] as l}<span class="sq l{l}"></span>{/each}
    {t("calendar.heatmap_more")}
  </div>
</div>

<style>
  .heat { display: grid; gap: 6px; }
  svg { width: 100%; height: auto; }
  .legend { display: flex; align-items: center; gap: 4px; justify-content: flex-end; }
  .sq { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }
  .l0 { fill: var(--subtle-2); background: var(--subtle-2); }
  .l1 { fill: color-mix(in srgb, var(--accent) 30%, transparent); background: color-mix(in srgb, var(--accent) 30%, transparent); }
  .l2 { fill: color-mix(in srgb, var(--accent) 55%, transparent); background: color-mix(in srgb, var(--accent) 55%, transparent); }
  .l3 { fill: color-mix(in srgb, var(--accent) 80%, transparent); background: color-mix(in srgb, var(--accent) 80%, transparent); }
  .l4 { fill: var(--accent); background: var(--accent); }
</style>
