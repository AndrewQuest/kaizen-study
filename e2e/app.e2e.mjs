// End-to-end test of the real Kaizen Study executable.
//
// It launches the release build with an isolated config/data folder, a 60x faster clock
// and WebView2 remote debugging, then drives the UI with Playwright over CDP.
//
//   npx tauri build --no-bundle   (once)
//   npm run e2e
//
// Close any running Kaizen Study first (the app is single-instance).
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "..");
const EXE = join(ROOT, "src-tauri", "target", "release", "kaizen-study.exe");
const SHOTS = join(ROOT, "e2e", "screens");
const PORT = 9333;
const WORK = join(tmpdir(), `kaizen-e2e-${Date.now()}`);
const CONFIG = join(WORK, "config");
const DATA = join(WORK, "data");

const results = [];
/** Messages received by the local ntfy mock: { auth, body }. */
const ntfyInbox = [];
const ntfy = createServer((req, res) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    try {
      ntfyInbox.push({ auth: req.headers.authorization ?? null, body: JSON.parse(data) });
    } catch {}
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
});
await new Promise((r) => ntfy.listen(0, "127.0.0.1", r));
const NTFY_URL = `http://127.0.0.1:${ntfy.address().port}`;
const waitInbox = async (pred, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (ntfyInbox.some(pred)) return true;
    await sleep(300);
  }
  return false;
};
const pageErrors = [];
let proc, browser, page;

// ---------- helpers ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Links the app asked the OS to open (see KAIZEN_OPEN_LOG). */
const opened = () => (existsSync(join(WORK, "opened.txt")) ? readFileSync(join(WORK, "opened.txt"), "utf8").split(/\r?\n/).filter(Boolean) : []);
const isoDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (n) => isoDate(new Date(Date.now() + n * 86400000));

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e?.message ?? e).split("\n")[0] });
    console.log(`  ✗ ${name}\n      ${String(e?.message ?? e).split("\n").slice(0, 3).join("\n      ")}`);
    await shot(`FAIL-${name.replace(/[^\w]+/g, "_").slice(0, 40)}`).catch(() => {});
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function shot(name, target = page) {
  await target.screenshot({ path: join(SHOTS, `${name}.png`) });
}

const invoke = (cmd, args = {}) =>
  page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);

function watch(p) {
  p.on("pageerror", (e) => {
    // Tauri injects its init scripts into every frame, including the PDF viewer iframe of
    // LaTeX documents, where its internals don't exist. Harmless and outside our code.
    const injected = /reading 'plugins'/.test(e.message) && !/\.js:/.test(e.stack ?? "");
    if (!injected) pageErrors.push(`[pageerror] ${e.stack ?? e.message}`);
  });
  p.on("console", (m) => {
    if (m.type() === "error") pageErrors.push(`[console] ${m.text()}`);
  });
}

async function launch() {
  proc = spawn(EXE, [], {
    env: {
      ...process.env,
      KAIZEN_CONFIG_DIR: CONFIG,
      KAIZEN_TIME_SCALE: "60",
      KAIZEN_TOOLS_DIR: join(WORK, "tools"),
      // Links are logged here instead of opening the real browser.
      KAIZEN_OPEN_LOG: join(WORK, "opened.txt"),
      WEBVIEW2_USER_DATA_FOLDER: join(WORK, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  proc.stderr.on("data", (d) => console.log(`      [app stderr] ${String(d).trim()}`));
  proc.on("exit", (code) => console.log(`      [app] proceso terminado (código ${code})`));
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) break;
    } catch {}
    await sleep(300);
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  browser.on("disconnected", () => console.log("      [cdp] desconectado"));
  const ctx = browser.contexts()[0];
  for (let i = 0; i < 50 && !ctx.pages().some((p) => !p.url().includes("/mini")); i++) await sleep(200);
  page = ctx.pages().find((p) => !p.url().includes("/mini"));
  watch(page);
  page.on("crash", () => console.log("      [page] el renderizador se cayó"));
  page.on("close", () => console.log("      [page] página cerrada"));
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1180, height: 760 }).catch(() => {});
}

async function kill() {
  await browser?.close().catch(() => {});
  if (proc && proc.exitCode === null) {
    try {
      execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: "ignore" });
    } catch {}
  }
  await sleep(1500);
}

/** Presses Ctrl+Alt+Shift+K at OS level (keybd_event), which is what triggers global hotkeys. */
function pressGlobalShortcut() {
  const ps = `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices;
public static class Kb { [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e); }'
$keys = 0x11, 0x12, 0x10, 0x4B
foreach ($k in $keys) { [Kb]::keybd_event($k, 0, 0, [UIntPtr]::Zero) }
[array]::Reverse($keys)
foreach ($k in $keys) { [Kb]::keybd_event($k, 0, 2, [UIntPtr]::Zero) }`;
  const encoded = Buffer.from(ps, "utf16le").toString("base64");
  execSync(`powershell -NoProfile -EncodedCommand ${encoded}`, { timeout: 20000, stdio: "ignore" });
}

/**
 * Real screen capture of the app window (unlike CDP screenshots it includes the
 * Windows Mica backdrop, which is what the user actually sees).
 */
function screenGrab(name) {
  const out = join(SHOTS, `${name}.png`);
  const ps = `
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices;
public static class Win { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
public struct RECT { public int L, T, R, B; } }'
$h = (Get-Process -Id ${proc.pid}).MainWindowHandle
[Win]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 700
$r = New-Object Win+RECT
[Win]::GetWindowRect($h, [ref]$r) | Out-Null
$bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$bmp.Save('${out.replace(/'/g, "''")}')`;
  execSync(`powershell -NoProfile -EncodedCommand ${Buffer.from(ps, "utf16le").toString("base64")}`, { timeout: 20000, stdio: "ignore" });
}

// By accessible name: works with the menu expanded or compact (icons only).
const nav = (name) => page.locator("nav").getByRole("button", { name, exact: true }).click();
const button = (name) => page.getByRole("button", { name, exact: false });
// ---------- test run ----------

async function main() {
  if (!existsSync(EXE)) throw new Error(`No existe ${EXE}. Ejecuta primero: npx tauri build --no-bundle`);
  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(CONFIG, { recursive: true });
  console.log(`Datos de prueba: ${WORK}\n`);

  await launch();

  console.log("Primer uso");
  await check("muestra la pantalla de bienvenida sin carpeta de datos", async () => {
    await page.getByText("Bienvenido a Kaizen Study").waitFor({ timeout: 10000 });
    await shot("01-setup");
  });
  await check("elige carpeta de datos y entra a la app", async () => {
    await invoke("set_data_dir", { path: DATA, mode: "open" });
    await page.reload();
    await page.locator("nav").getByText("Hoy").waitFor();
    assert(existsSync(join(DATA, "kaizen.db")), "no se creó kaizen.db");
    assert(existsSync(join(CONFIG, "config.json")), "no se guardó config.json");
    await shot("02-today-empty");
    screenGrab("02b-today-real");
  });

  await check("tema «Igual que Windows» coincide con el modo de Windows", async () => {
    const reg = execSync(
      String.raw`reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize" /v AppsUseLightTheme`,
    ).toString();
    const expected = /AppsUseLightTheme\s+REG_DWORD\s+0x0\s/.test(reg) ? "dark" : "light";
    const actual = await page.evaluate(() => document.documentElement.dataset.theme);
    assert(actual === expected, `Windows=${expected}, app=${actual}`);
  });

  console.log("Notificaciones al teléfono (servidor ntfy local de prueba)");
  await check("credencial en el Administrador de credenciales de Windows", async () => {
    await invoke("set_secret", { key: "ntfy_token", value: "token-e2e" });
    const st = await invoke("secrets_status");
    assert(st.ntfy_token === true, "no se guardó la credencial");
  });
  await check("ntfy: «Enviar prueba» llega al servidor con el token", async () => {
    for (const [key, value] of [["ntfy_server", NTFY_URL], ["ntfy_topic", "kaizen-e2e"], ["phone_ntfy", "true"], ["phone_ev_block", "true"]]) {
      await invoke("set_setting", { key, value });
    }
    await page.reload();
    await nav("Ajustes");
    await page.locator(".card", { hasText: "ntfy" }).getByRole("button", { name: "Enviar prueba" }).click();
    assert(await waitInbox((m) => m.body.title === "Kaizen Study" && m.body.topic === "kaizen-e2e", 8000), "no llegó la prueba");
    assert(ntfyInbox.at(-1).auth === "Bearer token-e2e", `auth=${ntfyInbox.at(-1).auth}`);
    await shot("v2-01-settings-phone");
  });
  await check("Telegram sin token muestra un error claro", async () => {
    const err = await invoke("phone_test", { channel: "telegram", title: "x", body: "y" }).then(() => null, (e) => String(e));
    assert(err && err.includes("token"), `error: ${err}`);
  });

  console.log("Materias y temas");
  await check("crea una materia", async () => {
    await nav("Materias");
    await page.getByTitle("Nueva materia").click();
    await page.getByLabel("Nombre").fill("Matemáticas");
    await page.locator(".emoji", { hasText: "🧮" }).click();
    await button("Guardar").click();
    await page.locator(".subject", { hasText: "Matemáticas" }).waitFor();
  });
  await check("crea dos temas seguidos sin salir de la lista", async () => {
    const input = page.getByPlaceholder("Nombre del tema");
    await input.fill("Derivadas");
    await input.press("Enter");
    await page.locator(".topic", { hasText: "Derivadas" }).waitFor();
    await input.fill("Integrales");
    await input.press("Enter");
    await page.locator(".topic", { hasText: "Integrales" }).waitFor();
    await shot("03-subjects");
  });
  await check("configura el tema: método Leitner y fecha de examen", async () => {
    await page.locator(".topic .open", { hasText: "Derivadas" }).click();
    await page.locator("label.field", { hasText: /^Método/ }).locator("select").selectOption("leitner");
    await page.getByLabel("Fecha de examen").fill(addDays(10));
    await page.getByLabel("Fecha de examen").dispatchEvent("change");
    await sleep(400);
    const reviews = await invoke("list_reviews", { from: isoDate(), to: addDays(40) });
    const exam = reviews.filter((r) => r.kind === "examen").map((r) => r.due_date).sort();
    assert(JSON.stringify(exam) === JSON.stringify([addDays(3), addDays(7), addDays(8), addDays(9)]), `repasos 7-3-2-1: ${exam}`);
    await shot("04-topic");
  });

  console.log("Sesión de estudio");
  await check("inicia una sesión desde el tema con el método preseleccionado", async () => {
    await page.locator(".page-head").getByRole("button", { name: /Estudiar/ }).click();
    await page.locator(".tpl.on", { hasText: "Recuerdo activo" }).waitFor();
    await shot("05-start-method");
    await button("Siguiente").click();
    await page.getByText("Cómo funciona").waitFor();
    // Plan: break 1 = café, break 2 = caminar (default order of "add").
    await button("+ Añadir descanso").click();
    await button("+ Añadir descanso").click();
    await page.locator(".breaks select").nth(1).selectOption("caminar");
    await shot("06-start-explain");
    await button("Comenzar").click();
    await page.locator(".session .time").waitFor();
    const time = await page.locator(".session .time").textContent();
    assert(/^2[45]:\d\d$/.test(time.trim()), `tiempo inicial inesperado: ${time}`);
  });
  await check("notas rápidas: el Markdown se aplica al salir de la línea", async () => {
    await page.locator(".notes-pane .cm-content").click();
    await page.keyboard.type("# Regla de la cadena\nLa **derivada** de `f(g(x))` es *f'(g(x))·g'(x)*.\n\n```js\nconst d = (f, g) => (x) => f(g(x));\n```\n", { delay: 5 });
    await page.locator(".timer-pane .who").click(); // leave the editor
    await sleep(300);
    for (const sel of [".cm-md-h1", ".cm-md-strong", ".cm-md-code", ".cm-md-em", ".cm-md-fence", ".cm-md-codeline"]) {
      assert((await page.locator(`.notes-pane ${sel}`).count()) > 0, `falta ${sel}`);
    }
    const raw = await page.locator(".notes-pane .cm-content").innerText();
    assert(!raw.includes("**") && !raw.includes("# Regla"), "las marcas de Markdown siguen visibles sin foco");
    await shot("07-session-notes");
  });
  await check("las notas rápidas se guardan solas", async () => {
    await sleep(1200);
    const topicId = (await invoke("timer_state")).topic_id;
    const sessions = await invoke("list_sessions", { topicId });
    assert(sessions[0].notes_md.includes("Regla de la cadena"), "notas no guardadas");
  });
  await check("termina el bloque de enfoque y pasa a descanso (reloj x60)", async () => {
    await page.locator(".session .kind", { hasText: "Descanso" }).waitFor({ timeout: 45000 });
    await page.locator(".break-card", { hasText: "Café o té" }).waitFor();
    assert((await page.locator(".break-card").innerText()).includes("Cómo descansar bien"), "falta la guía del método");
    await shot("08-session-break");
    await invoke("set_setting", { key: "notifications", value: "false" });
  });
  await check("fin de bloque llega al teléfono (ntfy) con la actividad del descanso", async () => {
    assert(await waitInbox((m) => /Buen trabajo/.test(m.body.title) && /Café/.test(m.body.message), 8000),
      JSON.stringify(ntfyInbox.map((m) => m.body.title)));
  });
  await check("reloj contraído en barra compacta y expandido de nuevo", async () => {
    await button("⬆ Contraer reloj").click();
    await page.locator(".session .bar .bar-time").waitFor();
    const notesWidth = await page.locator(".notes-pane").evaluate((el) => el.getBoundingClientRect().width);
    assert(notesWidth > 800, `notas sólo miden ${notesWidth}px`);
    await shot("v2-02-session-compact");
    await button("⬇ Expandir reloj").click();
    await page.locator(".session .ring").waitFor();
  });
  await check("pausar detiene el reloj y reanudar lo continúa", async () => {
    await button("Pausar").click();
    await page.locator(".session .kind", { hasText: "En pausa" }).waitFor();
    const a = await page.locator(".session .time").textContent();
    await sleep(1500);
    const b = await page.locator(".session .time").textContent();
    assert(a === b, `el reloj avanzó en pausa: ${a} → ${b}`);
    await button("Reanudar").click();
    await page.locator(".session .kind", { hasText: "Descanso" }).waitFor();
  });
  await check("mini ventana flotante se abre y se cierra con su botón ✕", async () => {
    const ctx = browser.contexts()[0];
    const opened = ctx.waitForEvent("page", { timeout: 10000 });
    opened.catch(() => {});
    await page.getByTitle("Mini ventana").click();
    const mini = await opened;
    watch(mini);
    await mini.locator(".time").waitFor();
    await sleep(500);
    await shot("09-mini", mini);
    const closed = mini.waitForEvent("close", { timeout: 5000 });
    await mini.getByTitle("Cerrar").click();
    await closed;
  });
  await check("saltar bloque vuelve a enfoque", async () => {
    await button("Saltar bloque").click();
    await page.locator(".session .kind", { hasText: "Enfoque" }).waitFor();
  });
  await check("atajo global Ctrl+Alt+Shift+K pausa (teclado real del sistema)", async () => {
    // If another Kaizen Study (e.g. the user's own) holds the shortcut, pressing it would act on
    // that app instead: skip, and say so.
    if ((await invoke("app_info")).shortcut_error) {
      console.log("      (omitida: otro Kaizen Study abierto ya usa el atajo)");
      return;
    }
    pressGlobalShortcut();
    await page.locator(".session .kind", { hasText: "En pausa" }).waitFor({ timeout: 4000 });
    await invoke("timer_toggle_pause");
  });
  await check("terminar pide valoración y la guarda", async () => {
    await button("Terminar").click();
    await page.getByText("¡Sesión terminada!").waitFor();
    await shot("10-rate");
    await page.getByRole("button", { name: "4", exact: true }).click();
    await page.locator(".footer").getByRole("button", { name: "Guardar" }).click();
    await page.getByText("Estudiado hoy").waitFor();
    const topicId = (await invoke("list_topics", { subjectId: (await invoke("list_subjects", { includeArchived: false }))[0].id }))
      .find((t) => t.name === "Derivadas").id;
    const s = (await invoke("list_sessions", { topicId }))[0];
    assert(s.rating === 4 && s.ended_at, `sesión: rating=${s.rating} ended=${s.ended_at}`);
    assert(s.focus_seconds >= 25 * 60, `focus_seconds=${s.focus_seconds}`);
    const reviews = await invoke("list_reviews", { from: isoDate(), to: addDays(2) });
    assert(reviews.some((r) => r.kind === "leitner" && r.due_date === addDays(1)), "no se programó el repaso de mañana");
    await shot("11-today-after");
  });

  console.log("Notas");
  await check("notas rápidas: aparecen en su subsección y se pasan a nota", async () => {
    await nav("Notas");
    await page.locator(".quick-item").first().click();
    await page.locator("main .quick-view", { hasText: "Regla de la cadena" }).waitFor();
    await shot("v2-03-quick-note");
    await button("Pasar a nota").click();
    await page.locator(".footer").getByRole("button", { name: "Pasar a nota" }).click();
    await page.locator(".note", { hasText: "Notas de la sesión" }).waitFor();
    await page.locator(".quick-item .moved").first().waitFor();
    const [hit] = await invoke("search_notes", { query: "Regla de la cadena" });
    assert(hit?.title.startsWith("Notas de la sesión"), "no se creó la nota");
    const quickHits = await invoke("search_quick_notes", { query: "Regla de la cadena" });
    assert(quickHits.length === 1 && quickHits[0].notes_moved, "la nota rápida no se conservó marcada");
  });
  await check("notas rápidas: selección múltiple y borrado (se conserva el tiempo)", async () => {
    await page.locator(".section").getByRole("button", { name: "Seleccionar" }).click();
    await page.locator(".quick-row input[type=checkbox]").first().check();
    await page.getByRole("button", { name: "Borrar seleccionadas (1)" }).waitFor();
    await shot("v3-01-quick-select");
    await page.locator(".section").getByRole("button", { name: "Listo" }).click();
    assert((await page.locator(".quick-row .trash").count()) >= 1, "falta el botón 🗑");
    // The confirmation is a native Windows dialog: run the same command it triggers.
    const topicId = (await invoke("search_quick_notes", { query: "Regla de la cadena" }))[0].topic_id;
    const before = await invoke("list_sessions", { topicId });
    await invoke("clear_quick_notes", { ids: before.filter((x) => x.notes_md).map((x) => x.id) });
    assert((await invoke("list_quick_notes", { topicId })).length === 0, "siguen las notas rápidas");
    const after = await invoke("list_sessions", { topicId });
    assert(after.reduce((a, x) => a + x.focus_seconds, 0) === before.reduce((a, x) => a + x.focus_seconds, 0),
      "se perdió tiempo de estudio");
  });
  await check("el método creó la nota con formato de preguntas", async () => {
    await page.locator(".note", { hasText: "Derivadas" }).click();
    await sleep(300);
    const text = await page.locator("main .cm-content").innerText();
    assert(text.includes("Preguntas para repasar"), "falta la plantilla de preguntas");
  });
  await check("modo lectura: la nota guardada se abre bloqueada y no se edita por accidente", async () => {
    await page.locator("main .lock.on").waitFor();
    const before = await page.locator("main .cm-content").innerText();
    await page.locator("main .cm-content").click();
    await page.keyboard.type("zzz");
    await sleep(300);
    assert((await page.locator("main .cm-content").innerText()) === before, "se pudo escribir con la nota bloqueada");
    assert(await page.locator("main .toolbar .tool").first().isDisabled(), "la barra sigue activa en lectura");
    await shot("v32-01-reading-mode");
  });
  await check("modo lectura: doble clic desbloquea con el cursor en ese punto", async () => {
    await page.locator("main .cm-md-h2, main .cm-md-h1").first().dblclick();
    await page.locator("main .lock:not(.on)").waitFor();
    await page.keyboard.type("Z");
    await sleep(200);
    const text = await page.locator("main .cm-content").innerText();
    assert(text.includes("Z"), "no se pudo escribir tras el doble clic");
    await page.keyboard.press("Backspace");
  });
  await check("editor híbrido: todos los elementos se renderizan", async () => {
    await page.locator("main .cm-content").click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
    const doc = [
      "# Apuntes de derivadas",
      "## Reglas básicas",
      "Texto con **negrita**, *cursiva*, ~~tachado~~ y `codigo()`.",
      "",
      "- Primera idea",
      "- Segunda idea",
      "",
      "1. Paso uno",
      "2. Paso dos",
      "",
      "- [ ] Tarea pendiente",
      "- [x] Tarea hecha",
      "",
      "> **Definición:** cambio instantáneo.",
      "",
      "Fuente: [Khan Academy](https://es.khanacademy.org)",
      "",
      "| Función | Derivada |",
      "| --- | --- |",
      "| x^2 | 2x |",
      "",
      "---",
      "",
      "```python",
      "def derivada(f, x, h=1e-6):",
      "    # aproximación numérica",
      '    return (f(x + h) - f(x)) / h',
      "```",
      "",
    ].join("\n");
    // insertText avoids the list auto-continuation of typing Enter.
    await page.keyboard.insertText(doc);
    await page.locator("main .title").click();
    await sleep(600);
    for (const sel of [".cm-md-h1", ".cm-md-h2", ".cm-md-strong", ".cm-md-em", ".cm-md-strike", ".cm-md-code", ".cm-md-bullet", ".cm-md-listmark", ".cm-md-checkbox", ".cm-md-task-done", ".cm-md-quote", ".cm-md-link", ".cm-md-table table", ".cm-md-hr", ".cm-md-fence", ".cm-md-codeline"]) {
      assert((await page.locator(`main ${sel}`).count()) > 0, `no se renderizó ${sel}`);
    }
    await shot("12-notes-rendered");
  });
  await check("iconos de la barra con tamaño legible", async () => {
    const h = await page.locator("main .toolbar .tool").first().evaluate((el) => el.getBoundingClientRect().height);
    assert(h >= 36, `alto de los botones: ${h}px`);
  });
  await check("vista dividida: Markdown a la izquierda y vista previa a la derecha", async () => {
    await page.locator("main .tool.view-mode").click();
    await page.locator("main .preview h1", { hasText: "Apuntes de derivadas" }).waitFor();
    await page.locator("main .preview .code-block .tok-keyword").first().waitFor();
    await page.locator("main .preview table").waitFor();
    const raw = await page.locator("main .cm-content").innerText();
    assert(raw.includes("# Apuntes") && raw.includes("**negrita**"), "el lado izquierdo no muestra Markdown sin formato");
    await shot("v3-02-split-view");
    await page.locator("main .tool.view-mode").click();
    await page.locator("main .preview").waitFor({ state: "detached" });
  });
  await check("bloque ```latex se muestra como fórmula (KaTeX)", async () => {
    await page.locator("main .cm-content").click();
    await page.keyboard.press("Control+End");
    await page.getByTitle("Bloque de fórmula LaTeX (∑)").click();
    await page.keyboard.insertText("x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}");
    await page.locator("main .title").click();
    await page.locator("main .cm-md-latex .katex").waitFor();
    await shot("v3-03-latex-block");
  });
  await check("pegar un enlace: [](dirección) con el cursor listo para el título", async () => {
    const paste = (u) =>
      page.locator("main .cm-content").evaluate((el, url) => {
        const dt = new DataTransfer();
        dt.setData("text/plain", url);
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      }, u);
    await page.locator("main .cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\nVideo: ");
    await paste("https://www.youtube.com/watch?v=abc123");
    await page.keyboard.insertText("Regla de la cadena explicada");
    // Selected text + paste = that text becomes the link. (Ctrl+End: the long URL wraps, so
    // plain End would only reach the end of the visual line.)
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText(" y Wikipedia");
    for (let i = 0; i < "Wikipedia".length; i++) await page.keyboard.press("Shift+ArrowLeft");
    await paste("https://es.wikipedia.org/wiki/Derivada_(matemática)");
    await page.locator("main .title").click();
    await sleep(900);
    const [hit] = await invoke("search_notes", { query: "Regla de la cadena explicada" });
    assert(hit?.body_md.includes("[Regla de la cadena explicada](https://www.youtube.com/watch?v=abc123)"), "enlace sin título");
    assert(hit.body_md.includes("[Wikipedia](https://es.wikipedia.org/wiki/Derivada_%28matemática%29)"), "la selección no se convirtió en enlace");
    assert(await page.locator("main .cm-md-link[title='Ctrl + clic para abrir']").count() > 0, "falta la indicación Ctrl + clic");
  });
  await check("pegar una imagen la copia a «adjuntos» y se ve en la nota", async () => {
    await page.locator("main .cm-content").click();
    await page.keyboard.press("Control+End");
    // 2x2 red PNG
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP8z8DwnwEJMDIwMDAwAAA5+gH/1cS8JQAAAABJRU5ErkJggg==";
    await page.locator("main .cm-content").evaluate((el, b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "image.png", { type: "image/png" }));
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, png);
    await page.waitForFunction(() => document.querySelector("main .cm-md-embed img"), null, { timeout: 8000 });
    await page.locator("main .title").click();
    const img = page.locator("main .cm-md-embed img").first();
    await img.waitFor();
    await page.waitForFunction(() => {
      const i = document.querySelector("main .cm-md-embed img");
      return i && i.complete && i.naturalWidth === 2;
    }, null, { timeout: 8000 });
    assert(existsSync(join(DATA, "adjuntos", "image.png")), "no se copió a adjuntos");
    await shot("v3-04-image");
  });
  await check("bloque de código con colores tipo VS Code (Python)", async () => {
    // Wait for the lazily loaded Python grammar, then check token colours differ.
    await page.waitForFunction(() => {
      const spans = [...document.querySelectorAll("main .cm-md-codeline span")];
      return new Set(spans.map((s) => getComputedStyle(s).color)).size >= 3;
    }, null, { timeout: 8000 });
  });
  await check("al poner el cursor en una línea se ve el Markdown original", async () => {
    await page.locator("main .cm-md-h1").click();
    await sleep(200);
    const line = await page.locator("main .cm-md-h1").innerText();
    assert(line.startsWith("# "), `línea activa: ${line}`);
  });
  await check("clic en la casilla marca la tarea (también en modo lectura)", async () => {
    await page.locator("main .lock").click(); // lock: reading mode
    await page.locator("main .lock.on").waitFor();
    await sleep(200);
    await page.locator("main .cm-md-checkbox").first().click();
    await sleep(300);
    await page.locator("main .title").click();
    await sleep(900);
    const [hit] = await invoke("search_notes", { query: "Tarea pendiente" });
    assert(hit?.body_md.includes("- [x] Tarea pendiente"), "la casilla no cambió el texto");
    await page.locator("main .lock").click(); // back to editing for the next tests
    await page.locator("main .lock:not(.on)").waitFor();
  });
  await check("barra de formato: negrita sobre la selección", async () => {
    await page.locator("main .cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("palabra");
    await page.keyboard.press("Shift+Home");
    await page.getByTitle("Negrita (Ctrl+B)").click();
    await page.locator("main .title").click();
    await sleep(900);
    const hit = await invoke("search_notes", { query: "**palabra**" });
    assert(hit.length === 1, "no se aplicó la negrita");
  });
  await check("menú { } inserta un bloque de código del lenguaje elegido", async () => {
    await page.locator("main .cm-content").click();
    await page.keyboard.press("Control+End");
    await page.getByTitle("Bloque de código (Ctrl+Shift+E)").click();
    await page.locator(".menu button", { hasText: "Rust" }).click();
    await page.keyboard.insertText('fn main() { println!("hola"); }');
    await page.locator("main .title").click();
    await sleep(900);
    const hit = await invoke("search_notes", { query: "```rust\nfn main()" });
    assert(hit.length === 1, "no se insertó el bloque rust");
  });
  await check("guía de Markdown: navegar, ver ejemplo e insertarlo", async () => {
    await button("Guía de Markdown").click();
    await page.getByText("¿Qué es Markdown?").first().waitFor();
    await shot("13-guide-intro");
    await page.locator(".guide nav button", { hasText: "Bloques de código" }).click();
    await page.locator(".guide .result .cm-md-fence").waitFor();
    await shot("14-guide-code");
    await page.locator(".guide nav button", { hasText: "Tablas" }).click();
    await page.locator(".guide .result .cm-md-table table").waitFor();
    await page.locator(".guide nav button", { hasText: "Atajos de teclado" }).click();
    await page.getByText("Ctrl + Shift + E").waitFor();
    await page.locator(".guide nav button", { hasText: "Listas de tareas" }).click();
    await button("Insertar en mi nota").click();
    await sleep(900);
    const hit = await invoke("search_notes", { query: "Hacer los ejercicios 1 a 10" });
    assert(hit.length === 1, "no se insertó el ejemplo");
    // The cursor was inside the Rust block: the example must land after it, not inside.
    assert(/```rust\nfn main\(\) \{ println!\("hola"\); \}\n```\n[\s\S]*- \[x\] Repasar vocabulario/.test(hit[0].body_md),
      "el ejemplo quedó dentro del bloque de código");
  });
  await check("ortografía: subraya errores en español, acepta inglés y corrige con clic derecho", async () => {
    await page.locator("main .cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\nUna palabra mal escrita: ortografico, otra en inglés: because. Y una inventada: Kaizenazo.\n");
    await page.locator("main .title").click();
    const bad = page.locator("main .cm-misspelled");
    await bad.filter({ hasText: "ortografico" }).waitFor({ timeout: 8000 });
    const flagged = await bad.allInnerTexts();
    assert(!flagged.includes("because") && !flagged.includes("palabra"), `marcadas: ${flagged}`);
    await bad.filter({ hasText: "ortografico" }).click({ button: "right" });
    await page.locator(".spell-menu .suggestion", { hasText: "ortográfico" }).waitFor();
    await shot("v2-04-spell-menu");
    await page.locator(".spell-menu .suggestion", { hasText: /^ortográfico$/ }).click();
    await bad.filter({ hasText: "Kaizenazo" }).click({ button: "right" });
    await page.locator(".spell-menu .spell-item", { hasText: "Añadir al diccionario" }).click();
    await page.locator("main .title").click();
    await sleep(1500);
    const after = await bad.allInnerTexts();
    assert(!after.includes("Kaizenazo") && !after.includes("ortografico"), `siguen marcadas: ${after}`);
    const [hit] = await invoke("search_notes", { query: "mal escrita: ortográfico" });
    assert(hit, "la corrección no se aplicó al texto");
    assert((await invoke("dictionary_words")).includes("Kaizenazo"), "no está en el diccionario personal");
  });
  await check("nueva nota con formato Cornell", async () => {
    await button("Nueva nota").click();
    await page.locator("main .title").fill("Resumen tema 1");
    await page.locator("main .head select").selectOption("cornell");
    await sleep(900);
    const hit = await invoke("search_notes", { query: "Pistas / Preguntas" });
    assert(hit.some((h) => h.title === "Resumen tema 1"), "plantilla Cornell no aplicada");
    assert((await page.locator(".note", { hasText: "Resumen tema 1" }).count()) === 1, "la lista no muestra el nuevo título");
  });
  await check("nota en formato «Fórmulas LaTeX»", async () => {
    await button("Nueva nota").click();
    await page.locator("main .title").fill("Fórmulas");
    await page.locator("main .head select").selectOption("latex");
    await page.locator("main .latex .cm-content").click();
    await page.keyboard.insertText("E = mc^2\n\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}");
    await page.locator(".formula .katex").nth(1).waitFor();
    await shot("v3-05-latex-formulas");
  });
  const DOC = String.raw`\documentclass{article}
\begin{document}
Hola desde Kaizen Study: $E=mc^2$
\end{document}
`;
  await check("documento LaTeX: descarga el compilador, compila a PDF y exporta", async () => {
    await page.locator("main .head select").selectOption("latexdoc");
    await page.locator("main .latex .cm-content").click();
    await page.keyboard.press("Control+a");
    await page.keyboard.insertText(DOC);
    await page.getByRole("button", { name: "Descargar compilador" }).click();
    // Tectonic (~30 MB) + LaTeX packages on the first compilation: needs internet.
    await page.locator("main .latex iframe").waitFor({ timeout: 300000 });
    await page.locator(".status", { hasText: "Compilado" }).waitFor({ timeout: 120000 });
    await shot("v3-06-latex-document");
    await sleep(1500); // let the PDF viewer paint
    screenGrab("v3-06b-latex-document-real");
    const note = (await invoke("search_notes", { query: "Hola desde Kaizen Study" }))[0];
    const dest = join(WORK, "doc.pdf");
    await invoke("latex_export", { noteId: note.id, dest });
    assert(statSync(dest).size > 1000, "PDF vacío");
  });
  await check("búsqueda global abre la nota exacta", async () => {
    await page.getByPlaceholder("Buscar en todas las notas…").fill("derivada(f");
    await page.locator(".hit").first().click();
    await sleep(500);
    const title = await page.locator("main .title").inputValue();
    assert(title === "Derivadas", `abrió: ${title}`);
  });

  console.log("Enlaces: siempre en el navegador, nunca dentro de la app");
  await check("modo lectura: clic en enlaces con título, sin título, <…> y dentro de tablas", async () => {
    const topicId = (await invoke("search_notes", { query: "Regla de la cadena explicada" }))[0].topic_id;
    const body = [
      "Titulado: [Ejemplo con título](https://example.com/titulado)",
      "",
      "Desnudo: https://example.com/desnudo",
      "",
      "Angular: <https://example.com/angular>",
      "",
      "| Tabla | Enlace |",
      "| --- | --- |",
      "| a | [en tabla](https://example.com/tabla) |",
      "",
      "Palabra mal escrita: ortografico.",
      "",
    ].join("\n");
    await invoke("save_note", { note: { id: "", topic_id: topicId, title: "Enlaces", body_md: body, layout: "libre", updated_at: "" } });
    await nav("Hoy");
    await nav("Notas");
    await page.locator(".note", { hasText: "Enlaces" }).first().click();
    await page.locator("main .lock.on").waitFor();
    const before = opened().length;
    const click = async (locator) => {
      const box = await locator.first().boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(600);
    };
    await click(page.locator("main .cm-md-link", { hasText: "Ejemplo con título" }));
    await click(page.locator("main .cm-md-link", { hasText: "example.com/desnudo" }));
    await click(page.locator("main .cm-md-link", { hasText: "example.com/angular" }));
    await click(page.locator("main .cm-md-table a"));
    const got = opened().slice(before);
    assert(
      JSON.stringify(got) === JSON.stringify(["https://example.com/titulado", "https://example.com/desnudo", "https://example.com/angular", "https://example.com/tabla"]),
      `abiertos: ${JSON.stringify(got)}`,
    );
    assert(page.url().startsWith("http://tauri.localhost"), `la app navegó a ${page.url()}`);
    assert((await page.locator("main .cm-misspelled").count()) === 0, "en lectura no debe subrayar ortografía");
    await shot("v33-01-links-reading");
  });
  await check("editando: clic normal no abre el enlace, Ctrl + clic sí", async () => {
    await page.locator("main .lock").click();
    await page.locator("main .lock:not(.on)").waitFor();
    const before = opened().length;
    const link = page.locator("main .cm-md-link", { hasText: "example.com/desnudo" }).first();
    const box = await link.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(500);
    assert(opened().length === before, "un clic normal en edición abrió el enlace");
    const box2 = await link.boundingBox();
    await page.keyboard.down("Control");
    await page.mouse.click(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.keyboard.up("Control");
    await sleep(500);
    assert(opened().at(-1) === "https://example.com/desnudo", `abiertos: ${opened().slice(before)}`);
    // The table (rendered HTML) also needs Ctrl while editing, and never navigates the app.
    await page.locator("main .title").click();
    const n = opened().length;
    await page.locator("main .cm-md-table a").first().click();
    await sleep(500);
    assert(opened().length === n && page.url().startsWith("http://tauri.localhost"), "el enlace de la tabla se abrió o navegó");
  });
  await check("vista dividida: clic en enlace de la vista previa abre el navegador", async () => {
    await page.locator("main .tool.view-mode").click();
    await page.locator("main .preview a", { hasText: "Ejemplo con título" }).click();
    await sleep(500);
    assert(opened().at(-1) === "https://example.com/titulado", `abiertos: ${opened().slice(-2)}`);
    assert(page.url().startsWith("http://tauri.localhost"), "la app navegó");
    await page.locator("main .tool.view-mode").click();
  });
  await check("si algo intenta navegar fuera, la app lo bloquea y abre el navegador", async () => {
    const n = opened().length;
    await page.evaluate(() => { location.href = "https://example.com/forzado"; });
    await sleep(1500);
    assert(page.url().startsWith("http://tauri.localhost"), `la app navegó a ${page.url()}`);
    assert(opened().slice(n).includes("https://example.com/forzado"), `abiertos: ${opened().slice(n)}`);
  });

  console.log("Repasos y estadísticas");
  await check("calendario de repasos muestra los repasos programados", async () => {
    await nav("Calendario");
    await page.locator(".day .dot").first().waitFor();
    await shot("15-reviews");
  });
  await check("planificar estudio semanal y verlo en calendario, próximos 7 días y Hoy", async () => {
    await invoke("set_setting", { key: "phone_ev_planned", value: "true" });
    const soon = new Date(Date.now() + 10 * 60000);
    const hhmm = `${String(soon.getHours()).padStart(2, "0")}:${String(soon.getMinutes()).padStart(2, "0")}`;
    await button("+ Planificar estudio").first().click();
    await page.locator(".dialog").getByLabel("Hora").fill(hhmm);
    await page.locator(".dialog").getByLabel("Duración (min)").fill("45");
    await page.locator(".dialog").getByText("Repetir cada semana").click();
    const weekday = String(((new Date().getDay() + 6) % 7) + 1);
    await page.locator(".dialog .day").nth(Number(weekday) - 1).click();
    await shot("v2-05-plan-dialog");
    await page.locator(".dialog .footer").getByRole("button", { name: "Guardar" }).click();
    await page.locator(".layout .sq").first().waitFor();
    const occ = await invoke("planned_occurrences", { from: isoDate(), to: addDays(14) });
    assert(occ.length === 2 || occ.length === 3, `ocurrencias: ${occ.length}`);
    assert(occ.every((o) => o.repeats && o.time === hhmm), "repetición o hora incorrecta");
    await page.locator(".card", { hasText: "Próximos 7 días" }).getByText("Derivadas").first().waitFor();
    await page.locator(".card", { hasText: "Exámenes" }).getByText(/en \d+ días/).first().waitFor();
    assert((await page.locator(".heat rect").count()) >= 365, "mapa de constancia incompleto");
    await shot("v2-06-calendar");
    await nav("Hoy");
    await page.getByText("Planificado para hoy").waitFor();
    await shot("v2-07-today-planned");
  });
  await check("recordatorio de estudio planificado llega al teléfono (planificador cada 30 s)", async () => {
    assert(await waitInbox((m) => m.body.title === "Estudio planificado" && /Derivadas/.test(m.body.message), 45000),
      JSON.stringify(ntfyInbox.map((m) => m.body.title)));
  });
  await check("▶ en un estudio planificado abre la sesión con su tema", async () => {
    await page.locator(".planned").getByRole("button", { name: /Empezar/ }).click();
    await page.locator(".tpl.on").waitFor();
    await page.locator(".dialog").getByRole("button", { name: "Volver" }).click();
    await page.locator(".pick.on", { hasText: "Derivadas" }).waitFor();
    await page.keyboard.press("Escape");
  });
  await check("estadísticas muestran el tiempo estudiado", async () => {
    await nav("Estadísticas");
    await page.locator(".bar:not(.zero)").first().waitFor();
    await page.locator("select").selectOption("90");
    await sleep(300);
    assert((await page.locator("svg text.axis").count()) >= 8, "faltan etiquetas de fecha en 90 días");
    await shot("16-stats");
  });

  console.log("Temporizador personalizado y recuperación");
  await check("temporizador personalizado (antes fallaba: enviaba texto)", async () => {
    await nav("Hoy");
    await button("Iniciar sesión de estudio").click();
    await page.locator(".pick", { hasText: "Integrales" }).click();
    await button("Siguiente").click();
    await page.locator(".tpl", { hasText: "Temporizador personalizado" }).click();
    await button("Siguiente").click();
    await page.getByLabel("Enfoque (min)").fill("3");
    await page.getByLabel("Descanso (min)").fill("1");
    await button("Comenzar").click();
    await page.locator(".session .time").waitFor();
    const time = (await page.locator(".session .time").textContent()).trim();
    assert(/^0[23]:\d\d$/.test(time), `tiempo: ${time}`);
  });
  await check("no se puede borrar el tema (ni su materia) con una sesión en curso", async () => {
    const st = await invoke("timer_state");
    const topic = await invoke("get_topic", { id: st.topic_id });
    const err1 = await invoke("delete_topic", { id: topic.id }).then(() => null, String);
    const err2 = await invoke("delete_subject", { id: topic.subject_id }).then(() => null, String);
    assert(err1?.includes("sesión en curso") && err2?.includes("sesión en curso"), `errores: ${err1} / ${err2}`);
    assert((await invoke("get_topic", { id: topic.id })).name === "Integrales", "el tema se borró");
  });
  await check("cerrar la ventana con sesión activa la manda a la bandeja", async () => {
    await invoke("plugin:window|close", { label: "main" }).catch(() => {});
    await sleep(800);
    assert(proc.exitCode === null, "la app se cerró");
    const visible = await invoke("plugin:window|is_visible", { label: "main" });
    assert(visible === false, "la ventana sigue visible");
    await invoke("show_main");
  });
  await check("si la app se cierra de golpe, ofrece recuperar la sesión", async () => {
    await sleep(16000); // let the totals be persisted (every 15 s)
    await kill();
    await launch();
    await page.getByText("Tienes una sesión sin terminar").waitFor({ timeout: 10000 });
    await shot("17-recover");
    await button("Continuar").click();
    await page.locator(".session .who", { hasText: "Integrales" }).waitFor();
    const st = await invoke("timer_state");
    assert(st.focus_total >= 60, `tiempo recuperado: ${st.focus_total}s`);
    await button("Terminar").click();
    await button("Omitir").click();
  });

  console.log("Ajustes, respaldo y tema oscuro");
  await check("actividad personalizada solo para una sesión desde «Nueva sesión»", async () => {
    const n = (await invoke("list_activities")).length;
    await nav("Hoy");
    await button("Iniciar sesión de estudio").click();
    await button("Siguiente").click();
    await button("Siguiente").click();
    await button("+ Actividad personalizada").click();
    const emojiBox = await page.locator(".custom").getByLabel("Emoji").boundingBox();
    const nameBox = await page.locator(".custom").getByLabel("Nombre").boundingBox();
    assert(emojiBox.x + emojiBox.width <= nameBox.x, `el campo Emoji (${emojiBox.width}px) tapa el campo Nombre`);
    await page.locator(".custom").getByLabel("Nombre").fill("Bailar una canción");
    await page.locator(".custom").getByText("Guardar en mis actividades").click();
    await page.locator(".custom").getByRole("button", { name: "Añadir al plan" }).click();
    await page.locator(".plan .tmp", { hasText: "Bailar una canción" }).waitFor();
    assert((await invoke("list_activities")).length === n, "se guardó aunque era solo para esta sesión");
    await shot("v3-07-custom-activity");
    await page.keyboard.press("Escape");
  });
  await check("ayuda de notificaciones con guía y enlaces oficiales", async () => {
    await nav("Ajustes");
    await page.locator(".card", { hasText: "Telegram" }).getByRole("button", { name: /Cómo se configura/ }).click();
    await page.getByText("BotFather").first().waitFor();
    assert((await page.locator(".links .link").count()) >= 2, "faltan enlaces oficiales");
    const n = opened().length;
    await page.locator(".links .link").first().click();
    await sleep(500);
    assert(opened().slice(n).some((u) => u.startsWith("https://core.telegram.org/")), `abiertos: ${opened().slice(n)}`);
    await page.getByRole("tab", { name: "Correo" }).click();
    await page.getByText("smtp.gmail.com").first().waitFor();
    await shot("v3-08-phone-help");
    await page.keyboard.press("Escape");
  });
  await check("dictado: lista de modelos y aviso si no hay modelo", async () => {
    assert((await page.locator(".models .model").count()) === 6, "deben listarse 6 modelos");
    await shot("v3-09-dictation-settings");
    await nav("Notas");
    await page.locator(".note", { hasText: "Derivadas" }).first().click();
    await page.locator("main .lock.on").click();
    await page.locator("main .tool.mic").click();
    await page.getByText("descarga primero un modelo").waitFor();
  });
  await check("notas: ocultar temas, ocultar lista y modo cuaderno (Esc para salir)", async () => {
    await nav("Notas");
    await page.getByRole("button", { name: "📂 Ocultar temas" }).click();
    await page.locator("aside.tree").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "🗒️ Ocultar lista de notas" }).click();
    await page.locator("aside.list").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "📂 Mostrar temas" }).click();
    await page.getByRole("button", { name: "🗒️ Mostrar lista de notas" }).click();
    await page.locator("aside.tree").waitFor();
    await page.getByRole("button", { name: "📖 Modo cuaderno" }).click();
    await page.locator(".shell.notebook").waitFor();
    assert(!(await page.locator("nav").isVisible()), "el menú lateral sigue visible");
    const w = await page.locator("main .editor").evaluate((el) => el.getBoundingClientRect().width);
    assert(w > 1000, `el cuaderno solo mide ${w}px`);
    await shot("v31-01-notebook");
    await page.keyboard.press("Escape");
    await page.locator(".shell:not(.notebook) nav").waitFor();
    assert((await invoke("get_settings")).notebook === "false", "no se recordó la salida");
  });
  await check("escala de la interfaz (150 %) y vuelta al 100 %", async () => {
    await nav("Ajustes");
    const before = await page.evaluate(() => innerWidth);
    await page.getByLabel("Tamaño de la interfaz").selectOption("1.5");
    await page.waitForFunction((b) => Math.abs(innerWidth - b / 1.5) < 4, before, { timeout: 5000 });
    await shot("v31-02-scale-150");
    // With 150 % there's no room for the side columns: Notes uses drawers and the editor keeps its width.
    await nav("Notas");
    await page.getByRole("button", { name: "📂 Temas" }).click();
    await page.locator("aside.tree.drawer").waitFor();
    await page.locator("aside.tree .topic").first().click();
    await page.locator("aside.list.drawer").waitFor();
    await page.locator("aside.list .note:not(.quick-item)", { hasText: "Derivadas" }).click();
    await page.locator("aside.drawer").waitFor({ state: "detached" });
    const ew = await page.locator("main .editor").evaluate((el) => el.getBoundingClientRect().width);
    assert(ew > 400, `editor a 150 %: ${ew}px`);
    await shot("v31-03-scale-150-notes");
    await nav("Ajustes");
    await page.getByLabel("Tamaño de la interfaz").selectOption("1");
    await page.waitForFunction((b) => Math.abs(innerWidth - b) < 4, before, { timeout: 5000 });
  });
  await check("dictado: selector de micrófono con los dispositivos de Windows", async () => {
    const devices = await invoke("dictation_devices");
    const options = await page.getByLabel("Micrófono").locator("option").allInnerTexts();
    assert(options[0] === "Predeterminado de Windows", `opciones: ${options}`);
    assert(options.length === devices.length + 1, `lista ${devices.length} vs ${options.length - 1}`);
    console.log(`      (micrófonos detectados: ${devices.length ? devices.join(", ") : "ninguno"})`);
  });
  await check("menú lateral compacto (solo iconos) y expandido", async () => {
    await page.getByTitle("Contraer menú").click();
    await page.locator(".shell.compact").waitFor();
    await sleep(500); // width animation
    const w = await page.locator("nav").evaluate((el) => el.getBoundingClientRect().width);
    assert(w <= 64, `ancho del menú: ${w}`);
    assert((await page.locator("nav .nav-item .grow").count()) === 0, "siguen los textos");
    await shot("v2-08-nav-compact");
    await page.getByTitle("Expandir menú").click();
    await page.locator(".shell:not(.compact)").waitFor();
  });
  await check("actividades de descanso: crear una propia y usarla en el plan por defecto", async () => {
    await nav("Ajustes");
    await button("+ Nueva actividad").click();
    await page.locator(".edit").getByLabel("Emoji").fill("🎸");
    await page.locator(".edit").getByLabel("Nombre").fill("Tocar la guitarra");
    await page.locator(".edit").getByRole("button", { name: "Guardar" }).click();
    await page.locator(".act", { hasText: "Tocar la guitarra" }).waitFor();
    const acts = await invoke("list_activities");
    const mine = acts.find((a) => a.name === "Tocar la guitarra");
    assert(mine?.emoji === "🎸", "actividad no guardada");
    await page.locator("label.field", { hasText: /^Método/ }).locator("select").selectOption("kaizen");
    await page.locator(".card", { hasText: "Plan por defecto" }).getByRole("button", { name: "+ Añadir descanso" }).click();
    await page.locator(".card", { hasText: "Plan por defecto" }).locator(".slot select").selectOption(mine.id);
    const settings = await invoke("get_settings");
    assert(settings.break_plan_kaizen === mine.id, `plan kaizen: ${settings.break_plan_kaizen}`);
    await shot("v2-09-settings-breaks");
  });
  await check("ajustes centrados en la pantalla", async () => {
    await nav("Ajustes");
    const { left, right } = await page.locator(".page").evaluate((el) => {
      const r = el.getBoundingClientRect();
      const m = el.parentElement.getBoundingClientRect();
      return { left: r.left - m.left, right: m.right - r.right };
    });
    assert(Math.abs(left - right) < 24, `márgenes izquierda ${left} / derecha ${right}`);
  });
  await check("en pruebas no se registra el inicio con Windows", async () => {
    const toggle = page.locator(".card", { hasText: "Iniciar con Windows" }).locator("input.toggle");
    assert(!(await toggle.isChecked()), "aparece activado sin estar registrado");
  });
  await check("meta diaria configurable se refleja en Hoy", async () => {
    await nav("Ajustes");
    await page.locator("input.goal").fill("20");
    await page.locator("input.goal").dispatchEvent("change");
    await nav("Hoy");
    await page.getByText("¡Meta cumplida!").waitFor();
  });
  await check("exportar e importar respaldo restaura los datos", async () => {
    const file = join(WORK, "respaldo.kaizen");
    await invoke("export_backup", { path: file });
    assert(statSync(file).size > 1000, "respaldo vacío");
    const [subject] = await invoke("list_subjects", { includeArchived: false });
    await invoke("delete_subject", { id: subject.id });
    assert((await invoke("list_subjects", { includeArchived: false })).length === 0, "no se borró");
    await invoke("import_backup", { path: file });
    assert((await invoke("list_subjects", { includeArchived: false })).length === 1, "no se restauró");
    const safety = execSync(`dir /b "${join(DATA, "backups")}"`, { shell: "cmd.exe" }).toString();
    assert(safety.includes("antes-de-importar"), "no se guardó la copia de seguridad previa");
    assert(existsSync(join(DATA, "adjuntos", "image.png")), "el adjunto no sobrevivió al respaldo");
  });
  await check("mover datos a otra carpeta", async () => {
    const dest = join(WORK, "data2");
    await invoke("set_data_dir", { path: dest, mode: "move" });
    const info = await invoke("app_info");
    assert(info.data_dir === dest, `data_dir=${info.data_dir}`);
    assert((await invoke("list_subjects", { includeArchived: false })).length === 1, "datos perdidos al mover");
    assert(existsSync(join(dest, "adjuntos", "image.png")), "los adjuntos no se copiaron al mover");
  });
  await check("tema oscuro en todas las pantallas", async () => {
    await page.reload();
    await nav("Ajustes");
    await page.locator("select").first().selectOption("dark");
    await sleep(300);
    assert((await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "no cambió a oscuro");
    await shot("18-dark-settings");
    screenGrab("18b-dark-settings-real");
    for (const [name, file] of [["Hoy", "19-dark-today"], ["Materias", "20-dark-subjects"], ["Notas", "21-dark-notes"], ["Estadísticas", "22-dark-stats"]]) {
      await nav(name);
      await sleep(700);
      await shot(file);
      screenGrab(`${file}-real`);
    }
  });

  await check("sin errores de JavaScript durante toda la prueba", async () => {
    assert(pageErrors.length === 0, pageErrors.join("\n"));
  });
}

try {
  await main();
} catch (e) {
  console.error("\nError fatal:", e);
  results.push({ name: "fatal", ok: false, error: String(e) });
} finally {
  await invoke("set_secret", { key: "ntfy_token", value: "" }).catch(() => {});
  ntfy.close();
  await kill();
  rmSync(WORK, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} pruebas superadas. Capturas en e2e/screens/`);
if (failed.length) {
  for (const f of failed) console.log(`  ✗ ${f.name}: ${f.error}`);
  process.exit(1);
}
