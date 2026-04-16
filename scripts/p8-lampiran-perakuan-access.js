/**
 * P8 Lampiran + Perakuan Access Investigation
 *
 * Maps both tabs on the incomplete p8 state. No uploads, no
 * declarations confirmed, no Hantar.
 *
 * Usage: node scripts/p8-lampiran-perakuan-access.js
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

console.log("\n=== P8 LAMPIRAN + PERAKUAN ACCESS ===\n");

function writeMarker(name, body) {
  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(`${ARTIFACT_DIR}/${name}_${ts}.txt`, `${name}\n${new Date().toISOString()}\n${body}\n`);
  } catch {}
}

async function captureTabInventory(page, panelId) {
  return await page.evaluate((pid) => {
    const panel = document.querySelector(`#${pid}`) || document.querySelector(".tab-pane.active");
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
    panel.querySelectorAll("label").forEach(l => {
      const r = l.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) labels.push({ text: (l.textContent || "").trim().substring(0, 100), htmlFor: l.htmlFor || "" });
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
        checked: el.checked || false,
        placeholder: (el.placeholder || "").substring(0, 40),
      });
    });

    const selects = [];
    panel.querySelectorAll("select").forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const cur = el.options[el.selectedIndex];
      selects.push({
        name: el.name || "", id: el.id || "",
        selectedText: (cur?.text || "").substring(0, 50),
        optionCount: el.options.length,
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
        tr.querySelectorAll("td").forEach(td => cells.push(td.textContent?.trim().substring(0, 50) || ""));
        rows.push(cells);
      });
      tables.push({ headers, rows });
    });

    // File inputs / upload widgets
    const fileInputs = [];
    panel.querySelectorAll('input[type="file"]').forEach(el => {
      const r = el.getBoundingClientRect();
      fileInputs.push({
        name: el.name || "", id: el.id || "",
        visible: r.width > 0 && r.height > 0,
        accept: el.accept || "",
        required: el.required || false,
      });
    });

    // Checkboxes
    const checkboxes = [];
    panel.querySelectorAll('input[type="checkbox"]').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const lbl = el.labels?.[0]?.textContent?.trim() || el.parentElement?.textContent?.trim() || "";
      checkboxes.push({
        name: el.name || "", id: el.id || "",
        checked: el.checked, required: el.required,
        label: lbl.substring(0, 100),
      });
    });

    const buttons = [];
    panel.querySelectorAll("button, input[type='submit'], input[type='button'], a.btn").forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const txt = (el.textContent || el.value || "").trim();
      if (txt.length > 0 && txt.length < 60) buttons.push({ text: txt.substring(0, 40), id: el.id || "", tag: el.tagName.toLowerCase() });
    });

    const body = (panel.innerText || "").substring(0, 2000);

    return { found: true, headings, labels, inputs, selects, tables, fileInputs, checkboxes, buttons, body };
  }, panelId);
}

function printInventory(label, inv) {
  console.log(`\n=== ${label} ===`);
  if (!inv.found) { console.log("Panel NOT FOUND."); return; }
  console.log(`Headings (${inv.headings.length}):`);
  for (const h of inv.headings) console.log(`  [${h.tag}] "${h.text}"`);
  console.log(`Labels (${inv.labels.length}):`);
  for (const l of inv.labels) console.log(`  "${l.text}" for="${l.htmlFor}"`);
  console.log(`Inputs (${inv.inputs.length}):`);
  for (const i of inv.inputs) console.log(`  type=${i.type} name="${i.name}" id="${i.id}" val="${i.value}" ro=${i.readOnly} checked=${i.checked}`);
  console.log(`Selects (${inv.selects.length}):`);
  for (const s of inv.selects) console.log(`  name="${s.name}" id="${s.id}" selected="${s.selectedText}" opts=${s.optionCount}`);
  console.log(`Tables (${inv.tables.length}):`);
  for (const t of inv.tables) { console.log(`  headers=[${t.headers.join(", ")}] rows=${t.rows.length}`); for (const r of t.rows) console.log(`    [${r.join(" | ")}]`); }
  console.log(`File inputs (${inv.fileInputs.length}):`);
  for (const f of inv.fileInputs) console.log(`  name="${f.name}" id="${f.id}" vis=${f.visible} accept="${f.accept}" req=${f.required}`);
  console.log(`Checkboxes (${inv.checkboxes.length}):`);
  for (const c of inv.checkboxes) console.log(`  name="${c.name}" id="${c.id}" checked=${c.checked} req=${c.required} label="${c.label}"`);
  console.log(`Buttons (${inv.buttons.length}): ${inv.buttons.map(b => `"${b.text}"`).join(", ")}`);
  console.log(`Body (first 500):\n"${inv.body.substring(0, 500)}"`);
}

async function run() {
  const ctx = await chromium.launchPersistentContext(path.resolve(PROFILE_DIR), {
    headless: false, channel: "chrome", viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  try {
    // ── Reach p8 + save MA + save BhgB ──────────────────────────────
    console.log("Reaching p8...");
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
    console.log("Verified.");

    await page.locator("#pdsG01_bhgn_am").click({ timeout: 5000 });
    await page.waitForTimeout(5000);
    await page.evaluate(() => { const b = document.querySelector(".bootbox .btn"); if (b) b.click(); });
    await page.waitForTimeout(1500);
    await page.keyboard.press("Escape"); await page.waitForTimeout(500);
    console.log("Maklumat Am saved.");

    await page.evaluate(() => { for (const a of document.querySelectorAll('.nav-tabs a')) { if (/bahagian\s*b/i.test(a.textContent)) { a.click(); return; } } });
    await page.waitForTimeout(2000);
    await page.locator('#date_suratcara').fill("01/01/2026");
    await page.locator('#nilai_balasan').fill("100");
    await page.locator('#butiran_harta').fill("TEST INSTRUMENT DETAILS FOR EMPLOYMENT CONTRACT");
    await page.waitForTimeout(500);
    await page.locator('#pdsG01_bhgn_b').click({ timeout: 5000 });
    await page.waitForTimeout(5000);
    await page.evaluate(() => { const b = document.querySelector(".bootbox .btn"); if (b) b.click(); });
    await page.waitForTimeout(1500);
    await page.keyboard.press("Escape"); await page.waitForTimeout(500);
    console.log("Bahagian B saved.\n");

    // ══════════════════════════════════════════════════════════════════
    // LAMPIRAN
    // ══════════════════════════════════════════════════════════════════
    console.log("--- OPENING LAMPIRAN ---");
    const tsL1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_lampiran_before_${tsL1}.png`, fullPage: true });

    await page.evaluate(() => { for (const a of document.querySelectorAll('.nav-tabs a')) { if (/lampiran/i.test(a.textContent)) { a.click(); return; } } });
    await page.waitForTimeout(3000);

    const lampiranActive = await page.evaluate(() => {
      const li = document.querySelector(".nav-tabs li.active");
      return li?.querySelector("a")?.textContent?.trim() || "";
    });
    console.log(`Active tab: "${lampiranActive}"`);

    // Check for warnings
    const lampiranWarnings = await page.evaluate(() => {
      const msgs = [];
      document.querySelectorAll(".modal.show, .modal.in, .bootbox, .alert, [role='alert']").forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > 50 && r.height > 50) msgs.push((el.textContent || "").trim().substring(0, 200));
      });
      return msgs;
    });
    console.log(`Warnings: ${lampiranWarnings.length}`);
    for (const w of lampiranWarnings) console.log(`  "${w.substring(0, 100)}"`);

    const tsL2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_lampiran_after_${tsL2}.png`, fullPage: true });

    let lampiranInv = { found: false };
    if (/lampiran/i.test(lampiranActive)) {
      lampiranInv = await captureTabInventory(page, "bhgn-attach");
      printInventory("LAMPIRAN", lampiranInv);
      writeMarker("P8_LAMPIRAN_INVENTORY",
        `url=${page.url()}\nactiveTab=${lampiranActive}\n` +
        `headings=${lampiranInv.headings?.map(h => h.text).join("; ")}\n` +
        `labels=${lampiranInv.labels?.map(l => l.text).join("; ")}\n` +
        `inputs=${lampiranInv.inputs?.map(i => `${i.type}:${i.name}="${i.value}"`).join("; ")}\n` +
        `fileInputs=${lampiranInv.fileInputs?.map(f => `${f.name} vis=${f.visible} req=${f.required}`).join("; ")}\n` +
        `tables=${lampiranInv.tables?.length}\n` +
        `buttons=${lampiranInv.buttons?.map(b => b.text).join("; ")}\n` +
        `body=${lampiranInv.body?.substring(0, 500)}`
      );

      // Scroll for full view
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);
      const tsL3 = new Date().toISOString().replace(/[:.]/g, "-");
      await page.screenshot({ path: `${ARTIFACT_DIR}/p8_lampiran_scrolled_${tsL3}.png`, fullPage: true });
    } else {
      console.log("Lampiran did NOT become active.");
      writeMarker("P8_LAMPIRAN_BLOCKED", `activeTab=${lampiranActive}`);
    }

    // ══════════════════════════════════════════════════════════════════
    // PERAKUAN
    // ══════════════════════════════════════════════════════════════════
    console.log("\n\n--- OPENING PERAKUAN ---");
    const tsP1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_perakuan_before_${tsP1}.png`, fullPage: true });

    await page.evaluate(() => { for (const a of document.querySelectorAll('.nav-tabs a')) { if (/perakuan/i.test(a.textContent)) { a.click(); return; } } });
    await page.waitForTimeout(3000);

    const perakuanActive = await page.evaluate(() => {
      const li = document.querySelector(".nav-tabs li.active");
      return li?.querySelector("a")?.textContent?.trim() || "";
    });
    console.log(`Active tab: "${perakuanActive}"`);

    const perakuanWarnings = await page.evaluate(() => {
      const msgs = [];
      document.querySelectorAll(".modal.show, .modal.in, .bootbox, .alert, [role='alert']").forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > 50 && r.height > 50) msgs.push((el.textContent || "").trim().substring(0, 200));
      });
      return msgs;
    });
    console.log(`Warnings: ${perakuanWarnings.length}`);
    for (const w of perakuanWarnings) console.log(`  "${w.substring(0, 100)}"`);

    const tsP2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_perakuan_after_${tsP2}.png`, fullPage: true });

    let perakuanInv = { found: false };
    if (/perakuan/i.test(perakuanActive)) {
      perakuanInv = await captureTabInventory(page, "bhgn-perakuan");
      printInventory("PERAKUAN", perakuanInv);
      writeMarker("P8_PERAKUAN_INVENTORY",
        `url=${page.url()}\nactiveTab=${perakuanActive}\n` +
        `headings=${perakuanInv.headings?.map(h => h.text).join("; ")}\n` +
        `labels=${perakuanInv.labels?.map(l => l.text).join("; ")}\n` +
        `inputs=${perakuanInv.inputs?.map(i => `${i.type}:${i.name}="${i.value}" checked=${i.checked}`).join("; ")}\n` +
        `checkboxes=${perakuanInv.checkboxes?.map(c => `${c.name} checked=${c.checked} req=${c.required} label="${c.label}"`).join("; ")}\n` +
        `buttons=${perakuanInv.buttons?.map(b => b.text).join("; ")}\n` +
        `body=${perakuanInv.body?.substring(0, 600)}`
      );

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);
      const tsP3 = new Date().toISOString().replace(/[:.]/g, "-");
      await page.screenshot({ path: `${ARTIFACT_DIR}/p8_perakuan_scrolled_${tsP3}.png`, fullPage: true });
    } else {
      console.log("Perakuan did NOT become active.");
      writeMarker("P8_PERAKUAN_BLOCKED", `activeTab=${perakuanActive}`);
    }

    console.log(`\n=== COMPLETE. NO UPLOADS. NO DECLARATIONS. NO HANTAR. ===`);

  } finally {
    await ctx.close();
  }
}

run().catch(err => { console.error("Failed:", err); process.exit(1); });
