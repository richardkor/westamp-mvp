"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// scripts/field-semantics-investigation.ts
var import_playwright = require("playwright");
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var ARTIFACT_DIR = "data/portal-probe-artifacts";
var PROFILE_DIR = "data/playwright-profile";
var lane = process.argv[2] || "penyeteman_am";
console.log(`
=== FIELD SEMANTICS INVESTIGATION: ${lane} ===
`);
function writeMarker(name, body) {
  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const ts = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(
      `${ARTIFACT_DIR}/${name}_${ts}.txt`,
      `${name}
${(/* @__PURE__ */ new Date()).toISOString()}
${body}
`
    );
  } catch {
  }
}
async function run() {
  const profilePath = path.resolve(PROFILE_DIR);
  const context = await import_playwright.chromium.launchPersistentContext(profilePath, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"]
  });
  const page = context.pages()[0] || await context.newPage();
  try {
    console.log("Navigating to application form...");
    await page.goto("https://stamps.hasil.gov.my/stamps/form/application", {
      timeout: 3e4,
      waitUntil: "domcontentloaded"
    });
    await page.waitForTimeout(3e3);
    const laneLabels = {
      sewa_pajakan: "Sewa / Pajakan",
      penyeteman_am: "Penyeteman Am"
    };
    const laneLabel = laneLabels[lane] || lane;
    console.log(`Selecting lane: "${laneLabel}"...`);
    await page.evaluate((label) => {
      const radios = document.querySelectorAll('input[type="radio"]');
      for (const r of radios) {
        const input = r;
        const lbl = input.labels?.[0]?.textContent?.trim() || input.parentElement?.textContent?.trim() || "";
        if (lbl === label) {
          input.click();
          return;
        }
      }
    }, laneLabel);
    await page.waitForTimeout(2e3);
    console.log("Filling Pejabat Setem = Sarawak...");
    await page.evaluate(() => {
      const sel = document.querySelector('select[name="CD_DUTISETEM_ID"]');
      if (sel) {
        for (let i = 0; i < sel.options.length; i++) {
          if (sel.options[i].text.includes("Sarawak")) {
            sel.selectedIndex = i;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
        }
      }
    });
    await page.waitForTimeout(1e3);
    console.log("Filling date = 01/Januari/2026...");
    await page.fill('input[name="tsd"]', "01");
    await page.waitForTimeout(500);
    const selectIndices = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll("select").forEach((sel, idx) => {
        const s = sel;
        const r = s.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        if (s.name === "CD_DUTISETEM_ID") return;
        if (s.options.length >= 12 && s.options.length <= 13) results.push(idx);
      });
      return results;
    });
    if (selectIndices.length > 0) {
      try {
        await page.locator("select").nth(selectIndices[0]).selectOption({ label: "Januari" });
      } catch {
      }
    }
    await page.waitForTimeout(1e3);
    console.log("Clicking Seterusnya...");
    const seterusnyaBtn = page.locator("button#btn-ma-submit");
    if (await seterusnyaBtn.isVisible({ timeout: 3e3 }).catch(() => false)) {
      await seterusnyaBtn.click();
    } else {
      await page.locator('button:has-text("Seterusnya")').first().click();
    }
    await page.waitForTimeout(5e3);
    const postSaveUrl = page.url();
    console.log(`Post-save URL: ${postSaveUrl}`);
    const ts1 = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/field_semantics_${lane}_${ts1}.png`, fullPage: true });
    const deepInventory = await page.evaluate(() => {
      const controls = [];
      const getRect = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return null;
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };
      const getParentChain = (el) => {
        const parts = [];
        let cur = el.parentElement;
        for (let i = 0; i < 3 && cur; i++) {
          const tag = cur.tagName.toLowerCase();
          const cls = (cur.className || "").toString().trim().split(/\s+/).slice(0, 2).join(".");
          parts.push(`${tag}${cls ? "." + cls : ""}`);
          cur = cur.parentElement;
        }
        return parts.join(" > ");
      };
      const getFormGroupContext = (el) => {
        let cur = el.parentElement;
        for (let i = 0; i < 6 && cur; i++) {
          const cls = (cur.className || "").toString().toLowerCase();
          if (cls.includes("form-group") || cls.includes("form-control") || cls.includes("input-group") || cls.includes("control-group") || cls.includes("field-group") || cls.includes("col-")) {
            const labelEls = cur.querySelectorAll("label, span.control-label, .field-label, strong, b");
            const texts = [];
            labelEls.forEach((l) => {
              const txt = (l.textContent || "").trim();
              const r = l.getBoundingClientRect();
              if (txt.length > 0 && txt.length < 100 && r.width > 0 && r.height > 0) {
                texts.push(txt.substring(0, 60));
              }
            });
            return {
              className: (cur.className || "").toString().substring(0, 80),
              text: texts.join(" | ")
            };
          }
          cur = cur.parentElement;
        }
        return { className: "", text: "" };
      };
      const getNearbyText = (el) => {
        const parts = [];
        const prev = el.previousElementSibling;
        if (prev) {
          const txt = (prev.textContent || "").trim();
          if (txt.length > 0 && txt.length < 80) parts.push(`prevSibling: "${txt.substring(0, 60)}"`);
        }
        return parts.join("; ");
      };
      const allControls = document.querySelectorAll("input, select, textarea, button[type='submit'], button[type='button']");
      allControls.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const input = el;
        const select = el;
        const tag = el.tagName.toLowerCase();
        const type = input.type || "";
        const isNavButton = tag === "button" && type === "button" && !(el.id || "").includes("submit") && !(el.id || "").includes("save") && !(el.className || "").toString().includes("btn-info") && !(el.className || "").toString().includes("btn-success") && !(el.className || "").toString().includes("btn-primary");
        const txt = (el.textContent || input.value || "").trim();
        const isActionButton = /simpan|hantar|submit|save|seterusnya/i.test(txt);
        if (tag === "button" && !isActionButton && isNavButton) return;
        let labelForText = "";
        if (input.id) {
          const labelFor = document.querySelector(`label[for="${input.id}"]`);
          if (labelFor) labelForText = (labelFor.textContent || "").trim().substring(0, 80);
        }
        let labelWrapping = "";
        if (el.closest("label")) {
          labelWrapping = (el.closest("label").textContent || "").trim().substring(0, 80);
        }
        const labelsList = [];
        if (input.labels) {
          input.labels.forEach((l) => {
            labelsList.push((l.textContent || "").trim().substring(0, 60));
          });
        }
        const formGroup = getFormGroupContext(el);
        const info = {
          controlType: `${tag}-${type || tag}`,
          tag,
          type,
          id: input.id || "",
          name: input.name || "",
          value: (input.value || "").substring(0, 60),
          readOnly: input.readOnly || false,
          disabled: input.disabled || false,
          hidden: input.hidden || type === "hidden",
          placeholder: (input.placeholder || "").substring(0, 40),
          labelForText,
          labelWrapping,
          labels: labelsList,
          formGroupClass: formGroup.className,
          formGroupText: formGroup.text,
          nearbyText: getNearbyText(el),
          parentChain: getParentChain(el),
          bbox: getRect(el)
        };
        if (tag === "select") {
          info.optionCount = select.options.length;
          const cur = select.options[select.selectedIndex];
          info.selectedText = (cur?.text || "").substring(0, 60);
          info.firstOptions = [];
          for (let i = 0; i < Math.min(8, select.options.length); i++) {
            info.firstOptions.push(`${select.options[i].value}="${select.options[i].text.substring(0, 40)}"`);
          }
        }
        if (tag === "button") {
          info.value = txt.substring(0, 40);
        }
        controls.push(info);
      });
      const tabs = [];
      document.querySelectorAll(".nav-tabs a, .nav-pills a, [role='tab']").forEach((a) => {
        const txt = (a.textContent || "").trim();
        const r = a.getBoundingClientRect();
        if (txt.length > 0 && r.width > 0 && r.height > 0) {
          tabs.push({
            text: txt.substring(0, 40),
            href: a.href || a.getAttribute("href") || "",
            active: a.classList.contains("active") || a.getAttribute("aria-selected") === "true"
          });
        }
      });
      const pageTitle = document.querySelector("h3, h4, .box-title, .content-header")?.textContent?.trim() || "";
      return { controls, tabs, pageTitle };
    });
    console.log(`
Page title: "${deepInventory.pageTitle}"`);
    console.log(`Tabs: ${deepInventory.tabs.map((t) => `"${t.text}"${t.active ? "*" : ""}`).join(", ")}`);
    console.log(`
Controls (${deepInventory.controls.length}):
`);
    const lines = [];
    for (const c of deepInventory.controls) {
      const line = [
        `[${c.controlType}]`,
        `id="${c.id}"`,
        `name="${c.name}"`,
        `value="${c.value}"`,
        c.readOnly ? "READONLY" : "",
        c.disabled ? "DISABLED" : "",
        c.hidden ? "HIDDEN" : "",
        c.placeholder ? `placeholder="${c.placeholder}"` : "",
        c.labelForText ? `label[for]="${c.labelForText}"` : "",
        c.labels.length > 0 ? `labels=[${c.labels.map((l) => `"${l}"`).join(",")}]` : "",
        c.formGroupText ? `formGroupText="${c.formGroupText}"` : "",
        c.nearbyText ? `nearby="${c.nearbyText}"` : "",
        c.tag === "select" ? `opts=${c.optionCount} selected="${c.selectedText}" first=[${(c.firstOptions || []).join(", ")}]` : "",
        `parentChain=${c.parentChain}`,
        c.bbox ? `bbox=${c.bbox.x},${c.bbox.y} ${c.bbox.w}x${c.bbox.h}` : ""
      ].filter(Boolean).join("  ");
      console.log(`  ${line}`);
      lines.push(line);
    }
    writeMarker(
      `FIELD_SEMANTICS_${lane.toUpperCase()}`,
      `url=${postSaveUrl}
pageTitle=${deepInventory.pageTitle}
tabs=${deepInventory.tabs.map((t) => `"${t.text}"${t.active ? "*" : ""}`).join(", ")}
controls:
${lines.join("\n")}`
    );
    console.log(`
=== FIELD SEMANTICS INVESTIGATION COMPLETE: ${lane} ===`);
    console.log(`URL: ${postSaveUrl}`);
    console.log(`NO VALUES CHANGED.`);
  } finally {
    await context.close();
  }
}
run().catch((err) => {
  console.error("Investigation failed:", err);
  process.exit(1);
});
