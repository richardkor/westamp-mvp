/**
 * MA2 Native-Fill Verification — Single-Purpose Probe
 *
 * Hypothesis: the prior p5 sewa_pajakan discovery run filled MA2 radios/
 * selects via raw DOM mutation (element.click() in page.evaluate, sel.value
 * assignment, manual dispatchEvent). Portal save still flagged pos/ks/
 * radio-kt as invalid. Suspected cause: raw DOM mutation does not propagate
 * to the portal's framework-bound model state.
 *
 * This probe fills each MA2 target using Playwright's native methods
 * (locator.check() / locator.selectOption()) — which dispatch proper
 * bubbling input/change events — and reads DOM state back (.checked,
 * .value, .selectedIndex, .classList, surrounding wrapper widgets) to
 * confirm whether:
 *   a) the DOM element reflects the intended value, and
 *   b) framework classes (has-error / is-invalid / etc.) clear off.
 *
 * Hard constraints:
 *   - One Seterusnya click (MA1 → reveal MA2). No second click.
 *   - No save. No advance to /formv2/p5/.
 *   - Read-only after each fill.
 *   - Any unexpected confirm/prompt dialog is dismissed.
 *
 * Output: data/portal-probe-artifacts/P5_SEWA_MA2_FILL_VERIFY_<ts>.txt
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

const TODAY = new Date();
const TEST_DATA = {
  stampOffice: "Sarawak",
  day: String(TODAY.getDate()).padStart(2, "0"),
  monthMs: [
    "Januari", "Februari", "Mac", "April", "Mei", "Jun",
    "Julai", "Ogos", "September", "Oktober", "November", "Disember",
  ][TODAY.getMonth()],
  year: String(TODAY.getFullYear()),
};

function ts() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function run() {
  const profilePath = path.resolve(PROFILE_DIR);
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const outFile = `${ARTIFACT_DIR}/P5_SEWA_MA2_FILL_VERIFY_${ts()}.txt`;
  const lines = [];
  const log = (s) => { console.log(s); lines.push(s); };
  const flush = () => { try { fs.writeFileSync(outFile, lines.join("\n") + "\n"); } catch {} };

  log(`P5_SEWA_MA2_FILL_VERIFY`);
  log(`ranAt=${new Date().toISOString()}`);
  log(`testData=${JSON.stringify(TEST_DATA)}`);
  log(``);

  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const page = context.pages()[0] || (await context.newPage());

  page.on("dialog", async (d) => {
    log(`[DIALOG ${d.type()}] "${(d.message() || "").substring(0, 200)}"`);
    if (d.type() === "confirm" || d.type() === "prompt") {
      await d.dismiss();
    } else {
      await d.accept();
    }
  });

  try {
    // ── Phase 1: navigate + wait-for-login ──────────────────────────
    log(`== Phase 1: navigate ==`);
    await page.goto("https://stamps.hasil.gov.my/stamps/form/application", {
      timeout: 60_000,
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(3000);
    let url = page.url();
    log(`urlAfterGoto=${url}`);

    if (!url.includes("/stamps/form/application")) {
      log(`NOT ON FORM — waiting up to 15 min for manual MyTax login in the Playwright Chrome window.`);
      flush();
      const deadline = Date.now() + 900_000;
      let lastRetry = 0;
      let retries = 0;
      while (Date.now() < deadline) {
        await page.waitForTimeout(2000);
        let cur;
        try { cur = page.url(); } catch { continue; }
        if (cur.includes("/stamps/form/application")) break;
        if (/mytax\.hasil\.gov\.my/.test(cur) && Date.now() - lastRetry > 20_000 && retries < 6) {
          retries++;
          lastRetry = Date.now();
          log(`[retry ${retries}] on MyTax (${cur}) — retry form goto...`);
          flush();
          try {
            await page.goto("https://stamps.hasil.gov.my/stamps/form/application", { timeout: 30_000, waitUntil: "domcontentloaded" });
            await page.waitForTimeout(2500);
          } catch (e) { log(`goto err: ${e.message}`); flush(); }
        }
      }
      if (!page.url().includes("/stamps/form/application")) {
        log(`GAVE UP waiting for login. finalUrl=${page.url()}`);
        flush();
        await context.close();
        process.exit(1);
      }
      await page.waitForTimeout(3000);
    }
    log(`formUrl=${page.url()}`);
    log(``);
    flush();

    // ── Phase 2: select Sewa / Pajakan ──────────────────────────────
    log(`== Phase 2: pick Sewa / Pajakan ==`);
    const laneOk = await page.evaluate(() => {
      for (const r of document.querySelectorAll('input[type="radio"]')) {
        const lbl = r.labels?.[0]?.textContent?.trim() || r.parentElement?.textContent?.trim() || "";
        if (lbl === "Sewa / Pajakan") {
          r.click();
          return { ok: true, value: r.value };
        }
      }
      return { ok: false };
    });
    log(`laneClick=${JSON.stringify(laneOk)}`);
    if (!laneOk.ok) {
      log(`LANE MISSING — bail.`);
      flush();
      await context.close();
      return;
    }
    await page.waitForTimeout(1500);
    log(``);

    // ── Phase 3: fill MA1 (Pejabat Setem + date) ────────────────────
    log(`== Phase 3: fill MA1 ==`);
    const pejabat = await page.evaluate((office) => {
      const sel = document.querySelector('select[name="CD_DUTISETEM_ID"]');
      if (!sel) return { ok: false, reason: "select_missing" };
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].text.includes(office)) {
          sel.selectedIndex = i;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          return { ok: true, text: sel.options[i].text, value: sel.value };
        }
      }
      return { ok: false, reason: "no_match" };
    }, TEST_DATA.stampOffice);
    log(`pejabatSetem=${JSON.stringify(pejabat)}`);
    await page.waitForTimeout(1200);

    try {
      await page.fill('input[name="tsd"]', TEST_DATA.day);
    } catch (e) { log(`tsd fill err: ${e.message}`); }
    await page.waitForTimeout(500);

    const dateSelInfo = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll("select").forEach((s, idx) => {
        const r = s.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        if (s.name === "CD_DUTISETEM_ID") return;
        out.push({ index: idx, name: s.name || "", optionCount: s.options.length });
      });
      return out;
    });
    for (const s of dateSelInfo) {
      try {
        if (s.optionCount > 100) {
          await page.locator("select").nth(s.index).selectOption({ label: TEST_DATA.year });
        } else if (s.optionCount >= 12 && s.optionCount <= 13) {
          await page.locator("select").nth(s.index).selectOption({ label: TEST_DATA.monthMs });
        }
      } catch (e) { log(`date sel[${s.index}] err: ${e.message}`); }
    }
    await page.waitForTimeout(1500);
    log(`ma1Filled=true`);
    log(``);
    flush();

    // ── Phase 4: close datepicker + click Seterusnya to reveal MA2 ──
    log(`== Phase 4: close datepicker, click Seterusnya (reveals MA2) ==`);
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);
    try { await page.locator("body").click({ position: { x: 10, y: 10 } }); } catch {}
    await page.waitForTimeout(500);

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
    log(`seterusnyaClick=${JSON.stringify(seterusnyaClicked)}`);
    await page.waitForTimeout(2500);
    log(``);
    flush();

    // ── Helpers for DOM state capture ───────────────────────────────
    async function readElementOrGroup(tag) {
      return await page.evaluate((t) => {
        const describe = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const wrap = (() => {
            let w = el.parentElement;
            for (let i = 0; i < 5 && w; i++) {
              if (w.classList && (
                w.classList.contains("bootstrap-select") ||
                w.classList.contains("selectpicker") ||
                w.classList.contains("select2") ||
                w.classList.contains("select2-container")
              )) {
                return { found: true, level: i, tag: w.tagName.toLowerCase(), className: String(w.className || "").substring(0, 140) };
              }
              w = w.parentElement;
            }
            return { found: false };
          })();
          const sib = el.nextElementSibling;
          const siblingWidget = sib && sib.classList && (
            sib.classList.contains("bootstrap-select") ||
            sib.classList.contains("dropdown") ||
            sib.classList.contains("btn-group") ||
            sib.classList.contains("select2")
          ) ? { tag: sib.tagName.toLowerCase(), className: String(sib.className || "").substring(0, 140) } : null;
          return {
            tag: el.tagName.toLowerCase(),
            name: el.name || "",
            id: el.id || "",
            type: el.type || "",
            value: el.value,
            checked: el.checked === undefined ? null : el.checked,
            selectedIndex: el.selectedIndex === undefined ? null : el.selectedIndex,
            selectedText: (el.options && el.selectedIndex != null) ? (el.options[el.selectedIndex]?.text || "") : null,
            required: el.required || el.getAttribute("aria-required") === "true",
            ariaInvalid: el.getAttribute("aria-invalid") || "",
            disabled: el.disabled,
            visible: r.width > 0 && r.height > 0,
            classList: Array.from(el.classList || []),
            parentClassList: el.parentElement ? Array.from(el.parentElement.classList || []) : [],
            wrapper: wrap,
            siblingWidget,
          };
        };
        if (t.radioGroup) {
          return Array.from(document.querySelectorAll(`input[type="radio"][name="${t.radioGroup}"]`)).map(describe);
        }
        if (t.sel) {
          return describe(document.querySelector(t.sel));
        }
        return null;
      }, tag);
    }

    // ── Phase 5: native fills + read-back ───────────────────────────
    log(`== Phase 5: native fills + DOM read-back ==`);

    // --- pos (radio, target value="0" "Surat Cara Utama (Prinsipal)")
    log(`--- pos ---`);
    log(`target=value="0" label="Surat Cara Utama (Prinsipal)"`);
    const posBefore = await readElementOrGroup({ radioGroup: "pos" });
    log(`before=${JSON.stringify(posBefore)}`);
    try {
      await page.locator('input[type="radio"][name="pos"][value="0"]').check({ timeout: 5000 });
      log(`action=page.locator('input[type="radio"][name="pos"][value="0"]').check() -> OK`);
    } catch (e) {
      log(`action=page.locator(...).check() -> ERR: ${e.message}`);
    }
    await page.waitForTimeout(500);
    const posAfter = await readElementOrGroup({ radioGroup: "pos" });
    log(`after=${JSON.stringify(posAfter)}`);
    log(``);
    flush();

    // --- radio-kt (radio, target value="1" "Swataksir") ---
    log(`--- radio-kt ---`);
    log(`target=value="1" label="Swataksir"`);
    const ktBefore = await readElementOrGroup({ radioGroup: "radio-kt" });
    log(`before=${JSON.stringify(ktBefore)}`);
    try {
      await page.locator('input[type="radio"][name="radio-kt"][value="1"]').check({ timeout: 5000 });
      log(`action=page.locator('input[type="radio"][name="radio-kt"][value="1"]').check() -> OK`);
    } catch (e) {
      log(`action=page.locator(...).check() -> ERR: ${e.message}`);
    }
    await page.waitForTimeout(500);
    const ktAfter = await readElementOrGroup({ radioGroup: "radio-kt" });
    log(`after=${JSON.stringify(ktAfter)}`);
    log(``);
    flush();

    // --- ks (select, target value="239" "Pajakan") ---
    log(`--- ks ---`);
    log(`target=value="239" text="Pajakan"`);
    const ksBefore = await readElementOrGroup({ sel: 'select[name="ks"]' });
    log(`before=${JSON.stringify(ksBefore)}`);
    try {
      await page.locator('select[name="ks"]').selectOption({ value: "239" });
      log(`action=page.locator('select[name="ks"]').selectOption({value:"239"}) -> OK`);
    } catch (e) {
      log(`action=page.locator(...).selectOption(...) -> ERR: ${e.message}`);
    }
    await page.waitForTimeout(1500); // let any cascade to js populate
    const ksAfter = await readElementOrGroup({ sel: 'select[name="ks"]' });
    log(`after=${JSON.stringify(ksAfter)}`);
    log(``);
    flush();

    // --- js (select) read-only peek post-cascade ---
    log(`--- js (read-only, post-ks cascade) ---`);
    const jsPeek = await page.evaluate(() => {
      const s = document.querySelector('select[name="js"]');
      if (!s) return { found: false };
      const opts = [];
      for (let i = 0; i < s.options.length; i++) {
        opts.push({ value: s.options[i].value, text: (s.options[i].text || "").substring(0, 60) });
      }
      return {
        found: true,
        disabled: s.disabled,
        optionCount: s.options.length,
        value: s.value,
        selectedIndex: s.selectedIndex,
        selectedText: s.options[s.selectedIndex]?.text || "",
        classList: Array.from(s.classList || []),
        parentClassList: s.parentElement ? Array.from(s.parentElement.classList || []) : [],
        options: opts,
      };
    });
    log(`jsPeek=${JSON.stringify(jsPeek)}`);
    log(``);
    flush();

    // ── Phase 6: validation signals pre-save (no save clicked) ──────
    log(`== Phase 6: current validation signals (no save click) ==`);
    const sigs = await page.evaluate(() => {
      const out = { invalidByCssPseudo: [], hasErrorWrappers: [], ariaInvalid: [] };
      document.querySelectorAll(":invalid").forEach((el) => {
        const r = el.getBoundingClientRect();
        out.invalidByCssPseudo.push({
          tag: el.tagName.toLowerCase(),
          name: el.name || "",
          id: el.id || "",
          visible: r.width > 0 && r.height > 0,
        });
      });
      document.querySelectorAll(".has-error, .is-invalid").forEach((el) => {
        out.hasErrorWrappers.push({
          tag: el.tagName.toLowerCase(),
          className: String(el.className || "").substring(0, 100),
        });
      });
      document.querySelectorAll('[aria-invalid="true"]').forEach((el) => {
        out.ariaInvalid.push({
          tag: el.tagName.toLowerCase(),
          name: el.name || "",
          id: el.id || "",
        });
      });
      return out;
    });
    log(`validationSignals=${JSON.stringify(sigs)}`);
    log(``);

    log(`== DONE. No save clicked. No advance attempted. ==`);
    flush();
    console.log(`\nMarker written: ${outFile}\n`);
  } catch (err) {
    log(`PROBE ERROR: ${err.stack || err.message}`);
    flush();
  } finally {
    await context.close();
  }
}

run().catch((err) => { console.error("Outer failure:", err); process.exit(1); });
