/**
 * Field Semantics Investigation Script
 *
 * Opens the post-save lane-specific form page and captures deep DOM
 * structure for every visible Maklumat Am control — label associations,
 * form-group containers, readOnly/disabled/hidden states, and surrounding
 * DOM context.
 *
 * Usage:
 *   npx tsx scripts/field-semantics-investigation.ts sewa_pajakan
 *   npx tsx scripts/field-semantics-investigation.ts penyeteman_am
 *
 * Does NOT change any values. Read-only investigation only.
 */

import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

const ARTIFACT_DIR = "data/portal-probe-artifacts";
const PROFILE_DIR = "data/playwright-profile";

const lane = process.argv[2] || "penyeteman_am";
console.log(`\n=== FIELD SEMANTICS INVESTIGATION: ${lane} ===\n`);

function writeMarker(name: string, body: string): void {
  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(
      `${ARTIFACT_DIR}/${name}_${ts}.txt`,
      `${name}\n${new Date().toISOString()}\n${body}\n`
    );
  } catch { /* best-effort */ }
}

async function run() {
  const profilePath = path.resolve(PROFILE_DIR);
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = context.pages()[0] || await context.newPage();

  try {
    // Navigate to application form and go through lane selection + save
    console.log("Navigating to application form...");
    await page.goto("https://stamps.hasil.gov.my/stamps/form/application", {
      timeout: 30000, waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(3000);

    // Select lane
    const laneLabels: Record<string, string> = {
      sewa_pajakan: "Sewa / Pajakan",
      penyeteman_am: "Penyeteman Am",
    };
    const laneLabel = laneLabels[lane] || lane;
    console.log(`Selecting lane: "${laneLabel}"...`);
    await page.evaluate((label: string) => {
      const radios = document.querySelectorAll('input[type="radio"]');
      for (const r of radios) {
        const input = r as HTMLInputElement;
        const lbl = input.labels?.[0]?.textContent?.trim() || input.parentElement?.textContent?.trim() || "";
        if (lbl === label) { input.click(); return; }
      }
    }, laneLabel);
    await page.waitForTimeout(2000);

    // Fill shared fields
    console.log("Filling Pejabat Setem = Sarawak...");
    await page.evaluate(() => {
      const sel = document.querySelector('select[name="CD_DUTISETEM_ID"]') as HTMLSelectElement | null;
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
    await page.waitForTimeout(1000);

    console.log("Filling date = 01/Januari/2026...");
    await page.fill('input[name="tsd"]', "01");
    await page.waitForTimeout(500);
    // Set month to Januari on the first month select
    const selectIndices = await page.evaluate(() => {
      const results: number[] = [];
      document.querySelectorAll("select").forEach((sel, idx) => {
        const s = sel as HTMLSelectElement;
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
      } catch { /* disabled selects will fail, that's ok */ }
    }
    await page.waitForTimeout(1000);

    // Click Seterusnya to save
    console.log("Clicking Seterusnya...");
    const seterusnyaBtn = page.locator('button#btn-ma-submit');
    if (await seterusnyaBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await seterusnyaBtn.click();
    } else {
      // Fallback: find by text
      await page.locator('button:has-text("Seterusnya")').first().click();
    }
    await page.waitForTimeout(5000);

    const postSaveUrl = page.url();
    console.log(`Post-save URL: ${postSaveUrl}`);

    // Screenshot: post-save page
    const ts1 = new Date().toISOString().replace(/[:.]/g, "-");
    await page.screenshot({ path: `${ARTIFACT_DIR}/field_semantics_${lane}_${ts1}.png`, fullPage: true });

    // ── Deep DOM investigation ──────────────────────────────────────
    // For every visible form control, capture its full context:
    // label associations, parent form-group, siblings, readOnly state, etc.
    const deepInventory = await page.evaluate(() => {
      interface ControlInfo {
        controlType: string;  // "input-text", "input-radio", "select", "textarea", "button"
        tag: string;
        type: string;
        id: string;
        name: string;
        value: string;
        readOnly: boolean;
        disabled: boolean;
        hidden: boolean;
        placeholder: string;
        // Label associations
        labelForText: string;   // label[for=id] text
        labelWrapping: string;  // parent label text (if input is inside a label)
        labels: string[];       // all associated labels via .labels property
        // Form group context
        formGroupClass: string; // nearest .form-group or .form-control parent class
        formGroupText: string;  // visible text in the form-group container
        // Nearby text (previous sibling, parent non-block text)
        nearbyText: string;
        // DOM path
        parentChain: string;    // tag.class chain up 3 levels
        // Select-specific
        optionCount?: number;
        selectedText?: string;
        firstOptions?: string[];
        // Visibility
        bbox: { x: number; y: number; w: number; h: number } | null;
      }

      const controls: ControlInfo[] = [];

      const getRect = (el: Element): { x: number; y: number; w: number; h: number } | null => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return null;
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };

      const getParentChain = (el: Element): string => {
        const parts: string[] = [];
        let cur: Element | null = el.parentElement;
        for (let i = 0; i < 3 && cur; i++) {
          const tag = cur.tagName.toLowerCase();
          const cls = (cur.className || "").toString().trim().split(/\s+/).slice(0, 2).join(".");
          parts.push(`${tag}${cls ? "." + cls : ""}`);
          cur = cur.parentElement;
        }
        return parts.join(" > ");
      };

      const getFormGroupContext = (el: Element): { className: string; text: string } => {
        let cur: Element | null = el.parentElement;
        for (let i = 0; i < 6 && cur; i++) {
          const cls = (cur.className || "").toString().toLowerCase();
          if (cls.includes("form-group") || cls.includes("form-control") ||
              cls.includes("input-group") || cls.includes("control-group") ||
              cls.includes("field-group") || cls.includes("col-")) {
            // Get visible text content of just labels/spans inside this group
            const labelEls = cur.querySelectorAll("label, span.control-label, .field-label, strong, b");
            const texts: string[] = [];
            labelEls.forEach((l) => {
              const txt = (l.textContent || "").trim();
              const r = l.getBoundingClientRect();
              if (txt.length > 0 && txt.length < 100 && r.width > 0 && r.height > 0) {
                texts.push(txt.substring(0, 60));
              }
            });
            return {
              className: (cur.className || "").toString().substring(0, 80),
              text: texts.join(" | "),
            };
          }
          cur = cur.parentElement;
        }
        return { className: "", text: "" };
      };

      const getNearbyText = (el: Element): string => {
        // Check previous sibling text, parent text that isn't from children
        const parts: string[] = [];
        const prev = el.previousElementSibling;
        if (prev) {
          const txt = (prev.textContent || "").trim();
          if (txt.length > 0 && txt.length < 80) parts.push(`prevSibling: "${txt.substring(0, 60)}"`);
        }
        return parts.join("; ");
      };

      // Process all inputs, selects, textareas, buttons
      const allControls = document.querySelectorAll("input, select, textarea, button[type='submit'], button[type='button']");
      allControls.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return; // not visible

        const input = el as HTMLInputElement;
        const select = el as HTMLSelectElement;
        const tag = el.tagName.toLowerCase();
        const type = input.type || "";

        // Skip nav buttons (small buttons in header/sidebar)
        const isNavButton = tag === "button" && type === "button" &&
          !(el.id || "").includes("submit") && !(el.id || "").includes("save") &&
          !(el.className || "").toString().includes("btn-info") &&
          !(el.className || "").toString().includes("btn-success") &&
          !(el.className || "").toString().includes("btn-primary");
        // Keep action buttons (Simpan, Hantar, Simpan Maklumat Am)
        const txt = (el.textContent || input.value || "").trim();
        const isActionButton = /simpan|hantar|submit|save|seterusnya/i.test(txt);
        if (tag === "button" && !isActionButton && isNavButton) return;

        // Label associations
        let labelForText = "";
        if (input.id) {
          const labelFor = document.querySelector(`label[for="${input.id}"]`);
          if (labelFor) labelForText = (labelFor.textContent || "").trim().substring(0, 80);
        }

        let labelWrapping = "";
        if (el.closest("label")) {
          labelWrapping = (el.closest("label")!.textContent || "").trim().substring(0, 80);
        }

        const labelsList: string[] = [];
        if (input.labels) {
          input.labels.forEach((l) => {
            labelsList.push((l.textContent || "").trim().substring(0, 60));
          });
        }

        const formGroup = getFormGroupContext(el);

        const info: ControlInfo = {
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
          bbox: getRect(el),
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

      // Also capture the tab structure
      const tabs: Array<{ text: string; href: string; active: boolean }> = [];
      document.querySelectorAll(".nav-tabs a, .nav-pills a, [role='tab']").forEach((a) => {
        const txt = (a.textContent || "").trim();
        const r = a.getBoundingClientRect();
        if (txt.length > 0 && r.width > 0 && r.height > 0) {
          tabs.push({
            text: txt.substring(0, 40),
            href: (a as HTMLAnchorElement).href || a.getAttribute("href") || "",
            active: a.classList.contains("active") || a.getAttribute("aria-selected") === "true",
          });
        }
      });

      const pageTitle = document.querySelector("h3, h4, .box-title, .content-header")?.textContent?.trim() || "";

      return { controls, tabs, pageTitle };
    });

    // ── Output ──────────────────────────────────────────────────────
    console.log(`\nPage title: "${deepInventory.pageTitle}"`);
    console.log(`Tabs: ${deepInventory.tabs.map((t) => `"${t.text}"${t.active ? "*" : ""}`).join(", ")}`);
    console.log(`\nControls (${deepInventory.controls.length}):\n`);

    const lines: string[] = [];
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
        c.bbox ? `bbox=${c.bbox.x},${c.bbox.y} ${c.bbox.w}x${c.bbox.h}` : "",
      ].filter(Boolean).join("  ");
      console.log(`  ${line}`);
      lines.push(line);
    }

    writeMarker(`FIELD_SEMANTICS_${lane.toUpperCase()}`,
      `url=${postSaveUrl}\n` +
      `pageTitle=${deepInventory.pageTitle}\n` +
      `tabs=${deepInventory.tabs.map((t) => `"${t.text}"${t.active ? "*" : ""}`).join(", ")}\n` +
      `controls:\n${lines.join("\n")}`
    );

    console.log(`\n=== FIELD SEMANTICS INVESTIGATION COMPLETE: ${lane} ===`);
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
