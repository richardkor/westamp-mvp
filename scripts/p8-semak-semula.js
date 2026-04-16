/**
 * P8 Semak Semula Boundary Investigation
 *
 * Reaches Rumusan Pengiraan with incomplete state, clicks Semak Semula,
 * captures the exact result. Does NOT click Hantar.
 *
 * Usage: node scripts/p8-semak-semula.js
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

console.log("\n=== P8 SEMAK SEMULA INVESTIGATION ===\n");

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
    // ── Reach p8 + verify + save MA ─────────────────────────────────
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
    console.log("Verified: Employment Contract / Perjanjian Pekerjaan / Prinsipal");

    await page.locator("#pdsG01_bhgn_am").click({ timeout: 5000 });
    await page.waitForTimeout(5000);
    await page.evaluate(() => { const b = document.querySelector(".bootbox .btn"); if (b) b.click(); });
    await page.waitForTimeout(1500);
    await page.keyboard.press("Escape"); await page.waitForTimeout(500);
    console.log("Maklumat Am saved.");

    // ── Save Bahagian B ─────────────────────────────────────────────
    console.log("Saving Bahagian B...");
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
    console.log("Bahagian B saved.");

    // ── Open Rumusan Pengiraan ──────────────────────────────────────
    console.log("Opening Rumusan Pengiraan...");
    await page.evaluate(() => { for (const a of document.querySelectorAll('.nav-tabs a')) { if (/rumusan/i.test(a.textContent)) { a.click(); return; } } });
    await page.waitForTimeout(3000);

    const preActiveTab = await page.evaluate(() => {
      const li = document.querySelector(".nav-tabs li.active");
      return li?.querySelector("a")?.textContent?.trim() || "";
    });
    console.log(`Active tab: "${preActiveTab}"`);

    // ── Capture pre-click state ─────────────────────────────────────
    const preState = await page.evaluate(() => {
      // Duty summary values
      const dutyFields = {};
      ["ag_n", "d_sc", "d_ab", "dt_patut", "dt_remit", "dt_kena", "pnlt", "slnn", "jslnn", "jmlh"].forEach(name => {
        const el = document.querySelector(`[name="${name}"]`);
        if (el) dutyFields[name] = el.value || "";
      });

      // Bottom action buttons
      const buttons = [];
      document.querySelectorAll("input[type='submit'], input[type='button'], button, a.btn").forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const txt = (el.textContent || el.value || "").trim();
        if (/simpan|hantar|semak|senarai/i.test(txt)) {
          buttons.push({
            text: txt.substring(0, 40),
            id: el.id || "",
            type: el.type || "",
            disabled: el.disabled || false,
            bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          });
        }
      });

      return { dutyFields, buttons };
    });

    console.log("\nPre-click duty summary:");
    for (const [k, val] of Object.entries(preState.dutyFields)) console.log(`  ${k}: "${val}"`);
    console.log("\nAction buttons:");
    for (const b of preState.buttons) console.log(`  "${b.text}" id="${b.id}" type=${b.type} disabled=${b.disabled} bbox=${b.bbox.x},${b.bbox.y} ${b.bbox.w}x${b.bbox.h}`);

    // Screenshot before
    const ts1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_semak_before_${ts1}.png`, fullPage: true });

    // ── Click Semak Semula ──────────────────────────────────────────
    console.log("\n=== CLICKING SEMAK SEMULA ===");

    // Register dialog handler
    let dialogInfo = { captured: false, type: "", msg: "" };
    page.on("dialog", async d => {
      dialogInfo.captured = true; dialogInfo.type = d.type(); dialogInfo.msg = d.message();
      console.log(`  DIALOG: ${d.type()} "${d.message().substring(0, 150)}"`);
      await d.accept();
    });

    // Find Semak Semula button
    const semakBtn = preState.buttons.find(b => /senarai\s*semak|semak\s*semula/i.test(b.text));
    if (!semakBtn) {
      console.log("ERROR: Semak Semula button not found.");
      await ctx.close(); return;
    }

    console.log(`Clicking: "${semakBtn.text}" id="${semakBtn.id}" at (${semakBtn.bbox.x + semakBtn.bbox.w/2}, ${semakBtn.bbox.y + semakBtn.bbox.h/2})`);

    // Scroll button into view first
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);

    // Use Playwright locator if id exists, otherwise bbox
    if (semakBtn.id) {
      await page.locator(`#${semakBtn.id}`).click({ timeout: 5000 });
    } else {
      // Find by text
      const clicked = await page.evaluate(() => {
        const els = document.querySelectorAll("input[type='submit'], input[type='button'], button, a.btn");
        for (const b of els) {
          if (/senarai\s*semak/i.test((b.textContent || b.value || "").trim())) {
            b.click(); return true;
          }
        }
        return false;
      });
      if (!clicked) {
        // Last resort: bbox
        await page.mouse.click(semakBtn.bbox.x + semakBtn.bbox.w/2, semakBtn.bbox.y + semakBtn.bbox.h/2);
      }
    }

    await page.waitForTimeout(8000);

    // ── Capture post-click state ────────────────────────────────────
    const postUrl = page.url();
    const postActiveTab = await page.evaluate(() => {
      const li = document.querySelector(".nav-tabs li.active");
      return li?.querySelector("a")?.textContent?.trim() || "";
    });

    console.log(`\nPost-click:`);
    console.log(`  URL: ${postUrl}`);
    console.log(`  Active tab: "${postActiveTab}" (was "${preActiveTab}")`);
    console.log(`  Dialog: ${dialogInfo.captured ? `${dialogInfo.type} "${dialogInfo.msg.substring(0, 100)}"` : "none"}`);

    // Screenshot after
    const ts2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_semak_after_${ts2}.png`, fullPage: true });

    // Check for modals/warnings
    const postModals = await page.evaluate(() => {
      const msgs = [];
      document.querySelectorAll(".modal.show, .modal.in, .bootbox, [role='dialog']").forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > 50 && r.height > 50) {
          const title = el.querySelector(".modal-title, h4, h3")?.textContent?.trim() || "";
          const body = (el.textContent || "").trim().substring(0, 500);
          msgs.push({ class: (el.className || "").toString().substring(0, 60), title, body });
        }
      });
      return msgs;
    });
    console.log(`  Modals: ${postModals.length}`);
    for (const m of postModals) {
      console.log(`    class="${m.class}" title="${m.title}" body="${m.body.substring(0, 200)}"`);
    }

    // Check for visible validation errors/warnings/alerts
    const postAlerts = await page.evaluate(() => {
      const alerts = [];
      document.querySelectorAll(".alert, [role='alert'], .text-danger, .error, .has-error, .validation-summary").forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) alerts.push((el.textContent || "").trim().substring(0, 200));
      });
      return alerts;
    });
    console.log(`  Alerts: ${postAlerts.length}`);
    for (const a of postAlerts) console.log(`    "${a.substring(0, 100)}"`);

    // Check Hantar button state
    const postHantar = await page.evaluate(() => {
      const btns = document.querySelectorAll("input[type='submit'], input[type='button'], button");
      for (const b of btns) {
        const txt = (b.textContent || b.value || "").trim();
        if (/^hantar$/i.test(txt)) {
          return { found: true, disabled: b.disabled, display: window.getComputedStyle(b).display, visibility: window.getComputedStyle(b).visibility };
        }
      }
      return { found: false };
    });
    console.log(`  Hantar button: ${postHantar.found ? `disabled=${postHantar.disabled} display=${postHantar.display}` : "not found"}`);

    // Check visible page content for any checklist / validation summary
    const pageContent = await page.evaluate(() => {
      return (document.body?.innerText || "").substring(0, 2000);
    });

    // Look for validation-like content
    const validationPatterns = ["sila", "wajib", "tidak lengkap", "incomplete", "required", "error", "semakan", "checklist"];
    const matchedLines = [];
    for (const line of pageContent.split("\n")) {
      const lower = line.toLowerCase().trim();
      if (lower.length > 5 && validationPatterns.some(p => lower.includes(p))) {
        matchedLines.push(line.trim().substring(0, 120));
      }
    }
    if (matchedLines.length > 0) {
      console.log(`  Validation-related text found (${matchedLines.length}):`);
      for (const l of matchedLines.slice(0, 10)) console.log(`    "${l}"`);
    }

    writeMarker("P8_SEMAK_SEMULA",
      `preActiveTab=${preActiveTab}\npostActiveTab=${postActiveTab}\n` +
      `url=${postUrl}\n` +
      `dialog=${dialogInfo.captured ? `${dialogInfo.type}:"${dialogInfo.msg.substring(0, 150)}"` : "none"}\n` +
      `modals=${postModals.map(m => `title="${m.title}" body="${m.body.substring(0, 100)}"`).join("; ")}\n` +
      `alerts=${postAlerts.join("; ")}\n` +
      `hantar=${JSON.stringify(postHantar)}\n` +
      `validationText=${matchedLines.slice(0, 5).join("; ")}`
    );

    console.log(`\n=== COMPLETE. NO PARTY DATA. NO HANTAR. NO SUBMIT. ===`);

  } finally {
    await ctx.close();
  }
}

run().catch(err => { console.error("Failed:", err); process.exit(1); });
