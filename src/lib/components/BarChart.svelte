<script lang="ts">
  import { duration } from "$lib/format";

  let { data }: { data: { date: string; seconds: number }[] } = $props();

  // TOP leaves room for the highest "Nh" label, RIGHT for the last date label.
  const W = 720, H = 180, PAD = 24, TOP = 12, RIGHT = 16;
  const max = $derived(Math.max(3600, ...data.map((d) => d.seconds)));
  const step = $derived((W - PAD - RIGHT) / Math.max(1, data.length));
  const hourLines = $derived(Array.from({ length: Math.floor(max / 3600) }, (_, i) => i + 1).filter((h) => h <= 12));
  let hover = $state<number | null>(null);
  /** Show ~8 date labels whatever the range, always including today (the last bar). */
  const labelEvery = $derived(data.length <= 14 ? 1 : Math.ceil(data.length / 8));
</script>

<svg viewBox="0 {-TOP} {W} {H + 22 + TOP}" role="img" aria-label="Tiempo de estudio por día">
  {#each hourLines as h}
    {@const y = H - (h * 3600 * H) / max}
    <line x1={PAD} x2={W} y1={y} y2={y} class="grid" />
    <text x={PAD - 6} y={y + 4} class="axis" text-anchor="end">{h}h</text>
  {/each}
  {#each data as d, i}
    {@const bh = (d.seconds * H) / max}
    {@const x = PAD + i * step}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <g onmouseenter={() => (hover = i)} onmouseleave={() => (hover = null)}>
      <rect x={x} y={0} width={step} height={H} fill="transparent" />
      <rect x={x + step * 0.18} y={H - Math.max(bh, 2)} width={step * 0.64} height={Math.max(bh, 2)} rx="3"
        class="bar" class:zero={d.seconds === 0} class:hover={hover === i} />
      {#if (data.length - 1 - i) % labelEvery === 0}
        <text x={x + step / 2} y={H + 16} class="axis" text-anchor="middle">{d.date.slice(8)}/{d.date.slice(5, 7)}</text>
      {/if}
    </g>
  {/each}
  {#if hover !== null}
    {@const d = data[hover]}
    {@const x = Math.min(W - 140, Math.max(PAD, PAD + hover * step - 50))}
    <g class="tip">
      <rect x={x} y={4} width="140" height="40" rx="6" />
      <text x={x + 10} y={20}>{d.date.slice(8)}/{d.date.slice(5, 7)}</text>
      <text x={x + 10} y={36} class="strong">{duration(d.seconds)}</text>
    </g>
  {/if}
</svg>

<style>
  svg { width: 100%; height: auto; display: block; }
  .grid { stroke: var(--stroke-strong); stroke-dasharray: 3 4; }
  .axis { fill: var(--text-3); font-size: 11px; }
  .bar { fill: var(--accent); transition: opacity 0.1s; }
  .bar.zero { fill: var(--subtle-2); }
  .bar.hover { opacity: 0.75; }
  .tip rect { fill: var(--layer-solid); stroke: var(--stroke-strong); }
  .tip text { fill: var(--text-2); font-size: 12px; }
  .tip .strong { fill: var(--text); font-weight: 600; }
</style>
