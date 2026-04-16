/**
 * P5 Landlord Seller Form — Validation Investigation
 *
 * Run A: Click Simpan on empty form, capture validation behavior.
 * Run B: Fill minimum synthetic required fields, click Simpan, capture result.
 *
 * NOTE: This script uses the /seller/ page which is NOT the primary
 * portal interaction path. The real add-party UI is the Bootbox modal
 * on the /edit/ page. This script exists for historical reference only.
 *
 * WARNING: Do NOT add kpin/identity interaction without requiring
 * ALLOW_LIVE_ID_LOOKUP=true and redacting returned TIN/name values.
 *
 * Usage: node scripts/p5-seller-validation-investigation.js
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

console.log("\n=== P5 SELLER FORM VALIDATION INVESTIGATION ===\n");

function writeMarker(name, body) {
  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(`${ARTIFACT_DIR}/${name}_${ts}.txt`, `${name}\n${new Date().toISOString()}\n${body}\n`);
  } catch {}
}

async function captureValidationState(page, label) {
  const state = await page.evaluate(() => {
    // Visible validation messages / errors
    const messages = [];

    // Check for alert/bootbox/modal
    const modalSelectors = [".modal.show", ".modal.in", ".bootbox", "[role='dialog']", ".swal2-popup"];
    for (const sel of modalSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 50 && r.height > 50) {
          messages.push({ type: "modal", text: (el.textContent || "").trim().substring(0, 300), selector: sel });
        }
      }
    }

    // Check for native browser validation (HTML5 :invalid)
    const invalidFields = [];
    document.querySelectorAll("input:invalid, select:invalid, textarea:invalid").forEach((el) => {
      const inp = el;
      const r = inp.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      invalidFields.push({
        tag: inp.tagName.toLowerCase(),
        name: inp.name || "",
        id: inp.id || "",
        validationMessage: inp.validationMessage || "",
        type: inp.type || "",
      });
    });

    // Check for CSS-based validation classes
    const cssInvalid = [];
    document.querySelectorAll(".has-error, .is-invalid, .error, .field-error, .text-danger, .invalid-feedback").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        cssInvalid.push({
          text: (el.textContent || "").trim().substring(0, 100),
          className: (el.className || "").toString().substring(0, 60),
          tag: el.tagName.toLowerCase(),
        });
      }
    });

    // Check for any visible alert divs
    document.querySelectorAll(".alert, [role='alert']").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        messages.push({ type: "alert", text: (el.textContent || "").trim().substring(0, 200), selector: ".alert" });
      }
    });

    // Current field values
    const fieldValues = {};
    document.querySelectorAll("input, select, textarea").forEach((el) => {
      const inp = el;
      const r = inp.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      if (inp.type === "hidden") return;
      const key = inp.name || inp.id || `unnamed_${inp.type}`;
      if (inp.tagName.toLowerCase() === "select") {
        const sel = el;
        fieldValues[key] = sel.options[sel.selectedIndex]?.text || "";
      } else if (inp.type === "radio") {
        if (inp.checked) fieldValues[inp.name] = inp.value;
      } else {
        fieldValues[key] = inp.value || "";
      }
    });

    // tb_cukai_display specifically
    const tcd = document.querySelector('[name="tb_cukai_display"]');
    const tbCukaiValue = tcd ? tcd.value : "(not found)";
    const tbCukaiReadOnly = tcd ? tcd.readOnly : false;

    return { messages, invalidFields, cssInvalid, fieldValues, tbCukaiValue, tbCukaiReadOnly };
  });

  console.log(`\n--- Validation State: ${label} ---`);
  console.log(`Messages (${state.messages.length}):`);
  for (const m of state.messages) console.log(`  [${m.type}] "${m.text.substring(0, 120)}"`);
  console.log(`HTML5 invalid fields (${state.invalidFields.length}):`);
  for (const f of state.invalidFields) console.log(`  ${f.tag} name="${f.name}" id="${f.id}" type=${f.type} msg="${f.validationMessage}"`);
  console.log(`CSS invalid (${state.cssInvalid.length}):`);
  for (const c of state.cssInvalid) console.log(`  [${c.tag}] class="${c.className}" text="${c.text.substring(0, 60)}"`);
  console.log(`tb_cukai_display: value="${state.tbCukaiValue}" readOnly=${state.tbCukaiReadOnly}`);

  return state;
}

async function reachSellerForm(page) {
  // Navigate → Sewa/Pajakan → shared fill → save to p5 → select doc → save MA → Bahagian A → seller
  console.log("Navigating to application form...");
  await page.goto("https://stamps.hasil.gov.my/stamps/form/application", {
    timeout: 30000, waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(3000);

  await page.evaluate(() => {
    const radios = document.querySelectorAll('input[type="radio"]');
    for (const r of radios) {
      if (r.parentElement?.textContent?.trim() === "Sewa / Pajakan") { r.click(); return; }
    }
  });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const sel = document.querySelector('select[name="CD_DUTISETEM_ID"]');
    if (sel) { for (let i = 0; i < sel.options.length; i++) { if (sel.options[i].text.includes("Sarawak")) { sel.selectedIndex = i; sel.dispatchEvent(new Event("change", { bubbles: true })); break; } } }
  });
  await page.fill('input[name="tsd"]', "01");
  await page.waitForTimeout(500);
  try { await page.locator("select").nth(2).selectOption({ label: "Januari" }); } catch {}
  await page.waitForTimeout(500);
  await page.locator("button#btn-ma-submit").click();
  await page.waitForTimeout(5000);

  if (!page.url().includes("/formv2/p5/")) {
    console.log("ERROR: Not on p5."); return false;
  }

  // Select Perjanjian Sewa + Prinsipal + save
  await page.locator("#pds_suratcara").selectOption({ value: "1101" });
  await page.waitForTimeout(500);
  await page.locator("#pds_ps").selectOption({ value: "p" });
  await page.waitForTimeout(500);
  await page.evaluate(() => { document.getElementById("pdsL01_bhgn_am")?.click(); });
  await page.waitForTimeout(5000);

  // Dismiss success modal
  await page.evaluate(() => {
    const btn = document.querySelector(".bootbox .btn, .bootbox .close, [data-dismiss='modal']");
    if (btn) btn.click();
  });
  await page.waitForTimeout(1000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // Switch to Bahagian A
  await page.evaluate(() => {
    const links = document.querySelectorAll('.nav-tabs a');
    for (const a of links) { if (/bahagian\s*a/i.test(a.textContent?.trim())) { a.click(); return; } }
  });
  await page.waitForTimeout(2000);

  // Get seller href
  const sellerHref = await page.evaluate(() => {
    const links = document.querySelectorAll("#bhgn-a a");
    for (const a of links) {
      if (/individu/i.test(a.textContent?.trim()) && a.href.includes("seller")) {
        return a.href;
      }
    }
    return null;
  });

  if (!sellerHref) {
    console.log("ERROR: Seller href not found."); return false;
  }

  console.log(`Navigating to seller form: ${sellerHref}`);
  await page.goto(sellerHref, { timeout: 30000, waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  console.log(`Seller form URL: ${page.url()}`);
  return true;
}

async function run() {
  const profilePath = path.resolve(PROFILE_DIR);
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false, channel: "chrome", viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = context.pages()[0] || await context.newPage();

  try {
    // ══════════════════════════════════════════════════════════════════
    // RUN A: Empty save
    // ══════════════════════════════════════════════════════════════════
    console.log("=== RUN A: EMPTY SAVE ===\n");

    const reachedA = await reachSellerForm(page);
    if (!reachedA) { await context.close(); return; }

    // Screenshot: empty form before save
    const tsA1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_seller_empty_before_save_${tsA1}.png`, fullPage: true });

    // Register dialog handler
    let dialogA = { captured: false, message: "" };
    page.on("dialog", async (dialog) => {
      dialogA.captured = true;
      dialogA.message = dialog.message();
      console.log(`  Dialog: type=${dialog.type()} message="${dialogA.message.substring(0, 150)}"`);
      await dialog.accept();
    });

    // Click Simpan on empty form
    console.log("Clicking Simpan on empty form...");
    const simpanClicked = await page.evaluate(() => {
      const btn = document.querySelector('input[type="submit"][value*="Simpan"], button[type="submit"]');
      if (btn) { btn.click(); return true; }
      return false;
    });
    console.log(`Simpan clicked: ${simpanClicked}`);
    await page.waitForTimeout(5000);

    const postSaveUrlA = page.url();
    console.log(`Post-save URL: ${postSaveUrlA}`);
    console.log(`Dialog captured: ${dialogA.captured}${dialogA.captured ? ` msg="${dialogA.message.substring(0, 100)}"` : ""}`);

    // Screenshot: after empty save
    const tsA2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_seller_empty_after_save_${tsA2}.png`, fullPage: true });

    const validationA = await captureValidationState(page, "EMPTY_SAVE");

    writeMarker("P5_SELLER_EMPTY_SAVE",
      `url=${postSaveUrlA}\n` +
      `dialogCaptured=${dialogA.captured}${dialogA.captured ? ` msg="${dialogA.message.substring(0, 200)}"` : ""}\n` +
      `messages=${validationA.messages.map(m => `[${m.type}]"${m.text.substring(0, 80)}"`).join("; ")}\n` +
      `invalidFields=${validationA.invalidFields.map(f => `${f.name}:"${f.validationMessage}"`).join("; ")}\n` +
      `cssInvalid=${validationA.cssInvalid.map(c => `"${c.text.substring(0, 40)}"`).join("; ")}\n` +
      `tbCukai="${validationA.tbCukaiValue}"`
    );

    // ══════════════════════════════════════════════════════════════════
    // RUN B: Minimal synthetic fill
    // Only proceed if Run A is understood and doesn't reveal blocking
    // identity-verification requirements
    // ══════════════════════════════════════════════════════════════════
    console.log("\n\n=== RUN B: MINIMAL SYNTHETIC FILL ===\n");

    // Need a fresh seller form — navigate back to application form
    const reachedB = await reachSellerForm(page);
    if (!reachedB) { await context.close(); return; }

    // Screenshot: before fill
    const tsB1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_seller_synth_before_fill_${tsB1}.png`, fullPage: true });

    // Fill minimum required fields with synthetic placeholders
    console.log("Filling synthetic required fields...");

    // Nama
    await page.fill('#tb_nama', 'TEST LANDLORD NAME');
    await page.waitForTimeout(300);

    // Status Warganegara
    await page.locator('#warga').selectOption({ value: '1' }); // Warganegara
    await page.waitForTimeout(300);

    // Jantina — click Lelaki radio
    await page.locator('#USER_SEX-1').click();
    await page.waitForTimeout(300);

    // Tarikh Lahir
    await page.fill('#DSD_APPLY_DATE', '01/01/1990');
    await page.waitForTimeout(300);

    // Alamat (3 lines)
    await page.fill('#tb_alamat_1', 'TEST ADDRESS LINE 1');
    await page.waitForTimeout(200);
    await page.fill('#tb_alamat_2', 'TEST ADDRESS LINE 2');
    await page.waitForTimeout(200);
    await page.fill('#tb_alamat_3', 'TEST ADDRESS LINE 3');
    await page.waitForTimeout(200);

    // Bandar
    await page.fill('#tb_city', 'TEST CITY');
    await page.waitForTimeout(200);

    // Negeri
    await page.locator('#negeri1').selectOption({ value: '11' }); // Sarawak
    await page.waitForTimeout(300);

    // Negara — already MALAYSIA by default, leave it
    // Poskod
    await page.fill('#tb_poskod', '93000');
    await page.waitForTimeout(200);

    // No. Telefon
    await page.fill('#tb_telno', '0000000000');
    await page.waitForTimeout(200);

    // E-mail (not required, leave blank)

    // Screenshot: after synthetic fill, before save
    const tsB2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_seller_synth_after_fill_${tsB2}.png`, fullPage: true });

    // Capture field values
    const preSaveB = await captureValidationState(page, "SYNTH_FILL_BEFORE_SAVE");
    console.log("\nField values before save:");
    for (const [k, v] of Object.entries(preSaveB.fieldValues)) {
      if (v) console.log(`  ${k}: "${v}"`);
    }

    // Register dialog handler
    let dialogB = { captured: false, message: "" };
    page.removeAllListeners("dialog");
    page.on("dialog", async (dialog) => {
      dialogB.captured = true;
      dialogB.message = dialog.message();
      console.log(`  Dialog: type=${dialog.type()} message="${dialogB.message.substring(0, 150)}"`);
      await dialog.accept();
    });

    // Click Simpan
    console.log("\nClicking Simpan after synthetic fill...");
    await page.evaluate(() => {
      const btn = document.querySelector('input[type="submit"][value*="Simpan"], button[type="submit"]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(5000);

    const postSaveUrlB = page.url();
    console.log(`Post-save URL: ${postSaveUrlB}`);
    console.log(`URL changed: ${postSaveUrlB !== page.url()}`);
    console.log(`Dialog captured: ${dialogB.captured}${dialogB.captured ? ` msg="${dialogB.message.substring(0, 100)}"` : ""}`);

    // Screenshot: after synthetic save
    const tsB3 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_seller_synth_after_save_${tsB3}.png`, fullPage: true });

    const validationB = await captureValidationState(page, "SYNTH_SAVE");

    writeMarker("P5_SELLER_SYNTH_SAVE",
      `url=${postSaveUrlB}\n` +
      `dialogCaptured=${dialogB.captured}${dialogB.captured ? ` msg="${dialogB.message.substring(0, 200)}"` : ""}\n` +
      `messages=${validationB.messages.map(m => `[${m.type}]"${m.text.substring(0, 80)}"`).join("; ")}\n` +
      `invalidFields=${validationB.invalidFields.map(f => `${f.name}:"${f.validationMessage}"`).join("; ")}\n` +
      `cssInvalid=${validationB.cssInvalid.map(c => `"${c.text.substring(0, 40)}"`).join("; ")}\n` +
      `tbCukai="${validationB.tbCukaiValue}"\n` +
      `backOnBahagianA=${postSaveUrlB.includes("/edit/")}`
    );

    console.log(`\n=== SELLER VALIDATION INVESTIGATION COMPLETE ===`);
    console.log(`NO REAL DATA USED. TENANT NOT TOUCHED. NO OVERALL SUBMIT.`);

  } finally {
    await context.close();
  }
}

run().catch((err) => {
  console.error("Investigation failed:", err);
  process.exit(1);
});
