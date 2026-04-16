/**
 * P8 Save Boundary Investigation — Employment Contract
 *
 * Reaches p8, enters Employment Contract, verifies profile_desc + pds_ps,
 * then clicks the Maklumat Am save control and captures the post-save state.
 *
 * Usage: node scripts/p8-save-boundary-investigation.js
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

const DOC_NAME = "Employment Contract";
const EXPECTED_PROFILE_DESC = "Perjanjian Pekerjaan";
const EXPECTED_PDS_PS = "p"; // Prinsipal

console.log(`\n=== P8 SAVE BOUNDARY: "${DOC_NAME}" ===\n`);

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
    // ── Reach p8 ────────────────────────────────────────────────────
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

    const p8Url = page.url();
    if (!p8Url.includes("/formv2/p8/")) { console.log("ERROR: Not on p8."); await ctx.close(); return; }
    console.log(`P8 URL: ${p8Url}\n`);

    // ── Enter document name + verify ────────────────────────────────
    console.log(`Entering "${DOC_NAME}"...`);
    const nsc = page.locator("#namaperjanjian");
    await nsc.click();
    await nsc.fill(DOC_NAME);
    await page.waitForTimeout(500);
    await nsc.evaluate(el => {
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    });
    await page.waitForTimeout(3000);

    // Verify
    const verify = await page.evaluate(() => {
      const nsc2 = document.getElementById("namaperjanjian");
      const pd = document.getElementById("profile_desc");
      const ps = document.getElementById("pds_ps");
      return {
        namaperjanjian: nsc2 ? nsc2.value : "",
        profileDesc: pd ? pd.value : "",
        pdsPs: ps ? ps.value : "",
        pdsPsText: ps ? (ps.options[ps.selectedIndex]?.text || "") : "",
      };
    });

    console.log(`Verified:`);
    console.log(`  namaperjanjian: "${verify.namaperjanjian}"`);
    console.log(`  profile_desc: "${verify.profileDesc}"`);
    console.log(`  pds_ps: "${verify.pdsPsText}" (${verify.pdsPs})`);

    if (verify.namaperjanjian !== DOC_NAME) {
      console.log("ERROR: namaperjanjian mismatch."); await ctx.close(); return;
    }
    if (verify.profileDesc !== EXPECTED_PROFILE_DESC) {
      console.log(`ERROR: profile_desc mismatch. Expected "${EXPECTED_PROFILE_DESC}", got "${verify.profileDesc}".`);
      await ctx.close(); return;
    }
    if (verify.pdsPs !== EXPECTED_PDS_PS) {
      console.log(`ERROR: pds_ps mismatch. Expected "${EXPECTED_PDS_PS}", got "${verify.pdsPs}".`);
      await ctx.close(); return;
    }
    console.log("Pre-save verification PASSED.\n");

    // ── Screenshot before save ──────────────────────────────────────
    const ts1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_save_pre_${ts1}.png`, fullPage: true });

    // ── Capture pre-save field inventory ─────────────────────────────
    const preSave = await page.evaluate(() => {
      const labels = [];
      document.querySelectorAll("label").forEach(l => {
        const r = l.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) labels.push(l.textContent?.trim().substring(0, 80) || "");
      });
      const inputs = [];
      document.querySelectorAll("input, textarea, select").forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        if (el.type === "hidden") return;
        inputs.push({
          tag: el.tagName.toLowerCase(), type: el.type || "",
          name: el.name || "", id: el.id || "",
          value: (el.value || "").substring(0, 40),
        });
      });
      const tabs = [];
      document.querySelectorAll(".nav-tabs a, [role='tab']").forEach(a => {
        const r = a.getBoundingClientRect();
        if (r.width > 0) tabs.push({
          text: a.textContent?.trim().substring(0, 30) || "",
          active: a.classList.contains("active") || a.parentElement?.classList.contains("active"),
        });
      });
      return { labels, inputs, tabs };
    });
    console.log(`Pre-save: ${preSave.labels.length} labels, ${preSave.inputs.length} controls`);
    console.log(`Tabs: ${preSave.tabs.map(t => `"${t.text}"${t.active ? "*" : ""}`).join(", ")}`);

    // ── Find and click save control ─────────────────────────────────
    // On p8, the save control is "Simpan Maklumat Am" (id=pdsG01_bhgn_am)
    const saveInfo = await page.evaluate(() => {
      const candidates = [];
      document.querySelectorAll("input[type='submit'], input[type='button'], button").forEach(el => {
        const txt = (el.textContent || el.value || "").trim();
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && /simpan/i.test(txt)) {
          candidates.push({
            text: txt.substring(0, 40), tag: el.tagName.toLowerCase(),
            type: el.type || "", id: el.id || "",
            bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          });
        }
      });
      return candidates;
    });
    console.log(`\nSave controls: ${saveInfo.length}`);
    for (const s of saveInfo) console.log(`  "${s.text}" tag=${s.tag} type=${s.type} id="${s.id}" bbox=${s.bbox.x},${s.bbox.y} ${s.bbox.w}x${s.bbox.h}`);

    // Prefer "Simpan Maklumat Am"
    const saveMa = saveInfo.find(s => /simpan\s*maklumat/i.test(s.text));
    const saveTarget = saveMa || saveInfo[0];
    if (!saveTarget) {
      console.log("ERROR: No save control found."); await ctx.close(); return;
    }
    console.log(`\nUsing save: "${saveTarget.text}" id="${saveTarget.id}"`);

    // Register dialog handler
    let dialogInfo = { captured: false, type: "", msg: "" };
    page.on("dialog", async d => {
      dialogInfo.captured = true; dialogInfo.type = d.type(); dialogInfo.msg = d.message();
      console.log(`  DIALOG: ${d.type()} "${d.message().substring(0, 100)}"`);
      await d.accept();
    });

    // Click save using real browser-level interaction
    console.log("Clicking save...");
    if (saveTarget.id) {
      await page.locator(`#${saveTarget.id}`).click({ timeout: 5000 });
    } else {
      await page.mouse.click(saveTarget.bbox.x + saveTarget.bbox.w / 2, saveTarget.bbox.y + saveTarget.bbox.h / 2);
    }
    await page.waitForTimeout(8000);

    // ── Post-save state capture ─────────────────────────────────────
    const postSaveUrl = page.url();
    console.log(`\nPost-save URL: ${postSaveUrl}`);
    console.log(`URL changed: ${postSaveUrl !== p8Url}`);
    console.log(`Dialog: ${dialogInfo.captured ? `${dialogInfo.type} "${dialogInfo.msg.substring(0, 100)}"` : "none"}`);

    // Screenshot after save
    const ts2 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/p8_save_post_${ts2}.png`, fullPage: true });

    // Check for modals/messages
    const postSave = await page.evaluate(() => {
      const messages = [];
      document.querySelectorAll(".modal.show, .modal.in, .bootbox, [role='dialog']").forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > 50 && r.height > 50) {
          messages.push({ type: "modal", text: (el.textContent || "").trim().substring(0, 300) });
        }
      });
      document.querySelectorAll(".alert, [role='alert'], .text-danger, .error").forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          messages.push({ type: "alert", text: (el.textContent || "").trim().substring(0, 200) });
        }
      });

      // Headings
      const headings = [];
      document.querySelectorAll("h1,h2,h3,h4,h5,.box-title,.content-header").forEach(h => {
        const r = h.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) headings.push(h.textContent?.trim().substring(0, 80) || "");
      });

      // Tabs
      const tabs = [];
      document.querySelectorAll(".nav-tabs a, [role='tab']").forEach(a => {
        const r = a.getBoundingClientRect();
        if (r.width > 0) tabs.push({
          text: a.textContent?.trim().substring(0, 30) || "",
          active: a.classList.contains("active") || a.parentElement?.classList.contains("active"),
        });
      });

      // All visible labels
      const labels = [];
      document.querySelectorAll("label").forEach(l => {
        const r = l.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) labels.push(l.textContent?.trim().substring(0, 80) || "");
      });

      // All visible inputs/selects
      const controls = [];
      document.querySelectorAll("input, textarea, select").forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        if (el.type === "hidden") return;
        controls.push({
          tag: el.tagName.toLowerCase(), type: el.type || "",
          name: el.name || "", id: el.id || "",
          value: (el.value || "").substring(0, 60),
          readOnly: el.readOnly || false,
        });
      });

      // Invalid fields
      const invalids = [];
      document.querySelectorAll("input:invalid, select:invalid").forEach(el => {
        invalids.push({ name: el.name || "", msg: el.validationMessage?.substring(0, 40) || "" });
      });

      const body = (document.body?.innerText || "").substring(0, 1500);

      return { messages, headings, tabs, labels, controls, invalids, body };
    });

    console.log(`\nPost-save analysis:`);
    console.log(`  Messages: ${postSave.messages.length}`);
    for (const m of postSave.messages) console.log(`    [${m.type}] "${m.text.substring(0, 120)}"`);
    console.log(`  Headings: ${postSave.headings.join("; ")}`);
    console.log(`  Tabs: ${postSave.tabs.map(t => `"${t.text}"${t.active ? "*" : ""}`).join(", ")}`);
    console.log(`  Labels (${postSave.labels.length}): ${postSave.labels.slice(0, 15).join("; ")}`);
    console.log(`  Controls (${postSave.controls.length}):`);
    for (const c of postSave.controls) console.log(`    ${c.tag} type=${c.type} name="${c.name}" id="${c.id}" value="${c.value}" ro=${c.readOnly}`);
    console.log(`  Invalid (${postSave.invalids.length}): ${postSave.invalids.map(f => f.name).join(", ")}`);
    console.log(`  Body (first 300): "${postSave.body.substring(0, 300)}"`);

    writeMarker("P8_SAVE_BOUNDARY",
      `doc=${DOC_NAME}\n` +
      `preSaveUrl=${p8Url}\n` +
      `postSaveUrl=${postSaveUrl}\n` +
      `urlChanged=${postSaveUrl !== p8Url}\n` +
      `dialog=${dialogInfo.captured ? `${dialogInfo.type}:"${dialogInfo.msg.substring(0, 100)}"` : "none"}\n` +
      `messages=${postSave.messages.map(m => `[${m.type}]"${m.text.substring(0, 80)}"`).join("; ")}\n` +
      `headings=${postSave.headings.join("; ")}\n` +
      `tabs=${postSave.tabs.map(t => `"${t.text}"${t.active ? "*" : ""}`).join(", ")}\n` +
      `labels=${postSave.labels.length}\n` +
      `controls=${postSave.controls.length}\n` +
      `invalids=${postSave.invalids.length}: ${postSave.invalids.map(f => f.name).join(", ")}\n` +
      `body=${postSave.body.substring(0, 500)}`
    );

    console.log(`\n=== P8 SAVE BOUNDARY INVESTIGATION COMPLETE ===`);
    console.log(`NO LATER FIELDS FILLED. NO LATER TABS. NO SUBMIT.`);

  } finally {
    await ctx.close();
  }
}

run().catch(err => { console.error("Failed:", err); process.exit(1); });
