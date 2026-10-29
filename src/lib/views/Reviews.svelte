<script lang="ts">
  import { api, type Exam, type PlannedOccurrence, type PlannedStudy, type Review } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import { dateLocale, isoDate, longDate } from "$lib/format";
  import { t, tList } from "$lib/i18n/i18n.svelte";
  import Heatmap from "$lib/components/Heatmap.svelte";
  import PlanDialog from "$lib/components/PlanDialog.svelte";
  import PlannedItem from "$lib/components/PlannedItem.svelte";
  import ReviewItem from "$lib/components/ReviewItem.svelte";

  let month = $state(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  let reviews = $state<Review[]>([]);
  let due = $state<Review[]>([]);
  let planned = $state<PlannedOccurrence[]>([]);
  let next7 = $state<PlannedOccurrence[]>([]);
  let next7Reviews = $state<Review[]>([]);
  let exams = $state<Exam[]>([]);
  let daily = $state<{ date: string; seconds: number }[]>([]);
  let selected = $state(isoDate());
  let editing = $state<PlannedStudy | null>(null);

  const today = isoDate();
  const addDays = (n: number) => isoDate(new Date(Date.now() + n * 86400000));
  const days = $derived.by(() => {
    // Monday-first grid covering the whole month.
    const first = new Date(month);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  });
  function group<T>(items: T[], date: (x: T) => string) {
    return items.reduce<Record<string, T[]>>((acc, x) => ((acc[date(x)] ??= []).push(x), acc), {});
  }
  const reviewsByDay = $derived(group(reviews, (r) => r.due_date));
  const plannedByDay = $derived(group(planned, (p) => p.date));
  const examsByDay = $derived(group(exams, (e) => e.exam_date));
  const weekdays = $derived(tList("reviews.weekdays"));

  $effect(() => {
    void app.revision;
    const from = isoDate(days[0]);
    const to = isoDate(days[41]);
    Promise.all([
      api.listReviews(from, to),
      api.dueReviews(),
      api.plannedOccurrences(from, to),
      api.plannedOccurrences(today, addDays(6)),
      api.listReviews(addDays(1), addDays(6)),
      api.upcomingExams(),
      api.stats(365),
    ])
      .then(([r, d, p, n7, n7r, ex, st]) => {
        [reviews, due, planned, next7, exams, daily] = [r, d, p, n7, ex, st.daily];
        next7Reviews = n7r.filter((x) => !x.done_at && x.due_date > today);
      })
      .catch(app.fail.bind(app));
  });

  const shift = (n: number) => (month = new Date(month.getFullYear(), month.getMonth() + n, 1));
  const daysUntil = (d: string) =>
    Math.round((new Date(d + "T00:00").getTime() - new Date(today + "T00:00").getTime()) / 86400000);
  const countdown = (d: string) => {
    const n = daysUntil(d);
    return n === 0 ? t("calendar.exam_today") : n === 1 ? t("calendar.exam_tomorrow") : t("calendar.exam_in", { n });
  };
  const shortDay = (d: string) => new Date(d + "T00:00").toLocaleDateString(dateLocale(), { weekday: "short", day: "numeric" });

  function newPlan(date = selected) {
    editing = {
      id: "", topic_id: "", template_id: null, start_date: date < today ? today : date,
      time: "18:00", duration_min: 60, repeat_days: "", repeat_until: null,
    };
  }

  async function edit(item: PlannedOccurrence) {
    editing = await api.getPlanned(item.plan_id);
  }

  function saved() {
    editing = null;
    app.refresh();
  }

  const nothingSelected = $derived(
    !(plannedByDay[selected]?.length || examsByDay[selected]?.length || reviewsByDay[selected]?.length || (selected === today && due.length)),
  );
</script>

<div class="page">
  <div class="page-head">
    <h1 class="grow">{t("calendar.title")}</h1>
    <button class="btn primary" onclick={() => newPlan()}>{t("calendar.plan")}</button>
  </div>
  <p class="faint explain">{t("reviews.explain")}</p>

  <div class="layout">
    <div class="col">
      <section class="card">
        <div class="row">
          <button class="btn ghost icon" onclick={() => shift(-1)} aria-label="‹">‹</button>
          <h3 class="grow center">{month.toLocaleDateString(dateLocale(), { month: "long", year: "numeric" })}</h3>
          <button class="btn ghost icon" onclick={() => shift(1)} aria-label="›">›</button>
        </div>
        <div class="grid">
          {#each weekdays as w}<span class="wd faint">{w}</span>{/each}
          {#each days as d}
            {@const key = isoDate(d)}
            <button class="day" class:other={d.getMonth() !== month.getMonth()} class:today={key === today}
              class:sel={key === selected} class:exam={!!examsByDay[key]} onclick={() => (selected = key)}
              ondblclick={() => newPlan(key)}>
              <span class="num">{d.getDate()}</span>
              <span class="marks">
                {#each (reviewsByDay[key] ?? []).slice(0, 3) as r}
                  <span class="dot" class:done={!!r.done_at} style:background={r.subject_color}></span>
                {/each}
                {#each (plannedByDay[key] ?? []).slice(0, 3) as p}
                  <span class="sq" style:background={p.subject_color}></span>
                {/each}
                {#if examsByDay[key]}<span class="exam-mark">🎓</span>{/if}
              </span>
            </button>
          {/each}
        </div>
        <div class="row legend faint">
          <span class="dot"></span>{t("calendar.review")}
          <span class="sq"></span>{t("calendar.planned")}
          <span>🎓</span>{t("calendar.exam")}
        </div>
      </section>

      <section class="card">
        <h3>{t("calendar.heatmap")}</h3>
        <Heatmap {daily} />
      </section>
    </div>

    <div class="col">
      <section class="card">
        <div class="row">
          <h3 class="grow cap">{longDate(selected)}</h3>
          <button class="btn" onclick={() => newPlan(selected)}>{t("calendar.plan")}</button>
        </div>
        {#each examsByDay[selected] ?? [] as ex (ex.topic_id)}
          <div class="exam-line">🎓 {t("calendar.exam")}: <strong>{ex.topic_name}</strong> · {ex.subject_name}</div>
        {/each}
        {#each plannedByDay[selected] ?? [] as p (p.plan_id + p.date)}
          <PlannedItem item={p} onedit={() => edit(p)} />
        {/each}
        {#if selected === today}
          {#each due as r (r.id)}<ReviewItem review={r} />{/each}
        {/if}
        {#each (reviewsByDay[selected] ?? []).filter((r) => r.done_at || selected > today) as r (r.id)}
          <ReviewItem review={r} />
        {/each}
        {#if nothingSelected}<p class="faint">{t("common.none")}</p>{/if}
      </section>

      <section class="card">
        <h3>{t("calendar.next7")}</h3>
        {#each next7 as p (p.plan_id + p.date)}
          <PlannedItem item={p} showDate={shortDay(p.date)} />
        {/each}
        {#each next7Reviews as r (r.id)}
          <div class="mini-line">
            <span class="dot" style:background={r.subject_color}></span>
            <span class="faint">{shortDay(r.due_date)}</span> {t("calendar.review")}: {r.topic_name}
          </div>
        {/each}
        {#if !next7.length && !next7Reviews.length}<p class="faint">{t("calendar.nothing")}</p>{/if}
      </section>

      <section class="card">
        <h3>🎓 {t("calendar.exams")}</h3>
        {#each exams as ex (ex.topic_id)}
          <div class="exam-row">
            <span class="dot" style:background={ex.subject_color}></span>
            <div class="grow"><strong>{ex.topic_name}</strong> <span class="faint">· {ex.subject_name} · {longDate(ex.exam_date)}</span></div>
            <span class="count" class:soon={daysUntil(ex.exam_date) <= 3}>{countdown(ex.exam_date)}</span>
          </div>
        {:else}
          <p class="faint">{t("calendar.no_exams")}</p>
        {/each}
      </section>
    </div>
  </div>
</div>

{#if editing}
  <PlanDialog plan={editing} onclose={() => (editing = null)} onsaved={saved} />
{/if}

<style>
  .explain { margin: -12px 0 16px; }
  .layout { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 16px; align-items: start; }
  .col { display: grid; gap: 16px; min-width: 0; }
  .card { display: grid; gap: 8px; }
  .card h3 { margin-bottom: 4px; }
  .center { text-align: center; }
  .center::first-letter, .cap::first-letter { text-transform: uppercase; }
  .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
  .wd { text-align: center; padding: 4px 0; }
  .day {
    min-height: 54px; display: grid; grid-template-rows: auto 1fr; justify-items: center; gap: 2px; padding: 4px 2px;
    border: 1px solid transparent; border-radius: var(--radius-sm); background: none;
  }
  .day:hover { background: var(--subtle); }
  .day.other { opacity: 0.4; }
  .day.today .num { background: var(--accent); color: var(--accent-text); border-radius: 50%; width: 24px; line-height: 24px; }
  .day.sel { border-color: var(--accent); }
  .day.exam { background: color-mix(in srgb, var(--danger) 10%, transparent); }
  .marks { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 2px; }
  .marks .dot, .legend .dot { width: 6px; height: 6px; }
  .legend .dot, .legend .sq { background: var(--text-3); }
  .marks .dot.done { opacity: 0.35; }
  .sq { width: 7px; height: 7px; border-radius: 2px; display: inline-block; }
  .exam-mark { font-size: 10px; line-height: 1; }
  .legend { gap: 6px; font-size: 12px; justify-content: center; }
  .exam-line { padding: 8px 10px; border-radius: var(--radius-sm); background: color-mix(in srgb, var(--danger) 10%, transparent); }
  .mini-line { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 2px 4px; }
  .exam-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-top: 1px solid var(--stroke); }
  .count { font-weight: 600; color: var(--text-2); white-space: nowrap; }
  .count.soon { color: var(--danger); }
</style>
