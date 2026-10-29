<script lang="ts">
  import { onMount } from "svelte";
  import { app, type View } from "$lib/app.svelte";
  import { clock } from "$lib/format";
  import { t } from "$lib/i18n/i18n.svelte";
  import RateDialog from "$lib/components/RateDialog.svelte";
  import StartDialog from "$lib/components/StartDialog.svelte";
  import Notes from "$lib/views/Notes.svelte";
  import Reviews from "$lib/views/Reviews.svelte";
  import Session from "$lib/views/Session.svelte";
  import Settings from "$lib/views/Settings.svelte";
  import Setup from "$lib/views/Setup.svelte";
  import Stats from "$lib/views/Stats.svelte";
  import Subjects from "$lib/views/Subjects.svelte";
  import Today from "$lib/views/Today.svelte";

  let ready = $state(false);

  onMount(async () => {
    try {
      await app.init();
    } finally {
      ready = true;
    }
  });

  const NAV: { id: View; icon: string }[] = [
    { id: "today", icon: "🏠" },
    { id: "subjects", icon: "📚" },
    { id: "session", icon: "⏱️" },
    { id: "notes", icon: "📝" },
    { id: "reviews", icon: "🔁" },
    { id: "stats", icon: "📊" },
  ];

  // Ctrl+1…7 switches sections.
  function onkeydown(e: KeyboardEvent) {
    if (!e.ctrlKey || e.altKey || e.shiftKey) return;
    const all = [...NAV.map((n) => n.id), "settings" as View];
    const i = Number(e.key) - 1;
    if (i >= 0 && i < all.length) {
      e.preventDefault();
      app.view = all[i];
    }
  }
</script>

<svelte:window {onkeydown} />

{#if !ready}
  <div></div>
{:else if !app.info?.data_dir}
  <Setup />
{:else}
  {@const compact = app.settings.nav_compact}
  <div class="shell" class:compact class:notebook={app.view === "notes" && app.settings.notebook}>
    <nav>
      <div class="brand">
        <button class="menu-toggle" title={t(compact ? "nav.expand" : "nav.collapse")} aria-label={t(compact ? "nav.expand" : "nav.collapse")}
          onclick={() => app.setSetting("nav_compact", !compact)}>☰</button>
        {#if !compact}<span class="logo">改</span> {t("app.name")}{/if}
      </div>
      {#each NAV as n}
        <button class="nav-item" class:on={app.view === n.id} onclick={() => (app.view = n.id)}
          title={compact ? t(`nav.${n.id}`) : undefined} aria-label={t(`nav.${n.id}`)}>
          <span class="nav-icon">{n.icon}</span>
          {#if !compact}<span class="grow">{t(`nav.${n.id}`)}</span>{/if}
          {#if n.id === "session" && app.timer}
            <span class="live" class:brk={app.timer.kind === "break"}>
              {clock(app.timer.duration != null ? app.timer.duration - app.timer.elapsed : app.timer.elapsed)}
            </span>
          {/if}
        </button>
      {/each}
      <span class="grow"></span>
      <button class="nav-item" class:on={app.view === "settings"} onclick={() => (app.view = "settings")}
        title={compact ? t("nav.settings") : undefined} aria-label={t("nav.settings")}>
        <span class="nav-icon">⚙️</span>{#if !compact}<span>{t("nav.settings")}</span>{/if}
      </button>
    </nav>

    <main>
      {#if app.view === "today"}<Today />
      {:else if app.view === "subjects"}<Subjects />
      {:else if app.view === "session"}<Session />
      {:else if app.view === "notes"}<Notes />
      {:else if app.view === "reviews"}<Reviews />
      {:else if app.view === "stats"}<Stats />
      {:else}<Settings />{/if}
    </main>
  </div>

  {#if app.startOpen}<StartDialog />{/if}
  {#if app.justFinished}<RateDialog />{/if}
{/if}

{#if app.toast}
  <div class="toast" class:error={app.toast.error} role="status">{app.toast.text}</div>
{/if}

<style>
  .shell { display: grid; grid-template-columns: 220px minmax(0, 1fr); height: 100vh; transition: grid-template-columns 0.15s; }
  .shell.compact { grid-template-columns: 60px minmax(0, 1fr); }
  /* Notebook mode: only the note (the side menu comes back when leaving the mode). */
  .shell.notebook { grid-template-columns: minmax(0, 1fr); }
  .shell.notebook nav { display: none; }
  .shell.notebook main { margin-top: 0; border-radius: 0; border: 0; }
  .compact .nav-item { flex-direction: column; justify-content: center; gap: 0; height: 44px; padding: 0; }
  .compact .live { font-size: 9px; }
  .compact .brand { justify-content: center; padding: 6px 0 16px; }
  .menu-toggle {
    width: 32px; height: 32px; border: 0; border-radius: var(--radius-sm);
    background: transparent; font-size: 16px; color: var(--text-2);
  }
  .menu-toggle:hover { background: var(--subtle); }
  nav { display: flex; flex-direction: column; gap: 2px; padding: 12px 6px; }
  .brand { display: flex; align-items: center; gap: 8px; padding: 6px 4px 16px; font-weight: 600; font-family: var(--font-display); }
  .logo {
    width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center;
    background: var(--accent); color: var(--accent-text); font-size: 15px;
  }
  .nav-item {
    position: relative; display: flex; align-items: center; gap: 12px;
    height: 36px; padding: 0 10px; border: 0; border-radius: var(--radius-sm);
    background: transparent; text-align: left;
  }
  .nav-item:hover { background: var(--subtle); }
  .nav-item.on { background: var(--subtle-2); }
  .nav-item.on::before {
    content: ""; position: absolute; left: 0; top: 10px; bottom: 10px; width: 3px;
    border-radius: 2px; background: var(--accent);
  }
  .nav-icon { width: 24px; text-align: center; font-size: 18px; line-height: 1; }
  .live { font-variant-numeric: tabular-nums; font-size: 12px; color: var(--focus); font-weight: 600; }
  .live.brk { color: var(--break); }
  main {
    background: var(--layer); border-top-left-radius: var(--radius-lg);
    border: 1px solid var(--stroke); border-right: 0; border-bottom: 0;
    min-width: 0; min-height: 0; overflow: hidden; margin-top: 8px;
  }
  .toast {
    position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 100;
    padding: 10px 18px; border-radius: var(--radius); background: var(--layer-solid);
    border: 1px solid var(--stroke-strong); box-shadow: var(--shadow);
    animation: up 0.2s ease-out;
  }
  .toast.error { border-color: var(--danger); color: var(--danger); }
  @keyframes up { from { transform: translate(-50%, 10px); opacity: 0; } }
</style>
