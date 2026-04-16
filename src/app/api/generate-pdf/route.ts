/**
 * POST /api/generate-pdf
 *
 * Receives serialized TenancyFormData as JSON, stores it in the
 * persistent token store (blob-storage-backed), launches Puppeteer to
 * visit the print page, and returns the generated PDF as a file download.
 *
 * Uses puppeteer-core with system Chrome — no bundled Chromium.
 *
 * File-based fields (NRIC images, inventory photos, uploaded files)
 * are NOT included — they cannot be serialized to JSON. The print page
 * shows textual placeholders with filenames for those items.
 *
 * Print URL construction:
 *   - If APP_BASE_URL is set, uses it as the base (e.g. "https://app.example.com")
 *   - Otherwise falls back to request headers (x-forwarded-proto + host)
 */

import { NextRequest } from "next/server";
import puppeteer from "puppeteer-core";
import { storeData, removeToken } from "../../../lib/token-store";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "../../../lib/rate-limiter";

/**
 * Force Node.js runtime. This route uses Puppeteer (child processes),
 * fs.accessSync (Chrome detection), and Buffer — none of which work
 * in Edge runtime.
 */
export const runtime = "nodejs";

/**
 * Resolve the Chrome / Chromium executable path.
 *
 * Priority:
 *  1. CHROME_EXECUTABLE_PATH env var (preferred), CHROME_PATH as fallback alias
 *  2. Platform-specific well-known paths (checked in order)
 *
 * Throws a descriptive error if nothing is found, so the 500 response
 * includes actionable guidance instead of a cryptic Puppeteer crash.
 */
function findChrome(): string {
  const fs = require("fs");

  // 1. Explicit env var override (CHROME_EXECUTABLE_PATH preferred, CHROME_PATH as alias)
  const envPath = process.env.CHROME_EXECUTABLE_PATH ?? process.env.CHROME_PATH;
  if (envPath) {
    try {
      fs.accessSync(envPath, fs.constants.X_OK);
    } catch {
      throw new Error(
        `CHROME_EXECUTABLE_PATH / CHROME_PATH is set to "${envPath}" but the file does not exist or is not executable.`,
      );
    }
    return envPath;
  }

  // 2. Platform-specific candidates (most common first)
  const candidates: string[] = [];

  switch (process.platform) {
    case "darwin":
      candidates.push(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
      );
      break;
    case "linux":
      candidates.push(
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
      );
      break;
    case "win32":
      candidates.push(
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      );
      break;
  }

  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      // not found — try next
    }
  }

  throw new Error(
    `Chrome/Chromium not found. Searched: ${candidates.join(", ") || "(no candidates for this platform)"}. ` +
      `Set the CHROME_EXECUTABLE_PATH environment variable to the full path of your Chrome or Chromium executable.`,
  );
}

/**
 * Resolve the base URL that Puppeteer uses to visit the print page.
 *
 * Priority:
 *  1. APP_BASE_URL env var — explicit override for deployments where
 *     request headers are unreliable (e.g. internal networking, containers)
 *  2. Request headers — x-forwarded-proto + host (standard for reverse proxies)
 *
 * Returns a base URL without trailing slash, e.g. "http://localhost:3000".
 * Throws if APP_BASE_URL is set but malformed.
 */
function resolvePrintBaseUrl(request: NextRequest): string {
  const envBase = process.env.APP_BASE_URL;

  if (envBase) {
    const trimmed = envBase.trim().replace(/\/+$/, "");
    if (!trimmed) {
      throw new Error("APP_BASE_URL is set but empty after trimming.");
    }

    // Validate it looks like a URL with protocol and host
    try {
      const parsed = new URL(trimmed);
      if (!parsed.protocol || !parsed.host) {
        throw new Error("Missing protocol or host.");
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `APP_BASE_URL is set to "${envBase}" but is not a valid URL: ${detail}`
      );
    }

    return trimmed;
  }

  // Fallback: derive from request headers
  const protocol = request.headers.get("x-forwarded-proto") ?? "http";
  const host = request.headers.get("host") ?? "localhost:3000";
  return `${protocol}://${host}`;
}

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rateCheck = checkRateLimit("generatePdf", clientIp, RATE_LIMITS.generatePdf);
  if (!rateCheck.allowed) {
    return Response.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateCheck.retryAfterSeconds) } }
    );
  }

  let token: string | null = null;

  try {
    const body = await request.json();

    // Store the form data and get a token
    token = await storeData(body.formData);

    // Determine the base URL for Puppeteer to visit
    const baseUrl = resolvePrintBaseUrl(request);
    const printUrl = `${baseUrl}/generate/print?token=${token}`;

    const browser = await puppeteer.launch({
      headless: true,
      executablePath: findChrome(),
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const page = await browser.newPage();

      // Navigate to the print page and wait for full render
      await page.goto(printUrl, { waitUntil: "networkidle0", timeout: 30_000 });

      // Generate PDF with A4 size and page numbering
      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "20mm", bottom: "25mm", left: "18mm", right: "18mm" },
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: `
          <div style="font-size:9px;color:#666;text-align:center;width:100%;">
            Page <span class="pageNumber"></span> / <span class="totalPages"></span>
          </div>
        `,
      });

      return new Response(Buffer.from(pdfBuffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="tenancy-agreement.pdf"',
        },
      });
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.error("PDF generation failed:", error);
    return new Response(
      JSON.stringify({ error: "PDF generation failed. Please try again." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  } finally {
    // Always clean up the token
    if (token) await removeToken(token);
  }
}
