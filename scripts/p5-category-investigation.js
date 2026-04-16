/**
 * P5 Category Rule Investigation
 *
 * Tests whether choosing pds_ps = "p" (Prinsipal) vs "s" (Surat Cara
 * berkaitan Pajakan 49(e)) changes the portal's post-save behavior
 * for Perjanjian Sewa (1101).
 *
 * Usage:
 *   node scripts/p5-category-investigation.js p
 *   node scripts/p5-category-investigation.js s
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

const pdsPsValue = process.argv[2];
if (!pdsPsValue || !["p", "s"].includes(pdsPsValue)) {
  console.error('Usage: node scripts/p5-category-investigation.js <p|s>');
  process.exit(1);
}

const pdsPsLabel = pdsPsValue === "p" ? "Prinsipal" : "Surat Cara berkaitan Pajakan 49(e)";
console.log(`\n=== P5 CATEGORY INVESTIGATION: Perjanjian Sewa + pds_ps="${pdsPsLabel}" (${pdsPsValue}) ===\n`);

function writeMarker(name, body) {
  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(`${ARTIFACT_DIR}/${name}_${ts}.txt`, `${name}\n${new Date().toISOString()}\n${body}\n`);
  } catch {}
}

async function captureFullInventory(page, label) {
  const inv = await page.evaluate(() => {
    const labels = [];
    document.querySelectorAll("label").forEach((l) => {
      const r = l.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        labels.push((l.textContent || "").trim().substring(0, 80));
      }
    });

    const inputs = [];
    document.querySelectorAll("input, textarea").forEach((el) => {
      const inp = el;
      const r = inp.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      inputs.push({
        type: inp.type || "text", name: inp.name, id: inp.id,
        value: (inp.value || "").substring(0, 60),
        readOnly: inp.readOnly, disabled: inp.disabled,
        label: (inp.labels?.[0]?.textContent || "").trim().substring(0, 60),
      });
    });

    const selects = [];
    document.querySelectorAll("select").forEach((el) => {
      const sel = el;
      const r = sel.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const cur = sel.options[sel.selectedIndex];
      const opts = [];
      for (let i = 0; i < Math.min(10, sel.options.length); i++) {
        opts.push(`${sel.options[i].value}="${sel.options[i].text}"`);
      }
      selects.push({
        name: sel.name, id: sel.id,
        selectedText: (cur?.text || "").substring(0, 60),
        selectedValue: cur?.value || "",
        optionCount: sel.options.length,
        firstOptions: opts,
        label: (sel.labels?.[0]?.textContent || "").trim().substring(0, 60),
      });
    });

    // Headings
    const headings = [];
    document.querySelectorAll("h1,h2,h3,h4,h5,.box-title,.content-header").forEach((h) => {
      const r = h.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) headings.push((h.textContent || "").trim().substring(0, 100));
    });

    // Tabs
    const tabs = [];
    document.querySelectorAll(".nav-tabs a, .nav-pills a, [role='tab']").forEach((a) => {
      const r = a.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        tabs.push({
          text: (a.textContent || "").trim().substring(0, 40),
          active: a.classList.contains("active") || a.getAttribute("aria-selected") === "true",
        });
      }
    });

    // Alerts/messages
    const messages = [];
    document.querySelectorAll(".alert, .notification, [role='alert'], [role='status'], .error, .success, .warning").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        messages.push((el.textContent || "").trim().substring(0, 200));
      }
    });

    const body = (document.body?.innerText || "").substring(0, 1500);
    return { labels, inputs, selects, headings, tabs, messages, body };
  });

  console.log(`\n--- Inventory: ${label} ---`);
  console.log(`Headings: ${inv.headings.join("; ")}`);
  console.log(`Tabs: ${inv.tabs.map(t => `"${t.text}"${t.active ? "*" : ""}`).join(", ")}`);
  console.log(`Messages: ${inv.messages.length > 0 ? inv.messages.join("; ") : "(none)"}`);
  console.log(`Labels (${inv.labels.length}): ${inv.labels.join("; ")}`);
  console.log(`Inputs (${inv.inputs.length}):`);
  for (const i of inv.inputs) console.log(`  type=${i.type} name=${i.name} id=${i.id} value="${i.value}" ro=${i.readOnly} disabled=${i.disabled} label="${i.label}"`);
  console.log(`Selects (${inv.selects.length}):`);
  for (const s of inv.selects) console.log(`  name=${s.name} id=${s.id} selected="${s.selectedText}" (${s.selectedValue}) opts=${s.optionCount} label="${s.label}" first=[${s.firstOptions.join(", ")}]`);

  return inv;
}

async function run() {
  const profilePath = path.resolve(PROFILE_DIR);
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false, channel: "chrome", viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = context.pages()[0] || await context.newPage();

  try {
    // Navigate → select Sewa/Pajakan → fill shared → save to p5
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
            sel.selectedIndex = i; sel.dispatchEvent(new Event("change", { bubbles: true })); break;
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

    const p5Url = page.url();
    console.log(`P5 URL: ${p5Url}`);
    if (!p5Url.includes("/formv2/p5/")) {
      console.log("ERROR: Not on p5 page.");
      await context.close();
      process.exit(1);
    }

    // Select Perjanjian Sewa
    console.log("Selecting pds_suratcara = Perjanjian Sewa (1101)...");
    await page.locator("#pds_suratcara").selectOption({ value: "1101" });
    await page.waitForTimeout(1000);

    // Set pds_ps
    console.log(`Setting pds_ps = "${pdsPsLabel}" (${pdsPsValue})...`);
    await page.locator("#pds_ps").selectOption({ value: pdsPsValue });
    await page.waitForTimeout(1000);

    // Verify selections before save
    const preSave = await page.evaluate(() => {
      const sc = document.getElementById("pds_suratcara");
      const ps = document.getElementById("pds_ps");
      return {
        scVal: sc ? sc.value : "", scText: sc ? (sc.options[sc.selectedIndex]?.text || "") : "",
        psVal: ps ? ps.value : "", psText: ps ? (ps.options[ps.selectedIndex]?.text || "") : "",
      };
    });
    console.log(`Pre-save: suratcara="${preSave.scText}" (${preSave.scVal}), pds_ps="${preSave.psText}" (${preSave.psVal})`);

    // Screenshot: before save
    const ts1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({
      path: `${ARTIFACT_DIR}/p5_cat_pre_save_${pdsPsValue}_${ts1}.png`, fullPage: true,
    });

    // Pre-save inventory
    await captureFullInventory(page, `PRE_SAVE_pds_ps_${pdsPsValue}`);

    // ── SAVE ──────────────────────────────────────────────────────
    // Find the "Simpan Maklumat Am" button (the current-section save)
    console.log("\n=== SAVING ===");
    const saveBtn = await page.evaluate(() => {
      const btns = document.querySelectorAll("input[type='submit'], input[type='button'], button");
      for (const b of btns) {
        const txt = (b.textContent || b.value || "").trim();
        if (/simpan\s*maklumat\s*am/i.test(txt)) {
          const r = b.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            return { text: txt, id: b.id || "", bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
          }
        }
      }
      return null;
    });

    if (!saveBtn) {
      console.log("ERROR: 'Simpan Maklumat Am' button not found.");
      await context.close();
      process.exit(1);
    }

    console.log(`Save button: "${saveBtn.text}" id="${saveBtn.id}" bbox=${saveBtn.bbox.x},${saveBtn.bbox.y} ${saveBtn.bbox.w}x${saveBtn.bbox.h}`);

    // Register dialog handler
    let dialogCaptured = false;
    let dialogMsg = "";
    page.on("dialog", async (dialog) => {
      dialogCaptured = true;
      dialogMsg = dialog.message();
      console.log(`  Dialog: type=${dialog.type()}, message="${dialogMsg.substring(0, 100)}"`);
      await dialog.accept();
    });

    // Click save
    await page.mouse.click(saveBtn.bbox.x + saveBtn.bbox.w / 2, saveBtn.bbox.y + saveBtn.bbox.h / 2);
    await page.waitForTimeout(5000);

    const postSaveUrl = page.url();
    console.log(`\nPost-save URL: ${postSaveUrl}`);
    console.log(`URL changed: ${postSaveUrl !== p5Url}`);
    console.log(`Dialog: ${dialogCaptured ? `yes - "${dialogMsg.substring(0, 100)}"` : "no"}`);

    // Screenshot: after save
    const ts2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({
      path: `${ARTIFACT_DIR}/p5_cat_post_save_${pdsPsValue}_${ts2}.png`, fullPage: true,
    });

    // Post-save inventory
    const postInv = await captureFullInventory(page, `POST_SAVE_pds_ps_${pdsPsValue}`);

    // Write summary
    writeMarker(`P5_CATEGORY_INVESTIGATION_${pdsPsValue.toUpperCase()}`,
      `pds_ps=${pdsPsValue} (${pdsPsLabel})\n` +
      `pds_suratcara=1101 (Perjanjian Sewa)\n` +
      `preSaveUrl=${p5Url}\n` +
      `postSaveUrl=${postSaveUrl}\n` +
      `urlChanged=${postSaveUrl !== p5Url}\n` +
      `dialogCaptured=${dialogCaptured}${dialogCaptured ? ` msg="${dialogMsg.substring(0, 100)}"` : ""}\n` +
      `postSaveMessages=${postInv.messages.length}: ${postInv.messages.join("; ")}\n` +
      `postSaveHeadings=${postInv.headings.join("; ")}\n` +
      `postSaveTabs=${postInv.tabs.map(t => `"${t.text}"${t.active ? "*" : ""}`).join(", ")}\n` +
      `postSaveLabels=${postInv.labels.length}\n` +
      `postSaveInputs=${postInv.inputs.length}\n` +
      `postSaveSelects=${postInv.selects.length}\n` +
      `body=${postInv.body.substring(0, 500)}`
    );

    console.log(`\n=== P5 CATEGORY INVESTIGATION COMPLETE: pds_ps=${pdsPsValue} ===`);
    console.log(`NO SUBMIT. NO LATER TABS FILLED.`);

  } finally {
    await context.close();
  }
}

run().catch((err) => {
  console.error("Investigation failed:", err);
  process.exit(1);
});
