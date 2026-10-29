<script lang="ts">
  // Always-on-top floating timer. Kept independent of the main app store so it
  // doesn't duplicate sounds/notifications.
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { api, type TimerSnapshot } from "$lib/api";
  import { systemTheme } from "$lib/app.svelte";
  import { clock } from "$lib/format";
  import { t } from "$lib/i18n/i18n.svelte";

  let s = $state<TimerSnapshot | null>(null);
  const win = getCurrentWindow();

  onMount(() => {
    api.getSettings().then(async (st) => {
      const theme = st.theme === "light" || st.theme === "dark" ? st.theme : await systemTheme();
      document.documentElement.dataset.theme = theme;
    });
    api.timerState().then((x) => (s = x));
    const unTick = listen<TimerSnapshot>("timer://tick", (e) => (s = e.payload));
    const unFin = listen("timer://finished", () => win.close());
    return () => {
      unTick.then((f) => f());
      unFin.then((f) => f());
    };
  });

  const remaining = $derived(s ? (s.duration != null ? s.duration - s.elapsed : s.elapsed) : 0);
  const progress = $derived(s?.duration ? s.elapsed / s.duration : 0);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="mini" class:brk={s?.kind === "break"} onmousedown={(e) => e.button === 0 && e.target === e.currentTarget && win.startDragging()}>
  {#if s}
    <div class="info" onmousedown={() => win.startDragging()}>
      <span class="kind">{s.paused ? t("session.paused") : t(`session.${s.kind}`)}</span>
      <span class="time">{clock(remaining)}</span>
      <span class="topic">{s.topic_name}</span>
    </div>
    <div class="btns">
      <button onclick={() => api.togglePause()} title={s.paused ? t("session.resume") : t("session.pause")}>{s.paused ? "▶" : "⏸"}</button>
      <button onclick={() => api.showMain()} title={t("tray.show")}>⤢</button>
      <button onclick={() => win.close()} title={t("common.close")}>✕</button>
    </div>
    <div class="bar" style:width="{progress * 100}%"></div>
  {/if}
</div>

<style>
  :global(html), :global(body) { background: transparent; }
  .mini {
    --c: var(--focus);
    position: fixed; inset: 0; display: flex; align-items: center; gap: 8px; padding: 0 10px 0 14px;
    background: var(--layer-solid); border: 1px solid var(--stroke-strong); border-radius: 10px; overflow: hidden;
    user-select: none;
  }
  .mini.brk { --c: var(--break); }
  .info { flex: 1; display: grid; min-width: 0; cursor: grab; }
  .kind { font-size: 11px; font-weight: 600; color: var(--c); text-transform: uppercase; letter-spacing: 0.06em; }
  .time { font-family: var(--font-display); font-size: 30px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .topic { font-size: 11px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .btns { display: flex; flex-direction: column; gap: 2px; }
  .btns button { width: 26px; height: 24px; border: 0; border-radius: 4px; background: transparent; font-size: 12px; }
  .btns button:hover { background: var(--subtle-2); }
  .bar { position: absolute; left: 0; bottom: 0; height: 3px; background: var(--c); transition: width 0.9s linear; }
</style>
