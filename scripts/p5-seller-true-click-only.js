/**
 * P5 Seller — Pure True Click-Path Observation
 *
 * Clicks landlord Tambah Individu via real portal UI and captures
 * EXACTLY what happens. No manual /seller/ navigation.
 *
 * WARNING: Do NOT add kpin/identity interaction without requiring
 * ALLOW_LIVE_ID_LOOKUP=true and redacting returned TIN/name values.
 *
 * Usage: node scripts/p5-seller-true-click-only.js
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

console.log("\n=== P5 SELLER: PURE TRUE CLICK-PATH OBSERVATION ===\n");

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
    // ── Reach Bahagian A ────────────────────────────────────────────
    console.log("Reaching Bahagian A...");
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
    if (!page.url().includes("/formv2/p5/")) { console.log("ERROR: Not on p5."); await context.close(); return; }
    await page.locator("#pds_suratcara").selectOption({value:"1101"});
    await page.locator("#pds_ps").selectOption({value:"p"});
    await page.waitForTimeout(500);
    await page.evaluate(() => { document.getElementById("pdsL01_bhgn_am")?.click(); });
    await page.waitForTimeout(5000);

    // Dismiss Maklumat Am success modal CLEANLY
    console.log("Dismissing Maklumat Am success modal...");
    await page.evaluate(() => { const b = document.querySelector(".bootbox .btn"); if (b) b.click(); });
    await page.waitForTimeout(1500);
    // Verify modal is gone
    const modalGone = await page.evaluate(() => {
      const m = document.querySelector(".bootbox.in, .modal.show, .modal.in");
      if (!m) return true;
      return m.getBoundingClientRect().width <= 0;
    });
    console.log(`Modal dismissed: ${modalGone}`);
    if (!modalGone) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1000);
    }

    // Switch to Bahagian A
    await page.evaluate(() => { for (const a of document.querySelectorAll('.nav-tabs a')) { if (/bahagian.a/i.test(a.textContent)) { a.click(); return; } } });
    await page.waitForTimeout(2000);

    const preClickUrl = page.url();
    console.log(`\nOn Bahagian A: ${preClickUrl}`);

    // ── Screenshot: BEFORE click ────────────────────────────────────
    const ts1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_trueclk_before_${ts1}.png`, fullPage: true });

    // Capture landlord table state BEFORE click
    const tableBefore = await page.evaluate(() => {
      const rows = [];
      document.querySelectorAll("#bhgn-a table tbody tr").forEach(tr => {
        const txt = (tr.textContent || "").trim();
        if (txt.length > 3) rows.push(txt.substring(0, 100));
      });
      return rows;
    });
    console.log(`Landlord table rows before: ${tableBefore.length}`);

    // ── CLICK: Tambah Individu ──────────────────────────────────────
    console.log("\nClicking landlord Tambah Individu...");
    await page.evaluate(() => {
      const links = document.querySelectorAll("#bhgn-a a");
      for (const a of links) {
        if (/individu/i.test(a.textContent?.trim()) && a.href.includes("seller")) {
          a.click();
          return;
        }
      }
    });

    // Wait for reaction — but do NOT navigate manually
    console.log("Waiting for portal reaction...");
    await page.waitForTimeout(5000);

    const postClickUrl = page.url();
    console.log(`URL after click: ${postClickUrl}`);
    console.log(`URL changed: ${postClickUrl !== preClickUrl}`);
    console.log(`On /seller/: ${postClickUrl.includes("/seller/")}`);
    console.log(`On /edit/: ${postClickUrl.includes("/edit/")}`);

    // ── Screenshot: IMMEDIATELY after click reaction ────────────────
    const ts2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_trueclk_after_${ts2}.png`, fullPage: true });

    // ── Check for modal ─────────────────────────────────────────────
    const modalState = await page.evaluate(() => {
      const modals = document.querySelectorAll(".modal, .bootbox, [role='dialog']");
      const results = [];
      modals.forEach(m => {
        const r = m.getBoundingClientRect();
        const s = window.getComputedStyle(m);
        const visible = r.width > 50 && r.height > 50 && s.display !== "none" && s.visibility !== "hidden";

        // Get title
        const titleEl = m.querySelector(".modal-title, .bootbox-body h4, h4, h3");
        const title = titleEl ? titleEl.textContent?.trim().substring(0, 100) : "";

        // Get body text
        const bodyEl = m.querySelector(".modal-body, .bootbox-body");
        const bodyText = bodyEl ? bodyEl.textContent?.trim().substring(0, 500) : (m.textContent || "").trim().substring(0, 500);

        // Get all controls inside modal
        const controls = [];
        m.querySelectorAll("input, select, textarea, button, a.btn").forEach(el => {
          const cr = el.getBoundingClientRect();
          if (cr.width <= 0 || cr.height <= 0) return;
          const inp = el;
          controls.push({
            tag: el.tagName.toLowerCase(),
            type: inp.type || "",
            name: inp.name || "",
            id: inp.id || "",
            value: (inp.value || el.textContent || "").trim().substring(0, 40),
            readOnly: inp.readOnly || false,
            placeholder: inp.placeholder || "",
          });
        });

        // Get all labels inside modal
        const labels = [];
        m.querySelectorAll("label").forEach(l => {
          const lr = l.getBoundingClientRect();
          if (lr.width > 0 && lr.height > 0) {
            labels.push(l.textContent?.trim().substring(0, 80) || "");
          }
        });

        // Get modal class/id
        results.push({
          visible,
          className: (m.className || "").toString().substring(0, 80),
          id: m.id || "",
          width: Math.round(r.width),
          height: Math.round(r.height),
          display: s.display,
          title,
          bodyText: bodyText.substring(0, 400),
          controls,
          labels,
        });
      });
      return results;
    });

    console.log(`\nModals found: ${modalState.length}`);
    for (const m of modalState) {
      console.log(`  visible=${m.visible} class="${m.className}" id="${m.id}" ${m.width}x${m.height} display=${m.display}`);
      console.log(`  title: "${m.title}"`);
      console.log(`  body (first 200): "${m.bodyText.substring(0, 200)}"`);
      console.log(`  labels (${m.labels.length}): ${m.labels.join("; ")}`);
      console.log(`  controls (${m.controls.length}):`);
      for (const c of m.controls) {
        console.log(`    ${c.tag} type=${c.type} name="${c.name}" id="${c.id}" value="${c.value}" ro=${c.readOnly} ph="${c.placeholder}"`);
      }
    }

    // ── Check landlord table AFTER click ─────────────────────────────
    const tableAfter = await page.evaluate(() => {
      const rows = [];
      // Check both visible tables
      document.querySelectorAll("table tbody tr").forEach(tr => {
        const r = tr.getBoundingClientRect();
        if (r.width <= 0) return;
        const txt = (tr.textContent || "").trim();
        if (txt.length > 3) rows.push(txt.substring(0, 120));
      });
      return rows;
    });
    console.log(`\nVisible table rows after: ${tableAfter.length}`);
    for (const row of tableAfter) console.log(`  "${row.substring(0, 80)}"`);

    // ── Check if div#kp is now visible (on whatever page we're on) ──
    const identityCheck = await page.evaluate(() => {
      const kp = document.getElementById("kp");
      const tbCukai = document.querySelector('[name="tb_cukai"]');
      const nokpRadios = document.querySelectorAll('[name="EPD_NOKP_TYPE"]');
      return {
        kpExists: !!kp,
        kpDisplay: kp ? window.getComputedStyle(kp).display : "(not found)",
        tbCukaiExists: !!tbCukai,
        tbCukaiDisplay: tbCukai ? window.getComputedStyle(tbCukai).display : "(not found)",
        nokpCount: nokpRadios.length,
        nokpAnyVisible: Array.from(nokpRadios).some(r => r.getBoundingClientRect().width > 0),
      };
    });
    console.log(`\nIdentity block check:`);
    console.log(`  div#kp exists=${identityCheck.kpExists} display="${identityCheck.kpDisplay}"`);
    console.log(`  tb_cukai exists=${identityCheck.tbCukaiExists} display="${identityCheck.tbCukaiDisplay}"`);
    console.log(`  EPD_NOKP_TYPE count=${identityCheck.nokpCount} anyVisible=${identityCheck.nokpAnyVisible}`);

    // Write evidence
    writeMarker("P5_TRUE_CLICK_PATH",
      `preClickUrl=${preClickUrl}\n` +
      `postClickUrl=${postClickUrl}\n` +
      `urlChanged=${postClickUrl !== preClickUrl}\n` +
      `modals=${modalState.length}\n` +
      modalState.map((m, i) => (
        `modal[${i}]: visible=${m.visible} class="${m.className}" title="${m.title}" ` +
        `labels=[${m.labels.join("; ")}] controls=${m.controls.length} body="${m.bodyText.substring(0, 200)}"`
      )).join("\n") + "\n" +
      `tableRowsBefore=${tableBefore.length}\n` +
      `tableRowsAfter=${tableAfter.length}\n` +
      `kpDisplay=${identityCheck.kpDisplay}\n` +
      `tbCukaiDisplay=${identityCheck.tbCukaiDisplay}\n` +
      `nokpAnyVisible=${identityCheck.nokpAnyVisible}`
    );

    console.log(`\n=== PURE TRUE CLICK-PATH OBSERVATION COMPLETE ===`);
    console.log(`NO MANUAL /seller/ NAVIGATION. NO IDENTITY DATA. NO SAVE. NO SUBMIT.`);

  } finally {
    await context.close();
  }
}

run().catch((err) => {
  console.error("Investigation failed:", err);
  process.exit(1);
});
