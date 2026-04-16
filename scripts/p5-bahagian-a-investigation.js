/**
 * P5 Bahagian A Structure Investigation
 *
 * Reaches the p5 Bahagian A tab for Perjanjian Sewa + Prinsipal,
 * captures the full field structure, and stops without filling anything.
 *
 * Usage: node scripts/p5-bahagian-a-investigation.js
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

console.log("\n=== P5 BAHAGIAN A INVESTIGATION ===\n");

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
    // ── Step 1: Reach p5 via proven path ────────────────────────────
    console.log("Navigating to application form...");
    await page.goto("https://stamps.hasil.gov.my/stamps/form/application", {
      timeout: 30000, waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(3000);

    // Select Sewa / Pajakan
    await page.evaluate(() => {
      const radios = document.querySelectorAll('input[type="radio"]');
      for (const r of radios) {
        if (r.parentElement?.textContent?.trim() === "Sewa / Pajakan") { r.click(); return; }
      }
    });
    await page.waitForTimeout(1000);

    // Fill shared fields
    await page.evaluate(() => {
      const sel = document.querySelector('select[name="CD_DUTISETEM_ID"]');
      if (sel) {
        for (let i = 0; i < sel.options.length; i++) {
          if (sel.options[i].text.includes("Sarawak")) {
            sel.selectedIndex = i; sel.dispatchEvent(new Event("change", { bubbles: true })); break;
          }
        }
      }
    });
    await page.fill('input[name="tsd"]', "01");
    await page.waitForTimeout(500);
    try { await page.locator("select").nth(2).selectOption({ label: "Januari" }); } catch {}
    await page.waitForTimeout(500);

    // Save to p5
    await page.locator("button#btn-ma-submit").click();
    await page.waitForTimeout(5000);

    const p5Url = page.url();
    console.log(`P5 URL: ${p5Url}`);
    if (!p5Url.includes("/formv2/p5/")) {
      console.log("ERROR: Not on p5 page."); await context.close(); return;
    }

    // ── Step 2: Select Perjanjian Sewa + Prinsipal ──────────────────
    console.log("Selecting pds_suratcara = Perjanjian Sewa (1101)...");
    await page.locator("#pds_suratcara").selectOption({ value: "1101" });
    await page.waitForTimeout(1000);

    console.log("Setting pds_ps = Prinsipal (p)...");
    await page.locator("#pds_ps").selectOption({ value: "p" });
    await page.waitForTimeout(1000);

    // ── Step 3: Save Maklumat Am ────────────────────────────────────
    console.log("Saving Maklumat Am...");
    const saveClicked = await page.evaluate(() => {
      const btn = document.getElementById("pdsL01_bhgn_am");
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!saveClicked) {
      console.log("ERROR: Save button not found."); await context.close(); return;
    }
    await page.waitForTimeout(5000);

    const postSaveUrl = page.url();
    console.log(`Post-save URL: ${postSaveUrl}`);

    // Screenshot: after Maklumat Am save
    const ts1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_bhgA_after_ma_save_${ts1}.png`, fullPage: true });

    // ── Step 4: Check tabs and navigate to Bahagian A ───────────────
    // First, check which tab is currently active
    const tabState = await page.evaluate(() => {
      const tabs = [];
      document.querySelectorAll(".nav-tabs a, .nav-pills a, [role='tab']").forEach((a) => {
        const r = a.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          tabs.push({
            text: (a.textContent || "").trim().substring(0, 40),
            href: a.getAttribute("href") || "",
            active: a.classList.contains("active") || a.getAttribute("aria-selected") === "true" ||
                    a.parentElement?.classList?.contains("active"),
            bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          });
        }
      });
      return tabs;
    });

    console.log("\nTab state after save:");
    for (const t of tabState) {
      console.log(`  "${t.text}" href="${t.href}" active=${t.active} bbox=${t.bbox.x},${t.bbox.y} ${t.bbox.w}x${t.bbox.h}`);
    }

    // Find Bahagian A tab
    const bhgATab = tabState.find(t => /bahagian\s*a/i.test(t.text));
    if (!bhgATab) {
      console.log("ERROR: Bahagian A tab not found.");
      writeMarker("P5_BHGA_NOT_FOUND", `tabs=${tabState.map(t => t.text).join(", ")}`);
      await context.close(); return;
    }

    console.log(`\nBahagian A tab: "${bhgATab.text}" href="${bhgATab.href}" active=${bhgATab.active}`);

    if (!bhgATab.active) {
      // Click the Bahagian A tab link
      console.log("Clicking Bahagian A tab...");
      // Method 1: Use the href anchor to find and click the exact <a> element
      const tabClicked = await page.evaluate(() => {
        const links = document.querySelectorAll('.nav-tabs a, [role="tab"]');
        for (const a of links) {
          if (/bahagian\s*a/i.test(a.textContent?.trim() || "")) {
            (a).click();
            return true;
          }
        }
        return false;
      });
      if (tabClicked) {
        console.log("Tab <a> clicked via JS.");
      } else {
        // Fallback: bbox click
        console.log("JS click failed, trying bbox...");
        await page.mouse.click(bhgATab.bbox.x + bhgATab.bbox.w / 2, bhgATab.bbox.y + bhgATab.bbox.h / 2);
      }
      await page.waitForTimeout(3000);
      console.log(`URL after tab click: ${page.url()}`);

      // Verify tab switched
      const newActiveTab = await page.evaluate(() => {
        const active = document.querySelector(".nav-tabs .active a, .nav-tabs li.active a");
        return active?.textContent?.trim() || "(unknown)";
      });
      console.log(`Active tab after click: "${newActiveTab}"`);
    } else {
      console.log("Bahagian A is already the active tab.");
    }

    // Screenshot: Bahagian A visible
    const ts2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_bhgA_visible_${ts2}.png`, fullPage: true });

    // ── Step 5: Deep field inventory of Bahagian A ──────────────────
    const bhgAUrl = page.url();
    console.log(`\nBahagian A URL: ${bhgAUrl}`);

    const inventory = await page.evaluate(() => {
      // Find all form-group rows in the active tab panel or visible fieldset
      const formGroups = [];
      // Scope to Bahagian A content area — try the specific panel first
      const bhgnAPanel = document.querySelector("#bhgn-a, .tab-pane.active, .tab-content .active");
      const searchRoot = bhgnAPanel || document.body;
      // Also report which root we used
      const rootInfo = bhgnAPanel ? `id=${bhgnAPanel.id || ""} class=${(bhgnAPanel.className || "").toString().substring(0, 40)}` : "document.body";

      // All visible labels with their associations
      const labels = [];
      searchRoot.querySelectorAll("label").forEach((lbl) => {
        const r = lbl.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          labels.push({
            text: (lbl.textContent || "").trim().substring(0, 100),
            htmlFor: lbl.htmlFor || "",
            bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          });
        }
      });

      // All visible inputs
      const inputs = [];
      searchRoot.querySelectorAll("input, textarea").forEach((el) => {
        const inp = el;
        const r = inp.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const lblEl = inp.labels?.[0];
        inputs.push({
          type: inp.type || "text",
          name: inp.name || "",
          id: inp.id || "",
          value: (inp.value || "").substring(0, 80),
          readOnly: inp.readOnly || false,
          disabled: inp.disabled || false,
          placeholder: (inp.placeholder || "").substring(0, 40),
          label: lblEl ? (lblEl.textContent || "").trim().substring(0, 80) : "",
          maxLength: inp.maxLength > 0 && inp.maxLength < 10000 ? inp.maxLength : null,
          bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        });
      });

      // All visible selects
      const selects = [];
      searchRoot.querySelectorAll("select").forEach((el) => {
        const sel = el;
        const r = sel.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const cur = sel.options[sel.selectedIndex];
        const opts = [];
        for (let i = 0; i < Math.min(15, sel.options.length); i++) {
          opts.push({ v: sel.options[i].value, t: sel.options[i].text.substring(0, 50) });
        }
        const lblEl = sel.labels?.[0];
        selects.push({
          name: sel.name || "",
          id: sel.id || "",
          selectedText: (cur?.text || "").substring(0, 60),
          selectedValue: cur?.value || "",
          optionCount: sel.options.length,
          options: opts,
          label: lblEl ? (lblEl.textContent || "").trim().substring(0, 80) : "",
          disabled: sel.disabled,
          bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        });
      });

      // Radio groups
      const radioMap = new Map();
      searchRoot.querySelectorAll('input[type="radio"]').forEach((el) => {
        const radio = el;
        const r = radio.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const lbl = radio.labels?.[0]?.textContent?.trim() || radio.parentElement?.textContent?.trim() || "";
        const group = radioMap.get(radio.name) || [];
        group.push({ value: radio.value, label: lbl.substring(0, 60), checked: radio.checked });
        radioMap.set(radio.name, group);
      });
      const radioGroups = [];
      radioMap.forEach((opts, name) => radioGroups.push({ name, options: opts }));

      // Headings
      const headings = [];
      searchRoot.querySelectorAll("h1,h2,h3,h4,h5,h6,.box-title,.content-header,legend,strong").forEach((h) => {
        const r = h.getBoundingClientRect();
        const txt = (h.textContent || "").trim();
        if (r.width > 0 && r.height > 0 && txt.length > 2 && txt.length < 120) {
          headings.push({ text: txt.substring(0, 100), tag: h.tagName.toLowerCase() });
        }
      });

      // Visible messages/instructions
      const messages = [];
      searchRoot.querySelectorAll(".alert, .help-block, .text-info, .text-muted, .instructions, small, .note").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          messages.push((el.textContent || "").trim().substring(0, 150));
        }
      });

      // Active tab confirmation
      const activeTabText = document.querySelector(".nav-tabs .active a, .nav-tabs li.active a, .nav-pills .active a")?.textContent?.trim() || "";

      const body = searchRoot.innerText?.substring(0, 2000) || "";

      return { labels, inputs, selects, radioGroups, headings, messages, activeTabText, body };
    });

    // ── Output ──────────────────────────────────────────────────────
    console.log(`\n=== BAHAGIAN A FIELD INVENTORY ===`);
    console.log(`Active tab: "${inventory.activeTabText}"`);
    console.log(`\nHeadings (${inventory.headings.length}):`);
    for (const h of inventory.headings) console.log(`  [${h.tag}] "${h.text}"`);

    console.log(`\nLabels (${inventory.labels.length}):`);
    for (const l of inventory.labels) console.log(`  "${l.text}" for="${l.htmlFor}"`);

    console.log(`\nInputs (${inventory.inputs.length}):`);
    for (const i of inventory.inputs) {
      console.log(`  type=${i.type} name="${i.name}" id="${i.id}" value="${i.value}" ro=${i.readOnly} disabled=${i.disabled} placeholder="${i.placeholder}" maxLen=${i.maxLength} label="${i.label}" bbox=${i.bbox.x},${i.bbox.y} ${i.bbox.w}x${i.bbox.h}`);
    }

    console.log(`\nSelects (${inventory.selects.length}):`);
    for (const s of inventory.selects) {
      console.log(`  name="${s.name}" id="${s.id}" selected="${s.selectedText}" (${s.selectedValue}) opts=${s.optionCount} disabled=${s.disabled} label="${s.label}"`);
      console.log(`    options: [${s.options.map(o => `${o.v}="${o.t}"`).join(", ")}]`);
    }

    console.log(`\nRadio groups (${inventory.radioGroups.length}):`);
    for (const rg of inventory.radioGroups) {
      console.log(`  name="${rg.name}": ${rg.options.map(o => `${o.value}="${o.label}"${o.checked ? "*" : ""}`).join(", ")}`);
    }

    console.log(`\nMessages (${inventory.messages.length}):`);
    for (const m of inventory.messages) console.log(`  "${m.substring(0, 100)}"`);

    console.log(`\nBody (first 500):\n"${inventory.body.substring(0, 500)}"`);

    // Write marker
    writeMarker("P5_BAHAGIAN_A_INVENTORY",
      `url=${bhgAUrl}\n` +
      `activeTab=${inventory.activeTabText}\n` +
      `headings=${inventory.headings.map(h => `[${h.tag}]"${h.text}"`).join("; ")}\n` +
      `labels=${inventory.labels.map(l => `"${l.text}" for="${l.htmlFor}"`).join("; ")}\n` +
      `inputs=${inventory.inputs.map(i => `${i.type}:${i.name}/${i.id}="${i.value}" ro=${i.readOnly} label="${i.label}"`).join("; ")}\n` +
      `selects=${inventory.selects.map(s => `${s.name}/${s.id}="${s.selectedText}" opts=${s.optionCount} label="${s.label}"`).join("; ")}\n` +
      `radioGroups=${inventory.radioGroups.map(rg => `${rg.name}=[${rg.options.map(o => `${o.value}="${o.label}"${o.checked ? "*" : ""}`).join(",")}]`).join("; ")}\n` +
      `messages=${inventory.messages.join("; ")}\n` +
      `body=${inventory.body.substring(0, 800)}`
    );

    // Scroll down to capture below-fold fields if any
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    const ts3 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_bhgA_scrolled_${ts3}.png`, fullPage: true });

    console.log(`\n=== P5 BAHAGIAN A INVESTIGATION COMPLETE ===`);
    console.log(`URL: ${bhgAUrl}`);
    console.log(`NOTHING FILLED IN BAHAGIAN A. NO SAVE. NO SUBMIT.`);

  } finally {
    await context.close();
  }
}

run().catch((err) => {
  console.error("Investigation failed:", err);
  process.exit(1);
});
