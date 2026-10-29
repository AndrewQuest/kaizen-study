<script lang="ts">
  // Step-by-step setup guide for each phone notification channel, with official links.
  import { api, type PhoneChannel } from "$lib/api";
  import { app } from "$lib/app.svelte";
  import { t, tList, tRaw } from "$lib/i18n/i18n.svelte";
  import Modal from "./Modal.svelte";

  let { channel = $bindable<PhoneChannel>("ntfy"), onclose }: { channel?: PhoneChannel; onclose: () => void } = $props();
  const CHANNELS: PhoneChannel[] = ["ntfy", "telegram", "email"];
  const links = $derived(tRaw<[string, string][]>(`phone_help.${channel}.links`) ?? []);
</script>

<Modal title={t("phone_help.title")} {onclose} width={720}>
  <div class="tabs" role="tablist">
    {#each CHANNELS as c}
      <button role="tab" aria-selected={channel === c} class:on={channel === c} onclick={() => (channel = c)}>
        {t(`phone_help.${c}.name`)}
      </button>
    {/each}
  </div>
  <p>{t(`phone_help.${channel}.intro`)}</p>
  <ol>
    {#each tList(`phone_help.${channel}.steps`) as step}<li>{step}</li>{/each}
  </ol>
  <div class="links">
    <h3>{t("phone_help.official")}</h3>
    {#each links as [label, url]}
      <button class="link" onclick={() => api.openExternal(url).catch(app.fail.bind(app))}>🔗 {label} ↗</button>
    {/each}
  </div>
</Modal>

<style>
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--stroke); }
  .tabs button {
    padding: 8px 14px; border: 0; background: none; color: var(--text-2);
    border-bottom: 3px solid transparent; margin-bottom: -1px;
  }
  .tabs button.on { color: var(--text); font-weight: 600; border-bottom-color: var(--accent); }
  ol { margin: 0; padding-left: 22px; display: grid; gap: 8px; line-height: 1.5; }
  .links { display: grid; gap: 4px; padding: 12px; border-radius: var(--radius); background: var(--accent-soft); }
  .links h3 { margin-bottom: 4px; }
  .link { justify-self: start; border: 0; background: none; color: var(--accent); text-decoration: underline; padding: 2px 0; text-align: left; }
</style>
