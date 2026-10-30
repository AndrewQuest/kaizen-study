<script module lang="ts">
  import { api, type PlannedOccurrence } from "$lib/api";

  type Scope = "one" | "series";

  /** Moving a single day keeps its done/skipped mark. */
  const moveKind = (item: PlannedOccurrence) => (item.status === "pending" ? "moved" : item.status);

  /** Moves an occurrence to `date` (one day of a series, or the whole plan). */
  export async function movePlanned(item: PlannedOccurrence, date: string, scope: Scope) {
    if (date === item.date) return;
    if (item.repeats && scope === "one") {
      await api.setPlanException(item.plan_id, item.original_date, moveKind(item), date, item.time);
    } else {
      const days = Math.round((new Date(date + "T00:00").getTime() - new Date(item.date + "T00:00").getTime()) / 86400000);
      await api.shiftPlanned(item.plan_id, days);
    }
  }
</script>

<script lang="ts">
  import { ask } from "$lib/dialogs";
  import type { PlannedStudy } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import { t } from "$lib/i18n/i18n.svelte";
  import Modal from "./Modal.svelte";
  import PlanDialog from "./PlanDialog.svelte";

  let {
    item,
    showDate = false,
    ondrop,
  }: {
    item: PlannedOccurrence;
    showDate?: string | false;
    /** Called while dragging ends over a day cell (`[data-date]`); the parent asks for the scope. */
    ondrop?: (item: PlannedOccurrence, date: string) => void;
  } = $props();

  let editing = $state<PlannedStudy | null>(null);
  let choosing = $state<{ question: string; run: (scope: Scope) => void } | null>(null);
  let dayEdit = $state<{ date: string; time: string } | null>(null);

  const moved = $derived(item.date !== item.original_date);
  /** Keep the day's moved date/time when marking it done or skipped. */
  const mark = (kind: "done" | "skipped" | "") =>
    kind === "" && moved
      ? api.setPlanException(item.plan_id, item.original_date, "moved", item.date, item.time)
      : api.setPlanException(item.plan_id, item.original_date, kind, moved ? item.date : null, moved ? item.time : null);

  async function act(f: () => Promise<unknown>) {
    try {
      await f();
      app.refresh();
    } catch (e) {
      app.fail(e);
    }
  }

  function scoped(question: string, run: (scope: Scope) => void) {
    if (item.repeats) choosing = { question, run };
    else run("series");
  }

  function choose(scope: Scope) {
    const run = choosing?.run;
    choosing = null;
    run?.(scope);
  }

  function edit() {
    scoped(t("calendar.series_edit"), async (scope) => {
      if (scope === "one") dayEdit = { date: item.date, time: item.time };
      else editing = await api.getPlanned(item.plan_id).catch((e) => (app.fail(e), null));
    });
  }

  async function remove() {
    if (!item.repeats) {
      if (await ask(t("calendar.delete_one_confirm"), { kind: "warning" })) act(() => api.deletePlanned(item.plan_id));
      return;
    }
    scoped(t("calendar.series_delete"), (scope) =>
      act(() => (scope === "one" ? api.setPlanException(item.plan_id, item.original_date, "deleted") : api.deletePlanned(item.plan_id))),
    );
  }

  function saveDay() {
    const d = dayEdit!;
    dayEdit = null;
    act(() => api.setPlanException(item.plan_id, item.original_date, moveKind(item), d.date, d.time));
  }

  // ---- Drag to another day (pointer events: HTML5 drag & drop is taken by the window's file drop) ----
  let ghost: HTMLElement | null = null;
  let start: { x: number; y: number } | null = null;

  function down(e: PointerEvent) {
    if (!ondrop || e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    start = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function target(e: PointerEvent) {
    ghost?.style.setProperty("display", "none");
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-date]");
    ghost?.style.removeProperty("display");
    return el;
  }
  function move(e: PointerEvent) {
    if (!start) return;
    if (!ghost) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
      ghost = document.createElement("div");
      ghost.className = "plan-ghost";
      ghost.textContent = `${item.time} ${item.topic_name}`;
      ghost.style.borderColor = item.subject_color;
      document.body.append(ghost);
    }
    ghost.style.left = `${e.clientX + 10}px`;
    ghost.style.top = `${e.clientY + 10}px`;
    document.querySelectorAll(".drop-over").forEach((x) => x.classList.remove("drop-over"));
    target(e)?.classList.add("drop-over");
  }
  function up(e: PointerEvent) {
    const dragged = !!ghost;
    const el = dragged ? target(e) : null;
    ghost?.remove();
    ghost = null;
    start = null;
    document.querySelectorAll(".drop-over").forEach((x) => x.classList.remove("drop-over"));
    if (el?.dataset.date && el.dataset.date !== item.date) ondrop?.(item, el.dataset.date);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="card item" class:done={item.status === "done"} class:skipped={item.status === "skipped"} class:draggable={!!ondrop}
  data-plan={item.plan_id} title={ondrop ? t("calendar.drag_hint") : undefined}
  onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
  <span class="time">{item.time}</span>
  <span class="dot" style:background={item.subject_color}></span>
  <div class="grow info">
    <div class="row">
      <strong class="name">{item.topic_name}</strong>
      {#if item.repeats}<span title={t("calendar.repeat")}>🔁</span>{/if}
      {#if item.status === "done"}<span class="tag ok">✓ {t("calendar.status_done")}</span>{/if}
      {#if item.status === "skipped"}<span class="tag">{t("calendar.status_skipped")}</span>{/if}
    </div>
    <span class="faint">
      {#if showDate}{showDate} · {/if}{item.subject_name} · {t("common.minutes", { n: item.duration_min })}
      {#if item.template_id} · {t(`templates.${item.template_id}.name`)}{/if}
    </span>
  </div>
  <div class="actions">
    <button class="btn ghost icon" title={t("calendar.edit")} aria-label={t("calendar.edit")} onclick={edit}>✏️</button>
    <button class="btn ghost icon" title={t("calendar.remove")} aria-label={t("calendar.remove")} onclick={remove}>🗑</button>
    {#if item.status === "pending"}
      <button class="btn ghost icon" title={t("calendar.done")} aria-label={t("calendar.done")} onclick={() => act(() => mark("done"))}>✓</button>
      <button class="btn ghost" onclick={() => act(() => mark("skipped"))}>{t("calendar.skip")}</button>
      <button class="btn primary" onclick={() => app.openStart(item.topic_id, item.template_id)}>▶ {t("calendar.start")}</button>
    {:else}
      <button class="btn ghost" onclick={() => act(() => mark(""))}>
        {item.status === "done" ? t("calendar.undo_done") : t("calendar.unskip")}
      </button>
    {/if}
  </div>
</div>

{#if choosing}
  {@const c = choosing}
  <Modal title={t("calendar.series_title")} onclose={() => (choosing = null)} width={420}>
    <p>{c.question}</p>
    {#snippet footer()}
      <button class="btn" onclick={() => (choosing = null)}>{t("common.cancel")}</button>
      <button class="btn" onclick={() => choose("series")}>{t("calendar.whole_series")}</button>
      <button class="btn primary" onclick={() => choose("one")}>{t("calendar.only_this")}</button>
    {/snippet}
  </Modal>
{/if}

{#if dayEdit}
  <Modal title={t("calendar.day_edit_title")} onclose={() => (dayEdit = null)} width={380}>
    <div class="row fields">
      <label class="field grow">{t("calendar.date")}<input type="date" bind:value={dayEdit.date} /></label>
      <label class="field">{t("calendar.time")}<input type="time" bind:value={dayEdit.time} /></label>
    </div>
    {#snippet footer()}
      <button class="btn" onclick={() => (dayEdit = null)}>{t("common.cancel")}</button>
      <button class="btn primary" disabled={!dayEdit?.date || !dayEdit?.time} onclick={saveDay}>{t("common.save")}</button>
    {/snippet}
  </Modal>
{/if}

{#if editing}
  <PlanDialog plan={editing} onclose={() => (editing = null)} onsaved={() => ((editing = null), app.refresh())} />
{/if}

<style>
  .item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; flex-wrap: wrap; }
  .item.draggable { cursor: grab; touch-action: none; }
  .item.done, .item.skipped { opacity: 0.65; }
  .item.skipped .name { text-decoration: line-through; }
  .info { min-width: 140px; }
  .time { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--accent); width: 44px; }
  .actions { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-left: auto; }
  .tag { font-size: 12px; padding: 0 6px; border-radius: 8px; background: var(--subtle-2); color: var(--text-2); }
  .tag.ok { color: var(--success, #13a10e); }
  .fields { gap: 12px; align-items: end; }
  .field { display: grid; gap: 4px; }
  :global(.plan-ghost) {
    position: fixed; z-index: 100; pointer-events: none; padding: 6px 10px; border-radius: var(--radius-sm);
    border-left: 4px solid; background: var(--surface, var(--bg)); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25); font-size: 13px;
  }
  :global(.drop-over) { outline: 2px dashed var(--accent); outline-offset: -2px; }
</style>
