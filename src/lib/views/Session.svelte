<script lang="ts">
  import { api } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import { clock, duration } from "$lib/format";
  import { t } from "$lib/i18n/i18n.svelte";
  import MarkdownEditor from "$lib/components/MarkdownEditor.svelte";

  let notes = $state("");
  /** Quick notes that already have text open in reading mode. */
  let notesLocked = $state(false);
  let loadedFor = "";
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const s = $derived(app.timer);
  const compact = $derived(app.settings.session_compact);
  const remaining = $derived(s ? (s.duration != null ? s.duration - s.elapsed : s.elapsed) : 0);
  const progress = $derived(s?.duration ? Math.min(1, s.elapsed / s.duration) : 0);
  const activity = $derived(s?.kind === "break" ? app.activity(s.activity) : undefined);
  const R = 120;
  const C = 2 * Math.PI * R;
  const shortcut = $derived(app.settings.shortcut.replace("CommandOrControl", "Ctrl"));

  // Load quick notes once per session (they persist in the DB as you type).
  $effect(() => {
    const id = s?.session_id;
    if (!id || id === loadedFor) return;
    loadedFor = id;
    api.listSessions(s!.topic_id).then((list) => {
      notes = list.find((x) => x.id === id)?.notes_md ?? "";
      notesLocked = notes.trim() !== "";
    });
  });

  function queueSave() {
    clearTimeout(saveTimer);
    const id = s?.session_id;
    if (id) saveTimer = setTimeout(() => api.saveSessionNotes(id, notes), 600);
  }

  async function finish() {
    clearTimeout(saveTimer);
    if (s) await api.saveSessionNotes(s.session_id, notes);
    await api.finishSession().catch(app.fail.bind(app));
  }

  const toggleCompact = () => app.setSetting("session_compact", !compact);
</script>

{#snippet controls(big: boolean)}
  <button class="btn primary" class:big onclick={() => api.togglePause()}>
    {s!.paused ? `▶ ${t("session.resume")}` : `⏸ ${t("session.pause")}`}
  </button>
  <button class="btn" class:big onclick={() => api.skipBlock()}>
    ⏭ {s!.mode === "flow" && s!.kind === "focus" ? t("session.take_break") : t("session.skip")}
  </button>
  <button class="btn" class:big onclick={() => api.toggleMini()} title={t("session.mini")} aria-label={t("session.mini")}>🗗</button>
  <button class="btn danger" class:big onclick={finish}>⏹ {t("session.finish")}</button>
{/snippet}

{#snippet breakCard()}
  {#if s?.kind === "break"}
    {@const guide = s.template_id ? t(`templates.${s.template_id}.break_guide`) : ""}
    <div class="break-card">
      {#if activity}
        <div class="row">
          <span class="act-emoji">{activity.emoji}</span>
          <div>
            <strong>{t("session.break_now", { activity: activity.name })}</strong>
            {#if activity.instructions}<p class="muted">{activity.instructions}</p>{/if}
          </div>
        </div>
      {/if}
      {#if guide && !guide.startsWith("templates.")}
        <p class="faint"><strong>{t("session.break_guide")}:</strong> {guide}</p>
      {/if}
    </div>
  {/if}
{/snippet}

{#if s}
  <div class="session" class:brk={s.kind === "break"} class:compact>
    {#if compact}
      <div class="top">
      <div class="bar">
        <span class="dot" style:background={s.subject_color}></span>
        <strong class="topic">{s.topic_name}</strong>
        <span class="kind">{s.paused ? t("session.paused") : t(`session.${s.kind}`)}</span>
        <span class="bar-time" class:dim={s.paused}>{clock(remaining)}</span>
        <span class="grow"></span>
        {@render controls(false)}
        <button class="btn toggle-clock" onclick={toggleCompact}>{t("session.expand")}</button>
        <div class="bar-progress" style:width="{progress * 100}%"></div>
      </div>
      {@render breakCard()}
      </div>
    {:else}
      <div class="timer-pane">
        <button class="btn toggle-clock collapse" onclick={toggleCompact}>{t("session.compact")}</button>
        <div class="who">
          <span class="dot" style:background={s.subject_color}></span>
          <span class="muted">{s.subject_name}</span>
          <strong>{s.topic_name}</strong>
        </div>
        {#if s.template_id}<span class="chip">{t(`templates.${s.template_id}.name`)}</span>{/if}

        <div class="ring">
          <svg viewBox="0 0 280 280">
            <circle cx="140" cy="140" r={R} class="track" />
            <circle cx="140" cy="140" r={R} class="arc"
              stroke-dasharray={C} stroke-dashoffset={s.duration ? C * progress : 0}
              class:pulse={s.duration == null} />
          </svg>
          <div class="center">
            <span class="kind">{s.paused ? t("session.paused") : t(`session.${s.kind}`)}</span>
            <span class="time" class:dim={s.paused}>{clock(remaining)}</span>
            <span class="faint">{t("session.cycle", { n: s.cycle + (s.kind === "focus" ? 1 : 0) })}</span>
          </div>
        </div>

        <div class="controls">{@render controls(true)}</div>
        {@render breakCard()}
        <p class="faint">{t("session.focus_total")}: {duration(s.focus_total)} · {t("session.shortcut_hint", { key: shortcut })}</p>
      </div>
    {/if}

    <div class="notes-pane">
      <h3>{t("session.quick_notes")}</h3>
      <MarkdownEditor bind:value={notes} bind:locked={notesLocked} placeholder={t("session.quick_notes_ph")} oninput={queueSave} />
    </div>
  </div>
{:else}
  <div class="empty-state">
    <p class="muted">{t("session.none")}</p>
    <button class="btn primary big" onclick={() => app.openStart()}>▶ {t("session.start")}</button>
  </div>
{/if}

<style>
  .session { display: grid; grid-template-columns: minmax(380px, 1.1fr) minmax(0, 1fr); height: 100%; --c: var(--focus); }
  .session.brk { --c: var(--break); }
  .session.compact { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .timer-pane { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 24px; overflow: auto; }
  .collapse { position: absolute; top: 12px; right: 12px; }
  .toggle-clock { border-color: var(--accent); color: var(--accent); font-weight: 600; }
  .who { display: flex; align-items: center; gap: 8px; font-size: 16px; }
  .ring { position: relative; width: min(340px, 42vh); aspect-ratio: 1; flex: none; }
  svg { width: 100%; height: 100%; transform: rotate(-90deg); }
  circle { fill: none; stroke-width: 10; }
  .track { stroke: var(--subtle-2); }
  .arc { stroke: var(--c); stroke-linecap: round; transition: stroke-dashoffset 0.9s linear, stroke 0.3s; }
  .arc.pulse { animation: pulse 2.4s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.35; } }
  .center { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; gap: 2px; }
  .kind { color: var(--c); font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; font-size: 13px; }
  .time { font-family: var(--font-display); font-size: clamp(44px, 8vh, 68px); font-weight: 600; font-variant-numeric: tabular-nums; }
  .time.dim, .bar-time.dim { opacity: 0.5; }
  .controls { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
  .notes-pane { display: flex; flex-direction: column; gap: 10px; padding: 24px; border-left: 1px solid var(--stroke); min-height: 0; }
  .compact .notes-pane { border-left: 0; padding-top: 12px; }

  .bar {
    position: relative; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 10px 24px; border-bottom: 1px solid var(--stroke); overflow: hidden;
  }
  .bar .topic { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 30%; }
  .bar-time { font-family: var(--font-display); font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--c); }
  .bar-progress { position: absolute; left: 0; bottom: 0; height: 3px; background: var(--c); transition: width 0.9s linear; }

  .break-card {
    display: grid; gap: 8px; max-width: 520px; padding: 12px 16px;
    border-radius: var(--radius); background: var(--break-soft); border: 1px solid var(--stroke);
  }
  .compact .break-card { max-width: none; margin: 12px 24px 0; }
  .act-emoji { font-size: 28px; }
  .empty-state { height: 100%; display: grid; place-content: center; justify-items: center; gap: 16px; }
</style>
