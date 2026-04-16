/**
 * P8 Bahagian B Access Investigation
 *
 * Tests whether Bahagian B is accessible with empty Bahagian A party
 * tables, and maps its initial structure if visible.
 *
 * Usage: node scripts/p8-bahagian-b-access.js
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

console.log("\n=== P8 BAHAGIAN B ACCESS INVESTIGATION ===\n");

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
    // ── Reach p8 + verify + save MA ─────────────────────────────────
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
    console.log("Verified: Employment Contract / Perjanjian Pekerjaan / Prinsipal");

    await page.locator("#pdsG01_bhgn_am").click({ timeout: 5000 });
    await page.waitForTimeout(5000);
    await page.evaluate(() => { const b = document.querySelector(".bootbox .btn"); if (b) b.click(); });
    await page.waitForTimeout(1500);
    await page.keyboard.press("Escape"); await page.waitForTimeout(500);

    // ── Open Bahagian A and confirm empty ────────────────────────────
    await page.evaluate(() => { for (const a of document.querySelectorAll('.nav-tabs a')) { if (/bahagian\s*a/i.test(a.textContent)) { a.click(); return; } } });
    await page.waitForTimeout(2000);

    const partyRows = await page.evaluate(() => {
      let count = 0;
      const panel = document.querySelector("#bhgn-a");
      if (panel) {
        panel.querySelectorAll("table tbody tr").forEach(tr => {
          if (tr.getBoundingClientRect().width > 0) count++;
        });
      }
      return count;
    });
    console.log(`Bahagian A party table rows: ${partyRows}`);
    if (partyRows > 0) {
      console.log("WARNING: Party tables not empty. Proceeding anyway for observation.");
    }

    // ── Screenshot before Bahagian B attempt ────────────────────────
    const ts1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_bhgB_before_${ts1}.png`, fullPage: true });

    // ── Check all tab states ────────────────────────────────────────
    const tabsBefore = await page.evaluate(() => {
      const tabs = [];
      document.querySelectorAll(".nav-tabs a, .nav-tabs li").forEach(el => {
        const a = el.tagName === "A" ? el : el.querySelector("a");
        if (!a) return;
        const r = a.getBoundingClientRect();
        if (r.width <= 0) return;
        const li = a.closest("li");
        tabs.push({
          text: a.textContent?.trim().substring(0, 30) || "",
          href: a.getAttribute("href") || "",
          active: li?.classList.contains("active") || a.classList.contains("active"),
          disabled: li?.classList.contains("disabled") || a.classList.contains("disabled") || a.getAttribute("aria-disabled") === "true",
          className: (li?.className || "").toString().substring(0, 40),
        });
      });
      return tabs;
    });

    console.log("\nTab states before Bahagian B click:");
    for (const t of tabsBefore) console.log(`  "${t.text}" href="${t.href}" active=${t.active} disabled=${t.disabled} class="${t.className}"`);

    const bhgBTab = tabsBefore.find(t => /bahagian\s*b/i.test(t.text));
    if (!bhgBTab) { console.log("ERROR: Bahagian B tab not found."); await ctx.close(); return; }
    console.log(`\nBahagian B: disabled=${bhgBTab.disabled} class="${bhgBTab.className}"`);

    // ── Attempt to click Bahagian B ─────────────────────────────────
    console.log("\nClicking Bahagian B tab...");
    await page.evaluate(() => {
      for (const a of document.querySelectorAll('.nav-tabs a')) {
        if (/bahagian\s*b/i.test(a.textContent?.trim())) { a.click(); return; }
      }
    });
    await page.waitForTimeout(3000);

    // Check what happened
    const activeAfter = await page.evaluate(() => {
      const a = document.querySelector(".nav-tabs .active a, .nav-tabs li.active a");
      return a?.textContent?.trim() || "(unknown)";
    });
    console.log(`Active tab after click: "${activeAfter}"`);
    console.log(`URL: ${page.url()}`);

    // Check for any modal/alert/warning
    const warnings = await page.evaluate(() => {
      const msgs = [];
      document.querySelectorAll(".modal.show, .modal.in, .bootbox, [role='dialog'], [role='alert'], .alert").forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > 50 && r.height > 50) {
          msgs.push({ type: el.tagName.toLowerCase(), class: (el.className || "").toString().substring(0, 60), text: (el.textContent || "").trim().substring(0, 300) });
        }
      });
      return msgs;
    });
    console.log(`Warnings/modals: ${warnings.length}`);
    for (const w of warnings) console.log(`  [${w.type}] class="${w.class}" text="${w.text.substring(0, 120)}"`);

    // Screenshot after attempt
    const ts2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_bhgB_after_${ts2}.png`, fullPage: true });

    // ── If Bahagian B became active, capture its structure ──────────
    if (/bahagian\s*b/i.test(activeAfter)) {
      console.log("\n=== BAHAGIAN B IS ACTIVE — CAPTURING STRUCTURE ===");

      const inv = await page.evaluate(() => {
        const panel = document.querySelector("#bhgn-b") || document.querySelector(".tab-pane.active");
        if (!panel) return { found: false };

        const headings = [];
        panel.querySelectorAll("h1,h2,h3,h4,h5,h6,.box-title,legend,strong").forEach(h => {
          const r = h.getBoundingClientRect();
          const txt = (h.textContent || "").trim();
          if (r.width > 0 && r.height > 0 && txt.length > 2 && txt.length < 120)
            headings.push({ text: txt.substring(0, 100), tag: h.tagName.toLowerCase() });
        });

        const labels = [];
        panel.querySelectorAll("label").forEach(l => {
          const r = l.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) labels.push({ text: (l.textContent || "").trim().substring(0, 80), htmlFor: l.htmlFor || "" });
        });

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

        const tables = [];
        panel.querySelectorAll("table").forEach(t => {
          const r = t.getBoundingClientRect();
          if (r.width <= 0) return;
          const headers = [];
          t.querySelectorAll("th").forEach(th => { if (th.getBoundingClientRect().width > 0) headers.push(th.textContent?.trim().substring(0, 40) || ""); });
          tables.push({ headers, rowCount: t.querySelectorAll("tbody tr").length });
        });

        const buttons = [];
        panel.querySelectorAll("button, input[type='submit'], input[type='button'], a.btn").forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return;
          const txt = (el.textContent || el.value || "").trim();
          if (txt.length > 0 && txt.length < 60) buttons.push({ text: txt.substring(0, 40), tag: el.tagName.toLowerCase(), id: el.id || "" });
        });

        const body = (panel.innerText || "").substring(0, 2000);

        return { found: true, headings, labels, inputs, selects, tables, buttons, body };
      });

      if (inv.found) {
        console.log(`\nHeadings (${inv.headings.length}):`);
        for (const h of inv.headings) console.log(`  [${h.tag}] "${h.text}"`);
        console.log(`Labels (${inv.labels.length}):`);
        for (const l of inv.labels) console.log(`  "${l.text}" for="${l.htmlFor}"`);
        console.log(`Inputs (${inv.inputs.length}):`);
        for (const i of inv.inputs) console.log(`  type=${i.type} name="${i.name}" id="${i.id}" val="${i.value}" ro=${i.readOnly} ph="${i.placeholder}" label="${i.label}"`);
        console.log(`Selects (${inv.selects.length}):`);
        for (const s of inv.selects) {
          console.log(`  name="${s.name}" id="${s.id}" selected="${s.selectedText}" opts=${s.optionCount} label="${s.label}"`);
          console.log(`    [${s.options.map(o => `${o.v}="${o.t}"`).join(", ")}]`);
        }
        console.log(`Tables (${inv.tables.length}):`);
        for (const t of inv.tables) console.log(`  headers=[${t.headers.join(", ")}] rows=${t.rowCount}`);
        console.log(`Buttons (${inv.buttons.length}): ${inv.buttons.map(b => `"${b.text}"`).join(", ")}`);
        console.log(`Body (first 500):\n"${inv.body.substring(0, 500)}"`);

        writeMarker("P8_BAHAGIAN_B_INVENTORY",
          `url=${page.url()}\nactiveTab=${activeAfter}\n` +
          `headings=${inv.headings.map(h => `[${h.tag}]"${h.text}"`).join("; ")}\n` +
          `labels=${inv.labels.map(l => `"${l.text}"`).join("; ")}\n` +
          `inputs=${inv.inputs.map(i => `${i.type}:${i.name}/${i.id}="${i.value}" ro=${i.readOnly}`).join("; ")}\n` +
          `selects=${inv.selects.map(s => `${s.name}/${s.id}="${s.selectedText}" opts=${s.optionCount}`).join("; ")}\n` +
          `tables=${inv.tables.map(t => `[${t.headers.join(",")}] rows=${t.rowCount}`).join("; ")}\n` +
          `buttons=${inv.buttons.map(b => `"${b.text}"`).join("; ")}\n` +
          `body=${inv.body.substring(0, 600)}`
        );
      }

      // Scroll for full content
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);
      const ts3 = new Date().toISOString().replace(/[:.]/g, "-");
      await page.screenshot({ path: `${ARTIFACT_DIR}/p8_bhgB_scrolled_${ts3}.png`, fullPage: true });
    } else {
      console.log(`\nBahagian B did NOT become active. Active tab is still: "${activeAfter}"`);
      writeMarker("P8_BAHAGIAN_B_BLOCKED",
        `url=${page.url()}\nactiveTab=${activeAfter}\n` +
        `bhgBDisabled=${bhgBTab.disabled}\n` +
        `warnings=${warnings.map(w => w.text.substring(0, 80)).join("; ")}\n` +
        `partyRows=${partyRows}`
      );
    }

    console.log(`\n=== COMPLETE. NO DATA. NO SAVE. NO SUBMIT. ===`);

  } finally {
    await ctx.close();
  }
}

run().catch(err => { console.error("Failed:", err); process.exit(1); });
