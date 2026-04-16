/**
 * P8 Bahagian A Structure Investigation — Employment Contract
 *
 * Reaches p8, enters Employment Contract, saves Maklumat Am,
 * opens Bahagian A tab, captures full structure. No filling.
 *
 * Usage: node scripts/p8-bahagian-a-investigation.js
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

console.log("\n=== P8 BAHAGIAN A INVESTIGATION ===\n");

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
    // ── Reach p8 + enter document + verify ──────────────────────────
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
    console.log(`P8 URL: ${page.url()}`);

    // Enter Employment Contract
    const nsc = page.locator("#namaperjanjian");
    await nsc.click();
    await nsc.fill("Employment Contract");
    await page.waitForTimeout(500);
    await nsc.evaluate(el => { el.dispatchEvent(new Event("change", { bubbles: true })); el.dispatchEvent(new Event("blur", { bubbles: true })); });
    await page.waitForTimeout(3000);

    // Verify
    const v = await page.evaluate(() => {
      return {
        nsc: document.getElementById("namaperjanjian")?.value || "",
        pd: document.getElementById("profile_desc")?.value || "",
        ps: document.getElementById("pds_ps")?.value || "",
      };
    });
    console.log(`Verified: nsc="${v.nsc}" pd="${v.pd}" ps="${v.ps}"`);
    if (v.nsc !== "Employment Contract" || v.pd !== "Perjanjian Pekerjaan" || v.ps !== "p") {
      console.log("ERROR: Verification failed."); await ctx.close(); return;
    }

    // ── Save Maklumat Am ────────────────────────────────────────────
    console.log("\nSaving Maklumat Am...");
    await page.locator("#pdsG01_bhgn_am").click({ timeout: 5000 });
    await page.waitForTimeout(5000);

    // Dismiss success modal
    console.log("Dismissing success modal...");
    await page.evaluate(() => { const b = document.querySelector(".bootbox .btn"); if (b) b.click(); });
    await page.waitForTimeout(1500);
    // Verify modal is gone
    const modalGone = await page.evaluate(() => {
      const m = document.querySelector(".bootbox.in, .modal.show");
      return !m || m.getBoundingClientRect().width <= 0;
    });
    console.log(`Modal dismissed: ${modalGone}`);
    if (!modalGone) { await page.keyboard.press("Escape"); await page.waitForTimeout(1000); }

    // Screenshot: before tab switch
    const ts1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_bhgA_before_tab_${ts1}.png`, fullPage: true });

    // ── Check current tab state ─────────────────────────────────────
    const tabState = await page.evaluate(() => {
      const tabs = [];
      document.querySelectorAll(".nav-tabs a, [role='tab']").forEach(a => {
        const r = a.getBoundingClientRect();
        if (r.width > 0) tabs.push({
          text: a.textContent?.trim().substring(0, 30) || "",
          href: a.getAttribute("href") || "",
          active: a.classList.contains("active") || a.parentElement?.classList.contains("active"),
          bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        });
      });
      return tabs;
    });

    console.log("\nTab state:");
    for (const t of tabState) console.log(`  "${t.text}" href="${t.href}" active=${t.active}`);

    // ── Click Bahagian A tab ────────────────────────────────────────
    const bhgA = tabState.find(t => /bahagian\s*a/i.test(t.text));
    if (!bhgA) { console.log("ERROR: Bahagian A tab not found."); await ctx.close(); return; }

    if (!bhgA.active) {
      console.log(`\nClicking Bahagian A tab...`);
      await page.evaluate(() => {
        for (const a of document.querySelectorAll('.nav-tabs a')) {
          if (/bahagian\s*a/i.test(a.textContent?.trim())) { a.click(); return; }
        }
      });
      await page.waitForTimeout(3000);
    } else {
      console.log("Bahagian A is already active.");
    }

    // Verify active tab
    const activeNow = await page.evaluate(() => {
      const a = document.querySelector(".nav-tabs .active a, .nav-tabs li.active a");
      return a?.textContent?.trim() || "(unknown)";
    });
    console.log(`Active tab: "${activeNow}"`);

    const bhgAUrl = page.url();
    console.log(`URL: ${bhgAUrl}`);

    // Screenshot: Bahagian A visible
    const ts2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_bhgA_visible_${ts2}.png`, fullPage: true });

    // ── Deep inventory of Bahagian A ────────────────────────────────
    const inventory = await page.evaluate(() => {
      const panel = document.querySelector("#bhgn-a") || document.querySelector(".tab-pane.active") || document.body;
      const rootInfo = panel ? `id=${panel.id || ""} class=${(panel.className || "").toString().substring(0, 40)}` : "body";

      // Headings
      const headings = [];
      panel.querySelectorAll("h1,h2,h3,h4,h5,h6,.box-title,legend,strong").forEach(h => {
        const r = h.getBoundingClientRect();
        const txt = (h.textContent || "").trim();
        if (r.width > 0 && r.height > 0 && txt.length > 2 && txt.length < 120)
          headings.push({ text: txt.substring(0, 100), tag: h.tagName.toLowerCase() });
      });

      // Labels
      const labels = [];
      panel.querySelectorAll("label").forEach(l => {
        const r = l.getBoundingClientRect();
        if (r.width > 0 && r.height > 0)
          labels.push({ text: (l.textContent || "").trim().substring(0, 100), htmlFor: l.htmlFor || "" });
      });

      // Inputs
      const inputs = [];
      panel.querySelectorAll("input, textarea").forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        if (el.type === "hidden") return;
        inputs.push({
          type: el.type || "text", name: el.name || "", id: el.id || "",
          value: (el.value || "").substring(0, 60),
          readOnly: el.readOnly || false, disabled: el.disabled || false,
          placeholder: (el.placeholder || "").substring(0, 40),
          label: (el.labels?.[0]?.textContent || "").trim().substring(0, 60),
        });
      });

      // Selects
      const selects = [];
      panel.querySelectorAll("select").forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const cur = el.options[el.selectedIndex];
        const opts = [];
        for (let i = 0; i < Math.min(10, el.options.length); i++)
          opts.push({ v: el.options[i].value, t: el.options[i].text.substring(0, 40) });
        selects.push({
          name: el.name || "", id: el.id || "",
          selectedText: (cur?.text || "").substring(0, 50),
          optionCount: el.options.length, options: opts,
          label: (el.labels?.[0]?.textContent || "").trim().substring(0, 60),
        });
      });

      // Tables
      const tables = [];
      panel.querySelectorAll("table").forEach(t => {
        const r = t.getBoundingClientRect();
        if (r.width <= 0) return;
        const headers = [];
        t.querySelectorAll("th").forEach(th => {
          if (th.getBoundingClientRect().width > 0) headers.push(th.textContent?.trim().substring(0, 40) || "");
        });
        const rowCount = t.querySelectorAll("tbody tr").length;
        tables.push({ headers, rowCount, className: (t.className || "").toString().substring(0, 40) });
      });

      // Buttons/links for adding entries
      const addButtons = [];
      panel.querySelectorAll("a, button").forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const txt = (el.textContent || "").trim();
        if (/tambah|add|individu|syarikat|simpan|save/i.test(txt) && txt.length < 80) {
          addButtons.push({
            text: txt.substring(0, 60), tag: el.tagName.toLowerCase(),
            href: el.getAttribute("href")?.substring(0, 80) || "",
            id: el.id || "",
          });
        }
      });

      // Messages
      const messages = [];
      panel.querySelectorAll(".alert, .help-block, .text-info, .instructions, small").forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) messages.push((el.textContent || "").trim().substring(0, 120));
      });

      const body = (panel.innerText || "").substring(0, 2000);

      return { rootInfo, headings, labels, inputs, selects, tables, addButtons, messages, body };
    });

    // Output
    console.log(`\n=== BAHAGIAN A FIELD INVENTORY ===`);
    console.log(`Root: ${inventory.rootInfo}`);

    console.log(`\nHeadings (${inventory.headings.length}):`);
    for (const h of inventory.headings) console.log(`  [${h.tag}] "${h.text}"`);

    console.log(`\nLabels (${inventory.labels.length}):`);
    for (const l of inventory.labels) console.log(`  "${l.text}" for="${l.htmlFor}"`);

    console.log(`\nInputs (${inventory.inputs.length}):`);
    for (const i of inventory.inputs) console.log(`  type=${i.type} name="${i.name}" id="${i.id}" value="${i.value}" ro=${i.readOnly} disabled=${i.disabled} ph="${i.placeholder}" label="${i.label}"`);

    console.log(`\nSelects (${inventory.selects.length}):`);
    for (const s of inventory.selects) {
      console.log(`  name="${s.name}" id="${s.id}" selected="${s.selectedText}" opts=${s.optionCount} label="${s.label}"`);
      console.log(`    [${s.options.map(o => `${o.v}="${o.t}"`).join(", ")}]`);
    }

    console.log(`\nTables (${inventory.tables.length}):`);
    for (const t of inventory.tables) console.log(`  headers=[${t.headers.join(", ")}] rows=${t.rowCount} class="${t.className}"`);

    console.log(`\nAdd/action buttons (${inventory.addButtons.length}):`);
    for (const b of inventory.addButtons) console.log(`  "${b.text}" tag=${b.tag} href="${b.href}" id="${b.id}"`);

    console.log(`\nMessages (${inventory.messages.length}):`);
    for (const m of inventory.messages) console.log(`  "${m.substring(0, 80)}"`);

    console.log(`\nBody (first 500):\n"${inventory.body.substring(0, 500)}"`);

    // Scroll down for below-fold content
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    const ts3 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_bhgA_scrolled_${ts3}.png`, fullPage: true });

    writeMarker("P8_BAHAGIAN_A_INVENTORY",
      `url=${bhgAUrl}\n` +
      `activeTab=${activeNow}\n` +
      `root=${inventory.rootInfo}\n` +
      `headings=${inventory.headings.map(h => `[${h.tag}]"${h.text}"`).join("; ")}\n` +
      `labels=${inventory.labels.map(l => `"${l.text}" for="${l.htmlFor}"`).join("; ")}\n` +
      `inputs=${inventory.inputs.map(i => `${i.type}:${i.name}/${i.id}="${i.value}" ro=${i.readOnly} label="${i.label}"`).join("; ")}\n` +
      `selects=${inventory.selects.map(s => `${s.name}/${s.id}="${s.selectedText}" opts=${s.optionCount}`).join("; ")}\n` +
      `tables=${inventory.tables.map(t => `[${t.headers.join(",")}] rows=${t.rowCount}`).join("; ")}\n` +
      `addButtons=${inventory.addButtons.map(b => `"${b.text}" tag=${b.tag} href="${b.href}"`).join("; ")}\n` +
      `body=${inventory.body.substring(0, 800)}`
    );

    console.log(`\n=== P8 BAHAGIAN A INVESTIGATION COMPLETE ===`);
    console.log(`NOTHING FILLED. NO SAVE. NO SUBMIT.`);

  } finally {
    await ctx.close();
  }
}

run().catch(err => { console.error("Failed:", err); process.exit(1); });
