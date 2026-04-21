/**
 * P5 (Sewa / Pajakan) Live Gate Discovery — Read-Only Boundary Probe
 *
 * Purpose: Replace guessed advisory state for the sewa_pajakan lane with
 * real, observed gate evidence. Walks the real e-Duti Setem portal far
 * enough to enumerate which of the following are actually required
 * before Hantar:
 *   - MA save gate content (which fields portal-side validation flags)
 *   - Lampiran (document uploads) accessibility + requirement
 *   - Perakuan (declaration) accessibility + requirement
 *   - Bahagian A / B accessibility
 *   - Rumusan Pengiraan accessibility
 *   - Hantar gate validation messages (behind dismiss-guard)
 *
 * Hard stop rules (DO NOT RELAX):
 *   - Every native confirm()/prompt() dialog is DISMISSED.
 *   - No Bahagian A parties are added.
 *   - No files are uploaded.
 *   - No payment path is followed.
 *   - If any action could create an irreversible submission, screenshot
 *     and log instead of clicking.
 *
 * Usage: node scripts/p5-sewa-pajakan-gate-discovery.js
 *
 * Requires:
 *   - Manual login if data/playwright-profile session has expired.
 *     (The script will wait up to 15 minutes for the form page URL.)
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

// ── Test data — safe dummy values authorized for this probe ──────────
const TODAY = new Date();
const TEST_DATA = {
  stampOffice: "Sarawak",
  day: String(TODAY.getDate()).padStart(2, "0"),
  month: String(TODAY.getMonth() + 1).padStart(2, "0"),
  monthMs: [
    "Januari", "Februari", "Mac", "April", "Mei", "Jun",
    "Julai", "Ogos", "September", "Oktober", "November", "Disember",
  ][TODAY.getMonth()],
  year: String(TODAY.getFullYear()),
  // Semantic MA2 defaults (not heuristic) — established from the
  // MA2 inventory + the Apr-22 native-fill verify probe.
  ma2: {
    posValue: "0",        // Surat Cara Utama (Prinsipal)
    radioKtValue: "1",    // Swataksir
    ksValue: "240",       // Sewa (tenancy) — NOT Pajakan
    // js: pick first non-placeholder non-"Lain-Lain" option after cascade
    // settles; js values vary per ks selection and are discovered live.
  },
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
 * Capture the tab bar — anchor text, visibility, active state, href.
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
      const active =
        (activeEl && activeEl.classList.contains("active")) ||
        a.classList.contains("active");
      tabs.push({
        text: txt.substring(0, 60),
        href: a.getAttribute("href") || "",
        visible: vis,
        active: !!active,
        disabled:
          a.classList.contains("disabled") ||
          a.getAttribute("aria-disabled") === "true",
      });
    });
    return tabs;
  });
}

/**
 * Capture alerts, validation messages, modals, invalid fields.
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
            className: String(el.className || "").substring(0, 80),
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
    document.querySelectorAll("input:invalid, select:invalid, textarea:invalid, .has-error input, .has-error select, .is-invalid").forEach((el) => {
      const r = el.getBoundingClientRect();
      invalids.push({
        tag: el.tagName.toLowerCase(),
        name: el.name || "",
        id: el.id || "",
        value: (el.value || "").substring(0, 40),
        visible: r.width > 0 && r.height > 0,
      });
    });

    return { alerts, modals, invalids };
  });
}

/**
 * Capture visible action buttons (Simpan/Hantar/Semak/etc.).
 */
async function captureActionButtons(page) {
  return await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("input[type='submit'], input[type='button'], button, a.btn").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const txt = (el.textContent || el.value || "").trim();
      if (!txt || txt.length > 80) return;
      if (!/simpan|hantar|semak|senarai|tambah|batal|cancel|kembali|keluar|seterusnya/i.test(txt)) return;
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

/**
 * Try to fill the MA1 Tarikh Surat Cara via the pickadate.js widget.
 *
 * Strategy ladder (stop at first success):
 *   1. page.fill('input[name="tsd"]', YYYY-MM-DD)
 *   2. page.fill('input[name="tsd"]', DD/MM/YYYY)
 *   3. Click the input to open picker, press Enter (pickadate defaults
 *      to highlighting today; Enter selects highlighted date).
 *
 * Returns { ok, strategy, readBackValue, errors[] }.
 */
async function fillMa1DateWidget(page) {
  const errors = [];
  const targetSel = 'input[name="tsd"]';

  const readBack = async () => {
    return await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? { value: el.value, classList: Array.from(el.classList || []) } : null;
    }, targetSel);
  };

  // Strategy 1: YYYY-MM-DD
  const ymd = `${TEST_DATA.year}-${TEST_DATA.month}-${TEST_DATA.day}`;
  try {
    await page.fill(targetSel, ymd, { timeout: 4000 });
    await page.waitForTimeout(400);
    const rb = await readBack();
    if (rb && rb.value && rb.value.length >= 8) {
      return { ok: true, strategy: "fill_ymd", attemptValue: ymd, readBackValue: rb.value, errors };
    }
    errors.push(`fill_ymd read-back empty or short (value="${rb?.value ?? "(null)"}")`);
  } catch (e) {
    errors.push(`fill_ymd error: ${e.message}`);
  }

  // Strategy 2: DD/MM/YYYY
  const dmy = `${TEST_DATA.day}/${TEST_DATA.month}/${TEST_DATA.year}`;
  try {
    await page.fill(targetSel, dmy, { timeout: 4000 });
    await page.waitForTimeout(400);
    const rb = await readBack();
    if (rb && rb.value && rb.value.length >= 8) {
      return { ok: true, strategy: "fill_dmy", attemptValue: dmy, readBackValue: rb.value, errors };
    }
    errors.push(`fill_dmy read-back empty or short (value="${rb?.value ?? "(null)"}")`);
  } catch (e) {
    errors.push(`fill_dmy error: ${e.message}`);
  }

  // Strategy 3: click input → keyboard Enter (pickadate highlights today by default)
  try {
    await page.locator(targetSel).click({ timeout: 4000 });
    await page.waitForTimeout(800);
    await page.keyboard.press("Enter").catch(() => {});
    await page.waitForTimeout(500);
    const rb = await readBack();
    if (rb && rb.value && rb.value.length >= 8) {
      return { ok: true, strategy: "click_enter", readBackValue: rb.value, errors };
    }
    errors.push(`click_enter read-back empty or short (value="${rb?.value ?? "(null)"}")`);
  } catch (e) {
    errors.push(`click_enter error: ${e.message}`);
  }

  // All strategies failed
  const rbFinal = await readBack();
  return { ok: false, strategy: "none", readBackValue: rbFinal?.value ?? null, errors };
}

/**
 * Wait (up to timeoutMs) for the `js` select to be populated with more
 * than one option (the placeholder plus at least one real option).
 * Returns final option list + whether cascade actually populated.
 */
async function waitForJsCascade(page, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    lastState = await page.evaluate(() => {
      const s = document.querySelector('select[name="js"]');
      if (!s) return { found: false };
      const opts = [];
      for (let i = 0; i < s.options.length; i++) {
        opts.push({ value: s.options[i].value, text: (s.options[i].text || "").substring(0, 80) });
      }
      return {
        found: true,
        disabled: s.disabled,
        optionCount: s.options.length,
        currentValue: s.value,
        selectedIndex: s.selectedIndex,
        options: opts,
      };
    });
    if (lastState.found && lastState.optionCount > 1) {
      return { ok: true, ...lastState };
    }
    await page.waitForTimeout(250);
  }
  return { ok: false, ...(lastState || { found: false }) };
}

/**
 * Pick first js option that is non-placeholder AND non-Lain-Lain.
 * "Placeholder" = empty value OR text starts with "sila pilih"/"pilih"/"--".
 * "Lain-Lain" = text contains "lain-lain" (case-insensitive).
 * Returns the chosen option or null.
 */
function chooseJsOption(options) {
  for (const o of options) {
    if (o.value === "" || o.value === "-1") continue;
    if (/^(sila pilih|pilih|--)/i.test(o.text)) continue;
    if (/lain-lain/i.test(o.text)) continue;
    return o;
  }
  return null;
}

/**
 * Capture a diff of invalid fields and has-error wrappers between two
 * captureAlertsAndModals() snapshots.
 */
function invalidsDiff(pre, post) {
  const preKeys = new Set(pre.invalids.map((i) => `${i.tag}:${i.name || i.id}`));
  const postKeys = new Set(post.invalids.map((i) => `${i.tag}:${i.name || i.id}`));
  const added = [...postKeys].filter((k) => !preKeys.has(k));
  const removed = [...preKeys].filter((k) => !postKeys.has(k));
  const common = [...postKeys].filter((k) => preKeys.has(k));
  return { added, removed, common };
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

  const page = context.pages()[0] || (await context.newPage());

  // ── Global dialog guard — DISMISS confirm/prompt from any phase ───
  const dialogLog = [];
  page.on("dialog", async (d) => {
    const entry = {
      at: new Date().toISOString(),
      type: d.type(),
      message: (d.message() || "").substring(0, 500),
    };
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

  let onP5 = false;

  try {
    // ── Phase 1: Navigate + wait-for-login ─────────────────────────
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
      console.log("  >> Please complete login manually in the Playwright Chrome window.");
      const deadline = Date.now() + 900_000;
      let lastRetryAt = 0;
      let retries = 0;
      while (Date.now() < deadline) {
        await page.waitForTimeout(2000);
        let current;
        try { current = page.url(); } catch { continue; }
        if (current.includes("/stamps/form/application")) break;
        if (/mytax\.hasil\.gov\.my/.test(current) && Date.now() - lastRetryAt > 20_000 && retries < 6) {
          retries++;
          lastRetryAt = Date.now();
          console.log(`  [retry ${retries}] On MyTax (${current}) — retrying form URL...`);
          try {
            await page.goto("https://stamps.hasil.gov.my/stamps/form/application", { timeout: 30_000, waitUntil: "domcontentloaded" });
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
    }
    url = page.url();
    console.log(`  Final URL: ${url}`);
    await shot(page, "p5_sewa_01_application_landing");

    // ── Phase 2: Select "Sewa / Pajakan" lane ──────────────────────
    console.log("\nPhase 2: Select Sewa / Pajakan");
    const laneOk = await page.evaluate(() => {
      for (const r of document.querySelectorAll('input[type="radio"]')) {
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

    // ── Phase 3: Fill MA1 (Pejabat Setem + date) ────────────────────
    console.log("\nPhase 3: Fill MA1");
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

    // MA1 Tarikh Surat Cara — via pickadate widget. Best-effort.
    console.log("  Filling MA1 Tarikh Surat Cara (pickadate widget)...");
    const dateFill = await fillMa1DateWidget(page);
    console.log(`    date fill result: ${JSON.stringify({ ok: dateFill.ok, strategy: dateFill.strategy, readBackValue: dateFill.readBackValue })}`);
    if (dateFill.errors.length) {
      for (const err of dateFill.errors) console.log(`      err: ${err}`);
    }
    writeMarker("P5_SEWA_MA1_DATE_FILL",
      `ok=${dateFill.ok}\nstrategy=${dateFill.strategy}\nreadBackValue=${dateFill.readBackValue ?? "(null)"}\n` +
      `errors=\n${dateFill.errors.map((e) => `  ${e}`).join("\n") || "  (none)"}`);
    await page.waitForTimeout(800);
    await shot(page, "p5_sewa_03_ma1_filled");

    // ── Phase 3a: Close datepicker, click Seterusnya ─────────────────
    console.log("\nPhase 3a: Close datepicker + click Seterusnya (reveals MA2)");
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
    try { await page.locator("body").click({ position: { x: 10, y: 10 } }); } catch {}
    await page.waitForTimeout(400);

    const seterusnyaClicked = await page.evaluate(() => {
      for (const el of document.querySelectorAll("button, a.btn, input[type='button'], input[type='submit']")) {
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

    // ── Phase 3b: Fill MA2 via native Playwright methods ─────────────
    console.log("\nPhase 3b: Fill MA2 (native methods, semantic defaults)");

    // pos — radio, target value="0" "Surat Cara Utama (Prinsipal)"
    console.log(`  pos: target value="${TEST_DATA.ma2.posValue}"`);
    try {
      await page.locator(`input[type="radio"][name="pos"][value="${TEST_DATA.ma2.posValue}"]`).check({ timeout: 5000 });
      console.log(`    .check() OK`);
    } catch (e) {
      console.log(`    .check() ERR: ${e.message}`);
    }
    await page.waitForTimeout(400);

    // radio-kt — radio, target value="1" "Swataksir"
    console.log(`  radio-kt: target value="${TEST_DATA.ma2.radioKtValue}"`);
    try {
      await page.locator(`input[type="radio"][name="radio-kt"][value="${TEST_DATA.ma2.radioKtValue}"]`).check({ timeout: 5000 });
      console.log(`    .check() OK`);
    } catch (e) {
      console.log(`    .check() ERR: ${e.message}`);
    }
    await page.waitForTimeout(400);

    // ks — select, target value="240" ("Sewa" — tenancy)
    console.log(`  ks: target value="${TEST_DATA.ma2.ksValue}" (expect "Sewa")`);
    try {
      await page.locator('select[name="ks"]').selectOption({ value: TEST_DATA.ma2.ksValue });
      console.log(`    .selectOption() OK`);
    } catch (e) {
      console.log(`    .selectOption() ERR: ${e.message}`);
    }

    // Wait for js cascade to populate (>1 option)
    const jsCascade = await waitForJsCascade(page, 6000);
    console.log(`  js cascade: ok=${jsCascade.ok} optionCount=${jsCascade.optionCount ?? "?"}`);
    if (jsCascade.ok) {
      for (const o of jsCascade.options) {
        console.log(`      js opt: value="${o.value}" text="${o.text}"`);
      }
    }

    // Pick js per the non-placeholder non-Lain-Lain rule.
    let jsChoice = null;
    if (jsCascade.ok && jsCascade.options && jsCascade.options.length > 1) {
      jsChoice = chooseJsOption(jsCascade.options);
      if (jsChoice) {
        console.log(`  js: choosing value="${jsChoice.value}" text="${jsChoice.text}"`);
        try {
          await page.locator('select[name="js"]').selectOption({ value: jsChoice.value });
          console.log(`    .selectOption() OK`);
        } catch (e) {
          console.log(`    .selectOption() ERR: ${e.message}`);
        }
      } else {
        console.log(`  js: no non-placeholder non-Lain-Lain option found`);
      }
    } else {
      console.log(`  js: cascade did not populate within 6s — leaving blank`);
    }
    await page.waitForTimeout(800);

    // Capture full MA2 state post-fill
    const ma2PostFill = await page.evaluate(() => {
      const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const out = { radios: {}, selects: {} };
      const groupsSeen = new Set();
      document.querySelectorAll('input[type="radio"]').forEach((r) => {
        if (!isVis(r)) return;
        if (r.name === "ES_PDS_APP") return;
        const g = r.name;
        if (!out.radios[g]) out.radios[g] = [];
        out.radios[g].push({ value: r.value, checked: r.checked });
        groupsSeen.add(g);
      });
      ["ks", "js"].forEach((name) => {
        const s = document.querySelector(`select[name="${name}"]`);
        if (!s) return;
        const opts = [];
        for (let i = 0; i < s.options.length; i++) {
          opts.push({ value: s.options[i].value, text: (s.options[i].text || "").substring(0, 60) });
        }
        out.selects[name] = {
          value: s.value,
          selectedIndex: s.selectedIndex,
          selectedText: s.options[s.selectedIndex]?.text || "",
          optionCount: s.options.length,
          options: opts,
        };
      });
      return out;
    });

    writeMarker("P5_SEWA_MA2_INVENTORY",
      `pos=${JSON.stringify(ma2PostFill.radios["pos"] || null)}\n` +
      `radio-kt=${JSON.stringify(ma2PostFill.radios["radio-kt"] || null)}\n` +
      `ks=${JSON.stringify(ma2PostFill.selects["ks"] || null)}\n` +
      `js=${JSON.stringify(ma2PostFill.selects["js"] || null)}\n` +
      `jsCascadeOk=${jsCascade.ok}\n` +
      `jsCascadeOptionCount=${jsCascade.optionCount ?? 0}\n` +
      `jsChoice=${jsChoice ? JSON.stringify(jsChoice) : "(none)"}`);
    await shot(page, "p5_sewa_03b_ma2_filled");

    // ── Phase 4: Save MA — rich evidence, continue-on-stall ─────────
    console.log("\nPhase 4: Save MA (btn-ma-submit) — rich evidence capture");
    const preSaveUrl = page.url();
    const preSaveSignals = await captureAlertsAndModals(page);
    const preSaveButtons = await captureActionButtons(page);
    console.log(`  preSave url=${preSaveUrl}`);
    console.log(`  preSave invalids=${preSaveSignals.invalids.length} alerts=${preSaveSignals.alerts.length} modals=${preSaveSignals.modals.length}`);
    await shot(page, "p5_sewa_04a_pre_save");

    let clickErr = null;
    try {
      await page.locator("button#btn-ma-submit").click({ timeout: 10_000 });
      console.log(`  Save clicked`);
    } catch (e) {
      clickErr = e.message;
      console.log(`  Save click ERR: ${e.message}`);
    }

    // Poll up to 8s for URL change, alert, modal, or invalid-class flip.
    const pollDeadline = Date.now() + 8000;
    let observed = { urlChanged: false, alertAppeared: false, modalAppeared: false, invalidsChanged: false };
    while (Date.now() < pollDeadline) {
      await page.waitForTimeout(400);
      const curUrl = page.url();
      if (curUrl !== preSaveUrl) { observed.urlChanged = true; break; }
      const cur = await captureAlertsAndModals(page);
      if (cur.alerts.length > preSaveSignals.alerts.length) observed.alertAppeared = true;
      if (cur.modals.length > preSaveSignals.modals.length) observed.modalAppeared = true;
      if (cur.invalids.length !== preSaveSignals.invalids.length) observed.invalidsChanged = true;
      if (observed.alertAppeared || observed.modalAppeared || observed.invalidsChanged) break;
    }
    const postSaveUrl = page.url();
    const postSaveSignals = await captureAlertsAndModals(page);
    const postSaveButtons = await captureActionButtons(page);
    onP5 = postSaveUrl.includes("/formv2/p5/");
    console.log(`  postSave url=${postSaveUrl} (advanced to /formv2/p5/=${onP5})`);
    console.log(`  postSave invalids=${postSaveSignals.invalids.length} alerts=${postSaveSignals.alerts.length} modals=${postSaveSignals.modals.length}`);
    await shot(page, "p5_sewa_04b_post_save");

    const diff = invalidsDiff(preSaveSignals, postSaveSignals);
    const fmtInvalids = (list) => list.length
      ? list.map((f) => `${f.tag}:${f.name || f.id}(vis=${f.visible})`).join("; ")
      : "(none)";
    const fmtAlerts = (list) => list.length
      ? list.map((a) => `[${a.className.substring(0, 40)}] "${a.text.substring(0, 160)}"`).join("\n  ")
      : "(none)";
    const fmtModals = (list) => list.length
      ? list.map((m) => `title="${m.title}" body="${m.body.substring(0, 140)}" buttons=[${m.buttons.join(",")}]`).join("\n  ")
      : "(none)";
    const fmtButtons = (list) => list.length
      ? list.map((b) => `"${b.text}"${b.id ? `#${b.id}` : ""}${b.disabled ? " DIS" : ""}`).join("; ")
      : "(none)";

    writeMarker("P5_SEWA_MA_SAVE_GATE_EVIDENCE",
      `clickErr=${clickErr ?? "(none)"}\n` +
      `preSaveUrl=${preSaveUrl}\n` +
      `postSaveUrl=${postSaveUrl}\n` +
      `urlChanged=${observed.urlChanged}\n` +
      `advancedToP5=${onP5}\n` +
      `observedDuringPoll=${JSON.stringify(observed)}\n` +
      `\n== PRE-SAVE ==\n` +
      `invalids(${preSaveSignals.invalids.length})=${fmtInvalids(preSaveSignals.invalids)}\n` +
      `alerts(${preSaveSignals.alerts.length})=\n  ${fmtAlerts(preSaveSignals.alerts)}\n` +
      `modals(${preSaveSignals.modals.length})=\n  ${fmtModals(preSaveSignals.modals)}\n` +
      `buttons(${preSaveButtons.length})=${fmtButtons(preSaveButtons)}\n` +
      `\n== POST-SAVE ==\n` +
      `invalids(${postSaveSignals.invalids.length})=${fmtInvalids(postSaveSignals.invalids)}\n` +
      `alerts(${postSaveSignals.alerts.length})=\n  ${fmtAlerts(postSaveSignals.alerts)}\n` +
      `modals(${postSaveSignals.modals.length})=\n  ${fmtModals(postSaveSignals.modals)}\n` +
      `buttons(${postSaveButtons.length})=${fmtButtons(postSaveButtons)}\n` +
      `\n== DIFF ==\n` +
      `invalidsAdded=${diff.added.length ? diff.added.join(", ") : "(none)"}\n` +
      `invalidsRemoved=${diff.removed.length ? diff.removed.join(", ") : "(none)"}\n` +
      `invalidsUnchanged=${diff.common.length ? diff.common.join(", ") : "(none)"}`);

    if (!onP5) {
      console.log(`  MA save did not advance to /formv2/p5/ — continuing anyway with defensive phases.`);
    }

    // ── Phase 5: Baseline capture (defensive) ─────────────────────
    console.log("\nPhase 5: Baseline capture");
    if (!onP5) {
      console.log(`  UNREACHABLE: baseline capture expects /formv2/p5/, but we are at ${page.url()}.`);
      writeMarker("P5_SEWA_BASELINE_UNREACHABLE", `reason=not_on_p5\nactualUrl=${page.url()}`);
    } else {
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
        `postMaUrl=${page.url()}\n` +
        `suratcara="${p5Baseline.suratcaraText}" val="${p5Baseline.suratcaraVal}" optCount=${p5Baseline.suratcaraOptionCount}\n` +
        `suratcara_first10=${p5Baseline.suratcaraOptions.slice(0, 10).map((o) => `${o.v}="${o.t}"`).join("; ")}\n` +
        `pds_ps="${p5Baseline.pdsPsText}" val="${p5Baseline.pdsPsVal}"\n` +
        `profile_desc="${p5Baseline.profileDescVal}"\n` +
        `tabs=${p5Tabs.map((t) => `${t.active ? "*" : ""}${t.disabled ? "!" : ""}"${t.text}"`).join(", ")}`);
    }

    // ── Phase 6: Walk each tab (defensive, read-only) ──────────────
    console.log("\nPhase 6: Walk tabs (read-only)");
    const tabTargets = [
      { key: "bahagian_a", match: /bahagian\s*a/i },
      { key: "bahagian_b", match: /bahagian\s*b/i },
      { key: "lampiran",   match: /lampiran/i },
      { key: "perakuan",   match: /perakuan|akuan/i },
      { key: "rumusan",    match: /rumusan|pengiraan/i },
    ];
    const tabWalk = {};
    if (!onP5) {
      console.log(`  UNREACHABLE: tab walk requires /formv2/p5/, at ${page.url()}.`);
      writeMarker("P5_SEWA_TAB_WALK_UNREACHABLE", `reason=not_on_p5\nactualUrl=${page.url()}`);
    } else {
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

        const inv = await page.evaluate(() => {
          const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
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

        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(400);
      }

      writeMarker("P5_SEWA_TAB_WALK",
        Object.entries(tabWalk).map(([k, v]) =>
          `[${k}] clickOk=${v.clickResult.ok}${v.clickResult.reason ? ` (${v.clickResult.reason})` : ""} activeTab="${v.activeTab}" panelVisible=${v.panelVisible} inputs=${v.inputCount} selects=${v.selectCount} fileInputs=${v.fileInputs.length} checkboxes=${v.checkboxes.length}\n` +
          `  fileInputs: ${v.fileInputs.map((f) => `${f.name || f.id} label="${f.label}" req=${f.required}`).join("; ") || "(none)"}\n` +
          `  checkboxes: ${v.checkboxes.map((c) => `${c.name || c.id} label="${c.label}" req=${c.required}`).join("; ") || "(none)"}\n` +
          `  alerts: ${v.alerts.map((a) => `"${a.text.substring(0, 80)}"`).join("; ") || "(none)"}\n` +
          `  modals: ${v.modals.map((m) => `"${m.title}" buttons=[${m.buttons.join(",")}]`).join("; ") || "(none)"}\n`,
        ).join("\n"));
    }

    // ── Phase 7: Attempt Hantar (defensive, dismiss-guard active) ────
    console.log("\nPhase 7: Attempt Hantar (dismiss-guard active)");
    if (!onP5) {
      console.log(`  UNREACHABLE: Hantar probe requires /formv2/p5/, at ${page.url()}.`);
      writeMarker("P5_SEWA_HANTAR_UNREACHABLE", `reason=not_on_p5\nactualUrl=${page.url()}`);
    } else {
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
        console.log("  NO ENABLED Hantar button found → write marker, skip.");
        writeMarker("P5_SEWA_HANTAR_BTN_NOT_FOUND",
          `activeTab="${preState.activeTab}"\nurl=${preState.url}\n` +
          `candidates=${preState.hantarButtons.map((b) => `"${b.text}" id=${b.id} dis=${b.disabled}`).join("; ")}`);
      } else {
        console.log(`  Clicking Hantar: "${hantarBtn.text}" id="${hantarBtn.id}" (dismiss-guard active)`);
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
          document.querySelector(".nav-tabs li.active a")?.textContent?.trim() || "");
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
        for (const m of postMsgs.modals) console.log(`    title="${m.title}" body="${m.body.substring(0, 180)}" buttons=[${m.buttons.join(",")}]`);
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

        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(500);
      }
    }

    // ── Phase 7b: Gate-chain walk — resolve pds_suratcara=1101, re-probe ──
    //
    // Goal (narrowly scoped): take the proven first Hantar gate
    // ("Sila pilih Nama Surat Cara"), resolve only that one gate, and
    // surface the NEXT first-error gate. No deeper speculative filling.
    //
    // Hard-stop discipline preserved:
    //   - dismiss-guard still dismisses any native confirm/prompt
    //   - if Hantar response stops looking like a validation modal,
    //     we do NOT click further — we capture and stop
    //   - we change exactly one field (pds_suratcara); the remaining
    //     :invalid set (15 fields) guarantees Hantar cannot really submit
    console.log("\nPhase 7b: Resolve pds_suratcara=1101, re-trigger Hantar (gate 2)");
    if (!onP5) {
      console.log(`  UNREACHABLE: gate-chain walk requires /formv2/p5/, at ${page.url()}.`);
      writeMarker("P5_SEWA_GATE_CHAIN_UNREACHABLE", `reason=not_on_p5\nactualUrl=${page.url()}`);
    } else {
      // Step 1: Close any bootbox/modal left open from Phase 7.
      const modalClosed = await page.evaluate(() => {
        const out = { closedCount: 0, clicks: [] };
        const modals = document.querySelectorAll(".modal.show, .modal.in, .bootbox");
        for (const m of modals) {
          const buttons = m.querySelectorAll("button, input[type='button'], a.btn");
          for (const b of buttons) {
            const txt = (b.textContent || b.value || "").trim();
            if (/^(ok|tutup|close|batal|cancel)$/i.test(txt)) {
              b.click();
              out.clicks.push(txt);
              out.closedCount++;
              break;
            }
          }
        }
        return out;
      });
      console.log(`  dismiss-pre-state modal: ${JSON.stringify(modalClosed)}`);
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(1500);

      // Step 1b: Activate the Maklumat Am tab before interacting with
      // pds_suratcara. Phase 6's tab walk leaves the active pane set to
      // whatever the last walk-step was (Rumusan Pengiraan). pds_suratcara
      // lives on the Maklumat Am pane — selectOption will timeout on a
      // hidden select unless we switch back first.
      const maTabActivation = await page.evaluate(() => {
        const anchors = document.querySelectorAll(".nav-tabs a, .nav-tabs li a, [role='tab']");
        for (const a of anchors) {
          const txt = (a.textContent || "").trim();
          if (/^maklumat\s*am$/i.test(txt)) {
            const r = a.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              a.click();
              return { ok: true, text: txt, href: a.getAttribute("href") || "" };
            }
            return { ok: false, reason: "not_visible", text: txt };
          }
        }
        return { ok: false, reason: "not_found" };
      });
      console.log(`  activate Maklumat Am tab: ${JSON.stringify(maTabActivation)}`);
      await page.waitForTimeout(1500);

      // Step 2: Capture pre-select state (pds_suratcara and pds_jenis cascade
      // target).
      const preSelect = await page.evaluate(() => {
        const sc = document.getElementById("pds_suratcara");
        const jenis = document.getElementById("pds_jenis");
        const scOpts = sc ? Array.from(sc.options).map((o) => ({ v: o.value, t: (o.text || "").substring(0, 60) })) : [];
        const jenisOpts = jenis ? Array.from(jenis.options).map((o) => ({ v: o.value, t: (o.text || "").substring(0, 60) })) : [];
        const invalidsAll = [];
        document.querySelectorAll("input:invalid, select:invalid, textarea:invalid").forEach((el) => {
          const r = el.getBoundingClientRect();
          invalidsAll.push({ tag: el.tagName.toLowerCase(), name: el.name || "", id: el.id || "", visible: r.width > 0 && r.height > 0 });
        });
        return {
          suratcaraFound: !!sc,
          suratcaraVal: sc?.value ?? "",
          suratcaraSelectedText: sc?.options[sc.selectedIndex]?.text ?? "",
          suratcaraOptionCount: sc?.options?.length ?? 0,
          suratcaraOptions: scOpts,
          jenisFound: !!jenis,
          jenisVal: jenis?.value ?? "",
          jenisOptionCount: jenis?.options?.length ?? 0,
          jenisOptions: jenisOpts,
          invalidCount: invalidsAll.length,
          invalids: invalidsAll,
        };
      });
      console.log(`  pre-select pds_suratcara found=${preSelect.suratcaraFound} val="${preSelect.suratcaraVal}" opts=${preSelect.suratcaraOptionCount}`);
      console.log(`  pre-select pds_jenis found=${preSelect.jenisFound} val="${preSelect.jenisVal}" opts=${preSelect.jenisOptionCount}`);
      console.log(`  pre-select :invalid count=${preSelect.invalidCount}`);

      // Step 3: Select pds_suratcara = 1101 (Perjanjian Sewa) via native Playwright.
      let selectErr = null;
      if (preSelect.suratcaraFound) {
        try {
          await page.locator('#pds_suratcara').selectOption({ value: "1101" });
          console.log(`  pds_suratcara.selectOption("1101") OK`);
        } catch (e) {
          selectErr = e.message;
          console.log(`  pds_suratcara.selectOption ERR: ${e.message}`);
        }
      } else {
        selectErr = "pds_suratcara element not found";
        console.log(`  ABORT step 3: ${selectErr}`);
      }
      // Allow cascade time to settle.
      await page.waitForTimeout(3000);

      // Step 4: Capture cascade — jenis options, invalid-set diff, any new
      // visible field groups.
      const postSelect = await page.evaluate(() => {
        const sc = document.getElementById("pds_suratcara");
        const jenis = document.getElementById("pds_jenis");
        const jenisOpts = jenis ? Array.from(jenis.options).map((o) => ({ v: o.value, t: (o.text || "").substring(0, 60) })) : [];
        const invalidsAll = [];
        document.querySelectorAll("input:invalid, select:invalid, textarea:invalid").forEach((el) => {
          const r = el.getBoundingClientRect();
          invalidsAll.push({ tag: el.tagName.toLowerCase(), name: el.name || "", id: el.id || "", visible: r.width > 0 && r.height > 0 });
        });
        return {
          suratcaraVal: sc?.value ?? "",
          suratcaraText: sc?.options[sc.selectedIndex]?.text ?? "",
          jenisVal: jenis?.value ?? "",
          jenisOptionCount: jenis?.options?.length ?? 0,
          jenisOptions: jenisOpts,
          invalidCount: invalidsAll.length,
          invalids: invalidsAll,
        };
      });
      console.log(`  post-select pds_suratcara val="${postSelect.suratcaraVal}" text="${postSelect.suratcaraText}"`);
      console.log(`  post-select pds_jenis val="${postSelect.jenisVal}" opts=${postSelect.jenisOptionCount}`);
      for (const o of postSelect.jenisOptions.slice(0, 15)) console.log(`    jenis: ${o.v}="${o.t}"`);
      console.log(`  post-select :invalid count=${postSelect.invalidCount}`);

      const preInvalidKeys = new Set(preSelect.invalids.map((i) => i.name || i.id));
      const postInvalidKeys = new Set(postSelect.invalids.map((i) => i.name || i.id));
      const invalidsRemovedByCascade = [...preInvalidKeys].filter((k) => !postInvalidKeys.has(k));
      const invalidsAddedByCascade = [...postInvalidKeys].filter((k) => !preInvalidKeys.has(k));
      console.log(`  cascade removed from :invalid: ${invalidsRemovedByCascade.join(", ") || "(none)"}`);
      console.log(`  cascade added to :invalid:   ${invalidsAddedByCascade.join(", ") || "(none)"}`);

      writeMarker("P5_SEWA_SURATCARA_CASCADE",
        `selectErr=${selectErr ?? "(none)"}\n` +
        `pre_suratcaraVal="${preSelect.suratcaraVal}"  post_suratcaraVal="${postSelect.suratcaraVal}"  post_suratcaraText="${postSelect.suratcaraText}"\n` +
        `pre_jenis_optCount=${preSelect.jenisOptionCount}  post_jenis_optCount=${postSelect.jenisOptionCount}\n` +
        `pre_jenis_val="${preSelect.jenisVal}"  post_jenis_val="${postSelect.jenisVal}"\n` +
        `post_jenis_options=\n${postSelect.jenisOptions.map((o) => `  ${o.v}="${o.t}"`).join("\n") || "  (none)"}\n` +
        `pre_invalidCount=${preSelect.invalidCount}  post_invalidCount=${postSelect.invalidCount}\n` +
        `invalids_pre=${[...preInvalidKeys].join(", ") || "(none)"}\n` +
        `invalids_post=${[...postInvalidKeys].join(", ") || "(none)"}\n` +
        `invalids_removed_by_cascade=${invalidsRemovedByCascade.join(", ") || "(none)"}\n` +
        `invalids_added_by_cascade=${invalidsAddedByCascade.join(", ") || "(none)"}`);
      await shot(page, "p5_sewa_07b_after_suratcara");

      // Step 5: Re-trigger Hantar (dismiss-guard still active).
      console.log("\n  Re-clicking Hantar to surface next gate...");
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);

      const hantar2Pre = await page.evaluate(() => {
        const btns = [];
        document.querySelectorAll("button, input[type='submit'], input[type='button'], a.btn").forEach((el) => {
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
        return { buttons: btns, url: window.location.href, activeTab: active };
      });
      console.log(`  gate-2 pre state: activeTab="${hantar2Pre.activeTab}" url=${hantar2Pre.url} candidates=${hantar2Pre.buttons.length}`);
      for (const b of hantar2Pre.buttons) {
        console.log(`    "${b.text}" id="${b.id}" dis=${b.disabled}`);
      }

      const hantar2Btn = hantar2Pre.buttons.find((b) => /^hantar$/i.test(b.text) && !b.disabled)
                      || hantar2Pre.buttons.find((b) => !b.disabled);

      if (!hantar2Btn) {
        console.log("  No enabled Hantar button on gate-2 re-probe — stop.");
        writeMarker("P5_SEWA_HANTAR_GATE2_BTN_NOT_FOUND",
          `url=${hantar2Pre.url}\nactiveTab="${hantar2Pre.activeTab}"\n` +
          `candidates=${hantar2Pre.buttons.map((b) => `"${b.text}" id=${b.id} dis=${b.disabled}`).join("; ") || "(none)"}`);
      } else {
        const preClickDialogs2 = dialogLog.length;
        const preHantar2Url = page.url();

        try {
          if (hantar2Btn.id && /^[A-Za-z][\w-]*$/.test(hantar2Btn.id)) {
            await page.locator(`#${hantar2Btn.id}`).click({ timeout: 8000 });
          } else {
            await page.mouse.click(
              hantar2Btn.bbox.x + hantar2Btn.bbox.w / 2,
              hantar2Btn.bbox.y + hantar2Btn.bbox.h / 2,
            );
          }
          console.log(`  gate-2 Hantar clicked: "${hantar2Btn.text}" id="${hantar2Btn.id}"`);
        } catch (e) {
          console.log(`    click error: ${e.message}`);
        }
        await page.waitForTimeout(8000);

        const postHantar2Url = page.url();
        const postHantar2Active = await page.evaluate(() =>
          document.querySelector(".nav-tabs li.active a")?.textContent?.trim() || "");
        const postHantar2Msgs = await captureAlertsAndModals(page);
        const postHantar2Buttons = await captureActionButtons(page);
        await shot(page, "p5_sewa_07c_post_hantar_gate2");
        const newDialogs2 = dialogLog.slice(preClickDialogs2);

        // Post-hoc safety assertion: URL must not have changed to a
        // /sijil/ or /pembayaran/ path (indicates real submission). If
        // that ever happens, mark loudly and stop.
        const urlIsSubmission = /\/(sijil|pembayaran|payment|certificate|acknowledg)/i.test(postHantar2Url);
        if (urlIsSubmission) {
          console.log(`  !!! UNEXPECTED URL SHIFT: ${postHantar2Url} — marking and stopping gate-chain.`);
          writeMarker("P5_SEWA_HANTAR_GATE2_UNEXPECTED_URL",
            `preUrl=${preHantar2Url}\npostUrl=${postHantar2Url}\nThis may indicate a real submission path — HALT further probing.`);
        }

        console.log(`  post-gate-2 URL: ${postHantar2Url} (changed=${postHantar2Url !== preHantar2Url})`);
        console.log(`  post-gate-2 activeTab: "${postHantar2Active}"`);
        console.log(`  dialogs in gate-2 click: ${newDialogs2.length}`);
        for (const d of newDialogs2) console.log(`    ${d.type} ${d.decision}: "${d.message.substring(0, 200)}"`);
        console.log(`  modals: ${postHantar2Msgs.modals.length}`);
        for (const m of postHantar2Msgs.modals) console.log(`    title="${m.title}" body="${m.body.substring(0, 200)}" buttons=[${m.buttons.join(",")}]`);
        console.log(`  alerts: ${postHantar2Msgs.alerts.length}`);
        for (const a of postHantar2Msgs.alerts) console.log(`    "${a.text.substring(0, 200)}" class="${a.className.substring(0, 30)}"`);
        console.log(`  invalids: ${postHantar2Msgs.invalids.length}`);
        for (const f of postHantar2Msgs.invalids) console.log(`    ${f.tag} ${f.name || f.id} vis=${f.visible}`);

        writeMarker("P5_SEWA_HANTAR_GATE2_BOUNDARY",
          `preHantar2Url=${preHantar2Url}\npostHantar2Url=${postHantar2Url}\nurlChanged=${postHantar2Url !== preHantar2Url}\n` +
          `urlSuspectedSubmission=${urlIsSubmission}\n` +
          `preActiveTab="${hantar2Pre.activeTab}"\npostActiveTab="${postHantar2Active}"\n` +
          `dialogsCaptured=${newDialogs2.length}\n` +
          `${newDialogs2.map((d) => `  ${d.type} ${d.decision}: "${d.message.substring(0, 300)}"`).join("\n")}\n` +
          `modals=${postHantar2Msgs.modals.length}\n` +
          `${postHantar2Msgs.modals.map((m) => `  title="${m.title}" body="${m.body.substring(0, 300)}" buttons=[${m.buttons.join(",")}]`).join("\n")}\n` +
          `alerts=${postHantar2Msgs.alerts.length}\n` +
          `${postHantar2Msgs.alerts.map((a) => `  "${a.text.substring(0, 300)}" class="${a.className.substring(0, 40)}"`).join("\n")}\n` +
          `invalidFields(${postHantar2Msgs.invalids.length})=${postHantar2Msgs.invalids.map((f) => f.name || f.id).join(", ")}\n` +
          `postButtons=${postHantar2Buttons.map((b) => `"${b.text}" dis=${b.disabled}`).join("; ")}`);

        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(500);
      }
    }

    // ── Phase 8: Final summary ────────────────────────────────────
    console.log("\nPhase 8: Final summary");
    writeMarker("P5_SEWA_GATE_SUMMARY",
      `lane=sewa_pajakan\nranAt=${new Date().toISOString()}\nfinalUrl=${page.url()}\n` +
      `advancedToP5=${onP5}\ndialogsTotal=${dialogLog.length}\n` +
      `${dialogLog.map((d) => `  ${d.type} ${d.decision}: "${d.message.substring(0, 300)}"`).join("\n")}\n` +
      `NOTE: No Hantar confirm dialog was accepted. No final submission was performed.`);
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
