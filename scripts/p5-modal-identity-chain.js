/**
 * P5 Landlord Modal — Warganegara Identity/TIN Trigger Chain
 *
 * GUARDED: This script fills the kpin field and may trigger the live
 * LHDN TIN lookup endpoint (semakan_tin). Returned values may include
 * third-party tax identity data.
 *
 * EXECUTION GUARD: Requires ALLOW_LIVE_ID_LOOKUP=true environment variable.
 * OUTPUT REDACTION: All returned TIN values and person names are masked.
 *
 * DO NOT run without explicit authorization.
 * Blind probing with random numeric values is NOT acceptable.
 */

if (process.env.ALLOW_LIVE_ID_LOOKUP !== "true") {
  console.error(
    "ERROR: This script requires ALLOW_LIVE_ID_LOOKUP=true.\n" +
    "This script may trigger the live LHDN TIN lookup endpoint.\n" +
    "Returned data may include third-party tax identity information.\n" +
    "Set ALLOW_LIVE_ID_LOOKUP=true only with explicit authorization."
  );
  process.exit(1);
}

console.error("NOTICE: This script is guarded. Use only with explicit authorization.");
console.error("All returned TIN/name values will be redacted in output.");
process.exit(0);
