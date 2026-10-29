<script lang="ts">
  import { api, type Review, type ReviewResult } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import { isoDate, longDate } from "$lib/format";
  import { t } from "$lib/i18n/i18n.svelte";

  let { review }: { review: Review } = $props();
  const overdue = $derived(!review.done_at && review.due_date < isoDate());

  async function done(result: ReviewResult) {
    try {
      await api.completeReview(review.id, result);
      app.refresh();
    } catch (e) {
      app.fail(e);
    }
  }
</script>

<div class="card item">
  <span class="dot" style:background={review.subject_color}></span>
  <div class="grow">
    <div class="row">
      <strong>{review.topic_name}</strong>
      <span class="faint">{review.subject_name}</span>
      {#if overdue}<span class="chip warn">{t("reviews.overdue")} · {longDate(review.due_date)}</span>{/if}
    </div>
    <span class="faint">
      {review.kind === "examen" ? t("reviews.kind_examen") : t("reviews.kind_leitner", { n: review.step + 1 })}
    </span>
  </div>
  {#if review.done_at}
    <span class="chip">✓ {t(`reviews.${review.result ?? "done"}`)}</span>
  {:else}
    <button class="btn ghost" onclick={() => app.openStart(review.topic_id)} title={t("topic.study")}>▶</button>
    <button class="btn" onclick={() => done("dificil")}>😣 {t("reviews.dificil")}</button>
    <button class="btn" onclick={() => done("bien")}>🙂 {t("reviews.bien")}</button>
    <button class="btn" onclick={() => done("facil")}>😎 {t("reviews.facil")}</button>
  {/if}
</div>

<style>
  .item { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
  .warn { color: var(--warning); }
</style>
