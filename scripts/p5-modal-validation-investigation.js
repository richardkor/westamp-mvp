/**
 * P5 Landlord Modal — Validation + Reveal + Synthetic Fill Investigation
 *
 * Run A: Empty modal save
 * Run B: Identity reveal check (Warganegara/Bukan Warganegara inside modal)
 * Run C: Minimal synthetic fill + save
 *
 * NOTE: This script does NOT fill kpin or trigger the TIN lookup.
 * If any future modification adds kpin interaction, it MUST:
 *   - require ALLOW_LIVE_ID_LOOKUP=true
 *   - redact all returned TIN/name values
 *   - NOT use random/blind identity numbers
 *
 * Usage: node scripts/p5-modal-validation-investigation.js
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

console.log("\n=== P5 LANDLORD MODAL INVESTIGATION ===\n");

function writeMarker(name, body) {
  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(`${ARTIFACT_DIR}/${name}_${ts}.txt`, `${name}\n${new Date().toISOString()}\n${body}\n`);
  } catch {}
}

async function reachBahagianAAndOpenModal(page) {
  await page.goto("https://stamps.hasil.gov.my/stamps/form/application", { timeout: 30000, waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { for (const r of document.querySelectorAll('input[type="radio"]')) { if (r.parentElement?.textContent?.trim() === "Sewa / Pajakan") { r.click(); return; } } });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { const s = document.querySelector('select[name="CD_DUTISETEM_ID"]'); if (s) { for (let i=0;i<s.options.length;i++) { if (s.options[i].text.includes("Sarawak")) { s.selectedIndex=i; s.dispatchEvent(new Event("change",{bubbles:true})); break; } } } });
  await page.fill('input[name="tsd"]', "01");
  try { await page.locator("select").nth(2).selectOption({label:"Januari"}); } catch {}
  await page.waitForTimeout(500);
  await page.locator("button#btn-ma-submit").click();
  await page.waitForTimeout(5000);
  if (!page.url().includes("/formv2/p5/")) return false;
  await page.locator("#pds_suratcara").selectOption({value:"1101"});
  await page.locator("#pds_ps").selectOption({value:"p"});
  await page.waitForTimeout(500);
  await page.evaluate(() => { document.getElementById("pdsL01_bhgn_am")?.click(); });
  await page.waitForTimeout(5000);
  // Dismiss MA success modal
  await page.evaluate(() => { const b = document.querySelector(".bootbox .btn"); if (b) b.click(); });
  await page.waitForTimeout(1500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  // Switch to Bahagian A
  await page.evaluate(() => { for (const a of document.querySelectorAll('.nav-tabs a')) { if (/bahagian.a/i.test(a.textContent)) { a.click(); return; } } });
  await page.waitForTimeout(2000);
  // Click landlord Tambah Individu
  await page.evaluate(() => {
    for (const a of document.querySelectorAll("#bhgn-a a")) {
      if (/individu/i.test(a.textContent?.trim()) && a.href.includes("seller")) { a.click(); return; }
    }
  });
  await page.waitForTimeout(5000);
  // Verify modal is open
  const modalOpen = await page.evaluate(() => {
    const m = document.querySelector(".bootbox.in, .bootbox.show");
    return m ? m.getBoundingClientRect().width > 50 : false;
  });
  return modalOpen;
}

async function captureModalState(page, label) {
  const state = await page.evaluate(() => {
    const modal = document.querySelector(".bootbox.in, .bootbox.show");
    if (!modal) return { open: false };

    // Visible validation / invalid fields INSIDE modal
    const invalidFields = [];
    modal.querySelectorAll("input:invalid, select:invalid").forEach(el => {
      const r = el.getBoundingClientRect();
      invalidFields.push({
        name: el.name || "", id: el.id || "", type: el.type || "",
        msg: el.validationMessage || "",
        visible: r.width > 0 && r.height > 0,
      });
    });

    // All visible controls inside modal
    const controls = [];
    modal.querySelectorAll("input, select, textarea").forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      if (el.type === "hidden") return;
      controls.push({
        tag: el.tagName.toLowerCase(), type: el.type || "",
        name: el.name || "", id: el.id || "",
        value: (el.value || "").substring(0, 40),
        readOnly: el.readOnly || false, disabled: el.disabled || false,
        required: el.required || false,
      });
    });

    // Identity-specific checks inside modal
    const kpInModal = modal.querySelector("#kp");
    const kpDisplay = kpInModal ? window.getComputedStyle(kpInModal).display : "(not in modal)";

    const nokpRadios = [];
    modal.querySelectorAll('[name="EPD_NOKP_TYPE"]').forEach(r => {
      const rect = r.getBoundingClientRect();
      nokpRadios.push({ id: r.id, visible: rect.width > 0, display: window.getComputedStyle(r).display });
    });

    const tbCukai = modal.querySelector('[name="tb_cukai"]');
    const tbCukaiInModal = tbCukai ? {
      display: window.getComputedStyle(tbCukai).display,
      style: tbCukai.getAttribute("style") || "",
      required: tbCukai.required,
      value: tbCukai.value,
    } : null;

    const tbCukaiDisp = modal.querySelector('[name="tb_cukai_display"]');
    const tbCukaiDispInModal = tbCukaiDisp ? {
      visible: tbCukaiDisp.getBoundingClientRect().width > 0,
      readOnly: tbCukaiDisp.readOnly,
      value: tbCukaiDisp.value,
    } : null;

    // Any visible messages/errors
    const messages = [];
    modal.querySelectorAll(".alert, .text-danger, .has-error, .help-block, .error, [role='alert']").forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) messages.push((el.textContent || "").trim().substring(0, 100));
    });

    // Labels
    const labels = [];
    modal.querySelectorAll("label").forEach(l => {
      const r = l.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) labels.push(l.textContent?.trim().substring(0, 80) || "");
    });

    // Check for any newly visible fields (Jantina, Tarikh Lahir, No. Pengenalan Diri, Passport)
    const specialTexts = [];
    const walker = document.createTreeWalker(modal, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const txt = (node.textContent || "").trim();
      if (/jantina|tarikh lahir|pengenalan diri|passport|no\.?\s*kp|kad pengenalan|no\.?\s*polis|tentera/i.test(txt)) {
        const parent = node.parentElement;
        if (parent) {
          const r = parent.getBoundingClientRect();
          specialTexts.push({ text: txt.substring(0, 60), visible: r.width > 0 && r.height > 0, tag: parent.tagName.toLowerCase() });
        }
      }
    }

    return {
      open: true, invalidFields, controls, labels, messages,
      kpDisplay, nokpRadios, tbCukaiInModal, tbCukaiDispInModal,
      specialTexts,
    };
  });

  console.log(`\n--- Modal State: ${label} ---`);
  console.log(`Modal open: ${state.open}`);
  if (!state.open) return state;
  console.log(`Invalid fields (${state.invalidFields.length}):`);
  for (const f of state.invalidFields) console.log(`  ${f.name}/${f.id} type=${f.type} vis=${f.visible} msg="${f.msg}"`);
  console.log(`Visible controls (${state.controls.length}):`);
  for (const c of state.controls) console.log(`  ${c.tag} type=${c.type} name="${c.name}" id="${c.id}" value="${c.value}" ro=${c.readOnly} req=${c.required}`);
  console.log(`Labels (${state.labels.length}): ${state.labels.join("; ")}`);
  console.log(`Messages: ${state.messages.length > 0 ? state.messages.join("; ") : "none"}`);
  console.log(`div#kp in modal: display="${state.kpDisplay}"`);
  console.log(`EPD_NOKP_TYPE radios in modal: ${state.nokpRadios.map(r => `${r.id}:vis=${r.visible}`).join(", ") || "none"}`);
  console.log(`tb_cukai in modal: ${state.tbCukaiInModal ? `display=${state.tbCukaiInModal.display} req=${state.tbCukaiInModal.required}` : "not found"}`);
  console.log(`tb_cukai_display in modal: ${state.tbCukaiDispInModal ? `vis=${state.tbCukaiDispInModal.visible} ro=${state.tbCukaiDispInModal.readOnly}` : "not found"}`);
  console.log(`Special identity text (${state.specialTexts.length}):`);
  for (const st of state.specialTexts) console.log(`  "${st.text}" vis=${st.visible} tag=${st.tag}`);
  return state;
}

async function run() {
  const profilePath = path.resolve(PROFILE_DIR);
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false, channel: "chrome", viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = context.pages()[0] || await context.newPage();

  try {
    // ══════════════════════════════════════════════════════════════
    // RUN A: EMPTY MODAL SAVE
    // ══════════════════════════════════════════════════════════════
    console.log("=== RUN A: EMPTY MODAL SAVE ===\n");
    const modalOpenA = await reachBahagianAAndOpenModal(page);
    if (!modalOpenA) { console.log("ERROR: Modal not open for Run A."); await context.close(); return; }

    const ts_a1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_modal_empty_before_${ts_a1}.png`, fullPage: true });

    // Register dialog handler
    let dialogA = { captured: false, msg: "" };
    page.on("dialog", async d => { dialogA.captured = true; dialogA.msg = d.message(); await d.accept(); });

    // Click Simpan inside the modal using real browser-level click
    console.log("Clicking modal Simpan (empty)...");
    const simpan = page.locator('.bootbox input[type="submit"][value*="Simpan"]');
    if (await simpan.isVisible({ timeout: 3000 }).catch(() => false)) {
      await simpan.click({ timeout: 5000 });
    } else {
      // Try any submit in modal
      await page.locator('.bootbox input[type="submit"]').first().click({ timeout: 5000 });
    }
    await page.waitForTimeout(3000);

    console.log(`Dialog: ${dialogA.captured ? dialogA.msg.substring(0, 100) : "none"}`);

    const ts_a2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_modal_empty_after_${ts_a2}.png`, fullPage: true });

    const stateA = await captureModalState(page, "EMPTY_SAVE");
    writeMarker("P5_MODAL_EMPTY_SAVE",
      `dialog=${dialogA.captured ? dialogA.msg.substring(0, 100) : "none"}\n` +
      `modalStillOpen=${stateA.open}\n` +
      `invalidFields=${stateA.invalidFields?.map(f => `${f.name}:"${f.msg}"`).join("; ")}\n` +
      `kpDisplay=${stateA.kpDisplay}\n` +
      `tbCukai=${JSON.stringify(stateA.tbCukaiInModal)}`
    );

    // Close modal cleanly for next run
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);
    await page.evaluate(() => { const b = document.querySelector(".bootbox .close, .bootbox [data-dismiss='modal']"); if (b) b.click(); });
    await page.waitForTimeout(1000);

    // ══════════════════════════════════════════════════════════════
    // RUN B: IDENTITY REVEAL CHECK — WARGANEGARA INSIDE MODAL
    // ══════════════════════════════════════════════════════════════
    console.log("\n\n=== RUN B: IDENTITY REVEAL CHECK ===\n");
    // Open fresh modal
    const modalOpenB = await reachBahagianAAndOpenModal(page);
    if (!modalOpenB) { console.log("ERROR: Modal not open for Run B."); await context.close(); return; }

    console.log("--- B1: Before warganegara selection ---");
    const stateB0 = await captureModalState(page, "B_INITIAL");

    console.log("\n--- B2: Selecting Warganegara inside modal ---");
    await page.locator('.bootbox #warga').selectOption({ value: "1" });
    await page.waitForTimeout(3000);
    const ts_b1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_modal_warganegara_${ts_b1}.png`, fullPage: true });
    const stateB1 = await captureModalState(page, "B_WARGANEGARA");

    console.log("\n--- B3: Selecting Bukan Warganegara inside modal ---");
    await page.locator('.bootbox #warga').selectOption({ value: "2" });
    await page.waitForTimeout(3000);
    const ts_b2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_modal_bukanwarga_${ts_b2}.png`, fullPage: true });
    const stateB2 = await captureModalState(page, "B_BUKAN_WARGANEGARA");

    writeMarker("P5_MODAL_IDENTITY_REVEAL",
      `INITIAL: kpDisplay=${stateB0.kpDisplay} nokp=${stateB0.nokpRadios?.length} tbCukai=${JSON.stringify(stateB0.tbCukaiInModal)} specialTexts=${stateB0.specialTexts?.map(s => `"${s.text}" vis=${s.visible}`).join("; ")}\n` +
      `WARGANEGARA: kpDisplay=${stateB1.kpDisplay} nokp_visible=${stateB1.nokpRadios?.some(r => r.visible)} controls=${stateB1.controls?.length} specialTexts=${stateB1.specialTexts?.map(s => `"${s.text}" vis=${s.visible}`).join("; ")}\n` +
      `BUKAN_WARGANEGARA: kpDisplay=${stateB2.kpDisplay} nokp_visible=${stateB2.nokpRadios?.some(r => r.visible)} controls=${stateB2.controls?.length} specialTexts=${stateB2.specialTexts?.map(s => `"${s.text}" vis=${s.visible}`).join("; ")}`
    );

    // Close modal
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);
    await page.evaluate(() => { const b = document.querySelector(".bootbox .close"); if (b) b.click(); });
    await page.waitForTimeout(1000);

    // ══════════════════════════════════════════════════════════════
    // RUN C: MINIMAL SYNTHETIC FILL + SAVE
    // ══════════════════════════════════════════════════════════════
    console.log("\n\n=== RUN C: MINIMAL SYNTHETIC FILL + SAVE ===\n");
    const modalOpenC = await reachBahagianAAndOpenModal(page);
    if (!modalOpenC) { console.log("ERROR: Modal not open for Run C."); await context.close(); return; }

    // Capture landlord table before
    const tableBeforeC = await page.evaluate(() => {
      const rows = [];
      document.querySelectorAll("table tbody tr").forEach(tr => {
        const r = tr.getBoundingClientRect();
        if (r.width > 0) rows.push((tr.textContent || "").trim().substring(0, 80));
      });
      return rows;
    });
    console.log(`Landlord table rows before: ${tableBeforeC.length}`);

    // Fill synthetic values inside modal
    console.log("Filling synthetic values in modal...");
    await page.locator('.bootbox #tb_nama').fill("TEST LANDLORD NAME");
    await page.locator('.bootbox #warga').selectOption({ value: "1" }); // Warganegara
    await page.waitForTimeout(1000);
    await page.locator('.bootbox #tb_alamat_1').fill("TEST ADDRESS LINE 1");
    await page.locator('.bootbox #tb_alamat_2').fill("TEST ADDRESS LINE 2");
    await page.locator('.bootbox #tb_city').fill("TEST CITY");
    await page.locator('.bootbox #negeri1').selectOption({ value: "11" }); // Sarawak
    await page.locator('.bootbox #tb_poskod').fill("93000");
    await page.locator('.bootbox #tb_telno').fill("0000000000");
    await page.waitForTimeout(1000);

    const ts_c1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_modal_synth_filled_${ts_c1}.png`, fullPage: true });

    // Check invalid count before save
    const preSaveC = await captureModalState(page, "C_PRE_SAVE");

    // Register fresh dialog handler
    page.removeAllListeners("dialog");
    let dialogC = { captured: false, msg: "" };
    page.on("dialog", async d => { dialogC.captured = true; dialogC.msg = d.message(); console.log(`  DIALOG: "${d.message().substring(0, 100)}"`); await d.accept(); });

    // Click Simpan using REAL browser-level click
    console.log("\nClicking modal Simpan (synthetic fill)...");
    const simpanC = page.locator('.bootbox input[type="submit"][value*="Simpan"]');
    await simpanC.click({ timeout: 5000 });
    await page.waitForTimeout(8000);

    console.log(`Dialog: ${dialogC.captured ? dialogC.msg.substring(0, 100) : "none"}`);
    console.log(`URL: ${page.url()}`);

    const ts_c2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_modal_synth_after_save_${ts_c2}.png`, fullPage: true });

    // Check if modal is still open
    const modalStillOpenC = await page.evaluate(() => {
      const m = document.querySelector(".bootbox.in, .bootbox.show");
      return m ? m.getBoundingClientRect().width > 50 : false;
    });
    console.log(`Modal still open: ${modalStillOpenC}`);

    const stateCPost = await captureModalState(page, "C_POST_SAVE");

    // Check landlord table after
    const tableAfterC = await page.evaluate(() => {
      const rows = [];
      document.querySelectorAll("table tbody tr").forEach(tr => {
        const r = tr.getBoundingClientRect();
        if (r.width > 0) rows.push((tr.textContent || "").trim().substring(0, 120));
      });
      return rows;
    });
    console.log(`\nLandlord table rows after: ${tableAfterC.length}`);
    for (const row of tableAfterC) console.log(`  "${row.substring(0, 80)}"`);

    writeMarker("P5_MODAL_SYNTH_SAVE",
      `dialog=${dialogC.captured ? dialogC.msg.substring(0, 150) : "none"}\n` +
      `modalStillOpen=${modalStillOpenC}\n` +
      `preSave_invalidCount=${preSaveC.invalidFields?.length}\n` +
      `preSave_invalidFields=${preSaveC.invalidFields?.map(f => `${f.name}:"${f.msg}"`).join("; ")}\n` +
      `postSave_invalidCount=${stateCPost.invalidFields?.length}\n` +
      `tableRowsBefore=${tableBeforeC.length}\n` +
      `tableRowsAfter=${tableAfterC.length}\n` +
      `newRows=${tableAfterC.filter(r => !tableBeforeC.includes(r)).join("; ")}`
    );

    console.log(`\n=== INVESTIGATION COMPLETE ===`);
    console.log(`NO REAL DATA. TENANT NOT TOUCHED. NO OVERALL SUBMIT.`);

  } finally {
    await context.close();
  }
}

run().catch((err) => {
  console.error("Investigation failed:", err);
  process.exit(1);
});
