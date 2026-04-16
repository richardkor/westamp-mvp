/**
 * P8 Hantar Next Gate — Declaration Checked, Everything Else Incomplete
 *
 * Ticks declaration checkbox, clicks Hantar once, captures the next gate.
 * Does NOT confirm any submission. Does NOT upload files. Does NOT add parties.
 *
 * Usage: node scripts/p8-hantar-next-gate.js
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

console.log("\n=== P8 HANTAR NEXT GATE ===\n");

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
    // ── Reach p8 + verify + save MA + save BhgB ────────────────────
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
    console.log("Bahagian B saved.");

    // ── Confirm incomplete state ────────────────────────────────────
    await page.evaluate(() => { for (const a of document.querySelectorAll('.nav-tabs a')) { if (/bahagian\s*a/i.test(a.textContent)) { a.click(); return; } } });
    await page.waitForTimeout(1000);
    const partyRows = await page.evaluate(() => {
      let count = 0;
      const panel = document.querySelector("#bhgn-a");
      if (panel) panel.querySelectorAll("table tbody tr").forEach(tr => { if (tr.getBoundingClientRect().width > 0) count++; });
      return count;
    });
    console.log(`Bahagian A party rows: ${partyRows}`);

    // ── Switch to Perakuan and tick declaration ─────────────────────
    await page.evaluate(() => { for (const a of document.querySelectorAll('.nav-tabs a')) { if (/perakuan/i.test(a.textContent)) { a.click(); return; } } });
    await page.waitForTimeout(2000);

    // Check initial state
    const akuanBefore = await page.evaluate(() => {
      const cb = document.getElementById("pds_akuan");
      return cb ? cb.checked : null;
    });
    console.log(`Declaration checkbox before: ${akuanBefore}`);

    // Tick the checkbox
    console.log("Ticking declaration checkbox...");
    await page.locator('#pds_akuan').click();
    await page.waitForTimeout(1000);

    const akuanAfter = await page.evaluate(() => {
      const cb = document.getElementById("pds_akuan");
      return cb ? cb.checked : null;
    });
    console.log(`Declaration checkbox after: ${akuanAfter}`);

    if (!akuanAfter) {
      console.log("ERROR: Checkbox did not become checked."); await ctx.close(); return;
    }

    console.log(`\nIncomplete state + declaration checked: parties=${partyRows}, akuan=${akuanAfter}, uploads=none\n`);

    // ── Scroll to bottom for action buttons ─────────────────────────
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);

    // Pre-click state
    const preUrl = page.url();
    const preTab = await page.evaluate(() => document.querySelector(".nav-tabs li.active a")?.textContent?.trim() || "");

    console.log(`Pre-click: URL=${preUrl.substring(0, 60)} tab="${preTab}"`);

    // Screenshot before
    const ts1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_hantar_gate2_before_${ts1}.png`, fullPage: true });

    // ── Register dialog handler — DISMISS confirms to prevent submission ──
    let dialogInfo = { captured: false, type: "", msg: "", action: "" };
    page.on("dialog", async d => {
      dialogInfo.captured = true;
      dialogInfo.type = d.type();
      dialogInfo.msg = d.message();
      console.log(`  DIALOG: ${d.type()} "${d.message().substring(0, 200)}"`);
      if (d.type() === "confirm") {
        console.log("  >> DISMISSING confirm dialog to prevent submission.");
        await d.dismiss();
        dialogInfo.action = "dismissed";
      } else {
        await d.accept();
        dialogInfo.action = "accepted";
      }
    });

    // ── Click Hantar ────────────────────────────────────────────────
    console.log("\n=== CLICKING HANTAR ===");
    await page.locator('#pre_hantar').click({ timeout: 5000 });
    await page.waitForTimeout(8000);

    // ── Post-click capture ──────────────────────────────────────────
    const postUrl = page.url();
    const postTab = await page.evaluate(() => document.querySelector(".nav-tabs li.active a")?.textContent?.trim() || "");

    console.log(`\nPost-click:`);
    console.log(`  URL: ${postUrl}`);
    console.log(`  URL changed: ${postUrl !== preUrl}`);
    console.log(`  Active tab: "${postTab}" (was "${preTab}")`);
    console.log(`  Dialog: ${dialogInfo.captured ? `${dialogInfo.type} action=${dialogInfo.action} "${dialogInfo.msg.substring(0, 150)}"` : "none"}`);

    // Screenshot after
    const ts2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_hantar_gate2_after_${ts2}.png`, fullPage: true });

    // Check for modals
    const postModals = await page.evaluate(() => {
      const modals = [];
      document.querySelectorAll(".modal.show, .modal.in, .bootbox, [role='dialog']").forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > 50 && r.height > 50) {
          const title = el.querySelector(".modal-title, h4, h3")?.textContent?.trim() || "";
          const body = (el.textContent || "").trim().substring(0, 500);
          const buttons = [];
          el.querySelectorAll("button, input[type='button'], a.btn").forEach(b => {
            const br = b.getBoundingClientRect();
            if (br.width > 0) buttons.push((b.textContent || b.value || "").trim().substring(0, 30));
          });
          modals.push({ title, body: body.substring(0, 400), buttons });
        }
      });
      return modals;
    });
    console.log(`  Modals: ${postModals.length}`);
    for (const m of postModals) {
      console.log(`    title: "${m.title}"`);
      console.log(`    body: "${m.body.substring(0, 200)}"`);
      console.log(`    buttons: [${m.buttons.join(", ")}]`);
    }

    // Check alerts
    const postAlerts = await page.evaluate(() => {
      const alerts = [];
      document.querySelectorAll(".alert, [role='alert'], .text-danger, .error").forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) alerts.push((el.textContent || "").trim().substring(0, 150));
      });
      return alerts;
    });
    console.log(`  Alerts: ${postAlerts.length}`);
    for (const a of postAlerts) console.log(`    "${a.substring(0, 100)}"`);

    writeMarker("P8_HANTAR_GATE2",
      `preUrl=${preUrl}\npostUrl=${postUrl}\nurlChanged=${postUrl !== preUrl}\n` +
      `preTab=${preTab}\npostTab=${postTab}\n` +
      `akuanChecked=true\npartyRows=${partyRows}\nuploads=none\n` +
      `dialog=${dialogInfo.captured ? `${dialogInfo.type} action=${dialogInfo.action} "${dialogInfo.msg.substring(0, 200)}"` : "none"}\n` +
      `modals=${postModals.map(m => `title="${m.title}" buttons=[${m.buttons.join(",")}] body="${m.body.substring(0, 150)}"`).join("; ")}\n` +
      `alerts=${postAlerts.join("; ")}`
    );

    console.log(`\n=== COMPLETE. NO PARTIES. NO UPLOADS. NO CONFIRMATION CLICKED. ===`);

  } finally {
    await ctx.close();
  }
}

run().catch(err => { console.error("Failed:", err); process.exit(1); });
