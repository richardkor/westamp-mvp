/**
 * Nama Surat Cara Interaction Investigation
 *
 * Tests the behavior of the namaperjanjian input on the p8 (Penyeteman Am)
 * post-save page. For each document name, opens a fresh p8 session,
 * types the name, observes autocomplete/suggestions, and captures
 * the resulting state of profile_desc and pds_ps.
 *
 * Usage: node scripts/nama-surat-cara-investigation.js <document_name>
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

const docName = process.argv[2] || "Employment Contract";
console.log(`\n=== NAMA SURAT CARA INVESTIGATION: "${docName}" ===\n`);

function writeMarker(name, body) {
  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(
      `${ARTIFACT_DIR}/${name}_${ts}.txt`,
      `${name}\n${new Date().toISOString()}\n${body}\n`
    );
  } catch { /* best-effort */ }
}

async function captureControlState(page, label) {
  const state = await page.evaluate(() => {
    const result = {};

    // namaperjanjian
    const nsc = document.getElementById("namaperjanjian");
    result.namaperjanjian_value = nsc ? nsc.value : "(not found)";
    result.namaperjanjian_readOnly = nsc ? nsc.readOnly : false;

    // profile_desc
    const pd = document.getElementById("profile_desc");
    result.profile_desc_value = pd ? pd.value : "(not found)";
    result.profile_desc_readOnly = pd ? pd.readOnly : false;

    // pds_ps
    const ps = document.getElementById("pds_ps");
    if (ps) {
      const cur = ps.options[ps.selectedIndex];
      result.pds_ps_value = ps.value;
      result.pds_ps_text = cur ? cur.text : "(none)";
      result.pds_ps_disabled = ps.disabled;
    } else {
      result.pds_ps_value = "(not found)";
      result.pds_ps_text = "(not found)";
    }

    // Check for visible suggestion lists / autocomplete dropdowns
    const suggestionSelectors = [
      ".ui-autocomplete", ".tt-menu", ".typeahead", ".suggestions",
      ".dropdown-menu.show", "[role='listbox']", ".pac-container",
      ".awesomplete", ".autocomplete-results", ".search-results",
    ];
    const suggestions = [];
    for (const sel of suggestionSelectors) {
      const els = document.querySelectorAll(sel);
      els.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          const items = [];
          el.querySelectorAll("li, .tt-suggestion, [role='option'], a, .item").forEach((item) => {
            const txt = (item.textContent || "").trim();
            if (txt.length > 0 && txt.length < 200) items.push(txt.substring(0, 100));
          });
          suggestions.push({
            selector: sel,
            visible: true,
            itemCount: items.length,
            items: items.slice(0, 10),
            bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          });
        }
      });
    }
    result.suggestions = suggestions;

    // Check for visible messages/validation near the control
    const nscParent = nsc ? nsc.closest(".form-group") : null;
    if (nscParent) {
      const msgs = [];
      nscParent.querySelectorAll(".help-block, .error, .text-danger, .text-info, .text-muted, small, .hint").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          msgs.push((el.textContent || "").trim().substring(0, 100));
        }
      });
      result.nearbyMessages = msgs;
    }

    return result;
  });

  console.log(`\n--- Control State: ${label} ---`);
  console.log(`  namaperjanjian: "${state.namaperjanjian_value}" (readOnly=${state.namaperjanjian_readOnly})`);
  console.log(`  profile_desc: "${state.profile_desc_value}" (readOnly=${state.profile_desc_readOnly})`);
  console.log(`  pds_ps: value="${state.pds_ps_value}" text="${state.pds_ps_text}" disabled=${state.pds_ps_disabled}`);
  if (state.suggestions && state.suggestions.length > 0) {
    for (const sg of state.suggestions) {
      console.log(`  SUGGESTIONS: selector=${sg.selector}, items=${sg.itemCount}, bbox=${sg.bbox.x},${sg.bbox.y} ${sg.bbox.w}x${sg.bbox.h}`);
      for (const item of sg.items) {
        console.log(`    - "${item}"`);
      }
    }
  } else {
    console.log(`  suggestions: none visible`);
  }
  if (state.nearbyMessages && state.nearbyMessages.length > 0) {
    for (const m of state.nearbyMessages) {
      console.log(`  message: "${m}"`);
    }
  }

  return state;
}

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
    // Navigate to fresh application form
    console.log("Navigating to application form...");
    await page.goto("https://stamps.hasil.gov.my/stamps/form/application", {
      timeout: 30000, waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(3000);

    // Select Penyeteman Am
    console.log("Selecting Penyeteman Am...");
    await page.evaluate(() => {
      const radios = document.querySelectorAll('input[type="radio"]');
      for (const r of radios) {
        if (r.parentElement?.textContent?.trim() === "Penyeteman Am") {
          r.click();
          return;
        }
      }
    });
    await page.waitForTimeout(1000);

    // Fill shared fields
    console.log("Filling shared fields (Sarawak, 01/Januari/2026)...");
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
    try {
      // Find first month select and set to Januari
      const selCount = await page.evaluate(() => {
        let idx = 0;
        const sels = document.querySelectorAll("select");
        for (const s of sels) {
          const r = s.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          if (s.name === "CD_DUTISETEM_ID") continue;
          if (s.options.length >= 12 && s.options.length <= 13) return idx;
          idx++;
        }
        return -1;
      });
    } catch {}
    // Use the known working approach
    try { await page.locator("select").nth(2).selectOption({ label: "Januari" }); } catch {}
    await page.waitForTimeout(500);

    // Click Seterusnya
    console.log("Clicking Seterusnya...");
    await page.locator("button#btn-ma-submit").click();
    await page.waitForTimeout(5000);

    const postSaveUrl = page.url();
    console.log(`Post-save URL: ${postSaveUrl}`);

    if (!postSaveUrl.includes("/formv2/p8/")) {
      console.log("ERROR: Not on p8 page. Aborting.");
      await context.close();
      return;
    }

    // Screenshot: baseline before interaction
    const ts1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/nsc_baseline_${docName.replace(/\s+/g, "_")}_${ts1}.png`, fullPage: true });

    // Capture baseline state
    const baseline = await captureControlState(page, "BASELINE");

    // ── Interact with namaperjanjian ─────────────────────────────
    console.log(`\n=== Typing "${docName}" into namaperjanjian ===`);

    // Step 1: Click/focus the field
    const nscField = page.locator("#namaperjanjian");
    await nscField.click();
    await page.waitForTimeout(500);

    // Step 2: Clear and type the document name character by character
    // (to trigger any keystroke-based autocomplete)
    await nscField.fill("");
    await page.waitForTimeout(300);

    // Type slowly to allow autocomplete to trigger
    for (const char of docName) {
      await page.keyboard.type(char, { delay: 50 });
    }
    await page.waitForTimeout(2000);

    // Check for suggestions after typing
    const afterTyping = await captureControlState(page, "AFTER_TYPING");

    // Screenshot: after typing (may show autocomplete dropdown)
    const ts2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/nsc_after_typing_${docName.replace(/\s+/g, "_")}_${ts2}.png`, fullPage: true });

    // Step 3: If suggestions appeared, try to select the matching one
    let suggestionSelected = false;
    let selectedSuggestionText = "";
    if (afterTyping.suggestions && afterTyping.suggestions.length > 0) {
      console.log(`\nSuggestions found! Attempting to select matching item...`);
      // Try clicking the first matching suggestion
      const clicked = await page.evaluate((target) => {
        const selectors = [
          ".ui-autocomplete li", ".tt-suggestion", "[role='option']",
          ".dropdown-menu.show li", ".suggestions li", ".autocomplete-results li",
        ];
        for (const sel of selectors) {
          const items = document.querySelectorAll(sel);
          for (const item of items) {
            const txt = (item.textContent || "").trim();
            const r = item.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && txt.toLowerCase().includes(target.toLowerCase())) {
              item.click();
              return txt;
            }
          }
          // If no exact match, try clicking the first visible item
          for (const item of items) {
            const r = item.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              item.click();
              return (item.textContent || "").trim();
            }
          }
        }
        return null;
      }, docName);

      if (clicked) {
        suggestionSelected = true;
        selectedSuggestionText = clicked;
        console.log(`  Selected suggestion: "${clicked}"`);
      }
      await page.waitForTimeout(2000);
    } else {
      console.log(`\nNo suggestions visible after typing. Trying blur + wait...`);
    }

    // Step 4: Trigger blur to fire any deferred logic
    await nscField.evaluate((el) => {
      el.dispatchEvent(new Event("blur", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(2000);

    // Step 5: Try pressing Enter
    await nscField.click();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);

    // Step 6: Check for any dialog that appeared
    // (already handled by page-level dialog listener if any)

    // Final state capture
    const finalState = await captureControlState(page, "FINAL");

    // Screenshot: final settled state
    const ts3 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/nsc_final_${docName.replace(/\s+/g, "_")}_${ts3}.png`, fullPage: true });

    // Verify URL didn't change (no unexpected navigation)
    const finalUrl = page.url();
    console.log(`\nFinal URL: ${finalUrl}`);
    console.log(`URL changed: ${finalUrl !== postSaveUrl}`);

    // Write summary
    writeMarker(`NSC_INVESTIGATION_${docName.replace(/\s+/g, "_").toUpperCase()}`,
      `docName=${docName}\n` +
      `url=${postSaveUrl}\n` +
      `BASELINE:\n` +
      `  namaperjanjian="${baseline.namaperjanjian_value}"\n` +
      `  profile_desc="${baseline.profile_desc_value}"\n` +
      `  pds_ps_value="${baseline.pds_ps_value}" text="${baseline.pds_ps_text}"\n` +
      `AFTER_TYPING:\n` +
      `  namaperjanjian="${afterTyping.namaperjanjian_value}"\n` +
      `  profile_desc="${afterTyping.profile_desc_value}"\n` +
      `  pds_ps_value="${afterTyping.pds_ps_value}" text="${afterTyping.pds_ps_text}"\n` +
      `  suggestions=${afterTyping.suggestions ? afterTyping.suggestions.length : 0}\n` +
      (afterTyping.suggestions && afterTyping.suggestions.length > 0
        ? `  suggestionItems=[${afterTyping.suggestions[0].items.join("; ")}]\n`
        : "") +
      `  suggestionSelected=${suggestionSelected} selectedText="${selectedSuggestionText}"\n` +
      `FINAL:\n` +
      `  namaperjanjian="${finalState.namaperjanjian_value}"\n` +
      `  profile_desc="${finalState.profile_desc_value}"\n` +
      `  pds_ps_value="${finalState.pds_ps_value}" text="${finalState.pds_ps_text}"\n` +
      `  profile_desc_changed=${baseline.profile_desc_value !== finalState.profile_desc_value}\n` +
      `  pds_ps_changed=${baseline.pds_ps_value !== finalState.pds_ps_value}\n` +
      `finalUrl=${finalUrl}`
    );

    console.log(`\n=== INVESTIGATION COMPLETE: "${docName}" ===`);
    console.log(`  profile_desc changed: ${baseline.profile_desc_value !== finalState.profile_desc_value} (before="${baseline.profile_desc_value}", after="${finalState.profile_desc_value}")`);
    console.log(`  pds_ps changed: ${baseline.pds_ps_value !== finalState.pds_ps_value} (before="${baseline.pds_ps_text}", after="${finalState.pds_ps_text}")`);
    console.log(`  NO SAVE. NO SUBMIT. NO LATER TABS.`);

  } finally {
    await context.close();
  }
}

run().catch((err) => {
  console.error("Investigation failed:", err);
  process.exit(1);
});
