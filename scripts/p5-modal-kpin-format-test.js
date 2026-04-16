/**
 * P5 Landlord Modal — KPIN Format/Length Trigger Test
 *
 * DEPRECATED / GUARDED: This script interacts with the live LHDN TIN
 * lookup endpoint (semakan_tin). Any 12-digit numeric kpin value
 * will trigger a real identity lookup that may return third-party
 * tax identity data.
 *
 * EXECUTION GUARD: Requires ALLOW_LIVE_ID_LOOKUP=true environment variable.
 * OUTPUT REDACTION: All returned TIN values and person names are masked.
 *
 * DO NOT run with random numeric values. Blind probing is not acceptable.
 * This script exists only as a structural reference and must not be
 * used for further identity probing.
 */

if (process.env.ALLOW_LIVE_ID_LOOKUP !== "true") {
  console.error(
    "ERROR: This script requires ALLOW_LIVE_ID_LOOKUP=true.\n" +
    "This script interacts with the live LHDN TIN lookup endpoint.\n" +
    "Any 12-digit numeric kpin triggers a real identity lookup that\n" +
    "may return third-party tax identity data.\n" +
    "Blind probing with random values is NOT acceptable.\n" +
    "Set ALLOW_LIVE_ID_LOOKUP=true only with explicit authorization."
  );
  process.exit(1);
}

console.error("NOTICE: This script is deprecated. Use only with explicit authorization.");
console.error("All returned TIN/name values will be redacted in output.");
process.exit(0);
