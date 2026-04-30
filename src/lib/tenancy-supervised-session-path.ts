/**
 * WeStamp — Tenancy Supervised Session · URL-boundary path classifier
 *
 * Tiny, pure, Playwright-free utility extracted from
 * `tenancy-supervised-session-shell.ts` so that client-reachable
 * code paths (e.g. the Phase 2 executor reachable from the
 * operator panel) can import the classifier without transitively
 * pulling Playwright into the client bundle.
 *
 * Behaviour and contract are unchanged from the previous in-shell
 * implementation; `tenancy-supervised-session-shell.ts` re-exports
 * `classifySupervisedSessionPath` and `SupervisedSessionPathKind`
 * so existing callers remain unaffected.
 *
 * Sensitive-data policy
 * ─────────────────────
 * The classifier accepts a raw URL ONCE at the boundary and
 * returns ONLY the resulting enum value. The caller must drop the
 * raw URL immediately after invocation. The function never logs,
 * never persists, and never re-emits any portion of the input.
 */

/**
 * Path-shape enum — coarser than page kind because it derives from
 * URL pathname only (no DOM marker information). The single
 * trustworthy descriptor of "which portal surface is this URL?".
 */
export type SupervisedSessionPathKind =
  | "mytax_dashboard"
  | "stamps_role_change"
  | "stamps_dashboard"
  | "sewa_pajakan_p5_form"
  | "other";

/**
 * Classify a raw portal URL into a coarse path-shape enum. **Drops
 * the raw URL, query string, hash, and href at this seam** — only
 * the resulting `SupervisedSessionPathKind` is returned. Callers
 * must not retain the URL after calling this function.
 *
 * Recognised host / path combinations:
 *   - host `mytax.hasil.gov.my`                                 → `mytax_dashboard`
 *   - host containing `stamps.hasil.gov.my` and pathname:
 *       · starts with `/stamps/main/role_change`                → `stamps_role_change`
 *       · starts with `/stamps/utama/dashboard`                 → `stamps_dashboard`
 *       · starts with `/stamps/formv2/p5/edit`                  → `sewa_pajakan_p5_form`
 *       · starts with `/stamps/formv2/p5/create`                → `sewa_pajakan_p5_form`
 *   - everything else                                            → `other`
 *
 * Defensively returns `"other"` on malformed input — never throws.
 */
export function classifySupervisedSessionPath(
  rawUrl: string
): SupervisedSessionPathKind {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return "other";

  let host = "";
  let pathname = "";
  try {
    const u = new URL(rawUrl);
    host = u.hostname;
    pathname = u.pathname;
  } catch {
    // Treat as a path-only string. We cannot identify the host so
    // we skip the host-required classifications.
    if (rawUrl.startsWith("/stamps/main/role_change")) return "stamps_role_change";
    if (rawUrl.startsWith("/stamps/utama/dashboard")) return "stamps_dashboard";
    if (rawUrl.startsWith("/stamps/formv2/p5/edit")) return "sewa_pajakan_p5_form";
    if (rawUrl.startsWith("/stamps/formv2/p5/create")) return "sewa_pajakan_p5_form";
    return "other";
  }

  if (host === "mytax.hasil.gov.my") return "mytax_dashboard";

  if (host.endsWith("stamps.hasil.gov.my")) {
    if (pathname.startsWith("/stamps/main/role_change")) return "stamps_role_change";
    if (pathname.startsWith("/stamps/utama/dashboard")) return "stamps_dashboard";
    if (pathname.startsWith("/stamps/formv2/p5/edit")) return "sewa_pajakan_p5_form";
    if (pathname.startsWith("/stamps/formv2/p5/create")) return "sewa_pajakan_p5_form";
  }

  return "other";
}
