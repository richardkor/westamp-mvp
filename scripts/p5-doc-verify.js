/**
 * P5 Document Selection + Verification — Live Test
 *
 * Navigates to a fresh p5 page, selects a Nama Surat Cara option
 * from pds_suratcara, reads back the result, and verifies.
 *
 * Usage: node scripts/p5-doc-verify.js "<document_label>" "<expected_option_value>"
 */

const { chromium } = require("playwright");
const path = require("path");

const PROFILE_DIR = "data/playwright-profile";

const docLabel = process.argv[2];
const expectedValue = process.argv[3];

if (!docLabel || !expectedValue) {
  console.error('Usage: node scripts/p5-doc-verify.js "<label>" "<value>"');
  process.exit(1);
}

console.log(`\n=== P5 DOC VERIFY: "${docLabel}" (value=${expectedValue}) ===\n`);

async function run() {
  const profilePath = path.resolve(PROFILE_DIR);
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = context.pages()[0] || await context.newPage();

  try {
    // Navigate → select Sewa/Pajakan → fill shared → save
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
      if (sel) {
        for (let i = 0; i < sel.options.length; i++) {
          if (sel.options[i].text.includes("Sarawak")) {
            sel.selectedIndex = i;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
        }
      }
    });
    await page.fill('input[name="tsd"]', "01");
    await page.waitForTimeout(500);
    try { await page.locator("select").nth(2).selectOption({ label: "Januari" }); } catch {}
    await page.waitForTimeout(500);

    await page.locator("button#btn-ma-submit").click();
    await page.waitForTimeout(5000);

    const postSaveUrl = page.url();
    console.log(`Post-save URL: ${postSaveUrl}`);

    if (!postSaveUrl.includes("/formv2/p5/")) {
      console.log("ERROR: Not on p5 page.");
      await context.close();
      process.exit(1);
    }

    // Screenshot: before selection
    const ts1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({
      path: `data/portal-probe-artifacts/p5_verify_pre_${docLabel.replace(/\s+/g, "_").substring(0, 25)}_${ts1}.png`,
      fullPage: true,
    });

    // Capture baseline
    const baseline = await page.evaluate(() => {
      const sc = document.getElementById("pds_suratcara");
      const ps = document.getElementById("pds_ps");
      const scOpts = [];
      if (sc) { for (let i = 0; i < sc.options.length; i++) scOpts.push({ v: sc.options[i].value, t: sc.options[i].text }); }
      const psOpts = [];
      if (ps) { for (let i = 0; i < ps.options.length; i++) psOpts.push({ v: ps.options[i].value, t: ps.options[i].text }); }
      return {
        scVal: sc ? sc.value : "(not found)",
        scText: sc ? (sc.options[sc.selectedIndex]?.text || "") : "(not found)",
        scOpts,
        psVal: ps ? ps.value : "(not found)",
        psText: ps ? (ps.options[ps.selectedIndex]?.text || "") : "(not found)",
        psOpts,
      };
    });

    console.log(`Baseline: suratcara="${baseline.scText}" (${baseline.scVal}), pds_ps="${baseline.psText}" (${baseline.psVal})`);
    console.log(`pds_suratcara options: ${baseline.scOpts.map(o => `${o.v}="${o.t}"`).join(", ")}`);
    console.log(`pds_ps options: ${baseline.psOpts.map(o => `${o.v}="${o.t}"`).join(", ")}`);

    // Select the document
    console.log(`\nSelecting "${docLabel}" (value=${expectedValue})...`);
    await page.locator("#pds_suratcara").selectOption({ value: expectedValue });
    await page.waitForTimeout(2000);

    // Read back actual
    const actual = await page.evaluate(() => {
      const sc = document.getElementById("pds_suratcara");
      const ps = document.getElementById("pds_ps");
      const psOpts = [];
      if (ps) { for (let i = 0; i < ps.options.length; i++) psOpts.push({ v: ps.options[i].value, t: ps.options[i].text }); }
      return {
        scVal: sc ? sc.value : "(not found)",
        scText: sc ? (sc.options[sc.selectedIndex]?.text || "") : "(not found)",
        psVal: ps ? ps.value : "(not found)",
        psText: ps ? (ps.options[ps.selectedIndex]?.text || "") : "(not found)",
        psOpts,
      };
    });

    console.log(`\nActual after selection:`);
    console.log(`  pds_suratcara: "${actual.scText}" (value="${actual.scVal}")`);
    console.log(`  pds_ps: "${actual.psText}" (value="${actual.psVal}")`);
    console.log(`  pds_ps options: ${actual.psOpts.map(o => `${o.v}="${o.t}"`).join(", ")}`);

    // Screenshot: after selection
    const ts2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({
      path: `data/portal-probe-artifacts/p5_verify_post_${docLabel.replace(/\s+/g, "_").substring(0, 25)}_${ts2}.png`,
      fullPage: true,
    });

    // Verify
    const valMatch = actual.scVal === expectedValue;
    const labelMatch = actual.scText === docLabel;

    console.log(`\n=== VERIFICATION ===`);
    console.log(`  pds_suratcara value: ${valMatch ? "✅ PASS" : "❌ FAIL"} (expected="${expectedValue}", actual="${actual.scVal}")`);
    console.log(`  pds_suratcara label: ${labelMatch ? "✅ PASS" : "❌ FAIL"} (expected="${docLabel}", actual="${actual.scText}")`);
    console.log(`  pds_ps: value="${actual.psVal}" text="${actual.psText}" (reported, not verified against expectation)`);
    console.log(`  pds_ps option set: [${actual.psOpts.map(o => `${o.v}="${o.t}"`).join(", ")}]`);

    const allPass = valMatch && labelMatch;
    console.log(`\n  OVERALL: ${allPass ? "✅ ALL PASS" : "❌ FAILED"}`);
    console.log(`  NO SAVE. NO SUBMIT. NO LATER TABS.`);

    if (!allPass) process.exitCode = 1;

  } finally {
    await context.close();
  }
}

run().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
