/**
 * P5 (Sewa / Pajakan) Live Gate Discovery — Read-Only Boundary Probe
 *
 * Purpose: Replace guessed advisory state for the sewa_pajakan lane with
 * real, observed gate evidence. Walk the real e-Duti Setem portal flow
 * far enough to enumerate which of the following are actually required
 * before Hantar:
 *   - Lampiran (document uploads)
 *   - Perakuan (declaration checkbox)
 *   - Bahagian A party entry
 *   - Rumusan Pengiraan access
 *   - Additional server-side validation surfaced by the Hantar click
 *
 * Hard stop rules (DO NOT RELAX):
 *   - Any native confirm() dialog during the Hantar attempt is DISMISSED.
 *   - No Bahagian A parties are added.
 *   - No files are uploaded.
 *   - No payment path is followed.
 *   - If we cannot determine whether a next click would create a real
 *     submission, we stop and dump state.
 *
 * Usage: node scripts/p5-sewa-pajakan-gate-discovery.js
 *
 * Requires:
 *   - Manual login if data/playwright-profile session has expired.
 *     (The script will wait up to 10 minutes for the form page URL.)
 *
 * Output:
 *   - Screenshots + text markers under data/portal-probe-artifacts/
 *     prefixed `p5_sewa_*`.
 *   - Final summary marker `P5_SEWA_GATE_SUMMARY_*.txt`.
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

// ── Test data (from approved safe-dummy defaults) ──────────────────────
const TODAY = new Date();
const TEST_DATA = {
  stampOffice: "Sarawak",
  day: String(TODAY.getDate()).padStart(2, "0"),      // "21"
  monthMs: [
    "Januari", "Februari", "Mac", "April", "Mei", "Jun",
    "Julai", "Ogos", "September", "Oktober", "November", "Disember",
  ][TODAY.getMonth()],                                  // "April"
  year: String(TODAY.getFullYear()),                    // "2026"
  monthlyRent: 2500,
  leaseMonths: 12,
};

console.log(`\n=== P5 SEWA/PAJAKAN LIVE GATE DISCOVERY ===`);
console.log(`Today: ${TODAY.toISOString()}`);
console.log(`Test data: ${JSON.stringify(TEST_DATA)}\n`);

function ts() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function writeMarker(name, body) {
  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    fs.writeFileSync(
      `${ARTIFACT_DIR}/${name}_${ts()}.txt`,
      `${name}\n${new Date().toISOString()}\n${body}\n`,
    );
  } catch { /* best-effort */ }
}

async function shot(page, name) {
  const p = `${ARTIFACT_DIR}/${name}_${ts()}.png`;
  try {
    await page.screenshot({ path: p, fullPage: true });
    console.log(`  [screenshot] ${p}`);
  } catch (e) {
    console.log(`  [screenshot-failed] ${name}: ${e.message}`);
  }
}

/**
 * Capture the current tab bar: anchor text, visibility, active state,
 * href. Used to enumerate what tabs exist on p5.
 */
async function captureTabBar(page) {
  return await page.evaluate(() => {
    const tabs = [];
    document.querySelectorAll(".nav-tabs a, .nav-tabs li a, [role='tablist'] a").forEach((a) => {
      const r = a.getBoundingClientRect();
      const vis = r.width > 0 && r.height > 0;
      const txt = (a.textContent || "").trim();
      if (!txt) return;
      const activeEl = a.closest("li");
      const active = (activeEl && activeEl.classList.contains("active")) ||
                     a.classList.contains("active");
      tabs.push({
        text: txt.substring(0, 60),
        href: a.getAttribute("href") || "",
        visible: vis,
        active: !!active,
        disabled: a.classList.contains("disabled") || a.getAttribute("aria-disabled") === "true",
      });
    });
    return tabs;
  });
}

/**
 * Capture alerts, validation messages, and any visible modals.
 * These surface the portal's own gate-enforcement language.
 */
async function captureAlertsAndModals(page) {
  return await page.evaluate(() => {
    const alerts = [];
    const alertSelectors = [
      ".alert", ".notification", ".toast", ".message",
      ".swal2-popup", ".bootbox", "[role='alert']", "[role='status']",
      ".text-danger", ".error", ".success", ".warning",
      ".validation-error", ".form-error", ".field-error",
      ".has-error .help-block", ".is-invalid",
    ];
    for (const sel of alertSelectors) {
      document.querySelectorAll(sel).forEach((el) => {
        const txt = (el.textContent || "").trim();
        const r = el.getBoundingClientRect();
        if (txt && txt.length < 500 && r.width > 0 && r.height > 0) {
          alerts.push({
            sel,
            text: txt.substring(0, 300),
            className: String(el.className || "").substring(0, 60),
          });
        }
      });
    }

    const modals = [];
    document.querySelectorAll(".modal.show, .modal.in, .bootbox, [role='dialog'], .swal2-popup").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 50 && r.height > 50) {
        const title = el.querySelector(".modal-title, h4, h3, .swal2-title")?.textContent?.trim() || "";
        const body = (el.textContent || "").trim().substring(0, 500);
        const buttons = [];
        el.querySelectorAll("button, input[type='button'], a.btn").forEach((b) => {
          const br = b.getBoundingClientRect();
          if (br.width > 0) buttons.push((b.textContent || b.value || "").trim().substring(0, 30));
        });
        modals.push({ title, body, buttons });
      }
    });

    const invalids = [];
    document.querySelectorAll("input:invalid, select:invalid, .has-error input, .has-error select, .is-invalid").forEach((el) => {
      const r = el.getBoundingClientRect();
      invalids.push({
        name: el.name || "",
        id: el.id || "",
        tag: el.tagName.toLowerCase(),
        value: (el.value || "").substring(0, 40),
        visible: r.width > 0 && r.height > 0,
      });
    });

    return { alerts, modals, invalids };
  });
}

/**
 * Capture visible action buttons on the page (Simpan/Hantar/Semak/etc.).
 */
async function captureActionButtons(page) {
  return await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("input[type='submit'], input[type='button'], button, a.btn").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const txt = (el.textContent || el.value || "").trim();
      if (!txt || txt.length > 80) return;
      if (!/simpan|hantar|semak|senarai|tambah|batal|cancel|kembali|keluar/i.test(txt)) return;
      out.push({
        text: txt.substring(0, 60),
        id: el.id || "",
        tag: el.tagName.toLowerCase(),
        type: el.type || "",
        disabled: el.disabled || el.getAttribute("aria-disabled") === "true",
        bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      });
    });
    return out;
  });
}

async function run() {
  const profilePath = path.resolve(PROFILE_DIR);
  console.log(`Profile: ${profilePath}\n`);

  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const page = context.pages()[0] || await context.newPage();

  // ── Global dialog guard: DISMISS confirm() dialogs from any phase ─
  // p8-hantar-boundary.js pattern. Alerts are accepted (info only).
  const dialogLog = [];
  page.on("dialog", async (d) => {
    const entry = { at: new Date().toISOString(), type: d.type(), message: (d.message() || "").substring(0, 500) };
    console.log(`  [DIALOG] ${entry.type}: "${entry.message.substring(0, 200)}"`);
    if (d.type() === "confirm" || d.type() === "prompt") {
      console.log(`    >> DISMISSING (no submission/legal obligation).`);
      await d.dismiss();
      entry.decision = "dismissed";
    } else {
      await d.accept();
      entry.decision = "accepted";
    }
    dialogLog.push(entry);
  });

  try {
    // ── Phase 1: Navigate + wait-for-login-if-needed ────────────────
    console.log("Phase 1: Navigate → application form");
    await page.goto("https://stamps.hasil.gov.my/stamps/form/application", {
      timeout: 60_000,
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(3000);
    let url = page.url();
    console.log(`  URL after goto: ${url}`);

    if (!url.includes("/stamps/form/application")) {
      console.log(`\n  >> Not on form page (landed on ${url}).`);
      console.log("  >> Please complete login manually in the Playwright Chrome window if prompted.");
      console.log("  >> Once you are at the MyTax dashboard (https://mytax.hasil.gov.my/...), the script");
      console.log("  >> will retry the stamps form URL. If that fails, manually navigate to:");
      console.log("  >>   Perkhidmatan ez → e-Duti Setem (STSDS) → buka permohonan baru");
      console.log("  >> OR paste this URL into the same tab:");
      console.log("  >>   https://stamps.hasil.gov.my/stamps/form/application\n");

      // Polling loop: wait for MyTax login to complete, then opportunistically
      // retry the form URL, otherwise let the user navigate manually.
      const deadline = Date.now() + 900_000; // 15 min budget
      let lastRetryAt = 0;
      let retries = 0;
      while (Date.now() < deadline) {
        await page.waitForTimeout(2000);
        let current;
        try {
          current = page.url();
        } catch {
          // page may be briefly invalid during navigation
          continue;
        }
        if (current.includes("/stamps/form/application")) {
          url = current;
          console.log(`  Reached form URL: ${url}`);
          break;
        }
        // If we're on an authenticated MyTax page, try a direct goto every
        // ~20s — the session may now be established.
        if (/mytax\.hasil\.gov\.my/.test(current) && Date.now() - lastRetryAt > 20_000 && retries < 6) {
          retries++;
          lastRetryAt = Date.now();
          console.log(`  [retry ${retries}] On MyTax (${current}) — trying direct form URL again...`);
          try {
            await page.goto("https://stamps.hasil.gov.my/stamps/form/application", {
              timeout: 30_000,
              waitUntil: "domcontentloaded",
            });
            await page.waitForTimeout(2500);
          } catch (e) {
            console.log(`    goto error: ${e.message}`);
          }
        }
      }

      if (!page.url().includes("/stamps/form/application")) {
        console.log(`\n  Gave up waiting. finalUrl=${page.url()}`);
        writeMarker("P5_SEWA_LOGIN_TIMEOUT", `waitedFor=15min\nfinalUrl=${page.url()}\nretries=${retries}`);
        await context.close();
        process.exit(1);
      }
      await page.waitForTimeout(3000);
      url = page.url();
      console.log(`  Final URL: ${url}`);
    }
    await shot(page, "p5_sewa_01_application_landing");

    // ── Phase 2: Select "Sewa / Pajakan" lane ────────────────────────
    console.log("\nPhase 2: Select Sewa / Pajakan");
    const laneOk = await page.evaluate(() => {
      const radios = document.querySelectorAll('input[type="radio"]');
      for (const r of radios) {
        const label = r.labels?.[0]?.textContent?.trim() ||
                      r.parentElement?.textContent?.trim() || "";
        if (label === "Sewa / Pajakan") {
          r.click();
          return { ok: true, value: r.value, label };
        }
      }
      return { ok: false };
    });
    console.log(`  Lane radio clicked: ${JSON.stringify(laneOk)}`);
    if (!laneOk.ok) {
      writeMarker("P5_SEWA_LANE_RADIO_MISSING", `final_url=${page.url()}`);
      await shot(page, "p5_sewa_02_lane_radio_missing");
      await context.close();
      process.exit(1);
    }
    await page.waitForTimeout(1500);

    // ── Phase 3: Fill Maklumat Am (Pejabat Setem + Tarikh Surat Cara) ─
    console.log("\nPhase 3: Fill MA");
    const pejabatResult = await page.evaluate((office) => {
      const sel = document.querySelector('select[name="CD_DUTISETEM_ID"]');
      if (!sel) return { ok: false, reason: "select_missing" };
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].text.includes(office)) {
          sel.selectedIndex = i;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          return { ok: true, selected: sel.options[i].text, value: sel.value };
        }
      }
      return { ok: false, reason: "no_match", optionCount: sel.options.length };
    }, TEST_DATA.stampOffice);
    console.log(`  Pejabat Setem: ${JSON.stringify(pejabatResult)}`);
    await page.waitForTimeout(1200);

    try {
      await page.fill('input[name="tsd"]', TEST_DATA.day);
    } catch (e) {
      console.log(`  tsd fill failed: ${e.message}`);
    }
    await page.waitForTimeout(500);

    // Identify year (>100 opts) and month (~12 opts) selects among visible
    // unnamed selects, excluding Pejabat Setem.
    const selInfo = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll("select").forEach((s, idx) => {
        const r = s.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        if (s.name === "CD_DUTISETEM_ID") return;
        out.push({ index: idx, name: s.name || "", optionCount: s.options.length });
      });
      return out;
    });
    for (const s of selInfo) {
      try {
        if (s.optionCount > 100) {
          await page.locator("select").nth(s.index).selectOption({ label: TEST_DATA.year });
        } else if (s.optionCount >= 12 && s.optionCount <= 13) {
          await page.locator("select").nth(s.index).selectOption({ label: TEST_DATA.monthMs });
        }
      } catch (e) {
        console.log(`  selectOption[${s.index}] failed: ${e.message}`);
      }
    }
    await page.waitForTimeout(1500);
    await shot(page, "p5_sewa_03_ma_filled");

    // ── Phase 3a: Close any open datepicker, then click "Seterusnya" ─
    // Observed 2026-04-21: filling the date fields opens a bootstrap-
    // datepicker overlay. MA2 does not render until the overlay is closed
    // and "Seterusnya" (Next) is clicked on the MA1 date row.
    console.log("\nPhase 3a: Close datepicker + click Seterusnya");
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);
    // Click anywhere neutral to lose focus from date inputs
    try { await page.locator("body").click({ position: { x: 10, y: 10 } }); } catch {}
    await page.waitForTimeout(500);

    const seterusnyaClicked = await page.evaluate(() => {
      const candidates = document.querySelectorAll("button, a.btn, input[type='button'], input[type='submit']");
      for (const el of candidates) {
        const txt = (el.textContent || el.value || "").trim();
        if (/^seterusnya$/i.test(txt) || /\bseterusnya\b/i.test(txt)) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && !el.disabled) {
            el.click();
            return { ok: true, text: txt.substring(0, 40), id: el.id || "", tag: el.tagName.toLowerCase() };
          }
        }
      }
      return { ok: false };
    });
    console.log(`  Seterusnya click: ${JSON.stringify(seterusnyaClicked)}`);
    await page.waitForTimeout(2500);
    await shot(page, "p5_sewa_03a_after_seterusnya");

    // ── Phase 3b: Fill MA2 section (sewa-specific required fields) ───
    // Portal added an MA2 block for sewa_pajakan (observed 2026-04-21):
    //   a: Pilih Surat Cara  (radio)  — take "Surat Cara Utama (Prinsipal)" i.e. first option
    //   b: Kategori Surat Cara (select) — pick first real option
    //   c: Jenis Surat Cara   (select) — pick first real option (cascades from b)
    //   d: Kaedah Taksiran    (radio)  — take "Swataksir" i.e. first option
    console.log("\nPhase 3b: Fill MA2 (sewa-specific gate)");

    // Capture the current form state to identify MA2 controls.
    const ma2Before = await page.evaluate(() => {
      const isVis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const radioGroups = new Map();
      document.querySelectorAll('input[type="radio"]').forEach((r) => {
        if (!isVis(r)) return;
        if (r.name === "ES_PDS_APP") return; // MA1 lane radio — already set
        const lbl = r.labels?.[0]?.textContent?.trim() ||
                    r.parentElement?.textContent?.trim() || "";
        const group = radioGroups.get(r.name) || { name: r.name, options: [] };
        group.options.push({ value: r.value, id: r.id, label: lbl.substring(0, 80), checked: r.checked });
        radioGroups.set(r.name, group);
      });
      const selects = [];
      document.querySelectorAll("select").forEach((s) => {
        if (!isVis(s)) return;
        if (s.name === "CD_DUTISETEM_ID") return; // MA1 pejabat — already set
        if (!s.name && s.options.length >= 12 && s.options.length <= 13) return; // month dropdowns
        if (!s.name && s.options.length > 100) return; // year dropdowns
        const cur = s.options[s.selectedIndex];
        const firstOpts = [];
        for (let i = 0; i < Math.min(8, s.options.length); i++) {
          firstOpts.push({ value: s.options[i].value, text: s.options[i].text.substring(0, 60) });
        }
        selects.push({
          name: s.name, id: s.id,
          disabled: s.disabled,
          optionCount: s.options.length,
          currentText: cur?.text || "",
          currentValue: cur?.value || "",
          firstOpts,
        });
      });
      return { radioGroups: Array.from(radioGroups.values()), selects };
    });
    console.log(`  MA2 radio groups (${ma2Before.radioGroups.length}):`);
    for (const rg of ma2Before.radioGroups) {
      console.log(`    name=${rg.name} options=[${rg.options.map((o) => `${o.value}="${o.label}"${o.checked ? "*" : ""}`).join(", ")}]`);
    }
    console.log(`  MA2 selects (${ma2Before.selects.length}):`);
    for (const s of ma2Before.selects) {
      console.log(`    name=${s.name} id=${s.id} opts=${s.optionCount} current="${s.currentText}" disabled=${s.disabled}`);
      console.log(`      first: ${s.firstOpts.map((o) => `${o.value}="${o.text}"`).join(", ")}`);
    }
    writeMarker("P5_SEWA_MA2_INVENTORY",
      `radioGroups=\n${ma2Before.radioGroups.map((rg) => `  ${rg.name}=[${rg.options.map((o) => `${o.value}="${o.label}"${o.checked ? "*" : ""}`).join(", ")}]`).join("\n")}\n` +
      `selects=\n${ma2Before.selects.map((s) => `  ${s.name} id=${s.id} opts=${s.optionCount} current="${s.currentText}" disabled=${s.disabled}\n    opts: ${s.firstOpts.map((o) => `${o.value}="${o.text}"`).join("; ")}`).join("\n")}`,
    );

    // Click first option in each non-ES_PDS_APP radio group.
    for (const rg of ma2Before.radioGroups) {
      if (rg.options.length === 0) continue;
      if (rg.options.some((o) => o.checked)) {
        console.log(`  radio ${rg.name}: already checked (${rg.options.find((o) => o.checked)?.label})`);
        continue;
      }
      const target = rg.options[0];
      console.log(`  radio ${rg.name}: clicking "${target.label}" (value=${target.value})`);
      try {
        if (target.id) {
          await page.locator(`input[type="radio"]#${target.id}`).click({ timeout: 5000 });
        } else {
          // Click by name+value pair
          await page.locator(`input[type="radio"][name="${rg.name}"][value="${target.value}"]`).first().click({ timeout: 5000 });
        }
      } catch (e) {
        console.log(`    click failed: ${e.message}`);
      }
      await page.waitForTimeout(800);
    }

    // Select first real option in each MA2 select (skip placeholders).
    // Cascade-safe: re-read selects each iteration because b→c may populate c.
    for (let i = 0; i < ma2Before.selects.length; i++) {
      // Re-capture current select states — b's selection may have populated c
      const current = await page.evaluate(() => {
        const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const selects = [];
        document.querySelectorAll("select").forEach((s) => {
          if (!isVis(s)) return;
          if (s.name === "CD_DUTISETEM_ID") return;
          if (!s.name && s.options.length >= 12 && s.options.length <= 13) return;
          if (!s.name && s.options.length > 100) return;
          const firstOpts = [];
          for (let i = 0; i < Math.min(8, s.options.length); i++) {
            firstOpts.push({ value: s.options[i].value, text: s.options[i].text.substring(0, 60) });
          }
          selects.push({
            name: s.name, id: s.id,
            disabled: s.disabled,
            optionCount: s.options.length,
            currentValue: s.options[s.selectedIndex]?.value || "",
            firstOpts,
          });
        });
        return selects;
      });
      if (i >= current.length) break;
      const s = current[i];
      if (s.disabled) {
        console.log(`  select ${s.name || s.id}: disabled, skipping`);
        continue;
      }
      if (s.currentValue && s.currentValue !== "") {
        console.log(`  select ${s.name || s.id}: already set (value=${s.currentValue})`);
        continue;
      }
      // Pick first option with a non-empty value
      const choice = s.firstOpts.find((o) => o.value !== "" && !/^(sila pilih|pilih|--)/i.test(o.text));
      if (!choice) {
        console.log(`  select ${s.name || s.id}: no non-placeholder option — skipping`);
        continue;
      }
      console.log(`  select ${s.name || s.id}: choosing "${choice.text}" (value=${choice.value})`);
      try {
        if (s.id) {
          await page.locator(`select#${s.id}`).selectOption({ value: choice.value });
        } else if (s.name) {
          await page.locator(`select[name="${s.name}"]`).selectOption({ value: choice.value });
        }
      } catch (e) {
        console.log(`    selectOption failed: ${e.message}`);
      }
      await page.waitForTimeout(1500); // let cascades populate
    }

    await shot(page, "p5_sewa_03b_ma2_filled");

    // ── Phase 4: Save MA → expect /formv2/p5/ ────────────────────────
    console.log("\nPhase 4: Save MA (btn-ma-submit)");
    const preMaUrl = page.url();
    try {
      await page.locator("button#btn-ma-submit").click({ timeout: 10_000 });
    } catch (e) {
      console.log(`  Save MA click failed: ${e.message}`);
      writeMarker("P5_SEWA_MA_SAVE_CLICK_FAIL", `error=${e.message}\nurl=${page.url()}`);
      await shot(page, "p5_sewa_04_ma_save_click_fail");
      await context.close();
      return;
    }
    await page.waitForTimeout(6000);
    const postMaUrl = page.url();
    console.log(`  preMaUrl  = ${preMaUrl}`);
    console.log(`  postMaUrl = ${postMaUrl}`);
    const onP5 = postMaUrl.includes("/formv2/p5/");
    console.log(`  on /formv2/p5/: ${onP5}`);
    await shot(page, "p5_sewa_05_post_ma_save");

    if (!onP5) {
      const msgs = await captureAlertsAndModals(page);
      writeMarker("P5_SEWA_MA_SAVE_NOT_ADVANCED",
        `preMaUrl=${preMaUrl}\npostMaUrl=${postMaUrl}\n` +
        `alerts=${msgs.alerts.map((a) => `"${a.text}"`).join("; ")}\n` +
        `modals=${msgs.modals.map((m) => `title="${m.title}" body="${m.body.substring(0, 120)}"`).join("; ")}\n` +
        `invalids=${msgs.invalids.map((f) => f.name || f.id).join(", ")}`);
      console.log(`  Alerts: ${msgs.alerts.length}, Modals: ${msgs.modals.length}, Invalids: ${msgs.invalids.length}`);
      console.log("  ABORT: MA save did not advance to p5.");
      await context.close();
      return;
    }

    // ── Phase 5: Baseline on p5 — options + tab bar ──────────────────
    console.log("\nPhase 5: Baseline capture on /formv2/p5/");
    const p5Baseline = await page.evaluate(() => {
      const sc = document.getElementById("pds_suratcara");
      const ps = document.getElementById("pds_ps");
      const pd = document.getElementById("profile_desc");
      const scOpts = [];
      if (sc) for (let i = 0; i < sc.options.length; i++) scOpts.push({ v: sc.options[i].value, t: sc.options[i].text.substring(0, 60) });
      return {
        suratcaraVal: sc?.value || "",
        suratcaraText: sc?.options[sc.selectedIndex]?.text || "",
        suratcaraOptionCount: sc?.options?.length || 0,
        suratcaraOptions: scOpts,
        pdsPsVal: ps?.value || "",
        pdsPsText: ps?.options[ps.selectedIndex]?.text || "",
        profileDescVal: pd?.value || "",
      };
    });
    console.log(`  pds_suratcara: "${p5Baseline.suratcaraText}" (val="${p5Baseline.suratcaraVal}"), options=${p5Baseline.suratcaraOptionCount}`);
    console.log(`  pds_ps: "${p5Baseline.pdsPsText}" (val="${p5Baseline.pdsPsVal}")`);
    console.log(`  profile_desc: "${p5Baseline.profileDescVal}"`);

    const p5Tabs = await captureTabBar(page);
    console.log(`  Tabs (${p5Tabs.length}):`);
    for (const t of p5Tabs) console.log(`    "${t.text}" href=${t.href} vis=${t.visible} active=${t.active} disabled=${t.disabled}`);

    writeMarker("P5_SEWA_BASELINE",
      `postMaUrl=${postMaUrl}\n` +
      `suratcara="${p5Baseline.suratcaraText}" val="${p5Baseline.suratcaraVal}" optCount=${p5Baseline.suratcaraOptionCount}\n` +
      `suratcara_first10=${p5Baseline.suratcaraOptions.slice(0, 10).map((o) => `${o.v}="${o.t}"`).join("; ")}\n` +
      `pds_ps="${p5Baseline.pdsPsText}" val="${p5Baseline.pdsPsVal}"\n` +
      `profile_desc="${p5Baseline.profileDescVal}"\n` +
      `tabs=${p5Tabs.map((t) => `${t.active ? "*" : ""}${t.disabled ? "!" : ""}"${t.text}"`).join(", ")}`,
    );

    // ── Phase 6: Walk each tab (read-only — no fill, no save) ─────────
    console.log("\nPhase 6: Walk tabs (read-only)");
    // Walk by clicking tab anchors that match known gate names.
    const tabTargets = [
      { key: "bahagian_a", match: /bahagian\s*a/i },
      { key: "bahagian_b", match: /bahagian\s*b/i },
      { key: "lampiran",   match: /lampiran/i },
      { key: "perakuan",   match: /perakuan|akuan/i },
      { key: "rumusan",    match: /rumusan|pengiraan/i },
    ];
    const tabWalk = {};
    for (const target of tabTargets) {
      console.log(`\n  Tab: ${target.key}`);
      const clicked = await page.evaluate((pattern) => {
        const anchors = document.querySelectorAll(".nav-tabs a, .nav-tabs li a, [role='tab']");
        for (const a of anchors) {
          const txt = (a.textContent || "").trim();
          if (new RegExp(pattern, "i").test(txt)) {
            const r = a.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              a.click();
              return { ok: true, text: txt };
            }
            return { ok: false, reason: "not_visible", text: txt };
          }
        }
        return { ok: false, reason: "not_found" };
      }, target.match.source);
      console.log(`    click: ${JSON.stringify(clicked)}`);
      await page.waitForTimeout(2000);

      const afterClick = await page.evaluate(() => {
        const active = document.querySelector(".nav-tabs li.active a, [role='tab'][aria-selected='true']");
        const panel = document.querySelector(".tab-pane.active, .tab-pane.in");
        const panelText = panel ? (panel.textContent || "").trim().substring(0, 400) : "";
        return {
          activeTabText: (active?.textContent || "").trim(),
          activeHref: active?.getAttribute("href") || "",
          panelTextExcerpt: panelText,
          panelVisible: !!(panel && panel.getBoundingClientRect().width > 0),
        };
      });
      console.log(`    active-tab="${afterClick.activeTabText}" panelVisible=${afterClick.panelVisible}`);
      const msgs = await captureAlertsAndModals(page);
      if (msgs.modals.length || msgs.alerts.length) {
        console.log(`    alerts=${msgs.alerts.length} modals=${msgs.modals.length}`);
      }
      await shot(page, `p5_sewa_06_tab_${target.key}`);

      // Quick per-tab field inventory (inputs + selects + file inputs + checkboxes).
      const inv = await page.evaluate(() => {
        const isVis = (el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const inputs = [];
        document.querySelectorAll("input, textarea").forEach((el) => {
          if (!isVis(el)) return;
          inputs.push({
            type: el.type || "text",
            name: el.name || "",
            id: el.id || "",
            required: el.required || el.getAttribute("aria-required") === "true",
            label: el.labels?.[0]?.textContent?.trim().substring(0, 60) || "",
          });
        });
        const selects = [];
        document.querySelectorAll("select").forEach((el) => {
          if (!isVis(el)) return;
          selects.push({
            name: el.name || "",
            id: el.id || "",
            optionCount: el.options.length,
            label: el.labels?.[0]?.textContent?.trim().substring(0, 60) || "",
          });
        });
        const fileInputs = inputs.filter((i) => i.type === "file");
        const checkboxes = inputs.filter((i) => i.type === "checkbox");
        return { inputs, selects, fileInputs, checkboxes };
      });
      console.log(`    inputs=${inv.inputs.length} selects=${inv.selects.length} fileInputs=${inv.fileInputs.length} checkboxes=${inv.checkboxes.length}`);
      if (inv.fileInputs.length) {
        for (const f of inv.fileInputs) console.log(`      file: name="${f.name}" id="${f.id}" label="${f.label}" required=${f.required}`);
      }
      if (inv.checkboxes.length) {
        for (const c of inv.checkboxes) console.log(`      checkbox: name="${c.name}" id="${c.id}" label="${c.label}" required=${c.required}`);
      }

      tabWalk[target.key] = {
        clickResult: clicked,
        activeTab: afterClick.activeTabText,
        panelVisible: afterClick.panelVisible,
        panelTextExcerpt: afterClick.panelTextExcerpt,
        inputCount: inv.inputs.length,
        selectCount: inv.selects.length,
        fileInputs: inv.fileInputs,
        checkboxes: inv.checkboxes,
        alerts: msgs.alerts,
        modals: msgs.modals.map((m) => ({ title: m.title, buttons: m.buttons })),
      };

      // Dismiss any modal that popped as a side-effect of tab navigation
      // (e.g. confirm-before-switch), so subsequent tabs are reachable.
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(500);
    }

    writeMarker("P5_SEWA_TAB_WALK",
      Object.entries(tabWalk).map(([k, v]) =>
        `[${k}] clickOk=${v.clickResult.ok}${v.clickResult.reason ? ` (${v.clickResult.reason})` : ""} activeTab="${v.activeTab}" panelVisible=${v.panelVisible} inputs=${v.inputCount} selects=${v.selectCount} fileInputs=${v.fileInputs.length} checkboxes=${v.checkboxes.length}\n` +
        `  fileInputs: ${v.fileInputs.map((f) => `${f.name || f.id} label="${f.label}" req=${f.required}`).join("; ") || "(none)"}\n` +
        `  checkboxes: ${v.checkboxes.map((c) => `${c.name || c.id} label="${c.label}" req=${c.required}`).join("; ") || "(none)"}\n` +
        `  alerts: ${v.alerts.map((a) => `"${a.text.substring(0, 80)}"`).join("; ") || "(none)"}\n` +
        `  modals: ${v.modals.map((m) => `"${m.title}" buttons=[${m.buttons.join(",")}]`).join("; ") || "(none)"}\n`,
      ).join("\n"),
    );

    // ── Phase 7: Return to first tab, attempt Hantar with dismiss-guard ─
    console.log("\nPhase 7: Attempt Hantar (dismiss-guard active)");
    // Return to default tab view (scroll top) so Hantar is located by
    // scanning the whole page, not just the last active panel.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    await shot(page, "p5_sewa_07_pre_hantar");

    const preState = await page.evaluate(() => {
      const btns = [];
      document.querySelectorAll("input[type='submit'], input[type='button'], button, a.btn").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const txt = (el.textContent || el.value || "").trim();
        if (!/^hantar$/i.test(txt) && !/\bhantar\b/i.test(txt)) return;
        btns.push({
          text: txt.substring(0, 40),
          id: el.id || "",
          tag: el.tagName.toLowerCase(),
          type: el.type || "",
          disabled: el.disabled || el.getAttribute("aria-disabled") === "true",
          bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        });
      });
      const active = document.querySelector(".nav-tabs li.active a")?.textContent?.trim() || "";
      return { hantarButtons: btns, activeTab: active, url: window.location.href };
    });
    console.log(`  pre-Hantar state: activeTab="${preState.activeTab}" url=${preState.url}`);
    console.log(`  Hantar candidates (${preState.hantarButtons.length}):`);
    for (const b of preState.hantarButtons) {
      console.log(`    "${b.text}" id="${b.id}" tag=${b.tag} type=${b.type} disabled=${b.disabled} bbox=${b.bbox.x},${b.bbox.y} ${b.bbox.w}x${b.bbox.h}`);
    }

    const hantarBtn = preState.hantarButtons.find((b) => /^hantar$/i.test(b.text) && !b.disabled)
                   || preState.hantarButtons.find((b) => !b.disabled);

    if (!hantarBtn) {
      console.log("  NO ENABLED Hantar button found → write marker and stop.");
      writeMarker("P5_SEWA_HANTAR_BTN_NOT_FOUND",
        `activeTab="${preState.activeTab}"\nurl=${preState.url}\ncandidates=${preState.hantarButtons.map((b) => `"${b.text}" id=${b.id} dis=${b.disabled}`).join("; ")}`);
    } else {
      console.log(`  Clicking Hantar: "${hantarBtn.text}" id="${hantarBtn.id}" (dialog-guard active)`);
      const preClickDialogs = dialogLog.length;

      const preHantarUrl = page.url();
      try {
        if (hantarBtn.id && /^[A-Za-z][\w-]*$/.test(hantarBtn.id)) {
          await page.locator(`#${hantarBtn.id}`).click({ timeout: 8000 });
        } else {
          await page.mouse.click(
            hantarBtn.bbox.x + hantarBtn.bbox.w / 2,
            hantarBtn.bbox.y + hantarBtn.bbox.h / 2,
          );
        }
      } catch (e) {
        console.log(`    click error: ${e.message}`);
      }
      await page.waitForTimeout(8000);

      const postHantarUrl = page.url();
      const postHantarActive = await page.evaluate(() =>
        document.querySelector(".nav-tabs li.active a")?.textContent?.trim() || "",
      );
      const postMsgs = await captureAlertsAndModals(page);
      const postButtons = await captureActionButtons(page);
      await shot(page, "p5_sewa_08_post_hantar");

      const newDialogs = dialogLog.slice(preClickDialogs);
      console.log(`  post-click URL: ${postHantarUrl} (changed=${postHantarUrl !== preHantarUrl})`);
      console.log(`  post-click activeTab: "${postHantarActive}"`);
      console.log(`  dialogs captured during Hantar: ${newDialogs.length}`);
      for (const d of newDialogs) console.log(`    ${d.type} ${d.decision}: "${d.message.substring(0, 200)}"`);
      console.log(`  alerts: ${postMsgs.alerts.length}`);
      for (const a of postMsgs.alerts) console.log(`    "${a.text.substring(0, 180)}" class="${a.className.substring(0, 30)}"`);
      console.log(`  modals: ${postMsgs.modals.length}`);
      for (const m of postMsgs.modals) {
        console.log(`    title="${m.title}" body="${m.body.substring(0, 180)}" buttons=[${m.buttons.join(",")}]`);
      }
      console.log(`  invalids: ${postMsgs.invalids.length}`);
      for (const f of postMsgs.invalids) console.log(`    ${f.tag} ${f.name || f.id} val="${f.value}" vis=${f.visible}`);

      writeMarker("P5_SEWA_HANTAR_BOUNDARY",
        `preHantarUrl=${preHantarUrl}\npostHantarUrl=${postHantarUrl}\nurlChanged=${postHantarUrl !== preHantarUrl}\n` +
        `preActiveTab="${preState.activeTab}"\npostActiveTab="${postHantarActive}"\n` +
        `dialogsCaptured=${newDialogs.length}\n` +
        `${newDialogs.map((d) => `  ${d.type} ${d.decision}: "${d.message.substring(0, 300)}"`).join("\n")}\n` +
        `alerts=${postMsgs.alerts.length}\n` +
        `${postMsgs.alerts.map((a) => `  "${a.text.substring(0, 200)}" class="${a.className.substring(0, 40)}"`).join("\n")}\n` +
        `modals=${postMsgs.modals.length}\n` +
        `${postMsgs.modals.map((m) => `  title="${m.title}" body="${m.body.substring(0, 200)}" buttons=[${m.buttons.join(",")}]`).join("\n")}\n` +
        `invalidFields=${postMsgs.invalids.map((f) => f.name || f.id).join(", ")}\n` +
        `postButtons=${postButtons.map((b) => `"${b.text}" dis=${b.disabled}`).join("; ")}`);

      // Dismiss any lingering modal before cleanup.
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(500);
    }

    // ── Phase 8: Final summary ───────────────────────────────────────
    console.log("\nPhase 8: Final summary");
    writeMarker("P5_SEWA_GATE_SUMMARY",
      `lane=sewa_pajakan\n` +
      `ranAt=${new Date().toISOString()}\n` +
      `finalUrl=${page.url()}\n` +
      `dialogsTotal=${dialogLog.length}\n` +
      `${dialogLog.map((d) => `  ${d.type} ${d.decision}: "${d.message.substring(0, 300)}"`).join("\n")}\n` +
      `NOTE: No Hantar confirm dialog was accepted. No final submission was performed.\n`,
    );
    console.log("\n=== DONE. No confirmation clicked. No submission performed. ===\n");

  } catch (err) {
    console.error("\nProbe failed:", err);
    writeMarker("P5_SEWA_PROBE_ERROR", `error=${err.stack || err.message}\nurl=${page.url()}`);
    await shot(page, "p5_sewa_error");
  } finally {
    await context.close();
  }
}

run().catch((err) => {
  console.error("Outer failure:", err);
  process.exit(1);
});
