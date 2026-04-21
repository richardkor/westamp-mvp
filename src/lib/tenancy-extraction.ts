/**
 * WeStamp — Tenancy PDF Extraction Assist
 *
 * Extracts a narrow set of suggested tenancy details from an uploaded
 * PDF using text extraction + pattern matching.
 *
 * Designed for Malaysian residential tenancy agreements only.
 * All extracted values are SUGGESTIONS — unverified and potentially wrong.
 *
 * If extraction fails or finds nothing, returns a graceful empty result.
 * Never throws.
 *
 * Source PDF is obtained through the blob storage abstraction, so this
 * works in both local and Supabase-backed storage modes.
 *
 * For scanned/image-based PDFs where text-layer yields no fields, falls back
 * to OCR via system binaries (gs + tesseract) — see tenancy-ocr.ts.
 * If OCR binaries are unavailable in the runtime, the result reports
 * ocrUnavailable: true rather than silently returning empty.
 *
 * Does NOT implement AI/LLM-based extraction.
 * Does NOT auto-confirm extracted values.
 */

import {
  TenancyExtractionResult,
  ExtractedField,
  ExtractionConfidence,
} from "./stamping-types";
import { blobStore } from "./storage";
import { ocrTenancyPdf } from "./tenancy-ocr";

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Attempt to extract tenancy details from a stored PDF.
 *
 * Reads the PDF through the blob storage abstraction (works with both
 * local filesystem and Supabase Storage backends).
 *
 * @param storagePath - Storage key like "uploads/uuid.pdf"
 * @returns Extraction result with nullable suggested fields
 */
export async function extractTenancyDetails(
  storagePath: string
): Promise<TenancyExtractionResult> {
  const nullField: ExtractedField<never> = {
    value: null,
    confidence: null,
    source: null,
  };
  const emptyResult: TenancyExtractionResult = {
    extractedAt: new Date().toISOString(),
    dataSource: "pdf_parsed_unverified",
    suggestedMonthlyRent: nullField,
    suggestedLeaseMonths: nullField,
    suggestedAgreementDate: nullField,
    fieldsExtracted: 0,
    textLengthChars: 0,
  };

  try {
    // Read the PDF through the blob storage abstraction
    const fileBuffer = await blobStore.readBlob(storagePath);

    if (!fileBuffer) {
      return emptyResult;
    }

    // pdf-parse v1 is a CommonJS module. We intentionally require the
    // internal lib file rather than the package root: the package's
    // index.js runs a module-level debug block (`if (!module.parent)`)
    // which synchronously calls Fs.readFileSync("./test/data/05-versions-space.pdf").
    // In bundled/serverless runtimes (Next.js server build, Vercel) the
    // module has no parent and cwd does not contain that test fixture,
    // so the require throws ENOENT and the outer catch below silently
    // returns an empty result with textLengthChars=0. Requiring the
    // internal implementation bypasses the debug block entirely.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (buf: Buffer) => Promise<{ text: string }>;
    const parsed = await pdfParse(fileBuffer);

    const text = parsed.text ?? "";
    if (!text.trim()) {
      return { ...emptyResult, extractedAt: new Date().toISOString() };
    }

    // Run field-level extraction
    const rentResult = extractMonthlyRent(text);
    const leaseResult = extractLeaseMonths(text);
    const dateResult = extractAgreementDate(text);

    const suggestedMonthlyRent: ExtractedField<number> = rentResult
      ? { value: rentResult.value, confidence: rentResult.confidence, source: "pdf_text_pattern", matchNote: rentResult.matchNote }
      : nullField;
    const suggestedLeaseMonths: ExtractedField<number> = leaseResult
      ? { value: leaseResult.value, confidence: leaseResult.confidence, source: "pdf_text_pattern", matchNote: leaseResult.matchNote }
      : nullField;
    const suggestedAgreementDate: ExtractedField<string> = dateResult
      ? { value: dateResult.value, confidence: dateResult.confidence, source: "pdf_text_pattern", matchNote: dateResult.matchNote }
      : nullField;

    let fieldsExtracted = 0;
    if (suggestedMonthlyRent.value !== null) fieldsExtracted++;
    if (suggestedLeaseMonths.value !== null) fieldsExtracted++;
    if (suggestedAgreementDate.value !== null) fieldsExtracted++;

    // ── Text-layer succeeded: return without OCR ──────────────────────
    if (fieldsExtracted > 0) {
      return {
        extractedAt: new Date().toISOString(),
        dataSource: "pdf_parsed_unverified",
        suggestedMonthlyRent,
        suggestedLeaseMonths,
        suggestedAgreementDate,
        fieldsExtracted,
        textLengthChars: text.length,
        ocrAttempted: false,
      };
    }

    // ── Text-layer found nothing — attempt OCR fallback ───────────────
    // OCR is tried when zero useful fields were detected. This typically
    // indicates a scanned/image-based PDF with no usable text layer.
    const ocrResult = await ocrTenancyPdf(fileBuffer);

    if (!ocrResult.ocrAvailable) {
      // OCR binaries (gs/tesseract) are not available in this runtime
      return {
        ...emptyResult,
        extractedAt: new Date().toISOString(),
        textLengthChars: text.length,
        ocrAttempted: true,
        ocrUnavailable: true,
      };
    }

    if (!ocrResult.text.trim()) {
      // OCR ran but yielded nothing (page unreadable or no text detected)
      return {
        ...emptyResult,
        extractedAt: new Date().toISOString(),
        textLengthChars: text.length,
        ocrAttempted: true,
      };
    }

    const ocrText = ocrResult.text;

    // Run the same extraction patterns on OCR-produced text
    const ocrRentResult = extractMonthlyRent(ocrText);
    const ocrLeaseResult = extractLeaseMonths(ocrText);
    const ocrDateResult = extractAgreementDate(ocrText);

    // Mark OCR-derived fields with source "ocr_unverified"
    const ocrRent: ExtractedField<number> = ocrRentResult
      ? { value: ocrRentResult.value, confidence: ocrRentResult.confidence, source: "ocr_unverified", matchNote: ocrRentResult.matchNote }
      : nullField;
    const ocrLease: ExtractedField<number> = ocrLeaseResult
      ? { value: ocrLeaseResult.value, confidence: ocrLeaseResult.confidence, source: "ocr_unverified", matchNote: ocrLeaseResult.matchNote }
      : nullField;
    const ocrDate: ExtractedField<string> = ocrDateResult
      ? { value: ocrDateResult.value, confidence: ocrDateResult.confidence, source: "ocr_unverified", matchNote: ocrDateResult.matchNote }
      : nullField;

    let ocrFieldsExtracted = 0;
    if (ocrRent.value !== null) ocrFieldsExtracted++;
    if (ocrLease.value !== null) ocrFieldsExtracted++;
    if (ocrDate.value !== null) ocrFieldsExtracted++;

    return {
      extractedAt: new Date().toISOString(),
      dataSource: "ocr_unverified",
      suggestedMonthlyRent: ocrRent,
      suggestedLeaseMonths: ocrLease,
      suggestedAgreementDate: ocrDate,
      fieldsExtracted: ocrFieldsExtracted,
      textLengthChars: ocrText.length,
      ocrAttempted: true,
    };
  } catch {
    // Graceful failure — return empty result, never throw
    return emptyResult;
  }
}

// ─── Internal extraction result ─────────────────────────────────────

interface InternalExtraction<T> {
  value: T;
  confidence: ExtractionConfidence;
  matchNote: string;
}

// ─── Field Extractors ───────────────────────────────────────────────

/**
 * Attempt to find monthly rent in typical Malaysian tenancy phrasing.
 *
 * Confidence tiers:
 *   - high: explicit "monthly rent/rental of RM X" phrasing
 *   - medium: "RM X per month" or "rent of/at RM X" (less specific context)
 *   - low: "RINGGIT MALAYSIA ... (RM X)" (weakest context)
 */
function extractMonthlyRent(text: string): InternalExtraction<number> | null {
  const normalized = text.replace(/\s+/g, " ");

  // Each entry: [pattern, confidence, matchNote]
  const monthlyRentPatterns: [RegExp, ExtractionConfidence, string][] = [
    [/monthly\s+rent(?:al)?\s+(?:of\s+)?RM\s?([\d,]+(?:\.\d{1,2})?)/i, "high", "monthly rent/rental of RM X"],
    [/monthly\s+rent(?:al)?\s*(?::|is)\s*RM\s?([\d,]+(?:\.\d{1,2})?)/i, "high", "monthly rent/rental: RM X"],
    [/rent(?:al)?\s+(?:of\s+)?RM\s?([\d,]+(?:\.\d{1,2})?)\s+per\s+month/i, "high", "rent of RM X per month"],
    [/RM\s?([\d,]+(?:\.\d{1,2})?)\s+per\s+month/i, "medium", "RM X per month"],
    [/rent(?:al)?\s+(?:at|of)\s+(?:a\s+)?(?:monthly\s+)?(?:sum\s+of\s+)?RM\s?([\d,]+(?:\.\d{1,2})?)/i, "medium", "rent at/of RM X"],
    [/sum\s+of\s+RM\s?([\d,]+(?:\.\d{1,2})?)\s+(?:per|a|each)\s+month/i, "medium", "sum of RM X per month"],
    [/RINGGIT\s+MALAYSIA[^(]*\(RM\s?([\d,]+(?:\.\d{1,2})?)\)/i, "low", "RINGGIT MALAYSIA (RM X)"],
  ];

  for (const [pattern, confidence, matchNote] of monthlyRentPatterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      const value = parseFloat(match[1].replace(/,/g, ""));
      if (Number.isFinite(value) && value > 0 && value <= 100_000) {
        return { value, confidence, matchNote };
      }
    }
  }

  return null;
}

/**
 * Attempt to find lease duration in months.
 *
 * Confidence tiers:
 *   - high: "period/term/duration of X months" (explicit month count)
 *   - medium: "period/term/duration of X year(s)" (year → month conversion)
 *   - low: "X months commencing/starting" or word-number years (weaker context)
 */
function extractLeaseMonths(text: string): InternalExtraction<number> | null {
  const normalized = text.replace(/\s+/g, " ");

  // High confidence: explicit months with strong context
  const highMonthPatterns: [RegExp, string][] = [
    [/(?:period|term|duration)\s+of\s+(\d{1,3})\s+month/i, "period/term of X months"],
  ];

  for (const [pattern, matchNote] of highMonthPatterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      const months = parseInt(match[1], 10);
      if (months > 0 && months <= 120) {
        return { value: months, confidence: "high", matchNote };
      }
    }
  }

  // Low confidence: months with weaker context
  const lowMonthPatterns: [RegExp, string][] = [
    [/(\d{1,3})\s+months?\s+(?:commencing|starting|from|beginning)/i, "X months commencing/starting"],
    [/(\d{1,3})\s+calendar\s+months/i, "X calendar months"],
  ];

  for (const [pattern, matchNote] of lowMonthPatterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      const months = parseInt(match[1], 10);
      if (months > 0 && months <= 120) {
        return { value: months, confidence: "low", matchNote };
      }
    }
  }

  // Medium confidence: years with strong context (conversion needed)
  const yearPatterns: [RegExp, string][] = [
    [/(?:period|term|duration)\s+of\s+(\d{1,2})\s+year/i, "period/term of X year(s)"],
    [/(\d{1,2})\s+\(\d+\)\s+years?/i, "X (X) years"],
    [/(?:period|term|duration)\s+of\s+\w+\s*\((\d{1,2})\)\s+years?/i, "period/term of word(X) years"],
  ];

  for (const [pattern, matchNote] of yearPatterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      const years = parseInt(match[1], 10);
      if (years > 0 && years <= 10) {
        return { value: years * 12, confidence: "medium", matchNote };
      }
    }
  }

  // Low confidence: word-number years
  const wordYearMap: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
  };
  const wordYearMatch = normalized.match(
    /(?:period|term|duration)\s+of\s+(one|two|three|four|five)\s+\(?(\d)?\)?\s*years?/i
  );
  if (wordYearMatch?.[1]) {
    const years = wordYearMap[wordYearMatch[1].toLowerCase()];
    if (years) return { value: years * 12, confidence: "low", matchNote: "word-number years" };
  }

  return null;
}

/**
 * Attempt to find the agreement/contract date.
 *
 * Confidence tiers:
 *   - high: "dated this Xth day of Month Year" (formal legal phrasing)
 *   - medium: "made on/dated D Month Year" (simple but clear)
 *   - low: DD/MM/YYYY near "date" keyword (ambiguous context)
 */
function extractAgreementDate(text: string): InternalExtraction<string> | null {
  const normalized = text.replace(/\s+/g, " ");

  // High confidence: formal dated clause
  const formalMatch = normalized.match(
    /dated\s+(?:this\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+day\s+of\s+(\w+)\s*,?\s*(\d{4})/i
  );
  if (formalMatch) {
    const dateStr = `${formalMatch[1]} ${formalMatch[2]} ${formalMatch[3]}`;
    const parsed = tryParseDate(dateStr);
    if (parsed) return { value: parsed, confidence: "high", matchNote: "dated this Xth day of Month Year" };
  }

  // High confidence: Schedule-form "Date of Agreement <D Month Year>".
  // Allow zero whitespace between "Agreement" and the day, because PDF
  // text extraction often concatenates Schedule label with value.
  const scheduleMatch = normalized.match(
    /Date\s+of\s+Agreement\s*(\d{1,2})\s+(\w+)\s*,?\s*(\d{4})/i
  );
  if (scheduleMatch) {
    const dateStr = `${scheduleMatch[1]} ${scheduleMatch[2]} ${scheduleMatch[3]}`;
    const parsed = tryParseDate(dateStr);
    if (parsed) return { value: parsed, confidence: "high", matchNote: "Schedule: Date of Agreement D Month Year" };
  }

  // High confidence: cover-page "<D>ST/ND/RD/TH DAY OF <MONTH> <YYYY>"
  // without a leading "dated" — WeStamp cover pages use this form.
  const coverMatch = normalized.match(
    /\b(\d{1,2})(?:st|nd|rd|th)\s+day\s+of\s+(\w+)\s*,?\s*(\d{4})/i
  );
  if (coverMatch) {
    const dateStr = `${coverMatch[1]} ${coverMatch[2]} ${coverMatch[3]}`;
    const parsed = tryParseDate(dateStr);
    if (parsed) return { value: parsed, confidence: "high", matchNote: "Xth day of Month Year (cover)" };
  }

  // Medium confidence: simple dated/made on
  const simpleMatch = normalized.match(
    /(?:dated|made\s+on|entered\s+(?:into\s+)?on)\s+(\d{1,2})\s+(\w+)\s*,?\s*(\d{4})/i
  );
  if (simpleMatch) {
    const dateStr = `${simpleMatch[1]} ${simpleMatch[2]} ${simpleMatch[3]}`;
    const parsed = tryParseDate(dateStr);
    if (parsed) return { value: parsed, confidence: "medium", matchNote: "dated/made on D Month Year" };
  }

  // Low confidence: numeric date near keyword
  const numericMatch = normalized.match(
    /(?:date|dated)[:\s]+(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/i
  );
  if (numericMatch) {
    const [, d, m, y] = numericMatch;
    const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    if (!isNaN(date.getTime()) && date.getFullYear() >= 2000) {
      return { value: date.toISOString().split("T")[0], confidence: "low", matchNote: "DD/MM/YYYY near date keyword" };
    }
  }

  return null;
}

// ─── Helpers ────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function tryParseDate(dateStr: string): string | null {
  // Try "D Month YYYY"
  const match = dateStr.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const monthName = match[2].toLowerCase();
  const year = parseInt(match[3], 10);

  const month = MONTHS[monthName];
  if (month === undefined) return null;

  const date = new Date(year, month, day);
  if (isNaN(date.getTime()) || date.getFullYear() < 2000) return null;

  return date.toISOString().split("T")[0];
}
