/**
 * WeStamp — Tenancy OCR Assist
 *
 * Extracts text from scanned/image-based tenancy PDFs using system-level OCR.
 * Used as a fallback when text-layer extraction yields no usable fields.
 *
 * Accepts a PDF Buffer (not a file path) — the caller obtains the buffer
 * through the blob storage abstraction, so this works in both local and
 * Supabase-backed storage modes.
 *
 * Requires system binaries:
 *   - gs (Ghostscript) — PDF to PNG conversion: brew install ghostscript
 *   - tesseract       — OCR:                   brew install tesseract
 *
 * Returns a structured result indicating whether OCR binaries are available
 * and, if so, the extracted text. This allows callers to distinguish
 * "OCR ran but found nothing" from "OCR binaries are missing."
 *
 * Tenancy-agreement documents only.
 * Returns raw OCR text — extraction patterns are applied by the caller.
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** OCR resolution in DPI — 200 DPI balances accuracy and processing time. */
const OCR_DENSITY_DPI = 200;

/**
 * Maximum pages to OCR per document.
 * Key tenancy terms (rent, duration) typically appear in the first few pages.
 */
const MAX_OCR_PAGES = 3;

/** Timeout per external process call in milliseconds. */
const PROCESS_TIMEOUT_MS = 45_000;

/**
 * Structured OCR result.
 * - ocrAvailable: false when gs or tesseract binaries are missing from the runtime
 * - ocrAvailable: true, text: "" when binaries exist but OCR produced nothing
 * - ocrAvailable: true, text: "..." when OCR succeeded
 */
export interface OcrResult {
  text: string;
  ocrAvailable: boolean;
}

/**
 * Attempt to extract text from a scanned/image-based PDF via OCR.
 *
 * @param pdfBuffer - PDF file contents as a Buffer (obtained from blob store)
 * @returns Structured OCR result with availability flag
 */
export async function ocrTenancyPdf(pdfBuffer: Buffer): Promise<OcrResult> {
  const unavailable: OcrResult = { text: "", ocrAvailable: false };

  try {
    // Write the PDF buffer to a temp file — Ghostscript requires a file path
    const tmpDir = os.tmpdir();
    const tmpPdfPath = path.join(tmpDir, `westamp-ocr-src-${Date.now()}.pdf`);
    fs.writeFileSync(tmpPdfPath, pdfBuffer);

    const convertResult = await convertPdfToImages(tmpPdfPath);

    // Clean up the temp PDF (best effort)
    try { fs.unlinkSync(tmpPdfPath); } catch { /* ignore */ }

    // If Ghostscript binary was missing, report OCR unavailable
    if (!convertResult.gsAvailable) {
      return unavailable;
    }

    if (convertResult.imagePaths.length === 0) {
      // gs ran but produced no images — likely empty/unreadable PDF
      return { text: "", ocrAvailable: true };
    }

    const textParts: string[] = [];
    let tesseractAvailable = true;

    for (const imgPath of convertResult.imagePaths) {
      const ocrResult = await ocrImageFile(imgPath);

      if (!ocrResult.tesseractAvailable) {
        tesseractAvailable = false;
      }
      if (ocrResult.text.trim()) {
        textParts.push(ocrResult.text);
      }

      // Clean up the temp image (best effort)
      try { fs.unlinkSync(imgPath); } catch { /* ignore */ }
    }

    // If tesseract was missing, report OCR unavailable
    if (!tesseractAvailable) {
      return unavailable;
    }

    return { text: textParts.join("\n\n"), ocrAvailable: true };
  } catch {
    // Unexpected failure — report as unavailable rather than silently empty
    return unavailable;
  }
}

// ─── Internal helpers ────────────────────────────────────────────────

interface ConvertResult {
  imagePaths: string[];
  gsAvailable: boolean;
}

/**
 * Convert the first MAX_OCR_PAGES pages of a PDF to PNG images using Ghostscript.
 * Returns paths to generated PNGs and whether gs was available.
 */
async function convertPdfToImages(absPath: string): Promise<ConvertResult> {
  const tmpDir = os.tmpdir();
  const baseName = path.basename(absPath, ".pdf");
  // Include timestamp to avoid collisions between concurrent extractions
  const pngPrefix = path.join(tmpDir, `westamp-ocr-${baseName}-${Date.now()}`);

  try {
    await execFileAsync(
      "gs",
      [
        "-dNOPAUSE",
        "-dBATCH",
        "-dSAFER",
        "-sDEVICE=png16m",
        `-r${OCR_DENSITY_DPI}`,
        `-dLastPage=${MAX_OCR_PAGES}`,
        `-sOutputFile=${pngPrefix}-%d.png`,
        absPath,
      ],
      { timeout: PROCESS_TIMEOUT_MS }
    );
  } catch (err) {
    // Detect binary-not-found specifically
    const errno = err as NodeJS.ErrnoException;
    if (errno.code === "ENOENT") {
      return { imagePaths: [], gsAvailable: false };
    }
    // gs exists but conversion failed for other reasons — still "available"
    return { imagePaths: [], gsAvailable: true };
  }

  // Collect whichever output pages were actually produced
  const imagePaths: string[] = [];
  for (let page = 1; page <= MAX_OCR_PAGES; page++) {
    const imgPath = `${pngPrefix}-${page}.png`;
    if (fs.existsSync(imgPath)) imagePaths.push(imgPath);
  }
  return { imagePaths, gsAvailable: true };
}

interface OcrImageResult {
  text: string;
  tesseractAvailable: boolean;
}

/**
 * Run Tesseract OCR on a single PNG image file.
 * Returns extracted text and whether tesseract was available.
 * Cleans up Tesseract's output .txt file after reading.
 */
async function ocrImageFile(imgPath: string): Promise<OcrImageResult> {
  // Tesseract writes output to <outputBase>.txt
  const outputBase = imgPath.replace(/\.png$/i, "-ocr-out");

  try {
    await execFileAsync(
      "tesseract",
      [imgPath, outputBase, "-l", "eng"],
      { timeout: PROCESS_TIMEOUT_MS }
    );
  } catch (err) {
    // Detect binary-not-found specifically
    const errno = err as NodeJS.ErrnoException;
    if (errno.code === "ENOENT") {
      return { text: "", tesseractAvailable: false };
    }
    // tesseract exists but OCR failed for other reasons
    return { text: "", tesseractAvailable: true };
  }

  const txtPath = `${outputBase}.txt`;
  if (!fs.existsSync(txtPath)) return { text: "", tesseractAvailable: true };

  try {
    const text = fs.readFileSync(txtPath, "utf-8");
    try { fs.unlinkSync(txtPath); } catch { /* ignore */ }
    return { text, tesseractAvailable: true };
  } catch {
    return { text: "", tesseractAvailable: true };
  }
}
