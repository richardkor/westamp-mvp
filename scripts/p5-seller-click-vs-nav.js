/**
 * P5 Seller — Click Path vs Direct Nav Comparison
 *
 * Run A: Reach seller form via real portal Tambah Individu click.
 * Run B: Reach seller form via direct URL navigation.
 * Compare div#kp and identity block visibility.
 *
 * WARNING: Do NOT add kpin/identity interaction without requiring
 * ALLOW_LIVE_ID_LOOKUP=true and redacting returned TIN/name values.
 *
 * Usage: node scripts/p5-seller-click-vs-nav.js
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

console.log("\n=== P5 SELLER: CLICK PATH vs DIRECT NAV ===\n");

function writeMarker(name, body) {
  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(`${ARTIFACT_DIR}/${name}_${ts}.txt`, `${name}\n${new Date().toISOString()}\n${body}\n`);
  } catch {}
}

async function captureIdentityState(page) {
  return await page.evaluate(() => {
    const kp = document.getElementById("kp");
    const kpDisplay = kp ? window.getComputedStyle(kp).display : "(not found)";

    const radios = [];
    document.querySelectorAll('input[name="EPD_NOKP_TYPE"]').forEach((el) => {
      const r = el.getBoundingClientRect();
      radios.push({
        id: el.id, value: el.value,
        bboxW: Math.round(r.width), bboxH: Math.round(r.height),
        display: window.getComputedStyle(el).display,
      });
    });

    const tbCukai = document.querySelector('[name="tb_cukai"]');
    const tbCukaiState = tbCukai ? {
      display: window.getComputedStyle(tbCukai).display,
      inlineStyle: tbCukai.getAttribute("style") || "",
      bboxW: Math.round(tbCukai.getBoundingClientRect().width),
      required: tbCukai.required,
      value: tbCukai.value,
    } : null;

    const tbCukaiDisp = document.querySelector('[name="tb_cukai_display"]');
    const tbCukaiDispState = tbCukaiDisp ? {
      bboxW: Math.round(tbCukaiDisp.getBoundingClientRect().width),
      bboxH: Math.round(tbCukaiDisp.getBoundingClientRect().height),
      readOnly: tbCukaiDisp.readOnly,
      value: tbCukaiDisp.value,
    } : null;

    // Check for any visible IC/identity input not in div#kp
    const visibleIdInputs = [];
    document.querySelectorAll("input").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const name = el.name || "";
      const id = el.id || "";
      if (/nokp|nric|ic_|passport|kp_|pengenalan/i.test(name + id)) {
        visibleIdInputs.push({ name, id, type: el.type, value: el.value.substring(0, 20) });
      }
    });

    // Check full contents of div#kp
    let kpInnerHTML = "";
    if (kp) {
      kpInnerHTML = kp.innerHTML.substring(0, 800);
    }

    // Count all visible form controls
    let visibleInputCount = 0;
    let visibleSelectCount = 0;
    document.querySelectorAll("input, select").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        if (el.tagName === "SELECT") visibleSelectCount++;
        else visibleInputCount++;
      }
    });

    return {
      kpDisplay, radios, tbCukaiState, tbCukaiDispState,
      visibleIdInputs, kpInnerHTML,
      visibleInputCount, visibleSelectCount,
    };
  });
}

function printState(label, state) {
  console.log(`\n--- ${label} ---`);
  console.log(`div#kp display: "${state.kpDisplay}"`);
  console.log(`EPD_NOKP_TYPE radios: ${state.radios.map(r => `${r.id}:w=${r.bboxW}`).join(", ")}`);
  console.log(`tb_cukai: ${state.tbCukaiState ? `display=${state.tbCukaiState.display} style="${state.tbCukaiState.inlineStyle}" w=${state.tbCukaiState.bboxW} req=${state.tbCukaiState.required}` : "NOT FOUND"}`);
  console.log(`tb_cukai_display: ${state.tbCukaiDispState ? `w=${state.tbCukaiDispState.bboxW} h=${state.tbCukaiDispState.bboxH} ro=${state.tbCukaiDispState.readOnly}` : "NOT FOUND"}`);
  console.log(`Visible identity inputs: ${state.visibleIdInputs.length > 0 ? state.visibleIdInputs.map(i => `${i.name}/${i.id}`).join(", ") : "none"}`);
  console.log(`Visible controls: ${state.visibleInputCount} inputs, ${state.visibleSelectCount} selects`);
}

async function reachBahagianA(page) {
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
  // Dismiss success modal
  await page.evaluate(() => { const b = document.querySelector(".bootbox .btn"); if (b) b.click(); });
  await page.waitForTimeout(1000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  // Switch to Bahagian A
  await page.evaluate(() => { for (const a of document.querySelectorAll('.nav-tabs a')) { if (/bahagian.a/i.test(a.textContent)) { a.click(); return; } } });
  await page.waitForTimeout(2000);
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
    // ══════════════════════════════════════════════════════════════
    // RUN A: TRUE PORTAL CLICK PATH
    // ══════════════════════════════════════════════════════════════
    console.log("=== RUN A: TRUE PORTAL CLICK PATH ===\n");

    const reached = await reachBahagianA(page);
    if (!reached) { console.log("ERROR: Failed to reach Bahagian A."); await context.close(); return; }

    const editUrl = page.url();
    console.log(`On Bahagian A: ${editUrl}`);

    // Get the seller Individu link href for later comparison
    const sellerHref = await page.evaluate(() => {
      for (const a of document.querySelectorAll("#bhgn-a a")) {
        if (/individu/i.test(a.textContent?.trim()) && a.href.includes("seller")) return a.href;
      }
      return null;
    });
    console.log(`Seller href: ${sellerHref}`);

    // Screenshot: Bahagian A before click
    const tsA0 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_clickvsnav_bhgA_${tsA0}.png`, fullPage: true });

    // Click the actual Tambah Individu link via Playwright locator
    // The link is small (45x14) — use JS click on the exact <a> element
    console.log("Clicking landlord Tambah Individu via real portal interaction...");
    const clickResult = await page.evaluate(() => {
      const links = document.querySelectorAll("#bhgn-a a");
      for (const a of links) {
        if (/individu/i.test(a.textContent?.trim()) && a.href.includes("seller")) {
          // Record the href before clicking
          const href = a.href;
          a.click();
          return { clicked: true, href };
        }
      }
      return { clicked: false, href: "" };
    });
    console.log(`Click result: ${JSON.stringify(clickResult)}`);

    // Wait for navigation
    await page.waitForTimeout(8000);

    const urlAfterClickA = page.url();
    console.log(`URL after click: ${urlAfterClickA}`);
    console.log(`Is seller page: ${urlAfterClickA.includes("/seller/")}`);
    console.log(`Is edit page (redirected back): ${urlAfterClickA.includes("/edit/")}`);

    // If we ended up back on edit page, the click may have created the
    // entry and redirected. Check if a "Berjaya" modal appeared.
    const modalCheck = await page.evaluate(() => {
      const m = document.querySelector(".bootbox, .modal.show, .modal.in");
      if (m) {
        const r = m.getBoundingClientRect();
        if (r.width > 50) return (m.textContent || "").trim().substring(0, 200);
      }
      return null;
    });
    if (modalCheck) {
      console.log(`Modal found: "${modalCheck.substring(0, 100)}"`);
      // Dismiss it
      await page.evaluate(() => { const b = document.querySelector(".bootbox .btn"); if (b) b.click(); });
      await page.waitForTimeout(1000);
    }

    // If we're on the edit page, the click created the entry and redirected.
    // The seller form content may now be inline, or we need to find the edit link.
    if (urlAfterClickA.includes("/edit/")) {
      console.log("Redirected back to edit page. Checking if seller entry was created...");
      // Look for an edit link for the newly created seller
      const editLink = await page.evaluate(() => {
        // Check for any seller edit links in the landlord table
        const links = document.querySelectorAll('#bhgn-a a[href*="seller"], #bhgn-a a[href*="edit_seller"]');
        const results = [];
        links.forEach(a => {
          const txt = (a.textContent || "").trim();
          const href = a.href || a.getAttribute("href") || "";
          const r = a.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            results.push({ text: txt.substring(0, 40), href: href.substring(0, 80), visible: true });
          }
        });
        return results;
      });
      console.log(`Edit links found: ${editLink.length}`);
      for (const l of editLink) console.log(`  "${l.text}" href="${l.href}"`);

      // Navigate to the seller page that was created
      if (sellerHref) {
        console.log(`Re-navigating to seller href: ${sellerHref}`);
        await page.goto(sellerHref, { timeout: 30000, waitUntil: "domcontentloaded" });
        await page.waitForTimeout(3000);
      }
    }

    // Now capture identity state for Run A
    const finalUrlA = page.url();
    console.log(`\nRun A final URL: ${finalUrlA}`);

    const tsA1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_clickvsnav_runA_${tsA1}.png`, fullPage: true });

    const stateA = await captureIdentityState(page);
    printState("RUN A — CLICK PATH", stateA);

    writeMarker("P5_CLICK_VS_NAV_RUN_A",
      `url=${finalUrlA}\n` +
      `method=portal_click_then_${finalUrlA.includes("/seller/") ? "on_seller" : "redirected_to_edit"}\n` +
      `kpDisplay=${stateA.kpDisplay}\n` +
      `radios=${stateA.radios.map(r => `${r.id}:w=${r.bboxW},display=${r.display}`).join("; ")}\n` +
      `tbCukai=${JSON.stringify(stateA.tbCukaiState)}\n` +
      `tbCukaiDisplay=${JSON.stringify(stateA.tbCukaiDispState)}\n` +
      `visibleIdInputs=${stateA.visibleIdInputs.map(i => `${i.name}/${i.id}`).join("; ")}\n` +
      `visibleControls=${stateA.visibleInputCount} inputs, ${stateA.visibleSelectCount} selects\n` +
      `kpHTML=${stateA.kpInnerHTML.substring(0, 400)}`
    );

    // ══════════════════════════════════════════════════════════════
    // RUN B: DIRECT URL NAVIGATION (CONTROL)
    // ══════════════════════════════════════════════════════════════
    console.log("\n\n=== RUN B: DIRECT URL NAVIGATION (CONTROL) ===\n");

    // Create a fresh seller form via a fresh application
    const reached2 = await reachBahagianA(page);
    if (!reached2) { console.log("ERROR: Failed to reach Bahagian A for Run B."); await context.close(); return; }

    const sellerHref2 = await page.evaluate(() => {
      for (const a of document.querySelectorAll("#bhgn-a a")) {
        if (/individu/i.test(a.textContent?.trim()) && a.href.includes("seller")) return a.href;
      }
      return null;
    });

    if (!sellerHref2) { console.log("ERROR: No seller href for Run B."); await context.close(); return; }

    console.log(`Direct navigating to: ${sellerHref2}`);
    await page.goto(sellerHref2, { timeout: 30000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);

    const finalUrlB = page.url();
    console.log(`Run B URL: ${finalUrlB}`);

    const tsB1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_clickvsnav_runB_${tsB1}.png`, fullPage: true });

    const stateB = await captureIdentityState(page);
    printState("RUN B — DIRECT NAV", stateB);

    writeMarker("P5_CLICK_VS_NAV_RUN_B",
      `url=${finalUrlB}\n` +
      `method=direct_url_navigation\n` +
      `kpDisplay=${stateB.kpDisplay}\n` +
      `radios=${stateB.radios.map(r => `${r.id}:w=${r.bboxW},display=${r.display}`).join("; ")}\n` +
      `tbCukai=${JSON.stringify(stateB.tbCukaiState)}\n` +
      `tbCukaiDisplay=${JSON.stringify(stateB.tbCukaiDispState)}\n` +
      `visibleIdInputs=${stateB.visibleIdInputs.map(i => `${i.name}/${i.id}`).join("; ")}\n` +
      `visibleControls=${stateB.visibleInputCount} inputs, ${stateB.visibleSelectCount} selects`
    );

    // ══════════════════════════════════════════════════════════════
    // COMPARISON
    // ══════════════════════════════════════════════════════════════
    console.log("\n\n=== COMPARISON ===");
    console.log(`div#kp display: A="${stateA.kpDisplay}" vs B="${stateB.kpDisplay}" → ${stateA.kpDisplay === stateB.kpDisplay ? "SAME" : "DIFFERENT"}`);
    console.log(`tb_cukai display: A="${stateA.tbCukaiState?.display}" vs B="${stateB.tbCukaiState?.display}" → ${stateA.tbCukaiState?.display === stateB.tbCukaiState?.display ? "SAME" : "DIFFERENT"}`);
    console.log(`Visible input count: A=${stateA.visibleInputCount} vs B=${stateB.visibleInputCount} → ${stateA.visibleInputCount === stateB.visibleInputCount ? "SAME" : "DIFFERENT"}`);
    console.log(`Visible select count: A=${stateA.visibleSelectCount} vs B=${stateB.visibleSelectCount} → ${stateA.visibleSelectCount === stateB.visibleSelectCount ? "SAME" : "DIFFERENT"}`);
    const anyRadioVisA = stateA.radios.some(r => r.bboxW > 0);
    const anyRadioVisB = stateB.radios.some(r => r.bboxW > 0);
    console.log(`Any EPD_NOKP_TYPE radio visible: A=${anyRadioVisA} vs B=${anyRadioVisB} → ${anyRadioVisA === anyRadioVisB ? "SAME" : "DIFFERENT"}`);

    console.log(`\n=== INVESTIGATION COMPLETE ===`);
    console.log(`NO IDENTITY DATA ENTERED. NO SAVE. NO SUBMIT.`);

  } finally {
    await context.close();
  }
}

run().catch((err) => {
  console.error("Investigation failed:", err);
  process.exit(1);
});
