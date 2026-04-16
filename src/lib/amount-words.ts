/**
 * WeStamp — RM Amount-to-Words Helper
 *
 * Converts a numeric RM amount string into Malaysian Ringgit wording.
 *
 * Whole ringgit:  "Ringgit Malaysia One Thousand Five Hundred (RM1,500.00) Only"
 * With sen:       "Ringgit Malaysia One Thousand Five Hundred and Sen Fifty (RM1,500.50) Only"
 */

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];

const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

/**
 * Convert an integer (0–999,999,999) to English words.
 * Returns empty string for 0.
 */
function intToWords(n: number): string {
  if (n === 0) return "";
  if (n < 0) return intToWords(-n);

  if (n < 20) return ONES[n];

  if (n < 100) {
    const t = TENS[Math.floor(n / 10)];
    const o = ONES[n % 10];
    return o ? `${t} ${o}` : t;
  }

  if (n < 1000) {
    const h = `${ONES[Math.floor(n / 100)]} Hundred`;
    const rem = n % 100;
    return rem ? `${h} and ${intToWords(rem)}` : h;
  }

  if (n < 1_000_000) {
    const th = `${intToWords(Math.floor(n / 1000))} Thousand`;
    const rem = n % 1000;
    if (!rem) return th;
    if (rem < 100) return `${th} and ${intToWords(rem)}`;
    return `${th} ${intToWords(rem)}`;
  }

  // Millions
  const mil = `${intToWords(Math.floor(n / 1_000_000))} Million`;
  const rem = n % 1_000_000;
  if (!rem) return mil;
  if (rem < 100) return `${mil} and ${intToWords(rem)}`;
  return `${mil} ${intToWords(rem)}`;
}

/**
 * Format an RM amount string as figures: "RM1,500.00"
 */
function fmtRMFigures(amountStr: string): string {
  const n = parseFloat(amountStr);
  return `RM${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Convert an RM amount string to full Malaysian Ringgit wording.
 *
 * Examples:
 *   "1500"    → "Ringgit Malaysia One Thousand Five Hundred (RM1,500.00) Only"
 *   "1500.50" → "Ringgit Malaysia One Thousand Five Hundred and Sen Fifty (RM1,500.50) Only"
 *   "0.50"    → "Ringgit Malaysia Sen Fifty (RM0.50) Only"
 */
export function ringgitWords(amountStr: string): string {
  const n = parseFloat(amountStr);
  const whole = Math.floor(n);
  const senRaw = Math.round((n - whole) * 100);

  const figures = fmtRMFigures(amountStr);
  const wholeWords = intToWords(whole);
  const senWords = intToWords(senRaw);

  if (senRaw === 0) {
    // Whole ringgit only
    return `Ringgit Malaysia ${wholeWords} (${figures}) Only`;
  }

  if (whole === 0) {
    // Sen only (unlikely for tenancy but handle cleanly)
    return `Ringgit Malaysia Sen ${senWords} (${figures}) Only`;
  }

  // Ringgit and sen
  return `Ringgit Malaysia ${wholeWords} and Sen ${senWords} (${figures}) Only`;
}
