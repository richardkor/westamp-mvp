/**
 * P8 Bahagian A — Tambah Individu Investigation
 *
 * Discovers the real add-party UI pattern for p8 Pihak Pertama and
 * Pihak Kedua Individu. No data entry, no save.
 *
 * WARNING: Do NOT add kpin/identity interaction without requiring
 * ALLOW_LIVE_ID_LOOKUP=true and redacting returned TIN/name values.
 *
 * Usage: node scripts/p8-tambah-individu-investigation.js
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

console.log("\n=== P8 TAMBAH INDIVIDU INVESTIGATION ===\n");

function writeMarker(name, body) {
  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(`${ARTIFACT_DIR}/${name}_${ts}.txt`, `${name}\n${new Date().toISOString()}\n${body}\n`);
  } catch {}
}

async function captureModalOrPageUI(page, label) {
  return await page.evaluate(() => {
    // Check for visible modal first
    const modalSelectors = [".bootbox.in", ".bootbox.show", ".modal.show", ".modal.in", "[role='dialog']"];
    let modal = null;
    for (const sel of modalSelectors) {
      const el = document.querySelector(sel);
      if (el && el.getBoundingClientRect().width > 50) { modal = el; break; }
    }

    const uiType = modal ? "modal" : "page";
    const root = modal || document.body;
    const modalClass = modal ? (modal.className || "").toString().substring(0, 80) : "";
    const modalId = modal ? (modal.id || "") : "";

    // Title
    const titleEl = root.querySelector(".modal-title, h4, h3, legend");
    const title = titleEl ? (titleEl.textContent || "").trim().substring(0, 100) : "";

    // Labels
    const labels = [];
    root.querySelectorAll("label").forEach(l => {
      const r = l.getBoundingClientRect();
      if (r.width > 0 && r.height > 0)
        labels.push((l.textContent || "").trim().substring(0, 80));
    });

    // Visible controls
    const controls = [];
    root.querySelectorAll("input, select, textarea").forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      if (el.type === "hidden") return;
      controls.push({
        tag: el.tagName.toLowerCase(), type: el.type || "",
        name: el.name || "", id: el.id || "",
        value: (el.value || "").substring(0, 40),
        readOnly: el.readOnly || false, required: el.required || false,
      });
    });

    // Buttons
    const buttons = [];
    root.querySelectorAll("button, input[type='submit'], input[type='button'], a.btn").forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const txt = (el.textContent || el.value || "").trim();
      if (txt.length > 0 && txt.length < 60)
        buttons.push({ text: txt.substring(0, 40), tag: el.tagName.toLowerCase(), id: el.id || "" });
    });

    // Check for identity-related hidden fields
    const kpDiv = root.querySelector("#kp");
    const kpDisplay = kpDiv ? window.getComputedStyle(kpDiv).display : "(not found)";

    return { uiType, modalClass, modalId, title, labels, controls, buttons, kpDisplay };
  });
}

async function reachP8BahagianA(page) {
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

  // Enter Employment Contract
  const nsc = page.locator("#namaperjanjian");
  await nsc.click(); await nsc.fill("Employment Contract");
  await page.waitForTimeout(500);
  await nsc.evaluate(el => { el.dispatchEvent(new Event("change", { bubbles: true })); el.dispatchEvent(new Event("blur", { bubbles: true })); });
  await page.waitForTimeout(3000);

  // Verify
  const v = await page.evaluate(() => ({
    nsc: document.getElementById("namaperjanjian")?.value || "",
    pd: document.getElementById("profile_desc")?.value || "",
    ps: document.getElementById("pds_ps")?.value || "",
  }));
  if (v.nsc !== "Employment Contract" || v.pd !== "Perjanjian Pekerjaan" || v.ps !== "p") {
    console.log(`Verify failed: ${JSON.stringify(v)}`); return false;
  }

  // Save Maklumat Am
  await page.locator("#pdsG01_bhgn_am").click({ timeout: 5000 });
  await page.waitForTimeout(5000);
  await page.evaluate(() => { const b = document.querySelector(".bootbox .btn"); if (b) b.click(); });
  await page.waitForTimeout(1500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // Open Bahagian A
  await page.evaluate(() => { for (const a of document.querySelectorAll('.nav-tabs a')) { if (/bahagian\s*a/i.test(a.textContent)) { a.click(); return; } } });
  await page.waitForTimeout(2000);
  return true;
}

function printUI(label, ui) {
  console.log(`\n--- ${label} ---`);
  console.log(`UI type: ${ui.uiType}${ui.modalClass ? ` class="${ui.modalClass}"` : ""}${ui.modalId ? ` id="${ui.modalId}"` : ""}`);
  console.log(`Title: "${ui.title}"`);
  console.log(`Labels (${ui.labels.length}): ${ui.labels.join("; ")}`);
  console.log(`Controls (${ui.controls.length}):`);
  for (const c of ui.controls) console.log(`  ${c.tag} type=${c.type} name="${c.name}" id="${c.id}" val="${c.value}" ro=${c.readOnly} req=${c.required}`);
  console.log(`Buttons (${ui.buttons.length}): ${ui.buttons.map(b => `"${b.text}"`).join(", ")}`);
  console.log(`div#kp: ${ui.kpDisplay}`);
}

async function run() {
  const ctx = await chromium.launchPersistentContext(path.resolve(PROFILE_DIR), {
    headless: false, channel: "chrome", viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  try {
    // ═══════════════════════════════════════════════════════════════
    // RUN A: PIHAK PERTAMA → Individu
    // ═══════════════════════════════════════════════════════════════
    console.log("=== RUN A: PIHAK PERTAMA → Individu ===\n");

    if (!await reachP8BahagianA(page)) { console.log("ERROR: Failed to reach p8 Bahagian A."); await ctx.close(); return; }

    const preUrlA = page.url();
    console.log(`On Bahagian A: ${preUrlA}`);

    // Screenshot before
    const tsA1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_tambah_pp_before_${tsA1}.png`, fullPage: true });

    // Click Pihak Pertama Individu via real portal UI
    console.log("Clicking Pihak Pertama Individu...");
    await page.evaluate(() => {
      const links = document.querySelectorAll("#bhgn-a a");
      for (const a of links) {
        if (/individu/i.test(a.textContent?.trim()) && a.href.includes("seller")) { a.click(); return; }
      }
    });
    await page.waitForTimeout(5000);

    const postUrlA = page.url();
    console.log(`URL after: ${postUrlA}`);
    console.log(`URL changed: ${postUrlA !== preUrlA}`);

    // Screenshot after
    const tsA2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_tambah_pp_after_${tsA2}.png`, fullPage: true });

    const uiA = await captureModalOrPageUI(page, "PIHAK_PERTAMA_INDIVIDU");
    printUI("PIHAK PERTAMA Individu", uiA);

    writeMarker("P8_TAMBAH_PP_INDIVIDU",
      `preUrl=${preUrlA}\npostUrl=${postUrlA}\nurlChanged=${postUrlA !== preUrlA}\n` +
      `uiType=${uiA.uiType}\ntitle="${uiA.title}"\n` +
      `labels=${uiA.labels.join("; ")}\n` +
      `controls=${uiA.controls.map(c => `${c.tag}:${c.name}/${c.id} ro=${c.readOnly} req=${c.required}`).join("; ")}\n` +
      `buttons=${uiA.buttons.map(b => `"${b.text}"`).join("; ")}\n` +
      `kpDisplay=${uiA.kpDisplay}`
    );

    // Close modal if present (without saving)
    if (uiA.uiType === "modal") {
      console.log("\nClosing modal without saving...");
      await page.evaluate(() => { const b = document.querySelector(".bootbox .close, [data-dismiss='modal']"); if (b) b.click(); });
      await page.waitForTimeout(1000);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1000);
    }

    // ═══════════════════════════════════════════════════════════════
    // RUN B: PIHAK KEDUA → Individu
    // ═══════════════════════════════════════════════════════════════
    console.log("\n\n=== RUN B: PIHAK KEDUA → Individu ===\n");

    // Re-open Bahagian A (might still be active)
    await page.evaluate(() => { for (const a of document.querySelectorAll('.nav-tabs a')) { if (/bahagian\s*a/i.test(a.textContent)) { a.click(); return; } } });
    await page.waitForTimeout(2000);

    const preUrlB = page.url();
    console.log(`On Bahagian A: ${preUrlB}`);

    // Screenshot before
    const tsB1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_tambah_pk_before_${tsB1}.png`, fullPage: true });

    // Click Pihak Kedua Individu
    console.log("Clicking Pihak Kedua Individu...");
    await page.evaluate(() => {
      const links = document.querySelectorAll("#bhgn-a a");
      for (const a of links) {
        if (/individu/i.test(a.textContent?.trim()) && a.href.includes("buyer")) { a.click(); return; }
      }
    });
    await page.waitForTimeout(5000);

    const postUrlB = page.url();
    console.log(`URL after: ${postUrlB}`);
    console.log(`URL changed: ${postUrlB !== preUrlB}`);

    // Screenshot after
    const tsB2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_tambah_pk_after_${tsB2}.png`, fullPage: true });

    const uiB = await captureModalOrPageUI(page, "PIHAK_KEDUA_INDIVIDU");
    printUI("PIHAK KEDUA Individu", uiB);

    writeMarker("P8_TAMBAH_PK_INDIVIDU",
      `preUrl=${preUrlB}\npostUrl=${postUrlB}\nurlChanged=${postUrlB !== preUrlB}\n` +
      `uiType=${uiB.uiType}\ntitle="${uiB.title}"\n` +
      `labels=${uiB.labels.join("; ")}\n` +
      `controls=${uiB.controls.map(c => `${c.tag}:${c.name}/${c.id} ro=${c.readOnly} req=${c.required}`).join("; ")}\n` +
      `buttons=${uiB.buttons.map(b => `"${b.text}"`).join("; ")}\n` +
      `kpDisplay=${uiB.kpDisplay}`
    );

    console.log(`\n=== P8 TAMBAH INDIVIDU INVESTIGATION COMPLETE ===`);
    console.log(`NO DATA ENTERED. NO SAVE. NO SUBMIT.`);

  } finally {
    await ctx.close();
  }
}

run().catch(err => { console.error("Failed:", err); process.exit(1); });
