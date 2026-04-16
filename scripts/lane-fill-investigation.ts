/**
 * Lane Fill Investigation Script
 *
 * Standalone script that reuses the persistent browser profile to:
 * 1. Navigate to the application form
 * 2. Select a lane
 * 3. Fill shared Maklumat Am fields (Pejabat Setem, Tarikh Surat Cara)
 * 4. Capture full field inventory after fill
 * 5. Stop without saving
 *
 * Usage:
 *   npx tsx scripts/lane-fill-investigation.ts sewa_pajakan
 *   npx tsx scripts/lane-fill-investigation.ts penyeteman_am
 */

import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

const lane = process.argv[2] || "sewa_pajakan";
console.log(`\n=== LANE FILL INVESTIGATION: ${lane} ===\n`);

function writeMarker(name: string, body: string): void {
  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(
      `${ARTIFACT_DIR}/${name}_${ts}.txt`,
      `${name}\n${new Date().toISOString()}\n${body}\n`
    );
  } catch { /* best-effort */ }
}

async function captureFieldInventory(page: import("playwright").Page, label: string) {
  const inventory = await page.evaluate(() => {
    const blockTags = new Set(["html", "body", "head"]);

    // Labels
    const labels: Array<{ text: string; forId: string }> = [];
    document.querySelectorAll("label").forEach((lbl) => {
      const txt = (lbl.textContent || "").trim();
      const r = lbl.getBoundingClientRect();
      if (txt.length > 0 && txt.length < 120 && r.width > 0 && r.height > 0) {
        labels.push({ text: txt.substring(0, 80), forId: lbl.htmlFor || "" });
      }
    });

    // Inputs
    const inputs: Array<{
      type: string; name: string; id: string; value: string;
      placeholder: string; readOnly: boolean; label: string;
    }> = [];
    document.querySelectorAll("input, textarea").forEach((el) => {
      const input = el as HTMLInputElement;
      const r = input.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const lbl = input.labels?.[0]?.textContent?.trim() || "";
      inputs.push({
        type: input.type || "text",
        name: input.name,
        id: input.id,
        value: input.value.substring(0, 60),
        placeholder: (input.placeholder || "").substring(0, 40),
        readOnly: input.readOnly,
        label: lbl.substring(0, 80),
      });
    });

    // Selects
    const selects: Array<{
      name: string; id: string; selectedText: string;
      optionCount: number; label: string; firstOptions: string[];
    }> = [];
    document.querySelectorAll("select").forEach((el) => {
      const sel = el as HTMLSelectElement;
      const r = sel.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const selectedOpt = sel.options[sel.selectedIndex];
      const lbl = sel.labels?.[0]?.textContent?.trim() || "";
      const firstOpts: string[] = [];
      for (let i = 0; i < Math.min(5, sel.options.length); i++) {
        firstOpts.push(sel.options[i].text.substring(0, 40));
      }
      selects.push({
        name: sel.name,
        id: sel.id,
        selectedText: (selectedOpt?.text || "").substring(0, 60),
        optionCount: sel.options.length,
        label: lbl.substring(0, 80),
        firstOptions: firstOpts,
      });
    });

    // Radio groups
    const radioGroups: Map<string, Array<{ value: string; label: string; checked: boolean }>> = new Map();
    document.querySelectorAll('input[type="radio"]').forEach((el) => {
      const radio = el as HTMLInputElement;
      const r = radio.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const lbl = radio.labels?.[0]?.textContent?.trim() || radio.parentElement?.textContent?.trim() || "";
      const group = radioGroups.get(radio.name) || [];
      group.push({ value: radio.value, label: lbl.substring(0, 60), checked: radio.checked });
      radioGroups.set(radio.name, group);
    });
    const radioGroupsArr: Array<{ name: string; options: Array<{ value: string; label: string; checked: boolean }> }> = [];
    radioGroups.forEach((opts, name) => {
      radioGroupsArr.push({ name, options: opts });
    });

    // Headings
    const headings: string[] = [];
    document.querySelectorAll("h1, h2, h3, h4, h5, .box-title, .box-header, legend, .content-header").forEach((h) => {
      const txt = (h.textContent || "").trim();
      const r = h.getBoundingClientRect();
      if (txt.length > 0 && txt.length < 120 && r.width > 0 && r.height > 0) headings.push(txt.substring(0, 100));
    });

    // Key text search
    const keyPatterns = [
      "Nama Surat Cara", "Kategori Surat Cara", "Kumpulan Surat Cara",
      "Pejabat Setem", "Tarikh Surat Cara", "Tarikh Diterima",
      "Surat Cara", "Maklumat Am", "Jenis Surat Cara", "Dokumen",
    ];
    const keyTextFound: Array<{ text: string; tag: string; visible: boolean }> = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const txt = (node.textContent || "").trim();
      if (txt.length < 3 || txt.length > 120) continue;
      for (const key of keyPatterns) {
        if (txt.includes(key)) {
          const parent = node.parentElement;
          if (!parent || blockTags.has(parent.tagName.toLowerCase())) continue;
          const r = parent.getBoundingClientRect();
          const vis = r.width > 0 && r.height > 0;
          keyTextFound.push({ text: txt.substring(0, 80), tag: parent.tagName.toLowerCase(), visible: vis });
          break;
        }
      }
    }

    const bodySnippet = document.body?.innerText?.substring(0, 1500) || "";

    return { labels, inputs, selects, radioGroups: radioGroupsArr, headings, keyTextFound, bodySnippet };
  });

  console.log(`\n--- Field Inventory: ${label} ---`);
  console.log(`Headings: ${inventory.headings.join("; ")}`);
  console.log(`Labels (${inventory.labels.length}):`);
  for (const l of inventory.labels) console.log(`  "${l.text}" for="${l.forId}"`);
  console.log(`Inputs (${inventory.inputs.length}):`);
  for (const i of inventory.inputs) console.log(`  type=${i.type} name=${i.name} id=${i.id} value="${i.value}" ro=${i.readOnly} label="${i.label}"`);
  console.log(`Selects (${inventory.selects.length}):`);
  for (const s of inventory.selects) console.log(`  name=${s.name} id=${s.id} selected="${s.selectedText}" opts=${s.optionCount} label="${s.label}" first=[${s.firstOptions.join(",")}]`);
  console.log(`Radio groups (${inventory.radioGroups.length}):`);
  for (const rg of inventory.radioGroups) console.log(`  name=${rg.name}: ${rg.options.map(o => `${o.value}="${o.label}"${o.checked ? "*" : ""}`).join(", ")}`);
  console.log(`Key text (${inventory.keyTextFound.length}):`);
  for (const k of inventory.keyTextFound) console.log(`  "${k.text}" tag=${k.tag} vis=${k.visible}`);
  console.log(`Body (first 300): "${inventory.bodySnippet.substring(0, 300)}"`);

  writeMarker(`LANE_FILL_INVENTORY_${label.toUpperCase().replace(/\s+/g, "_")}`,
    `headings=${inventory.headings.join("; ")}\n` +
    `labels=${inventory.labels.map(l => `"${l.text}"`).join("; ")}\n` +
    `inputs=${inventory.inputs.map(i => `${i.type}:${i.name}="${i.value}" ro=${i.readOnly} label="${i.label}"`).join("; ")}\n` +
    `selects=${inventory.selects.map(s => `${s.name}="${s.selectedText}" (${s.optionCount} opts) label="${s.label}"`).join("; ")}\n` +
    `radioGroups=${inventory.radioGroups.map(rg => `${rg.name}=[${rg.options.map(o => `${o.value}="${o.label}"${o.checked ? "*" : ""}`).join(",")}]`).join("; ")}\n` +
    `keyText=${inventory.keyTextFound.map(k => `"${k.text}" vis=${k.visible}`).join("; ")}\n` +
    `body=${inventory.bodySnippet.substring(0, 600)}`
  );

  return inventory;
}

async function run() {
  // Launch using persistent profile
  const profilePath = path.resolve(PROFILE_DIR);
  console.log(`Using profile: ${profilePath}`);

  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    // Navigate to the application form
    console.log("Navigating to application form...");
    await page.goto("https://stamps.hasil.gov.my/stamps/form/application", {
      timeout: 30000,
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(3000);

    console.log(`Current URL: ${page.url()}`);

    // Check if we're on the form page
    const onFormPage = page.url().includes("stamps/form/application");
    if (!onFormPage) {
      console.log("ERROR: Not on application form page. May need full navigation.");
      // Try to detect if we need to navigate through the menu
      console.log(`Actual URL: ${page.url()}`);
      await context.close();
      return;
    }

    // Screenshot: before lane selection
    const ts1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/lane_fill_pre_select_${lane}_${ts1}.png`, fullPage: true });

    // Select the lane radio
    const laneLabels: Record<string, string> = {
      sewa_pajakan: "Sewa / Pajakan",
      penyeteman_am: "Penyeteman Am",
    };
    const laneLabel = laneLabels[lane] || lane;

    console.log(`Selecting lane: "${laneLabel}"...`);
    const radioClicked = await page.evaluate((label: string) => {
      const radios = document.querySelectorAll('input[type="radio"]');
      for (const r of radios) {
        const input = r as HTMLInputElement;
        const lbl = input.labels?.[0]?.textContent?.trim() || input.parentElement?.textContent?.trim() || "";
        if (lbl === label) {
          input.click();
          return true;
        }
      }
      return false;
    }, laneLabel);

    if (!radioClicked) {
      console.log(`ERROR: Could not find radio for "${laneLabel}"`);
      await context.close();
      return;
    }
    console.log(`Lane "${laneLabel}" selected.`);
    await page.waitForTimeout(2000);

    // Screenshot: after lane selection, before fill
    const ts2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/lane_fill_post_select_${lane}_${ts2}.png`, fullPage: true });

    // Capture pre-fill inventory
    await captureFieldInventory(page, `${lane}_pre_fill`);

    // ── Fill shared fields ──────────────────────────────────────────
    // 1. Pejabat Setem Negeri (select CD_DUTISETEM_ID) — choose "Sarawak"
    console.log("\nFilling Pejabat Setem Negeri...");
    const pejabatFilled = await page.evaluate(() => {
      const sel = document.querySelector('select[name="CD_DUTISETEM_ID"]') as HTMLSelectElement | null;
      if (!sel) return { filled: false, reason: "select not found" };
      // Find an option with "Sarawak"
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].text.includes("Sarawak")) {
          sel.selectedIndex = i;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          return { filled: true, reason: `Selected: "${sel.options[i].text}"`, value: sel.value };
        }
      }
      // Fallback: select any non-empty option
      if (sel.options.length > 1) {
        sel.selectedIndex = 1;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return { filled: true, reason: `Selected: "${sel.options[1].text}" (fallback)`, value: sel.value };
      }
      return { filled: false, reason: "no suitable option" };
    });
    console.log(`  Pejabat Setem: ${JSON.stringify(pejabatFilled)}`);
    await page.waitForTimeout(2000);

    // 2. Tarikh surat cara (date fields — tsd input + year/month selects)
    // The date fields are: text input for day, select for year, select for month
    console.log("\nFilling Tarikh Surat Cara...");

    // First, let's understand the exact date field structure
    const dateFieldInfo = await page.evaluate(() => {
      // Find all visible inputs/selects near "Tarikh surat cara"
      const allInputs = document.querySelectorAll("input, select");
      const dateRelated: Array<{
        tag: string; type: string; name: string; id: string;
        optionCount?: number; firstOptions?: string[];
        bbox: { x: number; y: number; w: number; h: number } | null;
        visible: boolean;
      }> = [];

      allInputs.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const input = el as HTMLInputElement;
        const sel = el as HTMLSelectElement;
        const tag = el.tagName.toLowerCase();

        // Focus on elements with date-related names or near the date section
        const name = input.name || sel.name || "";
        const id = input.id || sel.id || "";

        if (name === "tsd" || name === "tsm" || id === "tsd" || id === "tsm" ||
            name.includes("tarikh") || name.includes("date") ||
            id.includes("tarikh") || id.includes("date") ||
            // Also capture unnamed selects (year/month dropdowns)
            (tag === "select" && !name && sel.options.length > 10)) {
          const entry: typeof dateRelated[0] = {
            tag,
            type: input.type || "",
            name,
            id,
            bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            visible: true,
          };
          if (tag === "select") {
            entry.optionCount = sel.options.length;
            entry.firstOptions = [];
            for (let i = 0; i < Math.min(5, sel.options.length); i++) {
              entry.firstOptions.push(`${sel.options[i].value}="${sel.options[i].text}"`);
            }
          }
          dateRelated.push(entry);
        }
      });

      return dateRelated;
    });

    console.log(`  Date-related fields: ${dateFieldInfo.length}`);
    for (const d of dateFieldInfo) {
      console.log(`    tag=${d.tag} type=${d.type} name=${d.name} id=${d.id} opts=${d.optionCount || 0} bbox=${d.bbox ? `${d.bbox.x},${d.bbox.y}` : "none"}`);
      if (d.firstOptions) console.log(`      first: [${d.firstOptions.join(", ")}]`);
    }

    // Fill the date: use "01" day, "2026" year, Januari month
    // Use Playwright's native select/fill APIs for reliability instead of
    // page.evaluate selectedIndex assignment (which the portal JS may reset).
    console.log("  Filling day (tsd)...");
    try {
      await page.fill('input[name="tsd"]', "01");
    } catch (e) {
      console.log(`  day fill failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    await page.waitForTimeout(1000);

    // For year/month selects (unnamed), use Playwright selectOption by label/value
    // First identify them by their option counts via DOM
    const selectInfo = await page.evaluate(() => {
      const results: Array<{ index: number; name: string; optionCount: number; currentText: string; currentValue: string }> = [];
      const allSelects = document.querySelectorAll("select");
      allSelects.forEach((sel, idx) => {
        const s = sel as HTMLSelectElement;
        const r = s.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        if (s.name === "CD_DUTISETEM_ID") return;
        const cur = s.options[s.selectedIndex];
        results.push({
          index: idx,
          name: s.name,
          optionCount: s.options.length,
          currentText: cur?.text || "",
          currentValue: cur?.value || "",
        });
      });
      return results;
    });
    console.log(`  Unnamed selects found: ${selectInfo.length}`);
    for (const si of selectInfo) {
      console.log(`    [${si.index}] name="${si.name}" opts=${si.optionCount} current="${si.currentText}" val="${si.currentValue}"`);
    }

    // Fill year selects (>100 options) with label "2026"
    // Fill month selects (12 options) with label "Januari"
    // Use Playwright's selectOption on the nth select element
    for (const si of selectInfo) {
      const nthSelector = `select >> nth=${si.index}`;
      try {
        if (si.optionCount > 100) {
          // Year select — try to select by label "2026"
          console.log(`  Setting year select [${si.index}] to "2026"...`);
          await page.locator(`select`).nth(si.index).selectOption({ label: "2026" });
          await page.waitForTimeout(500);
        } else if (si.optionCount >= 12 && si.optionCount <= 13) {
          // Month select — select Januari (first option, value "0")
          console.log(`  Setting month select [${si.index}] to "Januari"...`);
          await page.locator(`select`).nth(si.index).selectOption({ label: "Januari" });
          await page.waitForTimeout(500);
        }
      } catch (e) {
        console.log(`    selectOption failed for [${si.index}]: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    await page.waitForTimeout(3000);

    // ── DOM readback: verify ACTUAL values held by each control ────
    const actualValues = await page.evaluate(() => {
      const result: Record<string, string> = {};

      // Pejabat Setem
      const pejabat = document.querySelector('select[name="CD_DUTISETEM_ID"]') as HTMLSelectElement | null;
      if (pejabat) {
        const cur = pejabat.options[pejabat.selectedIndex];
        result["pejabat_setem_text"] = cur?.text || "(none)";
        result["pejabat_setem_value"] = cur?.value || "";
      }

      // Day (tsd)
      const tsd = document.querySelector('input[name="tsd"]') as HTMLInputElement | null;
      result["tsd_value"] = tsd?.value || "(not found)";

      // Day (tsm)
      const tsm = document.querySelector('input[name="tsm"]') as HTMLInputElement | null;
      result["tsm_value"] = tsm?.value || "(not found)";

      // Unnamed year/month selects
      const allSelects = document.querySelectorAll("select");
      let yearIdx = 0;
      let monthIdx = 0;
      allSelects.forEach((sel) => {
        const s = sel as HTMLSelectElement;
        const r = s.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        if (s.name === "CD_DUTISETEM_ID") return;
        const cur = s.options[s.selectedIndex];
        if (s.options.length > 100) {
          result[`year${yearIdx}_text`] = cur?.text || "(none)";
          result[`year${yearIdx}_value`] = cur?.value || "";
          yearIdx++;
        } else if (s.options.length >= 12 && s.options.length <= 13) {
          result[`month${monthIdx}_text`] = cur?.text || "(none)";
          result[`month${monthIdx}_value`] = cur?.value || "";
          monthIdx++;
        }
      });

      // Lane radio
      const radios = document.querySelectorAll('input[name="ES_PDS_APP"]');
      radios.forEach((r) => {
        const radio = r as HTMLInputElement;
        if (radio.checked) {
          const lbl = radio.labels?.[0]?.textContent?.trim() || radio.parentElement?.textContent?.trim() || "";
          result["selected_lane_value"] = radio.value;
          result["selected_lane_label"] = lbl;
        }
      });

      return result;
    });

    console.log("\n=== ACTUAL DOM VALUES AFTER FILL ===");
    for (const [k, v] of Object.entries(actualValues)) {
      console.log(`  ${k}: "${v}"`);
    }

    // Screenshot: after fill
    const ts3 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/lane_fill_post_fill_${lane}_${ts3}.png`, fullPage: true });

    // Capture post-fill inventory
    const postFillInventory = await captureFieldInventory(page, `${lane}_post_fill`);

    // ── SAVE STEP ──────────────────────────────────────────────────
    // Find and click the save control for the current Maklumat Am section.
    console.log("\n=== SAVE STEP ===");

    // Screenshot: immediately before save
    const ts4 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/lane_save_pre_${lane}_${ts4}.png`, fullPage: true });

    // Find save buttons/controls via DOM-walk
    const saveControls = await page.evaluate(() => {
      const SAVE_PATTERNS = [
        /^simpan$/i, /^save$/i, /^kemaskini$/i, /^update$/i,
        /simpan\s*maklumat/i, /save\s*info/i,
        /^seterusnya$/i, /^next$/i, /^submit$/i, /^hantar$/i,
      ];
      const results: Array<{
        text: string; tag: string; type: string; id: string; name: string;
        className: string; value: string;
        bbox: { x: number; y: number; w: number; h: number } | null;
        isVisible: boolean; isDisabled: boolean;
      }> = [];

      // Check buttons, inputs[submit], a links
      const candidates = document.querySelectorAll("button, input[type='submit'], input[type='button'], a.btn, a[role='button']");
      candidates.forEach((el) => {
        const txt = (el.textContent || (el as HTMLInputElement).value || "").trim();
        if (txt.length < 2 || txt.length > 60) return;
        if (!SAVE_PATTERNS.some((p) => p.test(txt))) return;
        const r = el.getBoundingClientRect();
        results.push({
          text: txt.substring(0, 40),
          tag: el.tagName.toLowerCase(),
          type: (el as HTMLInputElement).type || "",
          id: el.id || "",
          name: (el as HTMLInputElement).name || "",
          className: (el.className || "").toString().substring(0, 60),
          value: (el as HTMLInputElement).value || "",
          bbox: r.width > 0 ? {
            x: Math.round(r.x), y: Math.round(r.y),
            w: Math.round(r.width), h: Math.round(r.height),
          } : null,
          isVisible: r.width > 0 && r.height > 0,
          isDisabled: (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true",
        });
      });

      // Also look for visible submit-like elements by scanning all visible buttons
      document.querySelectorAll("button, input[type='submit'], input[type='button']").forEach((el) => {
        const txt = (el.textContent || (el as HTMLInputElement).value || "").trim();
        if (txt.length < 2 || txt.length > 60) return;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        // Include any visible button not already found
        const alreadyFound = results.some((r2) => r2.text === txt.substring(0, 40) && r2.tag === el.tagName.toLowerCase());
        if (!alreadyFound) {
          results.push({
            text: txt.substring(0, 40),
            tag: el.tagName.toLowerCase(),
            type: (el as HTMLInputElement).type || "",
            id: el.id || "",
            name: (el as HTMLInputElement).name || "",
            className: (el.className || "").toString().substring(0, 60),
            value: (el as HTMLInputElement).value || "",
            bbox: {
              x: Math.round(r.x), y: Math.round(r.y),
              w: Math.round(r.width), h: Math.round(r.height),
            },
            isVisible: true,
            isDisabled: (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true",
          });
        }
      });

      return results;
    });

    console.log(`Save controls found: ${saveControls.length}`);
    for (const sc of saveControls) {
      console.log(`  text="${sc.text}" tag=${sc.tag} type=${sc.type} id="${sc.id}" class="${sc.className.substring(0, 30)}" bbox=${sc.bbox ? `${sc.bbox.x},${sc.bbox.y} ${sc.bbox.w}x${sc.bbox.h}` : "none"} vis=${sc.isVisible} disabled=${sc.isDisabled}`);
    }
    writeMarker(`LANE_SAVE_CONTROLS_${lane.toUpperCase()}`,
      saveControls.map((sc) => `text="${sc.text}" tag=${sc.tag} type=${sc.type} id="${sc.id}" class="${sc.className}" vis=${sc.isVisible} disabled=${sc.isDisabled}`).join("\n")
    );

    // Find the best visible, enabled save control
    const bestSave = saveControls.find((sc) => sc.isVisible && !sc.isDisabled && sc.bbox);

    if (!bestSave || !bestSave.bbox) {
      console.log("ERROR: No visible, enabled save control found.");
      writeMarker(`LANE_SAVE_FAILED_${lane.toUpperCase()}`, "reason=no_visible_save_control");

      // Scroll down and try again — save button might be below fold
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);
      const ts4b = new Date().toISOString().replace(/[:.]/g, "-");
      await page.screenshot({ path: `${ARTIFACT_DIR}/lane_save_scrolled_${lane}_${ts4b}.png`, fullPage: true });

      // Re-scan after scroll
      const saveControls2 = await page.evaluate(() => {
        const results: Array<{ text: string; tag: string; id: string; bbox: { x: number; y: number; w: number; h: number } | null; isVisible: boolean; isDisabled: boolean }> = [];
        document.querySelectorAll("button, input[type='submit'], input[type='button']").forEach((el) => {
          const txt = (el.textContent || (el as HTMLInputElement).value || "").trim();
          if (txt.length < 2 || txt.length > 60) return;
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return;
          results.push({
            text: txt.substring(0, 40), tag: el.tagName.toLowerCase(), id: el.id || "",
            bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            isVisible: true, isDisabled: (el as HTMLButtonElement).disabled,
          });
        });
        return results;
      });
      console.log(`After scroll, visible buttons: ${saveControls2.length}`);
      for (const sc of saveControls2) {
        console.log(`  text="${sc.text}" tag=${sc.tag} id="${sc.id}" bbox=${sc.bbox ? `${sc.bbox.x},${sc.bbox.y} ${sc.bbox.w}x${sc.bbox.h}` : "none"} disabled=${sc.isDisabled}`);
      }

      console.log(`\n=== LANE SAVE INVESTIGATION INCOMPLETE: ${lane} — no save control found ===`);
      await context.close();
      return;
    }

    console.log(`\nClicking save: "${bestSave.text}" tag=${bestSave.tag} at (${bestSave.bbox.x + bestSave.bbox.w / 2}, ${bestSave.bbox.y + bestSave.bbox.h / 2})`);

    // Register dialog handler in case save triggers a native confirm
    let saveDialogCaptured = false;
    let saveDialogMessage = "";
    page.on("dialog", async (dialog) => {
      saveDialogCaptured = true;
      saveDialogMessage = dialog.message();
      console.log(`  Native dialog during save: type=${dialog.type()}, message="${saveDialogMessage.substring(0, 100)}"`);
      await dialog.accept();
    });

    // Click the save button
    const preUrl = page.url();
    await page.mouse.click(bestSave.bbox.x + bestSave.bbox.w / 2, bestSave.bbox.y + bestSave.bbox.h / 2);
    await page.waitForTimeout(5000);

    const postSaveUrl = page.url();
    console.log(`\nPost-save URL: ${postSaveUrl}`);
    console.log(`URL changed: ${postSaveUrl !== preUrl}`);
    console.log(`Dialog captured: ${saveDialogCaptured}${saveDialogCaptured ? ` message="${saveDialogMessage.substring(0, 100)}"` : ""}`);

    // Screenshot: after save
    const ts5 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/lane_save_post_${lane}_${ts5}.png`, fullPage: true });

    // Check for visible messages/alerts/validation
    const postSaveMessages = await page.evaluate(() => {
      const messages: Array<{ text: string; tag: string; className: string; visible: boolean }> = [];

      // Alert/notification elements
      const alertSelectors = [
        ".alert", ".notification", ".toast", ".message",
        ".swal2-popup", ".bootbox", "[role='alert']", "[role='status']",
        ".error", ".success", ".warning", ".info",
        ".validation-error", ".form-error", ".field-error",
        ".has-error", ".is-invalid",
      ];
      for (const sel of alertSelectors) {
        document.querySelectorAll(sel).forEach((el) => {
          const txt = (el.textContent || "").trim();
          if (txt.length > 0 && txt.length < 300) {
            const r = el.getBoundingClientRect();
            const vis = r.width > 0 && r.height > 0;
            if (vis) {
              messages.push({
                text: txt.substring(0, 200),
                tag: el.tagName.toLowerCase(),
                className: (el.className || "").toString().substring(0, 60),
                visible: vis,
              });
            }
          }
        });
      }

      // Also check for any modal that appeared
      const modals = document.querySelectorAll(".modal.show, .modal.in, [role='dialog'], .swal2-popup");
      modals.forEach((el) => {
        const txt = (el.textContent || "").trim();
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && txt.length > 0) {
          messages.push({
            text: `[MODAL] ${txt.substring(0, 200)}`,
            tag: el.tagName.toLowerCase(),
            className: (el.className || "").toString().substring(0, 60),
            visible: true,
          });
        }
      });

      return messages;
    });

    console.log(`Post-save messages/alerts: ${postSaveMessages.length}`);
    for (const m of postSaveMessages) {
      console.log(`  "${m.text.substring(0, 100)}" tag=${m.tag} class="${m.className.substring(0, 30)}"`);
    }

    // Full post-save field inventory
    console.log("\n--- Post-save field inventory ---");
    const postSaveInventory = await captureFieldInventory(page, `${lane}_post_save`);

    // DOM readback of actual values after save
    const postSaveValues = await page.evaluate(() => {
      const result: Record<string, string> = {};
      const pejabat = document.querySelector('select[name="CD_DUTISETEM_ID"]') as HTMLSelectElement | null;
      if (pejabat) {
        const cur = pejabat.options[pejabat.selectedIndex];
        result["pejabat_setem_text"] = cur?.text || "(none)";
      }
      const tsd = document.querySelector('input[name="tsd"]') as HTMLInputElement | null;
      result["tsd_value"] = tsd?.value || "(not found)";
      const tsm = document.querySelector('input[name="tsm"]') as HTMLInputElement | null;
      result["tsm_value"] = tsm?.value || "(not found)";

      const allSelects = document.querySelectorAll("select");
      let yearIdx = 0; let monthIdx = 0;
      allSelects.forEach((sel) => {
        const s = sel as HTMLSelectElement;
        const r = s.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        if (s.name === "CD_DUTISETEM_ID") return;
        const cur = s.options[s.selectedIndex];
        if (s.options.length > 100) {
          result[`year${yearIdx}_text`] = cur?.text || "(none)";
          yearIdx++;
        } else if (s.options.length >= 12 && s.options.length <= 13) {
          result[`month${monthIdx}_text`] = cur?.text || "(none)";
          monthIdx++;
        }
      });

      const radios = document.querySelectorAll('input[name="ES_PDS_APP"]');
      radios.forEach((r) => {
        const radio = r as HTMLInputElement;
        if (radio.checked) {
          result["selected_lane_label"] = radio.labels?.[0]?.textContent?.trim() || "";
        }
      });

      return result;
    });

    console.log("\n=== ACTUAL DOM VALUES AFTER SAVE ===");
    for (const [k, v] of Object.entries(postSaveValues)) {
      console.log(`  ${k}: "${v}"`);
    }

    writeMarker(`LANE_SAVE_SUMMARY_${lane.toUpperCase()}`,
      `lane=${lane}\n` +
      `saveControl="${bestSave.text}" tag=${bestSave.tag}\n` +
      `preUrl=${preUrl}\n` +
      `postUrl=${postSaveUrl}\n` +
      `urlChanged=${postSaveUrl !== preUrl}\n` +
      `dialogCaptured=${saveDialogCaptured}${saveDialogCaptured ? ` message="${saveDialogMessage.substring(0, 100)}"` : ""}\n` +
      `postSaveMessages=${postSaveMessages.length}: ${postSaveMessages.map((m) => `"${m.text.substring(0, 60)}"`).join("; ")}\n` +
      `ACTUAL_POST_SAVE_VALUES:\n` +
      Object.entries(postSaveValues).map(([k, v]) => `  ${k}=${v}`).join("\n") + "\n" +
      `postSaveLabels=${postSaveInventory.labels.length}\n` +
      `postSaveInputs=${postSaveInventory.inputs.length}\n` +
      `postSaveSelects=${postSaveInventory.selects.length}\n` +
      `postSaveRadios=${postSaveInventory.radioGroups.length}\n` +
      `namaSuratCaraVisible=${postSaveInventory.keyTextFound.some(k => k.text.includes("Nama Surat Cara") && k.visible)}\n` +
      `kategoriSuratCaraVisible=${postSaveInventory.keyTextFound.some(k => k.text.includes("Kategori Surat Cara") && k.visible)}\n` +
      `kumpulanSuratCaraVisible=${postSaveInventory.keyTextFound.some(k => k.text.includes("Kumpulan Surat Cara") && k.visible)}`
    );

    console.log(`\n=== LANE SAVE INVESTIGATION COMPLETE: ${lane} ===`);
    console.log(`URL: ${page.url()}`);
    console.log(`SAVE WAS TRIGGERED. NO FURTHER FIELDS FILLED. NO SUBMIT.`);

  } finally {
    // Close browser
    await context.close();
  }
}

run().catch((err) => {
  console.error("Investigation failed:", err);
  process.exit(1);
});
