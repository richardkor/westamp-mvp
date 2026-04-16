/**
 * P8 Pihak Pertama Modal — Identity Reveal Check
 *
 * Run A: Baseline
 * Run B: Warganegara reveal
 * Run C: Bukan Warganegara reveal
 *
 * No identity data entered. No save. No submit.
 *
 * WARNING: Do NOT add kpin/identity interaction without requiring
 * ALLOW_LIVE_ID_LOOKUP=true and redacting returned TIN/name values.
 *
 * Usage: node scripts/p8-modal-reveal-check.js
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

console.log("\n=== P8 MODAL IDENTITY REVEAL CHECK ===\n");

function writeMarker(name, body) {
  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(`${ARTIFACT_DIR}/${name}_${ts}.txt`, `${name}\n${new Date().toISOString()}\n${body}\n`);
  } catch {}
}

async function captureIdentityState(page, label) {
  const state = await page.evaluate(() => {
    const modal = document.querySelector(".bootbox.in, .bootbox.show");
    if (!modal) return { open: false };

    const get = (sel) => {
      const el = modal.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        visible: r.width > 0 && r.height > 0,
        display: window.getComputedStyle(el).display,
        value: el.value || "",
        readOnly: el.readOnly || false,
        required: el.required || false,
      };
    };

    const kp = modal.querySelector("#kp");
    const kpDisplay = kp ? window.getComputedStyle(kp).display : "(not found)";

    const radios = {};
    modal.querySelectorAll('[name="EPD_NOKP_TYPE"]').forEach(r => {
      radios[r.id] = { visible: r.getBoundingClientRect().width > 0, checked: r.checked };
    });

    const kpin = get('#kpin, [name="kpin"]');
    const passportin = get('#passportin, [name="passportin"]');
    const negara1 = get('#negara1, [name="negara1"]');
    const tbCukai = get('[name="tb_cukai"]');
    const tbCukaiDisp = get('[name="tb_cukai_display"]');

    // Jantina
    const jantinaRadio = modal.querySelector('[name="USER_SEX"]');
    let jantinaVis = false;
    if (jantinaRadio) jantinaVis = jantinaRadio.getBoundingClientRect().width > 0;
    let jantinaLabelVis = false;
    modal.querySelectorAll("label").forEach(l => {
      if (/jantina/i.test(l.textContent) && l.getBoundingClientRect().width > 0) jantinaLabelVis = true;
    });

    // Tarikh Lahir
    const tarikhInput = get('#DSD_APPLY_DATE, [name="DSD_APPLY_DATE"]');
    let tarikhLabelVis = false;
    modal.querySelectorAll("label").forEach(l => {
      if (/tarikh lahir/i.test(l.textContent) && l.getBoundingClientRect().width > 0) tarikhLabelVis = true;
    });

    // Visible control count
    let controlCount = 0;
    modal.querySelectorAll("input, select, textarea").forEach(el => {
      if (el.getBoundingClientRect().width > 0 && el.type !== "hidden") controlCount++;
    });

    // Labels
    const labels = [];
    modal.querySelectorAll("label").forEach(l => {
      if (l.getBoundingClientRect().width > 0) labels.push(l.textContent?.trim().substring(0, 60) || "");
    });

    // Messages
    const messages = [];
    modal.querySelectorAll("strong, .nota").forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const txt = (el.textContent || "").trim();
        if (txt.length > 5 && /nota|pengenalan|cukai|tin|tidak|passport/i.test(txt))
          messages.push(txt.substring(0, 120));
      }
    });

    return {
      open: true, kpDisplay, radios, kpin, passportin, negara1,
      tbCukai, tbCukaiDisp,
      jantinaVis, jantinaLabelVis,
      tarikhInput, tarikhLabelVis,
      controlCount, labels, messages,
    };
  });

  console.log(`\n--- ${label} ---`);
  if (!state.open) { console.log("Modal not open."); return state; }
  console.log(`div#kp: ${state.kpDisplay}`);
  console.log(`EPD_NOKP_TYPE: ${Object.entries(state.radios).map(([k,v]) => `${k}:vis=${v.visible}`).join(", ") || "none found"}`);
  console.log(`kpin: ${state.kpin ? `vis=${state.kpin.visible} req=${state.kpin.required}` : "not found"}`);
  console.log(`passportin: ${state.passportin ? `vis=${state.passportin.visible} req=${state.passportin.required}` : "not found"}`);
  console.log(`negara1: ${state.negara1 ? `vis=${state.negara1.visible} req=${state.negara1.required}` : "not found"}`);
  console.log(`tb_cukai: ${state.tbCukai ? `vis=${state.tbCukai.visible} display=${state.tbCukai.display} req=${state.tbCukai.required}` : "not found"}`);
  console.log(`tb_cukai_display: ${state.tbCukaiDisp ? `vis=${state.tbCukaiDisp.visible} ro=${state.tbCukaiDisp.readOnly}` : "not found"}`);
  console.log(`Jantina: radio_vis=${state.jantinaVis} label_vis=${state.jantinaLabelVis}`);
  console.log(`Tarikh Lahir: input_vis=${state.tarikhInput ? state.tarikhInput.visible : "not found"} label_vis=${state.tarikhLabelVis}`);
  console.log(`Visible controls: ${state.controlCount}`);
  console.log(`Labels (${state.labels.length}): ${state.labels.join("; ")}`);
  console.log(`Messages: ${state.messages.length > 0 ? state.messages.join("; ") : "none"}`);
  return state;
}

async function reachP8AndOpenModal(page) {
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

  await page.evaluate(() => { for (const a of document.querySelectorAll('.nav-tabs a')) { if (/bahagian\s*a/i.test(a.textContent)) { a.click(); return; } } });
  await page.waitForTimeout(2000);

  // Open Pihak Pertama Individu modal
  await page.evaluate(() => {
    for (const a of document.querySelectorAll("#bhgn-a a")) {
      if (/individu/i.test(a.textContent?.trim()) && a.href.includes("seller")) { a.click(); return; }
    }
  });
  await page.waitForTimeout(5000);

  const open = await page.evaluate(() => {
    const m = document.querySelector(".bootbox.in, .bootbox.show");
    return m ? m.getBoundingClientRect().width > 50 : false;
  });
  return open;
}

async function run() {
  const ctx = await chromium.launchPersistentContext(path.resolve(PROFILE_DIR), {
    headless: false, channel: "chrome", viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  try {
    // ═══════════════════════════════════════════════════════════════
    // RUN A: BASELINE
    // ═══════════════════════════════════════════════════════════════
    console.log("=== RUN A: P8 MODAL BASELINE ===");
    if (!await reachP8AndOpenModal(page)) { console.log("ERROR: Failed."); await ctx.close(); return; }
    const tsA = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_reveal_a_baseline_${tsA}.png`, fullPage: true });
    const stateA = await captureIdentityState(page, "A: BASELINE");
    writeMarker("P8_REVEAL_A_BASELINE", JSON.stringify(stateA, null, 2));
    await page.keyboard.press("Escape"); await page.waitForTimeout(1000);
    await page.evaluate(() => { const b = document.querySelector(".bootbox .close"); if (b) b.click(); }); await page.waitForTimeout(1000);

    // ═══════════════════════════════════════════════════════════════
    // RUN B: WARGANEGARA
    // ═══════════════════════════════════════════════════════════════
    console.log("\n\n=== RUN B: WARGANEGARA ===");
    if (!await reachP8AndOpenModal(page)) { console.log("ERROR: Failed."); await ctx.close(); return; }
    await page.locator('.bootbox #warga').selectOption({ value: "1" });
    await page.waitForTimeout(2000);
    const tsB = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_reveal_b_warganegara_${tsB}.png`, fullPage: true });
    const stateB = await captureIdentityState(page, "B: WARGANEGARA");
    writeMarker("P8_REVEAL_B_WARGANEGARA", JSON.stringify(stateB, null, 2));
    await page.keyboard.press("Escape"); await page.waitForTimeout(1000);
    await page.evaluate(() => { const b = document.querySelector(".bootbox .close"); if (b) b.click(); }); await page.waitForTimeout(1000);

    // ═══════════════════════════════════════════════════════════════
    // RUN C: BUKAN WARGANEGARA
    // ═══════════════════════════════════════════════════════════════
    console.log("\n\n=== RUN C: BUKAN WARGANEGARA ===");
    if (!await reachP8AndOpenModal(page)) { console.log("ERROR: Failed."); await ctx.close(); return; }
    await page.locator('.bootbox #warga').selectOption({ value: "2" });
    await page.waitForTimeout(2000);
    const tsC = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_reveal_c_bukanwarga_${tsC}.png`, fullPage: true });
    const stateC = await captureIdentityState(page, "C: BUKAN WARGANEGARA");
    writeMarker("P8_REVEAL_C_BUKANWARGA", JSON.stringify(stateC, null, 2));

    // ═══════════════════════════════════════════════════════════════
    // COMPARISON
    // ═══════════════════════════════════════════════════════════════
    console.log("\n\n=== COMPARISON: p8 vs p5 pattern ===");
    console.log("Baseline: div#kp=" + stateA.kpDisplay + " controls=" + stateA.controlCount);
    console.log("Warganegara: div#kp=" + stateB.kpDisplay + " kpin=" + (stateB.kpin?.visible ? "VIS" : "hidden") + " radios=" + Object.values(stateB.radios || {}).some(r => r.visible) + " controls=" + stateB.controlCount);
    console.log("Bukan Warga: div#kp=" + stateC.kpDisplay + " passportin=" + (stateC.passportin?.visible ? "VIS" : "hidden") + " negara1=" + (stateC.negara1?.visible ? "VIS" : "hidden") + " controls=" + stateC.controlCount);

    console.log(`\n=== COMPLETE. NO DATA. NO SAVE. NO SUBMIT. ===`);

  } finally {
    await ctx.close();
  }
}

run().catch(err => { console.error("Failed:", err); process.exit(1); });
