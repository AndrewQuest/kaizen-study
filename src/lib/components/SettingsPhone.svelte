<script lang="ts">
  import { api, type PhoneChannel, type SecretKey } from "$lib/api";
  import { app, type Settings } from "$lib/app.svelte";
  import { t } from "$lib/i18n/i18n.svelte";
  import PhoneHelp from "./PhoneHelp.svelte";

  const s = $derived(app.settings);
  let secrets = $state<Record<string, boolean>>({});
  let drafts = $state<Record<SecretKey, string>>({ telegram_token: "", smtp_password: "", ntfy_token: "" });
  let testing = $state<PhoneChannel | null>(null);
  let help = $state<PhoneChannel | null>(null);

  api.secretsStatus().then((r) => (secrets = r)).catch(app.fail.bind(app));

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => app.setSetting(key, value);
  const text = (key: keyof Settings) => (e: Event) => set(key, (e.currentTarget as HTMLInputElement).value.trim() as never);

  async function saveSecret(key: SecretKey) {
    try {
      await api.setSecret(key, drafts[key]);
      drafts[key] = "";
      secrets = await api.secretsStatus();
      app.notify(t("settings.saved_secret"));
    } catch (e) {
      app.fail(e);
    }
  }

  async function test(channel: PhoneChannel) {
    testing = channel;
    try {
      await api.phoneTest(channel, t("settings.test_title"), t("settings.test_body"));
      app.notify(t("settings.test_ok"));
    } catch (e) {
      app.notify(String(e), true, 8000);
    } finally {
      testing = null;
    }
  }

  async function findChat() {
    try {
      const id = await api.telegramFindChat();
      app.settings.telegram_chat_id = id;
      app.notify(t("settings.telegram_found", { id }));
    } catch (e) {
      app.notify(String(e), true, 8000);
    }
  }
</script>

{#snippet secret(key: SecretKey, label: string)}
  <label class="field">
    <span>{label} · <span class:ok={secrets[key]}>{secrets[key] ? `✓ ${t("settings.saved_secret")}` : t("settings.not_saved")}</span></span>
    <div class="row">
      <input class="grow" type="password" autocomplete="off" bind:value={drafts[key]} placeholder="••••••••" />
      <button class="btn" disabled={!drafts[key]} onclick={() => saveSecret(key)}>{t("settings.save_secret")}</button>
    </div>
  </label>
{/snippet}

{#snippet header(key: "phone_ntfy" | "phone_telegram" | "phone_email", name: string, channel: PhoneChannel)}
  <div class="row">
    <strong>{name}</strong>
    <button class="help" onclick={() => (help = channel)}>❓ {t("settings.help")}</button>
    <span class="grow"></span>
    <button class="btn" disabled={testing !== null} onclick={() => test(channel)}>
      {testing === channel ? "…" : t("settings.test")}
    </button>
    <label class="row faint">{t("settings.channel_on")}
      <input type="checkbox" class="toggle" checked={s[key]} onchange={(e) => set(key, e.currentTarget.checked)} />
    </label>
  </div>
{/snippet}

<p class="faint hint">{t("settings.phone_hint")}</p>

<div class="card block">
  <div>{t("settings.phone_events")}</div>
  <label class="row"><input type="checkbox" checked={s.phone_ev_block} onchange={(e) => set("phone_ev_block", e.currentTarget.checked)} /> {t("settings.ev_block")}</label>
  <label class="row">
    <input type="checkbox" checked={s.phone_ev_daily} onchange={(e) => set("phone_ev_daily", e.currentTarget.checked)} />
    {t("settings.ev_daily")}
    <input type="time" class="time" value={s.daily_time} onchange={(e) => e.currentTarget.value && set("daily_time", e.currentTarget.value)} />
  </label>
  <label class="row">
    <input type="checkbox" checked={s.phone_ev_planned} onchange={(e) => set("phone_ev_planned", e.currentTarget.checked)} />
    {t("settings.ev_planned")} ·
    <select value={String(s.planned_lead_min)} onchange={(e) => set("planned_lead_min", Number(e.currentTarget.value))}>
      {#each [5, 10, 15, 30, 60] as n}<option value={String(n)}>{t("settings.lead_min", { n })}</option>{/each}
    </select>
  </label>
</div>

<div class="card block">
  {@render header("phone_ntfy", "ntfy", "ntfy")}
  <span class="faint">{t("settings.ntfy_help")}</span>
  <div class="grid2">
    <label class="field">{t("settings.ntfy_server")}<input type="text" value={s.ntfy_server} onchange={text("ntfy_server")} /></label>
    <label class="field">{t("settings.ntfy_topic")}<input type="text" value={s.ntfy_topic} onchange={text("ntfy_topic")} /></label>
  </div>
  {@render secret("ntfy_token", t("settings.ntfy_token"))}
</div>

<div class="card block">
  {@render header("phone_telegram", "Telegram", "telegram")}
  <span class="faint">{t("settings.telegram_help")}</span>
  {@render secret("telegram_token", t("settings.telegram_token"))}
  <div class="row">
    <label class="field grow">{t("settings.telegram_chat")}<input type="text" value={s.telegram_chat_id} onchange={text("telegram_chat_id")} /></label>
    <button class="btn find" disabled={!secrets.telegram_token} onclick={findChat}>{t("settings.telegram_find")}</button>
  </div>
</div>

<div class="card block">
  {@render header("phone_email", "Correo", "email")}
  <span class="faint">{t("settings.smtp_help")}</span>
  <div class="grid2">
    <label class="field">{t("settings.smtp_host")}<input type="text" value={s.smtp_host} onchange={text("smtp_host")} placeholder="smtp.gmail.com" /></label>
    <div class="row">
      <label class="field grow">{t("settings.smtp_port")}
        <input type="number" value={s.smtp_port} onchange={(e) => set("smtp_port", Number(e.currentTarget.value) || 587)} />
      </label>
      <label class="field grow">{t("settings.smtp_security")}
        <select value={s.smtp_security} onchange={(e) => set("smtp_security", e.currentTarget.value)}>
          <option value="starttls">STARTTLS (587)</option>
          <option value="tls">SSL/TLS (465)</option>
        </select>
      </label>
    </div>
    <label class="field">{t("settings.smtp_user")}<input type="text" value={s.smtp_user} onchange={text("smtp_user")} placeholder="tu@gmail.com" /></label>
    <label class="field">{t("settings.smtp_to")}<input type="text" value={s.smtp_to} onchange={text("smtp_to")} /></label>
  </div>
  {@render secret("smtp_password", t("settings.smtp_password"))}
</div>

{#if help}
  <PhoneHelp channel={help} onclose={() => (help = null)} />
{/if}

<style>
  .hint { margin-bottom: 4px; }
  .block { display: grid; gap: 10px; padding: 14px 16px; }
  .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
  .ok { color: var(--break); }
  .time { min-height: 28px; padding: 2px 8px; border-radius: var(--radius-sm); border: 1px solid var(--stroke-strong); background: var(--card); }
  .find { align-self: end; }
  label.row { cursor: default; }
  .help { border: 0; background: none; color: var(--accent); text-decoration: underline; font-size: 13px; padding: 0 4px; }
</style>
