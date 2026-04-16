/**
 * P5 Seller Identity Block — Reveal Investigation
 *
 * Maps how EPD_NOKP_TYPE and tb_cukai become visible/accessible.
 * Does NOT enter any identity data. Structure only.
 *
 * WARNING: Do NOT add kpin/identity interaction without requiring
 * ALLOW_LIVE_ID_LOOKUP=true and redacting returned TIN/name values.
 *
 * Usage: node scripts/p5-seller-identity-reveal.js
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

console.log("\n=== P5 SELLER IDENTITY REVEAL INVESTIGATION ===\n");

function writeMarker(name, body) {
  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(`${ARTIFACT_DIR}/${name}_${ts}.txt`, `${name}\n${new Date().toISOString()}\n${body}\n`);
  } catch {}
}

async function captureIdentityBlock(page, label) {
  const state = await page.evaluate(() => {
    // Find EPD_NOKP_TYPE radios
    const nokpRadios = [];
    document.querySelectorAll('input[name="EPD_NOKP_TYPE"]').forEach((el) => {
      const radio = el;
      const r = radio.getBoundingClientRect();
      const parent = radio.parentElement;
      const grandParent = parent?.parentElement;

      // Walk up to find containing div/section
      let container = radio.parentElement;
      let containerInfo = "";
      for (let i = 0; i < 6 && container; i++) {
        const cls = (container.className || "").toString();
        const id2 = container.id || "";
        const display = window.getComputedStyle(container).display;
        const visibility = window.getComputedStyle(container).visibility;
        const overflow = window.getComputedStyle(container).overflow;
        containerInfo += `[${i}] ${container.tagName.toLowerCase()}#${id2}.${cls.substring(0, 40)} display=${display} vis=${visibility} overflow=${overflow}\n`;
        container = container.parentElement;
      }

      nokpRadios.push({
        id: radio.id,
        value: radio.value,
        checked: radio.checked,
        required: radio.required,
        disabled: radio.disabled,
        type: radio.type,
        // Visibility
        bboxWidth: Math.round(r.width),
        bboxHeight: Math.round(r.height),
        bboxX: Math.round(r.x),
        bboxY: Math.round(r.y),
        isVisible: r.width > 0 && r.height > 0,
        computedDisplay: window.getComputedStyle(radio).display,
        computedVisibility: window.getComputedStyle(radio).visibility,
        // Label
        labelText: radio.labels?.[0]?.textContent?.trim() || "",
        parentText: (parent?.textContent || "").trim().substring(0, 60),
        // Container chain
        containerChain: containerInfo,
      });
    });

    // Find tb_cukai (the hidden required input)
    const tbCukai = document.querySelector('input[name="tb_cukai"]');
    let tbCukaiInfo = null;
    if (tbCukai) {
      const r = tbCukai.getBoundingClientRect();
      let container2 = tbCukai.parentElement;
      let containerInfo2 = "";
      for (let i = 0; i < 6 && container2; i++) {
        const cls = (container2.className || "").toString();
        const id3 = container2.id || "";
        const display = window.getComputedStyle(container2).display;
        const visibility = window.getComputedStyle(container2).visibility;
        containerInfo2 += `[${i}] ${container2.tagName.toLowerCase()}#${id3}.${cls.substring(0, 40)} display=${display} vis=${visibility}\n`;
        container2 = container2.parentElement;
      }

      tbCukaiInfo = {
        id: tbCukai.id || "",
        name: tbCukai.name,
        type: tbCukai.type,
        value: tbCukai.value,
        required: tbCukai.required,
        readOnly: tbCukai.readOnly,
        disabled: tbCukai.disabled,
        hidden: tbCukai.hidden,
        maxLength: tbCukai.maxLength > 0 ? tbCukai.maxLength : null,
        placeholder: tbCukai.placeholder || "",
        bboxWidth: Math.round(r.width),
        bboxHeight: Math.round(r.height),
        bboxX: Math.round(r.x),
        bboxY: Math.round(r.y),
        isVisible: r.width > 0 && r.height > 0,
        computedDisplay: window.getComputedStyle(tbCukai).display,
        computedVisibility: window.getComputedStyle(tbCukai).visibility,
        containerChain: containerInfo2,
        labelText: tbCukai.labels?.[0]?.textContent?.trim() || "",
      };
    }

    // Find tb_cukai_display (the read-only display)
    const tbCukaiDisplay = document.querySelector('input[name="tb_cukai_display"]');
    let tbCukaiDisplayInfo = null;
    if (tbCukaiDisplay) {
      const r = tbCukaiDisplay.getBoundingClientRect();
      tbCukaiDisplayInfo = {
        id: tbCukaiDisplay.id || "",
        name: tbCukaiDisplay.name,
        value: tbCukaiDisplay.value,
        readOnly: tbCukaiDisplay.readOnly,
        bboxWidth: Math.round(r.width),
        bboxHeight: Math.round(r.height),
        bboxX: Math.round(r.x),
        bboxY: Math.round(r.y),
        isVisible: r.width > 0 && r.height > 0,
        labelText: tbCukaiDisplay.labels?.[0]?.textContent?.trim() || "",
      };
    }

    // Find ALL labels/text near these controls
    const nearbyLabels = [];
    // Look for "No. Pengenalan", "IC", "Passport", "Tentera" etc.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let node;
    const idPatterns = [
      /no\.?\s*pengenalan/i, /kad\s*pengenalan/i, /ic\s/i, /passport/i,
      /pasport/i, /tentera/i, /polis/i, /jenis\s*pengenalan/i,
      /no\.?\s*kp/i, /nric/i, /mykad/i,
    ];
    while ((node = walker.nextNode())) {
      const txt = (node.textContent || "").trim();
      if (txt.length < 3 || txt.length > 100) continue;
      if (!idPatterns.some(p => p.test(txt))) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const r = parent.getBoundingClientRect();
      nearbyLabels.push({
        text: txt.substring(0, 80),
        tag: parent.tagName.toLowerCase(),
        visible: r.width > 0 && r.height > 0,
        bbox: r.width > 0 ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` : "none",
      });
    }

    return { nokpRadios, tbCukaiInfo, tbCukaiDisplayInfo, nearbyLabels };
  });

  console.log(`\n--- Identity Block State: ${label} ---`);

  console.log(`\nEPD_NOKP_TYPE radios (${state.nokpRadios.length}):`);
  for (const r of state.nokpRadios) {
    console.log(`  id="${r.id}" value="${r.value}" required=${r.required} checked=${r.checked}`);
    console.log(`    visible=${r.isVisible} bbox=${r.bboxX},${r.bboxY} ${r.bboxWidth}x${r.bboxHeight}`);
    console.log(`    display=${r.computedDisplay} visibility=${r.computedVisibility}`);
    console.log(`    label="${r.labelText}" parentText="${r.parentText}"`);
    console.log(`    containerChain:\n${r.containerChain.split("\n").map(l => "      " + l).join("\n")}`);
  }

  if (state.tbCukaiInfo) {
    const tc = state.tbCukaiInfo;
    console.log(`\ntb_cukai:`);
    console.log(`  id="${tc.id}" name="${tc.name}" type=${tc.type} value="${tc.value}"`);
    console.log(`  required=${tc.required} readOnly=${tc.readOnly} disabled=${tc.disabled} hidden=${tc.hidden}`);
    console.log(`  visible=${tc.isVisible} bbox=${tc.bboxX},${tc.bboxY} ${tc.bboxWidth}x${tc.bboxHeight}`);
    console.log(`  display=${tc.computedDisplay} visibility=${tc.computedVisibility}`);
    console.log(`  maxLength=${tc.maxLength} placeholder="${tc.placeholder}" label="${tc.labelText}"`);
    console.log(`  containerChain:\n${tc.containerChain.split("\n").map(l => "    " + l).join("\n")}`);
  } else {
    console.log(`\ntb_cukai: NOT FOUND IN DOM`);
  }

  if (state.tbCukaiDisplayInfo) {
    const td = state.tbCukaiDisplayInfo;
    console.log(`\ntb_cukai_display:`);
    console.log(`  id="${td.id}" name="${td.name}" value="${td.value}" readOnly=${td.readOnly}`);
    console.log(`  visible=${td.isVisible} bbox=${td.bboxX},${td.bboxY} ${td.bboxWidth}x${td.bboxHeight}`);
    console.log(`  label="${td.labelText}"`);
  }

  console.log(`\nNearby identity labels (${state.nearbyLabels.length}):`);
  for (const l of state.nearbyLabels) {
    console.log(`  "${l.text}" tag=${l.tag} visible=${l.visible} bbox=${l.bbox}`);
  }

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
    // Reach seller form
    console.log("Reaching seller form...");
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
    await page.locator("#pds_suratcara").selectOption({value:"1101"});
    await page.locator("#pds_ps").selectOption({value:"p"});
    await page.waitForTimeout(500);
    await page.evaluate(() => { document.getElementById("pdsL01_bhgn_am")?.click(); });
    await page.waitForTimeout(5000);
    await page.evaluate(() => { const b = document.querySelector(".bootbox .btn"); if (b) b.click(); });
    await page.waitForTimeout(1000);
    await page.evaluate(() => { for (const a of document.querySelectorAll('.nav-tabs a')) { if (/bahagian.a/i.test(a.textContent)) { a.click(); return; } } });
    await page.waitForTimeout(2000);
    const href = await page.evaluate(() => { for (const a of document.querySelectorAll('#bhgn-a a')) { if (/individu/i.test(a.textContent) && a.href.includes('seller')) return a.href; } return null; });
    await page.goto(href, { timeout: 30000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    console.log(`Seller URL: ${page.url()}\n`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 1: Check initial state of identity controls
    // ═══════════════════════════════════════════════════════════════
    console.log("=== PHASE 1: Initial state (no interaction) ===");
    const ts1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_id_reveal_initial_${ts1}.png`, fullPage: true });
    const initial = await captureIdentityBlock(page, "INITIAL");

    // ═══════════════════════════════════════════════════════════════
    // PHASE 2: Select Status Warganegara = Warganegara
    // ═══════════════════════════════════════════════════════════════
    console.log("\n\n=== PHASE 2: After selecting Warganegara ===");
    await page.locator("#warga").selectOption({ value: "1" }); // Warganegara
    await page.waitForTimeout(2000);
    const ts2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_id_reveal_warganegara_${ts2}.png`, fullPage: true });
    const afterWarga = await captureIdentityBlock(page, "AFTER_WARGANEGARA");

    // ═══════════════════════════════════════════════════════════════
    // PHASE 3: Scroll down to check if fields are below fold
    // ═══════════════════════════════════════════════════════════════
    console.log("\n\n=== PHASE 3: After scrolling ===");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    const ts3 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_id_reveal_scrolled_${ts3}.png`, fullPage: true });
    // Scroll back up
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 4: Try selecting Bukan Warganegara to see if controls differ
    // ═══════════════════════════════════════════════════════════════
    console.log("\n\n=== PHASE 4: After selecting Bukan Warganegara ===");
    await page.locator("#warga").selectOption({ value: "2" }); // Bukan Warganegara
    await page.waitForTimeout(2000);
    const ts4 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_id_reveal_bukanwarga_${ts4}.png`, fullPage: true });
    const afterBukanWarga = await captureIdentityBlock(page, "AFTER_BUKAN_WARGANEGARA");

    // ═══════════════════════════════════════════════════════════════
    // PHASE 5: Switch back to Warganegara for clean state
    // ═══════════════════════════════════════════════════════════════
    console.log("\n\n=== PHASE 5: Back to Warganegara for final check ===");
    await page.locator("#warga").selectOption({ value: "1" });
    await page.waitForTimeout(2000);

    // Check if any of the radio IDs (IC_BARU etc) are now visible
    const finalCheck = await page.evaluate(() => {
      const ids = ["IC_BARU", "IC_POLIS", "IC_LAMA", "IC_ARMY"];
      const results = {};
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) {
          const r = el.getBoundingClientRect();
          const s = window.getComputedStyle(el);
          const parentS = el.parentElement ? window.getComputedStyle(el.parentElement) : null;
          results[id] = {
            inDOM: true,
            bboxW: Math.round(r.width), bboxH: Math.round(r.height),
            bboxX: Math.round(r.x), bboxY: Math.round(r.y),
            display: s.display, visibility: s.visibility, opacity: s.opacity,
            parentDisplay: parentS?.display, parentVisibility: parentS?.visibility,
          };
        } else {
          results[id] = { inDOM: false };
        }
      }
      // Also check tb_cukai
      const tc = document.querySelector('[name="tb_cukai"]');
      if (tc) {
        const r = tc.getBoundingClientRect();
        const s = window.getComputedStyle(tc);
        results["tb_cukai"] = {
          inDOM: true, type: tc.type,
          bboxW: Math.round(r.width), bboxH: Math.round(r.height),
          display: s.display, visibility: s.visibility, opacity: s.opacity,
        };
      }
      return results;
    });

    console.log("\nFinal visibility check:");
    for (const [id, info] of Object.entries(finalCheck)) {
      console.log(`  ${id}: ${JSON.stringify(info)}`);
    }

    writeMarker("P5_SELLER_IDENTITY_REVEAL",
      `INITIAL: nokpRadios visible=${initial.nokpRadios.some(r => r.isVisible)}, tbCukai visible=${initial.tbCukaiInfo?.isVisible}\n` +
      `AFTER_WARGANEGARA: nokpRadios visible=${afterWarga.nokpRadios.some(r => r.isVisible)}, tbCukai visible=${afterWarga.tbCukaiInfo?.isVisible}\n` +
      `AFTER_BUKAN_WARGANEGARA: nokpRadios visible=${afterBukanWarga.nokpRadios.some(r => r.isVisible)}, tbCukai visible=${afterBukanWarga.tbCukaiInfo?.isVisible}\n` +
      `finalCheck=${JSON.stringify(finalCheck)}`
    );

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
