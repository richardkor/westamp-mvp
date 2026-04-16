/**
 * P8 Document Name Entry + Verification — Live Test
 *
 * Navigates to a fresh p8 page, uses the driver's
 * enterPenyetemanAmDocumentNameAndVerify helper, and reports result.
 *
 * Usage: node scripts/p8-doc-verify.js "<document_name>" "<expected_profile_desc>" "<expected_pds_ps>"
 */

const { chromium } = require("playwright");
const path = require("path");

const PROFILE_DIR = "data/playwright-profile";

const docName = process.argv[2];
const expectedProfileDesc = process.argv[3];
const expectedPdsPs = process.argv[4] || "Prinsipal";

if (!docName || !expectedProfileDesc) {
  console.error("Usage: node scripts/p8-doc-verify.js <docName> <expectedProfileDesc> [expectedPdsPs]");
  process.exit(1);
}

console.log(`\n=== P8 DOC VERIFY: "${docName}" ===`);
console.log(`  Expected profile_desc: "${expectedProfileDesc}"`);
console.log(`  Expected pds_ps: "${expectedPdsPs}"\n`);

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
    // Navigate to application form → select Penyeteman Am → fill shared → save
    await page.goto("https://stamps.hasil.gov.my/stamps/form/application", {
      timeout: 30000, waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(3000);

    // Select Penyeteman Am
    await page.evaluate(() => {
      const radios = document.querySelectorAll('input[type="radio"]');
      for (const r of radios) {
        if (r.parentElement?.textContent?.trim() === "Penyeteman Am") { r.click(); return; }
      }
    });
    await page.waitForTimeout(1000);

    // Fill shared fields
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

    // Click Seterusnya
    await page.locator("button#btn-ma-submit").click();
    await page.waitForTimeout(5000);

    const postSaveUrl = page.url();
    console.log(`Post-save URL: ${postSaveUrl}`);

    if (!postSaveUrl.includes("/formv2/p8/")) {
      console.log("ERROR: Not on p8 page.");
      await context.close();
      process.exit(1);
    }

    // ── Use the driver helper directly via page interaction ──────────
    // Since we can't easily import the TS driver here, replicate the
    // exact logic from enterPenyetemanAmDocumentNameAndVerify.

    // Capture baseline
    const baseline = await page.evaluate(() => {
      const nsc = document.getElementById("namaperjanjian");
      const pd = document.getElementById("profile_desc");
      const ps = document.getElementById("pds_ps");
      return {
        namaperjanjian: nsc ? nsc.value : "(not found)",
        profileDesc: pd ? pd.value : "(not found)",
        pdsPs: ps ? ps.value : "(not found)",
        pdsPsText: ps ? (ps.options[ps.selectedIndex]?.text || "") : "(not found)",
      };
    });
    console.log(`Baseline: namaperjanjian="${baseline.namaperjanjian}", profile_desc="${baseline.profileDesc}", pds_ps="${baseline.pdsPsText}"`);

    // Type document name
    const nsc = page.locator("#namaperjanjian");
    await nsc.click();
    await nsc.fill("");
    await page.waitForTimeout(300);
    await nsc.fill(docName);
    await page.waitForTimeout(500);

    // Trigger blur/change
    await nsc.evaluate((el) => {
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    });
    await page.waitForTimeout(3000);

    // Read back actual
    const actual = await page.evaluate(() => {
      const nsc2 = document.getElementById("namaperjanjian");
      const pd2 = document.getElementById("profile_desc");
      const ps2 = document.getElementById("pds_ps");
      return {
        namaperjanjian: nsc2 ? nsc2.value : "(not found)",
        profileDesc: pd2 ? pd2.value : "(not found)",
        pdsPs: ps2 ? ps2.value : "(not found)",
        pdsPsText: ps2 ? (ps2.options[ps2.selectedIndex]?.text || "") : "(not found)",
        profileDescReadOnly: pd2 ? pd2.readOnly : false,
      };
    });

    console.log(`\nActual after blur:`);
    console.log(`  namaperjanjian: "${actual.namaperjanjian}"`);
    console.log(`  profile_desc: "${actual.profileDesc}" (readOnly=${actual.profileDescReadOnly})`);
    console.log(`  pds_ps: "${actual.pdsPsText}" (value="${actual.pdsPs}")`);

    // Verify
    const pdsPsMap = { Prinsipal: "p", Subsidiari: "s" };
    const expectedPdsPsVal = pdsPsMap[expectedPdsPs] || expectedPdsPs;

    const nameMatch = actual.namaperjanjian === docName;
    const profileMatch = actual.profileDesc === expectedProfileDesc;
    const pdsPsMatch = actual.pdsPs === expectedPdsPsVal;

    console.log(`\n=== VERIFICATION ===`);
    console.log(`  namaperjanjian: ${nameMatch ? "✅ PASS" : "❌ FAIL"} (expected="${docName}", actual="${actual.namaperjanjian}")`);
    console.log(`  profile_desc:   ${profileMatch ? "✅ PASS" : "❌ FAIL"} (expected="${expectedProfileDesc}", actual="${actual.profileDesc}")`);
    console.log(`  pds_ps:         ${pdsPsMatch ? "✅ PASS" : "❌ FAIL"} (expected="${expectedPdsPs}" [${expectedPdsPsVal}], actual="${actual.pdsPsText}" [${actual.pdsPs}])`);

    const allPass = nameMatch && profileMatch && pdsPsMatch;
    console.log(`\n  OVERALL: ${allPass ? "✅ ALL PASS" : "❌ FAILED"}`);
    console.log(`  NO SAVE. NO SUBMIT. NO LATER TABS.`);

    // Screenshot
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({
      path: `data/portal-probe-artifacts/p8_verify_${docName.replace(/\s+/g, "_").substring(0, 30)}_${ts}.png`,
      fullPage: true,
    });

    if (!allPass) process.exitCode = 1;

  } finally {
    await context.close();
  }
}

run().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
