// Visual review: real screen captures (including the Windows Mica backdrop) of every screen,
// empty state, 100 % and 150 %, plus a horizontal-overflow detector.
//
//   npx tauri build --no-bundle
//   npm run review -- <output folder>
import { spawn, execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = join(tmpdir(), "kaizen-review-" + Date.now());
const OUT = process.argv[3] ?? join(import.meta.dirname, "screens", "review");
mkdirSync(OUT, { recursive: true });
mkdirSync(join(W, "config"), { recursive: true });
writeFileSync(join(W, "config", "config.json"), JSON.stringify({ data_dir: join(W, "data") }));
const EXE = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : join(import.meta.dirname, "..", "src-tauri", "target", "release", "kaizen-study.exe");
const p = spawn(EXE, [], {
  env: { ...process.env, KAIZEN_CONFIG_DIR: join(W, "config"), KAIZEN_TOOLS_DIR: join(W, "tools"),
    WEBVIEW2_USER_DATA_FOLDER: join(W, "wv"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9340" },
  stdio: "ignore",
});
for (let i = 0; i < 60; i++) { try { if ((await fetch("http://127.0.0.1:9340/json/version")).ok) break; } catch {} await sleep(300); }
const b = await chromium.connectOverCDP("http://127.0.0.1:9340");
const page = b.contexts()[0].pages()[0];
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.locator("nav").getByText("Hoy").waitFor();
const inv = (c, a = {}) => page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [c, a]);
const nav = (name) => page.locator("nav").getByRole("button", { name, exact: true }).click();

function grab(name) {
  const ps = `
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices;
public static class Win { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
public struct RECT { public int L, T, R, B; } }'
$h = (Get-Process -Id ${p.pid}).MainWindowHandle
[Win]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 500
$r = New-Object Win+RECT
[Win]::GetWindowRect($h, [ref]$r) | Out-Null
$bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
[System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$bmp.Save('${join(OUT, name + ".png")}')`;
  execSync(`powershell -NoProfile -EncodedCommand ${Buffer.from(ps, "utf16le").toString("base64")}`, { timeout: 20000, stdio: "ignore" });
}

const SCREENS = ["Hoy", "Materias", "Sesión", "Notas", "Calendario", "Estadísticas", "Ajustes"];

// 1. Empty state
for (const s of SCREENS) {
  await nav(s);
  await sleep(600);
  grab(`empty-${s}`);
}
await nav("Calendario");
await page.getByRole("button", { name: "+ Planificar estudio" }).first().click();
await sleep(500);
grab("empty-plan-dialog");
await page.keyboard.press("Escape");

// 2. Some data
const s = await inv("save_subject", { subject: { id: "", name: "Matemáticas", color: "#0f6cbd", icon: "🧮", archived: false, created_at: "" } });
const t = await inv("save_topic", { topic: { id: "", subject_id: s.id, name: "Derivadas", template_id: "pomodoro", status: "nuevo", stage: null, exam_date: null, created_at: "" } });
await inv("save_note", { note: { id: "", topic_id: t.id, title: "Apuntes", body_md: "# Derivadas\n\nTexto con **negrita** y [un enlace](https://example.com).\n\n- [ ] Tarea\n\n```latex\nf'(x) = \\lim_{h \\to 0} \\frac{f(x+h)-f(x)}{h}\n```\n", layout: "libre", updated_at: "" } });
await page.reload();
await page.locator("nav").getByText("Hoy").waitFor();

// 3. Custom activity form (the "square" bug)
await page.getByRole("button", { name: /Iniciar sesión de estudio/ }).click();
await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByRole("button", { name: "+ Actividad personalizada" }).click();
await page.locator(".custom").getByLabel("Nombre").fill("Caminar al parque");
await sleep(300);
grab("custom-activity-form");
await page.keyboard.press("Escape");

// 4. Notebook mode
await nav("Notas");
await sleep(800);
grab("notes-100");
await page.getByRole("button", { name: "📖 Modo cuaderno" }).click();
await sleep(600);
grab("notebook");
await page.keyboard.press("Escape");

// 5. 150 %
await inv("set_setting", { key: "ui_scale", value: "1.5" });
await page.reload();
await page.locator("nav").getByText("Hoy").waitFor();
await sleep(800);
for (const sc of SCREENS) {
  await nav(sc);
  await sleep(700);
  grab(`scale150-${sc}`);
}
// Elements wider than their scroll container, per screen (horizontal overflow detector).
for (const sc of SCREENS) {
  await nav(sc);
  await sleep(500);
  const over = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("main *")) {
      const s = getComputedStyle(el);
      if ((s.overflowX === "auto" || s.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1) {
        const kids = [...el.querySelectorAll("*")].filter((k) => k.getBoundingClientRect().right > el.getBoundingClientRect().right + 1);
        out.push(`${el.className} (${el.scrollWidth}>${el.clientWidth}): ` + kids.slice(-3).map((k) => `${k.tagName}.${k.className}`).join(" | "));
      }
    }
    return out;
  });
  if (over.length) console.log(`OVERFLOW ${sc}:`, over.join(" || "));
}
await nav("Notas");
await page.getByRole("button", { name: "📂 Temas" }).click();
await sleep(500);
grab("scale150-notes-drawer");
console.log("errors:", JSON.stringify(errors));
p.kill();
process.exit(0);
