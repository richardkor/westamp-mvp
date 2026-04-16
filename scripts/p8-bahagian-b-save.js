/**
 * P8 Bahagian B — Save Boundary Investigation
 *
 * Run A: Empty save on Bahagian B
 * Run B: Minimal synthetic fill + save
 *
 * Usage: node scripts/p8-bahagian-b-save.js
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

console.log("\n=== P8 BAHAGIAN B SAVE BOUNDARY ===\n");

function writeMarker(name, body) {
  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(`${ARTIFACT_DIR}/${name}_${ts}.txt`, `${name}\n${new Date().toISOString()}\n${body}\n`);
  } catch {}
}

async function reachP8BahagianB(page) {
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
  if (!page.url().includes("/formv2/p8/")) return false;

  const nsc = page.locator("#namaperjanjian");
  await nsc.click(); await nsc.fill("Employment Contract");
  await nsc.evaluate(el => { el.dispatchEvent(new Event("change", { bubbles: true })); el.dispatchEvent(new Event("blur", { bubbles: true })); });
  await page.waitForTimeout(3000);

  const v = await page.evaluate(() => ({
    nsc: document.getElementById("namaperjanjian")?.value || "",
    pd: document.getElementById("profile_desc")?.value || "",
    ps: document.getElementById("pds_ps")?.value || "",
  }));
  if (v.nsc !== "Employment Contract" || v.pd !== "Perjanjian Pekerjaan" || v.ps !== "p") return false;

  await page.locator("#pdsG01_bhgn_am").click({ timeout: 5000 });
  await page.waitForTimeout(5000);
  await page.evaluate(() => { const b = document.querySelector(".bootbox .btn"); if (b) b.click(); });
  await page.waitForTimeout(1500);
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);

  // Open Bahagian B
  await page.evaluate(() => { for (const a of document.querySelectorAll('.nav-tabs a')) { if (/bahagian\s*b/i.test(a.textContent)) { a.click(); return; } } });
  await page.waitForTimeout(2000);

  const active = await page.evaluate(() => {
    const a = document.querySelector(".nav-tabs .active a, .nav-tabs li.active a");
    return a?.textContent?.trim() || "";
  });
  return /bahagian\s*b/i.test(active);
}

async function capturePostSave(page) {
  return await page.evaluate(() => {
    // Active tab
    const activeTab = document.querySelector(".nav-tabs .active a, .nav-tabs li.active a")?.textContent?.trim() || "";

    // Modals
    const modals = [];
    document.querySelectorAll(".modal.show, .modal.in, .bootbox, [role='dialog']").forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 50 && r.height > 50) modals.push({ class: (el.className || "").toString().substring(0, 60), text: (el.textContent || "").trim().substring(0, 300) });
    });

    // Invalid fields
    const invalids = [];
    document.querySelectorAll("input:invalid, select:invalid, textarea:invalid").forEach(el => {
      invalids.push({ name: el.name || "", id: el.id || "", msg: el.validationMessage?.substring(0, 50) || "", visible: el.getBoundingClientRect().width > 0 });
    });

    // Alerts
    const alerts = [];
    document.querySelectorAll(".alert, [role='alert'], .text-danger, .error").forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) alerts.push((el.textContent || "").trim().substring(0, 150));
    });

    // Headings (for "Berjaya" detection)
    const headings = [];
    document.querySelectorAll("h1,h2,h3,h4,h5").forEach(h => {
      const r = h.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) headings.push(h.textContent?.trim().substring(0, 60) || "");
    });

    // Field values
    const fields = {};
    ["pds_date_suratcara", "pds_date_suratcara_en", "nilai_balasan", "butiran_harta", "pds_salinan", "pds_remit"].forEach(name => {
      const el = document.querySelector(`[name="${name}"]`);
      if (el) {
        if (el.tagName === "SELECT") fields[name] = el.options[el.selectedIndex]?.text || "";
        else fields[name] = el.value || "";
      }
    });

    return { activeTab, modals, invalids, alerts, headings, fields };
  });
}

async function run() {
  const ctx = await chromium.launchPersistentContext(path.resolve(PROFILE_DIR), {
    headless: false, channel: "chrome", viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  try {
    // ═══════════════════════════════════════════════════════════════
    // RUN A: EMPTY SAVE
    // ═══════════════════════════════════════════════════════════════
    console.log("=== RUN A: EMPTY BAHAGIAN B SAVE ===\n");
    if (!await reachP8BahagianB(page)) { console.log("ERROR: Failed to reach Bahagian B."); await ctx.close(); return; }
    console.log(`On Bahagian B: ${page.url()}`);

    // Screenshot before
    const tsA1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_bhgB_save_empty_before_${tsA1}.png`, fullPage: true });

    // Capture pre-save values
    const preA = await capturePostSave(page);
    console.log(`Pre-save fields: ${JSON.stringify(preA.fields)}`);
    console.log(`Pre-save invalids: ${preA.invalids.length}`);

    // Register dialog handler
    let dialogA = { captured: false, msg: "" };
    page.on("dialog", async d => { dialogA.captured = true; dialogA.msg = d.message(); console.log(`  DIALOG: "${d.message().substring(0, 100)}"`); await d.accept(); });

    // Click Simpan Bahagian B
    console.log("\nClicking Simpan Bahagian B (empty)...");
    await page.locator('#pdsG01_bhgn_b').click({ timeout: 5000 });
    await page.waitForTimeout(5000);

    console.log(`Dialog: ${dialogA.captured ? dialogA.msg.substring(0, 100) : "none"}`);

    // Screenshot after
    const tsA2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_bhgB_save_empty_after_${tsA2}.png`, fullPage: true });

    const postA = await capturePostSave(page);
    console.log(`\nPost-save:`);
    console.log(`  Active tab: "${postA.activeTab}"`);
    console.log(`  Modals: ${postA.modals.length}`);
    for (const m of postA.modals) console.log(`    class="${m.class}" text="${m.text.substring(0, 100)}"`);
    console.log(`  Invalid fields: ${postA.invalids.length}`);
    for (const f of postA.invalids) console.log(`    ${f.name}/${f.id} vis=${f.visible} msg="${f.msg}"`);
    console.log(`  Alerts: ${postA.alerts.length}`);
    for (const a of postA.alerts) console.log(`    "${a.substring(0, 80)}"`);
    console.log(`  Headings: ${postA.headings.join("; ")}`);
    console.log(`  Fields: ${JSON.stringify(postA.fields)}`);

    writeMarker("P8_BHGB_EMPTY_SAVE",
      `dialog=${dialogA.captured ? dialogA.msg.substring(0, 100) : "none"}\n` +
      `activeTab=${postA.activeTab}\n` +
      `modals=${postA.modals.map(m => m.text.substring(0, 80)).join("; ")}\n` +
      `invalids=${postA.invalids.map(f => `${f.name}:${f.msg}`).join("; ")}\n` +
      `alerts=${postA.alerts.join("; ")}\n` +
      `headings=${postA.headings.join("; ")}\n` +
      `fields=${JSON.stringify(postA.fields)}`
    );

    // Dismiss any modal
    await page.evaluate(() => { const b = document.querySelector(".bootbox .btn"); if (b) b.click(); });
    await page.waitForTimeout(1000);
    await page.keyboard.press("Escape"); await page.waitForTimeout(500);

    // ═══════════════════════════════════════════════════════════════
    // RUN B: MINIMAL SYNTHETIC FILL + SAVE
    // ═══════════════════════════════════════════════════════════════
    console.log("\n\n=== RUN B: SYNTHETIC FILL + SAVE ===\n");
    if (!await reachP8BahagianB(page)) { console.log("ERROR: Failed to reach Bahagian B for Run B."); await ctx.close(); return; }
    console.log(`On Bahagian B: ${page.url()}`);

    // Fill synthetic values
    console.log("Filling synthetic Bahagian B values...");
    await page.locator('#date_suratcara').fill("01/01/2026");
    await page.waitForTimeout(500);
    await page.locator('#nilai_balasan').fill("100");
    await page.waitForTimeout(500);
    await page.locator('#butiran_harta').fill("TEST INSTRUMENT DETAILS FOR EMPLOYMENT CONTRACT");
    await page.waitForTimeout(500);
    // Leave pds_salinan at 0, pds_date_suratcara_en blank, pds_remit at default

    // Screenshot before save
    const tsB1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_bhgB_save_synth_before_${tsB1}.png`, fullPage: true });

    const preB = await capturePostSave(page);
    console.log(`Pre-save fields: ${JSON.stringify(preB.fields)}`);
    console.log(`Pre-save invalids: ${preB.invalids.length}`);
    for (const f of preB.invalids) console.log(`  ${f.name} vis=${f.visible} msg="${f.msg}"`);

    // Register fresh dialog handler
    page.removeAllListeners("dialog");
    let dialogB = { captured: false, msg: "" };
    page.on("dialog", async d => { dialogB.captured = true; dialogB.msg = d.message(); console.log(`  DIALOG: "${d.message().substring(0, 100)}"`); await d.accept(); });

    // Click Simpan Bahagian B
    console.log("\nClicking Simpan Bahagian B (synthetic fill)...");
    await page.locator('#pdsG01_bhgn_b').click({ timeout: 5000 });
    await page.waitForTimeout(8000);

    console.log(`Dialog: ${dialogB.captured ? dialogB.msg.substring(0, 100) : "none"}`);
    console.log(`URL: ${page.url()}`);

    // Screenshot after
    const tsB2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_bhgB_save_synth_after_${tsB2}.png`, fullPage: true });

    const postB = await capturePostSave(page);
    console.log(`\nPost-save:`);
    console.log(`  Active tab: "${postB.activeTab}"`);
    console.log(`  Modals: ${postB.modals.length}`);
    for (const m of postB.modals) console.log(`    class="${m.class}" text="${m.text.substring(0, 120)}"`);
    console.log(`  Invalid fields: ${postB.invalids.length}`);
    for (const f of postB.invalids) console.log(`    ${f.name}/${f.id} vis=${f.visible} msg="${f.msg}"`);
    console.log(`  Alerts: ${postB.alerts.length}`);
    for (const a of postB.alerts) console.log(`    "${a.substring(0, 80)}"`);
    console.log(`  Headings: ${postB.headings.join("; ")}`);
    console.log(`  Fields: ${JSON.stringify(postB.fields)}`);

    writeMarker("P8_BHGB_SYNTH_SAVE",
      `dialog=${dialogB.captured ? dialogB.msg.substring(0, 100) : "none"}\n` +
      `activeTab=${postB.activeTab}\n` +
      `modals=${postB.modals.map(m => m.text.substring(0, 80)).join("; ")}\n` +
      `invalids=${postB.invalids.map(f => `${f.name}:${f.msg}`).join("; ")}\n` +
      `headings=${postB.headings.join("; ")}\n` +
      `fields=${JSON.stringify(postB.fields)}`
    );

    console.log(`\n=== COMPLETE. NO PARTY DATA. NO LATER TABS. NO SUBMIT. ===`);

  } finally {
    await ctx.close();
  }
}

run().catch(err => { console.error("Failed:", err); process.exit(1); });
