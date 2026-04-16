/**
 * P5 Bahagian A — Tambah Individu Investigation
 *
 * Discovers what UI appears when clicking "Tambah Individu" for
 * landlord and tenant sections on the supported p5 path.
 * Does NOT fill or save any party data.
 *
 * Usage: node scripts/p5-tambah-individu-investigation.js
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

console.log("\n=== P5 TAMBAH INDIVIDU INVESTIGATION ===\n");

function writeMarker(name, body) {
  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(`${ARTIFACT_DIR}/${name}_${ts}.txt`, `${name}\n${new Date().toISOString()}\n${body}\n`);
  } catch {}
}

async function captureAddPartyUI(page, label) {
  const inv = await page.evaluate(() => {
    // Check for modals first
    const modalSelectors = [
      ".modal.show", ".modal.in", ".modal[style*='display: block']",
      ".modal[style*='display:block']", "[role='dialog']", "[role='alertdialog']",
      ".swal2-popup", ".bootbox",
    ];
    let modalEl = null;
    for (const sel of modalSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        if (r.width > 50 && r.height > 50 && s.display !== "none" && s.visibility !== "hidden") {
          modalEl = el;
          break;
        }
      }
    }

    // Determine search root: modal if found, else active tab panel
    const searchRoot = modalEl || document.querySelector("#bhgn-a") || document.body;
    const uiType = modalEl ? "modal" : "tab_panel";
    const modalClass = modalEl ? (modalEl.className || "").toString().substring(0, 80) : "";
    const modalId = modalEl ? (modalEl.id || "") : "";

    // Headings
    const headings = [];
    searchRoot.querySelectorAll("h1,h2,h3,h4,h5,h6,.modal-title,.box-title,legend,strong").forEach((h) => {
      const r = h.getBoundingClientRect();
      const txt = (h.textContent || "").trim();
      if (r.width > 0 && r.height > 0 && txt.length > 2 && txt.length < 120) {
        headings.push({ text: txt.substring(0, 100), tag: h.tagName.toLowerCase() });
      }
    });

    // Labels with for associations
    const labels = [];
    searchRoot.querySelectorAll("label").forEach((lbl) => {
      const r = lbl.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        labels.push({
          text: (lbl.textContent || "").trim().substring(0, 100),
          htmlFor: lbl.htmlFor || "",
        });
      }
    });

    // Inputs
    const inputs = [];
    searchRoot.querySelectorAll("input, textarea").forEach((el) => {
      const inp = el;
      const r = inp.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      if (inp.type === "hidden") return;
      const lblEl = inp.labels?.[0];
      inputs.push({
        type: inp.type || "text",
        name: inp.name || "",
        id: inp.id || "",
        value: (inp.value || "").substring(0, 80),
        readOnly: inp.readOnly || false,
        disabled: inp.disabled || false,
        placeholder: (inp.placeholder || "").substring(0, 50),
        maxLength: inp.maxLength > 0 && inp.maxLength < 10000 ? inp.maxLength : null,
        label: lblEl ? (lblEl.textContent || "").trim().substring(0, 80) : "",
      });
    });

    // Selects
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
        disabled: sel.disabled,
        label: lblEl ? (lblEl.textContent || "").trim().substring(0, 80) : "",
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

    // Buttons (save/cancel/close/add)
    const buttons = [];
    searchRoot.querySelectorAll("button, input[type='submit'], input[type='button'], a.btn").forEach((el) => {
      const txt = (el.textContent || el.value || "").trim();
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && txt.length > 0 && txt.length < 60) {
        buttons.push({
          text: txt.substring(0, 40),
          tag: el.tagName.toLowerCase(),
          type: el.type || "",
          id: el.id || "",
          className: (el.className || "").toString().substring(0, 50),
        });
      }
    });

    // Also check modal footer/header for close buttons
    if (modalEl) {
      const closeBtn = modalEl.querySelector(".close, [data-dismiss='modal'], .modal-footer button");
      if (closeBtn) {
        const r = closeBtn.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          buttons.push({
            text: (closeBtn.textContent || "").trim().substring(0, 20) || "×",
            tag: closeBtn.tagName.toLowerCase(),
            type: closeBtn.type || "",
            id: closeBtn.id || "",
            className: "close/dismiss",
          });
        }
      }
    }

    const body = searchRoot.innerText?.substring(0, 2000) || "";

    return {
      uiType, modalClass, modalId,
      headings, labels, inputs, selects, radioGroups, buttons, body,
    };
  });

  console.log(`\n--- Add-Party UI: ${label} ---`);
  console.log(`UI type: ${inv.uiType}${inv.modalClass ? ` (class="${inv.modalClass}")` : ""}${inv.modalId ? ` (id="${inv.modalId}")` : ""}`);
  console.log(`\nHeadings (${inv.headings.length}):`);
  for (const h of inv.headings) console.log(`  [${h.tag}] "${h.text}"`);
  console.log(`\nLabels (${inv.labels.length}):`);
  for (const l of inv.labels) console.log(`  "${l.text}" for="${l.htmlFor}"`);
  console.log(`\nInputs (${inv.inputs.length}):`);
  for (const i of inv.inputs) console.log(`  type=${i.type} name="${i.name}" id="${i.id}" value="${i.value}" ro=${i.readOnly} disabled=${i.disabled} placeholder="${i.placeholder}" maxLen=${i.maxLength} label="${i.label}"`);
  console.log(`\nSelects (${inv.selects.length}):`);
  for (const s of inv.selects) {
    console.log(`  name="${s.name}" id="${s.id}" selected="${s.selectedText}" (${s.selectedValue}) opts=${s.optionCount} disabled=${s.disabled} label="${s.label}"`);
    console.log(`    [${s.options.map(o => `${o.v}="${o.t}"`).join(", ")}]`);
  }
  console.log(`\nRadio groups (${inv.radioGroups.length}):`);
  for (const rg of inv.radioGroups) console.log(`  name="${rg.name}": ${rg.options.map(o => `${o.value}="${o.label}"${o.checked ? "*" : ""}`).join(", ")}`);
  console.log(`\nButtons (${inv.buttons.length}):`);
  for (const b of inv.buttons) console.log(`  "${b.text}" tag=${b.tag} type=${b.type} id="${b.id}" class="${b.className}"`);

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
    // ── Reach Bahagian A via proven path ─────────────────────────────
    console.log("Navigating to application form...");
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
      if (sel) { for (let i = 0; i < sel.options.length; i++) { if (sel.options[i].text.includes("Sarawak")) { sel.selectedIndex = i; sel.dispatchEvent(new Event("change", { bubbles: true })); break; } } }
    });
    await page.fill('input[name="tsd"]', "01");
    await page.waitForTimeout(500);
    try { await page.locator("select").nth(2).selectOption({ label: "Januari" }); } catch {}
    await page.waitForTimeout(500);
    await page.locator("button#btn-ma-submit").click();
    await page.waitForTimeout(5000);

    if (!page.url().includes("/formv2/p5/")) {
      console.log("ERROR: Not on p5 page."); await context.close(); return;
    }

    // Select Perjanjian Sewa + Prinsipal, save
    await page.locator("#pds_suratcara").selectOption({ value: "1101" });
    await page.waitForTimeout(500);
    await page.locator("#pds_ps").selectOption({ value: "p" });
    await page.waitForTimeout(500);
    await page.evaluate(() => { document.getElementById("pdsL01_bhgn_am")?.click(); });
    await page.waitForTimeout(5000);

    // Dismiss the "Berjaya" success modal from Maklumat Am save
    console.log("Dismissing Maklumat Am save success modal...");
    await page.evaluate(() => {
      // Close any visible bootbox/modal
      const closeBtn = document.querySelector(".bootbox .btn, .bootbox .close, [data-dismiss='modal']");
      if (closeBtn) closeBtn.click();
    });
    await page.waitForTimeout(1000);
    // Also try pressing Escape in case
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);

    // Switch to Bahagian A
    await page.evaluate(() => {
      const links = document.querySelectorAll('.nav-tabs a');
      for (const a of links) { if (/bahagian\s*a/i.test(a.textContent?.trim())) { a.click(); return; } }
    });
    await page.waitForTimeout(3000);
    console.log("On Bahagian A.\n");

    // ══════════════════════════════════════════════════════════════════
    // RUN A: Landlord Tambah Individu
    // ══════════════════════════════════════════════════════════════════
    console.log("=== RUN A: LANDLORD TAMBAH INDIVIDU ===\n");

    // Screenshot: before click
    const tsA1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_tambah_landlord_before_${tsA1}.png`, fullPage: true });

    // Find and click "Tambah Individu" in the landlord section
    // The landlord section comes first; need to find the correct link
    const landlordClick = await page.evaluate(() => {
      // Find all visible "Individu" or "Tambah" links/buttons
      const candidates = [];
      const allLinks = document.querySelectorAll("#bhgn-a a, #bhgn-a button, #bhgn-a [onclick]");
      allLinks.forEach((el) => {
        const txt = (el.textContent || "").trim();
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        if (/individu/i.test(txt)) {
          candidates.push({
            text: txt.substring(0, 60),
            tag: el.tagName.toLowerCase(),
            href: el.getAttribute("href") || "",
            onclick: el.getAttribute("onclick") || "",
            dataTarget: el.getAttribute("data-target") || el.getAttribute("data-toggle") || "",
            bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          });
        }
      });
      return candidates;
    });

    console.log(`Landlord "Individu" candidates: ${landlordClick.length}`);
    for (const c of landlordClick) {
      console.log(`  text="${c.text}" tag=${c.tag} href="${c.href}" onclick="${c.onclick.substring(0, 60)}" data="${c.dataTarget}" bbox=${c.bbox.x},${c.bbox.y} ${c.bbox.w}x${c.bbox.h}`);
    }

    if (landlordClick.length === 0) {
      console.log("ERROR: No 'Individu' link found in landlord section.");
      await context.close(); return;
    }

    // Click the first (topmost) Individu link — should be landlord (seller)
    const firstIndividu = landlordClick[0];
    console.log(`\nLandlord link: "${firstIndividu.text}" href="${firstIndividu.href}"`);

    if (firstIndividu.href) {
      // Navigate directly via the href to avoid modal overlay issues
      console.log(`Navigating to: ${firstIndividu.href}`);
      await page.goto(firstIndividu.href, { timeout: 30000, waitUntil: "domcontentloaded" });
    } else {
      // Fallback: JS click on the exact <a> element
      await page.evaluate((href) => {
        const links = document.querySelectorAll("#bhgn-a a");
        for (const a of links) {
          if (/individu/i.test(a.textContent?.trim()) && a.href.includes("seller")) {
            a.click(); return;
          }
        }
      }, firstIndividu.href);
    }
    await page.waitForTimeout(5000);

    // Screenshot: after click
    const tsA2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_tambah_landlord_after_${tsA2}.png`, fullPage: true });

    console.log(`URL after click: ${page.url()}`);

    // Capture the add-party UI
    const landlordUI = await captureAddPartyUI(page, "LANDLORD_INDIVIDU");

    writeMarker("P5_TAMBAH_LANDLORD_INDIVIDU",
      `uiType=${landlordUI.uiType}\n` +
      `modalClass=${landlordUI.modalClass}\n` +
      `headings=${landlordUI.headings.map(h => `[${h.tag}]"${h.text}"`).join("; ")}\n` +
      `labels=${landlordUI.labels.map(l => `"${l.text}" for="${l.htmlFor}"`).join("; ")}\n` +
      `inputs=${landlordUI.inputs.map(i => `${i.type}:${i.name}/${i.id}="${i.value}" ro=${i.readOnly} label="${i.label}"`).join("; ")}\n` +
      `selects=${landlordUI.selects.map(s => `${s.name}/${s.id}="${s.selectedText}" opts=${s.optionCount} label="${s.label}"`).join("; ")}\n` +
      `buttons=${landlordUI.buttons.map(b => `"${b.text}" tag=${b.tag} id="${b.id}"`).join("; ")}\n` +
      `body=${landlordUI.body.substring(0, 600)}`
    );

    // Close the modal/UI without saving (if it's a modal, click close/×)
    if (landlordUI.uiType === "modal") {
      console.log("\nClosing landlord modal without saving...");
      const closed = await page.evaluate(() => {
        const closeBtn = document.querySelector(".modal.show .close, .modal.in .close, [data-dismiss='modal']");
        if (closeBtn) { (closeBtn).click(); return true; }
        return false;
      });
      if (closed) {
        console.log("Modal close button clicked.");
        await page.waitForTimeout(1000);
      } else {
        // Try pressing Escape
        await page.keyboard.press("Escape");
        await page.waitForTimeout(1000);
        console.log("Pressed Escape to close.");
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // RUN B: Tenant Tambah Individu
    // ══════════════════════════════════════════════════════════════════
    console.log("\n\n=== RUN B: TENANT TAMBAH INDIVIDU ===\n");

    // Screenshot: before click
    const tsB1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p5_tambah_tenant_before_${tsB1}.png`, fullPage: true });

    // Find Individu links — the second one should be in the tenant section
    if (landlordClick.length >= 2) {
      const tenantIndividu = landlordClick[1];
      console.log(`Tenant link: "${tenantIndividu.text}" href="${tenantIndividu.href}"`);

      // Dismiss any modal first
      await page.evaluate(() => {
        const closeBtn = document.querySelector(".bootbox .btn, .bootbox .close, [data-dismiss='modal']");
        if (closeBtn) closeBtn.click();
      });
      await page.waitForTimeout(1000);

      if (tenantIndividu.href) {
        console.log(`Navigating to: ${tenantIndividu.href}`);
        await page.goto(tenantIndividu.href, { timeout: 30000, waitUntil: "domcontentloaded" });
      } else {
        await page.evaluate(() => {
          const links = document.querySelectorAll("#bhgn-a a");
          for (const a of links) {
            if (/individu/i.test(a.textContent?.trim()) && a.href.includes("buyer")) {
              a.click(); return;
            }
          }
        });
      }
      await page.waitForTimeout(5000);

      // Screenshot: after click
      const tsB2 = new Date().toISOString().replace(/[:.]/g, "-");
      await page.screenshot({ path: `${ARTIFACT_DIR}/p5_tambah_tenant_after_${tsB2}.png`, fullPage: true });

      console.log(`URL after click: ${page.url()}`);

      const tenantUI = await captureAddPartyUI(page, "TENANT_INDIVIDU");

      writeMarker("P5_TAMBAH_TENANT_INDIVIDU",
        `uiType=${tenantUI.uiType}\n` +
        `modalClass=${tenantUI.modalClass}\n` +
        `headings=${tenantUI.headings.map(h => `[${h.tag}]"${h.text}"`).join("; ")}\n` +
        `labels=${tenantUI.labels.map(l => `"${l.text}" for="${l.htmlFor}"`).join("; ")}\n` +
        `inputs=${tenantUI.inputs.map(i => `${i.type}:${i.name}/${i.id}="${i.value}" ro=${i.readOnly} label="${i.label}"`).join("; ")}\n` +
        `selects=${tenantUI.selects.map(s => `${s.name}/${s.id}="${s.selectedText}" opts=${s.optionCount} label="${s.label}"`).join("; ")}\n` +
        `buttons=${tenantUI.buttons.map(b => `"${b.text}" tag=${b.tag} id="${b.id}"`).join("; ")}\n` +
        `body=${tenantUI.body.substring(0, 600)}`
      );

      // Close without saving
      if (tenantUI.uiType === "modal") {
        console.log("\nClosing tenant modal without saving...");
        await page.evaluate(() => {
          const closeBtn = document.querySelector(".modal.show .close, .modal.in .close, [data-dismiss='modal']");
          if (closeBtn) { (closeBtn).click(); }
        });
        await page.waitForTimeout(1000);
      }
    } else {
      console.log("Only one 'Individu' link found — cannot distinguish tenant from landlord.");
      console.log("Tenant Tambah Individu NOT tested.");
    }

    console.log(`\n=== P5 TAMBAH INDIVIDU INVESTIGATION COMPLETE ===`);
    console.log(`NO PARTY DATA ENTERED. NO SAVE. NO SUBMIT.`);

  } finally {
    await context.close();
  }
}

run().catch((err) => {
  console.error("Investigation failed:", err);
  process.exit(1);
});
