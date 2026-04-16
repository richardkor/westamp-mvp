/**
 * P8 Rumusan Pengiraan Access Investigation
 *
 * Reaches p8, saves Maklumat Am + Bahagian B with proven synthetic values,
 * then attempts to open Rumusan Pengiraan and captures its state.
 *
 * Usage: node scripts/p8-rumusan-pengiraan-access.js
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

console.log("\n=== P8 RUMUSAN PENGIRAAN ACCESS ===\n");

function writeMarker(name, body) {
  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(`${ARTIFACT_DIR}/${name}_${ts}.txt`, `${name}\n${new Date().toISOString()}\n${body}\n`);
  } catch {}
}

async function run() {
  const ctx = await chromium.launchPersistentContext(path.resolve(PROFILE_DIR), {
    headless: false, channel: "chrome", viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  try {
    // ── Step 1: Reach p8 + verify + save Maklumat Am ────────────────
    console.log("Step 1: Reaching p8...");
    await page.goto("https://stamps.hasil.gov.my/stamps/form/application", { timeout: 30000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await page.evaluate(() => { for (const r of document.querySelectorAll('input[type="radio"]')) { if (r.parentElement?.textContent?.trim() === "Penyeteman Am") { r.click(); return; } } });
    await page.waitForTimeout(1000);
    await page.evaluate(() => { const s = document.querySelector('select[name="CD_DUTISETEM_ID"]'); if (s) { for (let i=0;i<s.options.length;i++) { if (s.options[i].text.includes("Sarawak")) { s.selectedIndex=i; s.dispatchEvent(new Event("change",{bubbles:true})); break; } } } });
    await page.fill('input[name="tsd"]', "01");
    try { await page.locator("select").nth(2).selectOption({ label: "Januari" }); } catch {}
    await page.waitForTimeout(500);
    await page.locator("button#btn-ma-submit").click();
    await page.waitForTimeout(5000);
    if (!page.url().includes("/formv2/p8/")) { console.log("ERROR: Not on p8."); await ctx.close(); return; }

    const nsc = page.locator("#namaperjanjian");
    await nsc.click(); await nsc.fill("Employment Contract");
    await nsc.evaluate(el => { el.dispatchEvent(new Event("change", { bubbles: true })); el.dispatchEvent(new Event("blur", { bubbles: true })); });
    await page.waitForTimeout(3000);

    const v = await page.evaluate(() => ({
      nsc: document.getElementById("namaperjanjian")?.value || "",
      pd: document.getElementById("profile_desc")?.value || "",
      ps: document.getElementById("pds_ps")?.value || "",
    }));
    if (v.nsc !== "Employment Contract" || v.pd !== "Perjanjian Pekerjaan" || v.ps !== "p") {
      console.log(`Verify failed: ${JSON.stringify(v)}`); await ctx.close(); return;
    }
    console.log("Verified: Employment Contract / Perjanjian Pekerjaan / Prinsipal");

    await page.locator("#pdsG01_bhgn_am").click({ timeout: 5000 });
    await page.waitForTimeout(5000);
    await page.evaluate(() => { const b = document.querySelector(".bootbox .btn"); if (b) b.click(); });
    await page.waitForTimeout(1500);
    await page.keyboard.press("Escape"); await page.waitForTimeout(500);
    console.log("Maklumat Am saved.\n");

    // ── Step 2: Open Bahagian B + fill + save ───────────────────────
    console.log("Step 2: Saving Bahagian B with synthetic values...");
    await page.evaluate(() => { for (const a of document.querySelectorAll('.nav-tabs a')) { if (/bahagian\s*b/i.test(a.textContent)) { a.click(); return; } } });
    await page.waitForTimeout(2000);

    await page.locator('#date_suratcara').fill("01/01/2026");
    await page.waitForTimeout(300);
    await page.locator('#nilai_balasan').fill("100");
    await page.waitForTimeout(300);
    await page.locator('#butiran_harta').fill("TEST INSTRUMENT DETAILS FOR EMPLOYMENT CONTRACT");
    await page.waitForTimeout(500);

    await page.locator('#pdsG01_bhgn_b').click({ timeout: 5000 });
    await page.waitForTimeout(5000);
    await page.evaluate(() => { const b = document.querySelector(".bootbox .btn"); if (b) b.click(); });
    await page.waitForTimeout(1500);
    await page.keyboard.press("Escape"); await page.waitForTimeout(500);
    console.log("Bahagian B saved.\n");

    // ── Step 3: Screenshot before Rumusan Pengiraan ─────────────────
    const ts1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_rumusan_before_${ts1}.png`, fullPage: true });

    // Check tab states
    const tabsBefore = await page.evaluate(() => {
      const tabs = [];
      document.querySelectorAll(".nav-tabs li").forEach(li => {
        const a = li.querySelector("a");
        if (!a || a.getBoundingClientRect().width <= 0) return;
        tabs.push({
          text: a.textContent?.trim().substring(0, 30) || "",
          href: a.getAttribute("href") || "",
          active: li.classList.contains("active"),
          disabled: li.classList.contains("disabled") || a.getAttribute("aria-disabled") === "true",
        });
      });
      return tabs;
    });
    console.log("Tab states before:");
    for (const t of tabsBefore) console.log(`  "${t.text}" active=${t.active} disabled=${t.disabled}`);

    // ── Step 4: Click Rumusan Pengiraan ─────────────────────────────
    console.log("\nClicking Rumusan Pengiraan tab...");
    await page.evaluate(() => { for (const a of document.querySelectorAll('.nav-tabs a')) { if (/rumusan/i.test(a.textContent)) { a.click(); return; } } });
    await page.waitForTimeout(3000);

    const activeAfter = await page.evaluate(() => {
      const li = document.querySelector(".nav-tabs li.active");
      return li?.querySelector("a")?.textContent?.trim() || "(unknown)";
    });
    console.log(`Active tab: "${activeAfter}"`);
    console.log(`URL: ${page.url()}`);

    // Check for warnings/modals
    const warnings = await page.evaluate(() => {
      const msgs = [];
      document.querySelectorAll(".modal.show, .modal.in, .bootbox, [role='dialog'], .alert, [role='alert']").forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > 50 && r.height > 50) msgs.push({ class: (el.className || "").toString().substring(0, 60), text: (el.textContent || "").trim().substring(0, 300) });
      });
      return msgs;
    });
    console.log(`Warnings/modals: ${warnings.length}`);
    for (const w of warnings) console.log(`  class="${w.class}" text="${w.text.substring(0, 120)}"`);

    // Screenshot after
    const ts2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_rumusan_after_${ts2}.png`, fullPage: true });

    // ── Step 5: Capture Rumusan Pengiraan structure if active ────────
    if (/rumusan/i.test(activeAfter)) {
      console.log("\n=== RUMUSAN PENGIRAAN ACTIVE — CAPTURING ===");

      const inv = await page.evaluate(() => {
        const panel = document.querySelector("#bhgn-kiraan") || document.querySelector(".tab-pane.active");
        if (!panel) return { found: false };

        const headings = [];
        panel.querySelectorAll("h1,h2,h3,h4,h5,h6,legend,strong,.box-title").forEach(h => {
          const r = h.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            const txt = (h.textContent || "").trim();
            if (txt.length > 2 && txt.length < 120) headings.push({ text: txt.substring(0, 100), tag: h.tagName.toLowerCase() });
          }
        });

        const labels = [];
        panel.querySelectorAll("label, td, th").forEach(l => {
          const r = l.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            const txt = (l.textContent || "").trim();
            if (txt.length > 2 && txt.length < 100) labels.push({ text: txt.substring(0, 80), tag: l.tagName.toLowerCase() });
          }
        });

        const inputs = [];
        panel.querySelectorAll("input, textarea").forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return;
          if (el.type === "hidden") return;
          inputs.push({
            type: el.type || "text", name: el.name || "", id: el.id || "",
            value: (el.value || "").substring(0, 60),
            readOnly: el.readOnly || false, disabled: el.disabled || false,
          });
        });

        const selects = [];
        panel.querySelectorAll("select").forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return;
          const cur = el.options[el.selectedIndex];
          selects.push({
            name: el.name || "", id: el.id || "",
            selectedText: (cur?.text || "").substring(0, 50), optionCount: el.options.length,
          });
        });

        const tables = [];
        panel.querySelectorAll("table").forEach(t => {
          const r = t.getBoundingClientRect();
          if (r.width <= 0) return;
          const headers = [];
          t.querySelectorAll("th").forEach(th => { if (th.getBoundingClientRect().width > 0) headers.push(th.textContent?.trim().substring(0, 40) || ""); });
          const rows = [];
          t.querySelectorAll("tbody tr").forEach(tr => {
            if (tr.getBoundingClientRect().width <= 0) return;
            const cells = [];
            tr.querySelectorAll("td").forEach(td => cells.push(td.textContent?.trim().substring(0, 40) || ""));
            rows.push(cells);
          });
          tables.push({ headers, rows });
        });

        const buttons = [];
        panel.querySelectorAll("button, input[type='submit'], input[type='button']").forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return;
          const txt = (el.textContent || el.value || "").trim();
          if (txt.length > 0 && txt.length < 60) buttons.push({ text: txt.substring(0, 40), id: el.id || "" });
        });

        const body = (panel.innerText || "").substring(0, 2000);

        return { found: true, headings, labels: labels.slice(0, 30), inputs, selects, tables, buttons, body };
      });

      if (inv.found) {
        console.log(`\nHeadings (${inv.headings.length}):`);
        for (const h of inv.headings) console.log(`  [${h.tag}] "${h.text}"`);
        console.log(`Labels/cells (${inv.labels.length}):`);
        for (const l of inv.labels) console.log(`  [${l.tag}] "${l.text}"`);
        console.log(`Inputs (${inv.inputs.length}):`);
        for (const i of inv.inputs) console.log(`  type=${i.type} name="${i.name}" id="${i.id}" val="${i.value}" ro=${i.readOnly}`);
        console.log(`Selects (${inv.selects.length}):`);
        for (const s of inv.selects) console.log(`  name="${s.name}" id="${s.id}" selected="${s.selectedText}" opts=${s.optionCount}`);
        console.log(`Tables (${inv.tables.length}):`);
        for (const t of inv.tables) {
          console.log(`  headers=[${t.headers.join(", ")}]`);
          for (const row of t.rows) console.log(`    [${row.join(" | ")}]`);
        }
        console.log(`Buttons (${inv.buttons.length}): ${inv.buttons.map(b => `"${b.text}" id="${b.id}"`).join(", ")}`);
        console.log(`\nBody (first 600):\n"${inv.body.substring(0, 600)}"`);

        writeMarker("P8_RUMUSAN_PENGIRAAN_INVENTORY",
          `url=${page.url()}\nactiveTab=${activeAfter}\n` +
          `headings=${inv.headings.map(h => `[${h.tag}]"${h.text}"`).join("; ")}\n` +
          `inputs=${inv.inputs.map(i => `${i.type}:${i.name}="${i.value}" ro=${i.readOnly}`).join("; ")}\n` +
          `selects=${inv.selects.map(s => `${s.name}="${s.selectedText}" opts=${s.optionCount}`).join("; ")}\n` +
          `tables=${inv.tables.length}\n` +
          inv.tables.map((t, idx) => `table[${idx}]: headers=[${t.headers.join(",")}] rows=${t.rows.length}\n${t.rows.map(r => "  " + r.join(" | ")).join("\n")}`).join("\n") + "\n" +
          `buttons=${inv.buttons.map(b => `"${b.text}"`).join("; ")}\n` +
          `body=${inv.body.substring(0, 800)}`
        );
      }

      // Scroll for full view
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);
      const ts3 = new Date().toISOString().replace(/[:.]/g, "-");
      await page.screenshot({ path: `${ARTIFACT_DIR}/p8_rumusan_scrolled_${ts3}.png`, fullPage: true });
    } else {
      console.log(`Rumusan Pengiraan did NOT become active. Active: "${activeAfter}"`);
      writeMarker("P8_RUMUSAN_BLOCKED", `activeTab=${activeAfter}\nwarnings=${warnings.map(w => w.text.substring(0, 80)).join("; ")}`);
    }

    console.log(`\n=== COMPLETE. NO PARTY DATA. NO LATER TABS. NO SUBMIT. ===`);

  } finally {
    await ctx.close();
  }
}

run().catch(err => { console.error("Failed:", err); process.exit(1); });
