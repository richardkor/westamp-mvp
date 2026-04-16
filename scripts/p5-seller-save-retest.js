/**
 * P5 Seller Form — Save Retest with Real Browser Interaction
 *
 * Fills minimum required fields with synthetic data, triggers save
 * via Playwright locator click (not page.evaluate), captures outcome.
 *
 * WARNING: Do NOT add kpin/identity interaction without requiring
 * ALLOW_LIVE_ID_LOOKUP=true and redacting returned TIN/name values.
 *
 * Usage: node scripts/p5-seller-save-retest.js
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

console.log("\n=== P5 SELLER FORM SAVE RETEST ===\n");

function writeMarker(name, body) {
  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(`${ARTIFACT_DIR}/${name}_${ts}.txt`, `${name}\n${new Date().toISOString()}\n${body}\n`);
  } catch {}
}

async function run() {
  const profilePath = path.resolve(PROFILE_DIR);
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false, channel: "chrome", viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = context.pages()[0] || await context.newPage();

  try {
    // ── Reach seller form via supported path ────────────────────────
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
      console.log("ERROR: Not on p5."); await context.close(); return;
    }

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
        if (/individu/i.test(a.textContent?.trim()) && a.href.includes("seller")) return a.href;
      }
      return null;
    });
    if (!sellerHref) { console.log("ERROR: No seller link."); await context.close(); return; }

    console.log(`Navigating to seller form: ${sellerHref}`);
    await page.goto(sellerHref, { timeout: 30000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    const sellerUrl = page.url();
    console.log(`Seller form URL: ${sellerUrl}\n`);

    // ── Fill synthetic required fields ──────────────────────────────
    console.log("Filling synthetic required fields...");
    await page.locator("#tb_nama").fill("TEST LANDLORD NAME");
    await page.locator("#warga").selectOption({ value: "1" });
    await page.locator("#USER_SEX-1").click();
    await page.locator("#DSD_APPLY_DATE").fill("01/01/1990");
    await page.locator("#tb_alamat_1").fill("TEST ADDRESS LINE 1");
    await page.locator("#tb_alamat_2").fill("TEST ADDRESS LINE 2");
    await page.locator("#tb_city").fill("TEST CITY");
    await page.locator("#negeri1").selectOption({ value: "11" }); // Sarawak
    await page.locator("#tb_poskod").fill("93000");
    await page.locator("#tb_telno").fill("0000000000");
    await page.waitForTimeout(1000);

    // ── Pre-save state ──────────────────────────────────────────────
    const preSave = await page.evaluate(() => {
      const invalidCount = document.querySelectorAll("input:invalid, select:invalid").length;
      const tcd = document.querySelector('[name="tb_cukai_display"]');
      const fields = {};
      document.querySelectorAll("input, select").forEach((el) => {
        const inp = el;
        const r = inp.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        if (inp.type === "hidden") return;
        const key = inp.name || inp.id || "";
        if (!key) return;
        if (inp.tagName.toLowerCase() === "select") {
          fields[key] = inp.options?.[inp.selectedIndex]?.text || "";
        } else if (inp.type === "radio") {
          if (inp.checked) fields[inp.name] = inp.value;
        } else {
          fields[key] = inp.value || "";
        }
      });
      return {
        invalidCount,
        tbCukai: tcd ? tcd.value : "(not found)",
        fields,
      };
    });

    console.log(`\nPre-save: invalidCount=${preSave.invalidCount}, tbCukai="${preSave.tbCukai}"`);
    for (const [k, v] of Object.entries(preSave.fields)) {
      if (v) console.log(`  ${k}: "${v}"`);
    }

    // Screenshot: before save
    const ts1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_seller_retest_before_save_${ts1}.png`, fullPage: true });

    // ── Register dialog handler ─────────────────────────────────────
    let dialogInfo = { captured: false, type: "", message: "" };
    page.on("dialog", async (dialog) => {
      dialogInfo.captured = true;
      dialogInfo.type = dialog.type();
      dialogInfo.message = dialog.message();
      console.log(`  DIALOG: type=${dialog.type()} message="${dialogInfo.message.substring(0, 150)}"`);
      await dialog.accept();
    });

    // ── SAVE: Real browser-level Playwright locator click ───────────
    console.log("\nTriggering save via Playwright locator click...");

    // Find the Simpan submit button
    const simpanLocator = page.locator('input[type="submit"][value*="Simpan"]');
    const simpanVisible = await simpanLocator.isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`Simpan visible: ${simpanVisible}`);

    if (!simpanVisible) {
      // Fallback: try any submit button
      const anySubmit = page.locator('input[type="submit"]').first();
      console.log("Simpan not found, trying any submit...");
      await anySubmit.click({ timeout: 5000 });
    } else {
      await simpanLocator.click({ timeout: 5000 });
    }

    console.log("Simpan click fired. Waiting for response...");

    // Wait for navigation or page reload
    await page.waitForTimeout(8000);

    // ── Post-save state capture ─────────────────────────────────────
    const postSaveUrl = page.url();
    const urlChanged = postSaveUrl !== sellerUrl;
    console.log(`\nPost-save URL: ${postSaveUrl}`);
    console.log(`URL changed: ${urlChanged}`);
    console.log(`Dialog: ${dialogInfo.captured ? `${dialogInfo.type} "${dialogInfo.message.substring(0, 100)}"` : "none"}`);

    // Screenshot: after save
    const ts2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_seller_retest_after_save_${ts2}.png`, fullPage: true });

    // Check for modals/messages
    const postSave = await page.evaluate(() => {
      const msgs = [];
      // Bootbox/modal
      document.querySelectorAll(".modal.show, .modal.in, .bootbox, [role='dialog']").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 50 && r.height > 50) {
          msgs.push({ type: "modal", text: (el.textContent || "").trim().substring(0, 300) });
        }
      });
      // Alerts
      document.querySelectorAll(".alert, [role='alert']").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          msgs.push({ type: "alert", text: (el.textContent || "").trim().substring(0, 200) });
        }
      });
      // Validation errors
      const invalidCount = document.querySelectorAll("input:invalid, select:invalid").length;
      const cssErrors = [];
      document.querySelectorAll(".has-error, .is-invalid, .text-danger, .error").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          cssErrors.push((el.textContent || "").trim().substring(0, 100));
        }
      });

      // Check if we're back on edit page (Bahagian A)
      const isEditPage = window.location.href.includes("/edit/");
      const isSellerPage = window.location.href.includes("/seller/");

      // Check for landlord table rows
      const tableRows = [];
      document.querySelectorAll("#bhgn-a table tbody tr, #bhgn-a .table tbody tr").forEach((tr) => {
        const txt = (tr.textContent || "").trim();
        if (txt.length > 5) tableRows.push(txt.substring(0, 120));
      });

      const tcd = document.querySelector('[name="tb_cukai_display"]');

      const body = (document.body?.innerText || "").substring(0, 1000);

      return {
        messages: msgs,
        invalidCount,
        cssErrors,
        isEditPage,
        isSellerPage,
        tableRows,
        tbCukai: tcd ? tcd.value : "(not found on page)",
        body,
      };
    });

    console.log(`\nPost-save analysis:`);
    console.log(`  isEditPage (Bahagian A): ${postSave.isEditPage}`);
    console.log(`  isSellerPage: ${postSave.isSellerPage}`);
    console.log(`  Messages: ${postSave.messages.length}`);
    for (const m of postSave.messages) console.log(`    [${m.type}] "${m.text.substring(0, 120)}"`);
    console.log(`  Invalid field count: ${postSave.invalidCount}`);
    console.log(`  CSS errors: ${postSave.cssErrors.length}`);
    for (const e of postSave.cssErrors) console.log(`    "${e.substring(0, 60)}"`);
    console.log(`  Table rows (landlord): ${postSave.tableRows.length}`);
    for (const r of postSave.tableRows) console.log(`    "${r.substring(0, 80)}"`);
    console.log(`  tb_cukai_display: "${postSave.tbCukai}"`);
    console.log(`  Body (first 300): "${postSave.body.substring(0, 300)}"`);

    writeMarker("P5_SELLER_SAVE_RETEST",
      `preUrl=${sellerUrl}\n` +
      `postUrl=${postSaveUrl}\n` +
      `urlChanged=${urlChanged}\n` +
      `dialog=${dialogInfo.captured ? `${dialogInfo.type}:"${dialogInfo.message.substring(0, 150)}"` : "none"}\n` +
      `isEditPage=${postSave.isEditPage}\n` +
      `isSellerPage=${postSave.isSellerPage}\n` +
      `messages=${postSave.messages.map(m => `[${m.type}]"${m.text.substring(0, 80)}"`).join("; ")}\n` +
      `invalidCount=${postSave.invalidCount}\n` +
      `cssErrors=${postSave.cssErrors.join("; ")}\n` +
      `tableRows=${postSave.tableRows.length}: ${postSave.tableRows.map(r => `"${r.substring(0, 60)}"`).join("; ")}\n` +
      `tbCukai="${postSave.tbCukai}"\n` +
      `body=${postSave.body.substring(0, 400)}`
    );

    console.log(`\n=== RETEST COMPLETE ===`);
    console.log(`NO REAL DATA. TENANT NOT TOUCHED. NO OVERALL SUBMIT.`);

  } finally {
    await context.close();
  }
}

run().catch((err) => {
  console.error("Retest failed:", err);
  process.exit(1);
});
