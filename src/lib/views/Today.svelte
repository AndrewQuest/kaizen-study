<script lang="ts">
  import { api, type PlannedOccurrence, type Review, type Session, type Stats } from "$lib/api";
  import PlannedItem from "$lib/components/PlannedItem.svelte";
  import { app } from "$lib/app.svelte";
  import { clock, duration, longDate, isoDate } from "$lib/format";
  import { t } from "$lib/i18n/i18n.svelte";
  import ReviewItem from "$lib/components/ReviewItem.svelte";

  let stats = $state<Stats | null>(null);
  let reviews = $state<Review[]>([]);
  let planned = $state<PlannedOccurrence[]>([]);
  let unfinished = $state<Session | null>(null);
  let unfinishedTopic = $state("");

  const goalSecs = $derived(app.settings.daily_goal_min * 60);
  const goalPct = $derived(Math.min(100, Math.round(((stats?.today_seconds ?? 0) / Math.max(60, goalSecs)) * 100)));

  const greeting = $derived.by(() => {
    const h = new Date().getHours();
    return t(h < 12 ? "today.greeting_morning" : h < 19 ? "today.greeting_afternoon" : "today.greeting_evening");
  });

  $effect(() => {
    void app.revision;
    load();
  });

  async function load() {
    try {
      [stats, reviews, unfinished, planned] = await Promise.all([
        api.stats(7), api.dueReviews(), api.unfinishedSession(), api.plannedOccurrences(isoDate(), isoDate()),
      ]);
      if (unfinished) unfinishedTopic = (await api.getTopic(unfinished.topic_id)).name;
    } catch (e) {
      app.fail(e);
    }
  }

  async function resume() {
    try {
      app.timer = await api.resumeSession(unfinished!.id);
      app.view = "session";
    } catch (e) {
      app.fail(e);
    }
  }

  async function closeUnfinished() {
    await api.closeUnfinished(unfinished!.id).catch(app.fail.bind(app));
    app.refresh();
  }
</script>

<div class="page">
  <div class="hero">
    <div>
      <p class="muted cap">{longDate(isoDate())}</p>
      <h1>{greeting}</h1>
    </div>
    {#if app.timer}
      <button class="btn primary big" onclick={() => (app.view = "session")}>
        ▶ {t("today.continue")} · {clock(app.timer.duration ? app.timer.duration - app.timer.elapsed : app.timer.elapsed)}
      </button>
    {:else}
      <button class="btn primary big" onclick={() => app.openStart()}>▶ {t("today.start")}</button>
    {/if}
  </div>

  {#if unfinished}
    <div class="card recover">
      <div class="grow">
        <h3>{t("today.recover_title")}</h3>
        <p class="muted">{t("today.recover_body", { topic: unfinishedTopic })}</p>
      </div>
      <button class="btn" onclick={closeUnfinished}>{t("today.recover_close")}</button>
      <button class="btn primary" onclick={resume}>{t("today.recover_resume")}</button>
    </div>
  {/if}

  <div class="kpis">
    <div class="card kpi">
      <span class="muted">{t("today.studied_today")}</span>
      <strong>{duration(stats?.today_seconds ?? 0)}</strong>
      <div class="goal" title="{t('today.goal')}: {duration(goalSecs)}">
        <div class="goal-fill" class:done={goalPct >= 100} style:width="{goalPct}%"></div>
      </div>
      <span class="faint">
        {goalPct >= 100 ? `🎉 ${t("today.goal_done")}` : `${t("today.goal")}: ${duration(goalSecs)} · ${goalPct}%`}
      </span>
    </div>
    <div class="card kpi">
      <span class="muted">{t("today.streak")}</span>
      <strong>🔥 {t(stats?.streak === 1 ? "today.streak_day" : "today.streak_days", { n: stats?.streak ?? 0 })}</strong>
    </div>
    <div class="card kpi week">
      {#each stats?.daily ?? [] as d}
        <div class="day" title="{d.date}: {duration(d.seconds)}">
          <div class="fill" style:height="{Math.min(100, (d.seconds / 7200) * 100)}%"></div>
        </div>
      {/each}
    </div>
  </div>

  {#if planned.length}
    <section class="planned">
      <h2>{t("calendar.today_planned")}</h2>
      <div class="list">
        {#each planned as p (p.plan_id)}<PlannedItem item={p} />{/each}
      </div>
    </section>
  {/if}

  <section>
    <h2>{t("today.due_reviews")}</h2>
    {#if reviews.length === 0}
      <div class="card empty">✅ {t("today.no_reviews")}</div>
    {:else}
      <div class="list">
        {#each reviews as r (r.id)}
          <ReviewItem review={r} />
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
  .cap::first-letter { text-transform: uppercase; }
  .recover { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; border-color: var(--accent); }
  .kpis { display: grid; grid-template-columns: 1fr 1fr 1.4fr; gap: 12px; margin-bottom: 28px; }
  .kpi { display: grid; gap: 6px; }
  .kpi strong { font-family: var(--font-display); font-size: 26px; font-weight: 600; }
  .week { display: flex; align-items: flex-end; gap: 8px; height: 100%; min-height: 86px; }
  .day { flex: 1; height: 100%; background: var(--subtle); border-radius: 4px; display: flex; align-items: flex-end; overflow: hidden; }
  .goal { height: 6px; border-radius: 3px; background: var(--subtle-2); overflow: hidden; margin-top: 4px; }
  .goal-fill { height: 100%; background: var(--accent); border-radius: 3px; transition: width 0.4s; }
  .goal-fill.done { background: var(--break); }
  .fill { width: 100%; background: var(--accent); border-radius: 4px; min-height: 2px; }
  section { display: grid; gap: 12px; }
  .planned { margin-bottom: 24px; }
  .list { display: grid; gap: 8px; }
</style>
