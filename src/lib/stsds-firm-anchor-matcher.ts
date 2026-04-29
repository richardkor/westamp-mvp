/**
 * WeStamp — Firm Anchor Matcher
 *
 * Pure, framework-free helper for selecting the correct firm/agent
 * anchor on the LHDN e-Duti Setem `/stamps/main/role_change` page.
 *
 * Why this module exists
 * ──────────────────────
 * The earlier implementation in `stsds-playwright-driver.ts` Stage 7
 * walked the DOM for text matches against a target firm name, scored
 * candidates with heuristics, and clicked `visibleFirmTargets[0]` —
 * effectively an index-based pick after sorting. It also logged raw
 * `href` substrings.
 *
 * Passive HAR research (recorded as design evidence only — the raw
 * HAR is NOT stored in this repo) confirmed:
 *
 *   - Firm/agent selection is anchor-href navigation, not a form POST.
 *   - The intended anchor's `href` always contains
 *     `/stamps/main/role_change/...`.
 *   - After a successful click, the portal redirects to
 *     `/stamps/utama/dashboard`.
 *
 * Given that, the safe selection rule is:
 *
 *   1. Filter to anchors whose decoded href contains
 *      `/stamps/main/role_change/`.
 *   2. Match against the operator-supplied target firm (and optional
 *      target branch) by *normalized exact* comparison on the anchor's
 *      visible text and on the decoded href content.
 *   3. Fail closed when there are zero, no exact, or multiple
 *      plausible matches.
 *   4. Never select by index.
 *
 * What this module IS
 * ───────────────────
 * - A pure function `matchFirmAnchor(candidates, config)` that takes a
 *   list of pre-collected candidate anchors plus the configured
 *   target and returns one of four outcomes:
 *   `no_candidates | no_match | ambiguous_match | unique_match`.
 * - Stable, redaction-free diagnostics suitable for safe logging.
 *
 * What this module IS NOT
 * ───────────────────────
 * - It does NOT touch the DOM. The driver is responsible for
 *   collecting candidates and clicking the chosen one.
 * - It does NOT do HTTP, replay requests, or talk to LHDN directly.
 * - It does NOT log, store, or persist raw `href`, raw role/firm
 *   numeric IDs, cookies, tokens, SSO values, `lhdnmsstoken`,
 *   IC numbers, TINs, or full sensitive URLs.
 * - It does NOT auto-fall-back to index-based selection if matching
 *   is ambiguous — ambiguity is a fail-closed condition.
 */

// ─── Stable constants (exported for the driver) ───────────────────

/**
 * Sentinel string used by both this helper and the driver's collector
 * to identify a role-change anchor. Exported so the driver does not
 * re-declare the same magic string. Stored verbatim because the URL
 * path fragment itself is non-sensitive — it's part of the public
 * portal route shape.
 */
export const ROLE_CHANGE_HREF_FRAGMENT = "/stamps/main/role_change/";

/**
 * Path the portal redirects to after a successful firm-anchor click.
 * The driver verifies the post-click URL matches this path before
 * proceeding to dashboard-dependent steps.
 */
export const POST_FIRM_SELECTION_REDIRECT_PATH = "/stamps/utama/dashboard";

/**
 * Coarse path-shape enum used by the driver in place of raw / truncated
 * URLs for safe diagnostic logging during role/firm selection.
 */
export type PortalPathKind = "role_change" | "dashboard" | "other";

/**
 * Classify a portal URL into a coarse path-shape enum. Returns
 * `"role_change"` if the URL's pathname starts with
 * `/stamps/main/role_change`, `"dashboard"` if it starts with
 * `/stamps/utama/dashboard`, otherwise `"other"`.
 *
 * **Returns enum only — never returns the URL, the path, the query
 * string, or the hash.** Driver code uses this to log a safe
 * `current_path_kind` diagnostic without leaking raw / truncated URL
 * values, role IDs, firm IDs, or token-bearing hash fragments.
 *
 * Defensively returns `"other"` on malformed input — never throws.
 */
export function classifyPathKind(url: string): PortalPathKind {
  if (typeof url !== "string" || url.length === 0) return "other";
  // Try as an absolute URL first (e.g. `https://stamps.hasil.gov.my/...`).
  try {
    const u = new URL(url);
    if (u.pathname.startsWith("/stamps/main/role_change")) return "role_change";
    if (u.pathname.startsWith("/stamps/utama/dashboard")) return "dashboard";
    return "other";
  } catch {
    // Fall through to relative-path matching below.
  }
  // Treat as a path-only string (e.g. `/stamps/utama/dashboard`).
  if (url.startsWith("/stamps/main/role_change")) return "role_change";
  if (url.startsWith("/stamps/utama/dashboard")) return "dashboard";
  return "other";
}

// ─── Public types ──────────────────────────────────────────────────

/**
 * One candidate anchor, post-collection by the driver.
 *
 * The driver is responsible for ensuring `hrefDecoded` has been passed
 * through `decodeURIComponent` (or equivalent) so that the comparison
 * sees the human-readable firm/branch text the portal embeds in the
 * URL path. `hrefDecoded` is consumed for matching only — it is NEVER
 * surfaced in `FirmAnchorMatchDiagnostics`, so callers who log only
 * the diagnostics object will not leak it.
 */
export interface FirmAnchorCandidate {
  /**
   * Stable, document-order ordinal assigned by the collector. The
   * driver re-uses this ordinal to click the matched anchor (e.g. via
   * a `data-westamp-firm-cand="N"` attribute it stamped at collect
   * time). Pure ordinal — carries no sensitive information.
   */
  ordinal: number;
  /**
   * The anchor's visible text (innerText / textContent), trimmed.
   * Used as the primary match key. Compared with normalized exact
   * equality against the configured target firm.
   */
  visibleText: string;
  /**
   * The anchor's `href`, decoded (`decodeURIComponent` applied so the
   * firm/branch string in the URL path is human-readable). Used as a
   * secondary match key only — it is never logged by this helper.
   */
  hrefDecoded: string;
  /**
   * Whether the anchor was visible at collect time
   * (display, opacity, getBoundingClientRect width/height > 0).
   */
  isVisible: boolean;
}

/** Operator-supplied selection config. */
export interface FirmAnchorMatchConfig {
  /**
   * Target firm name. Required. Compared via normalized exact
   * equality against `candidate.visibleText` and against the decoded
   * href content.
   */
  targetFirm: string;
  /**
   * Optional target branch. When supplied, a candidate must contain
   * the branch (normalized) in its visible text or decoded href to
   * be considered a match. Used to disambiguate when multiple firms
   * share the same name across branches.
   */
  targetBranch?: string | null;
}

/**
 * Match outcome. Always returns a `diagnostics` object containing
 * only safe non-sensitive counts plus the match-status string. Never
 * includes raw href, raw firm name, raw branch text, cookies, tokens,
 * or any other sensitive value.
 */
export type FirmAnchorMatchOutcome =
  | { kind: "no_candidates"; diagnostics: FirmAnchorMatchDiagnostics }
  | { kind: "no_match"; diagnostics: FirmAnchorMatchDiagnostics }
  | { kind: "ambiguous_match"; diagnostics: FirmAnchorMatchDiagnostics }
  | {
      kind: "unique_match";
      /** Ordinal of the unique candidate the driver should click. */
      ordinal: number;
      diagnostics: FirmAnchorMatchDiagnostics;
    };

/** Safe diagnostic counters. No raw values — counts and flags only. */
export interface FirmAnchorMatchDiagnostics {
  /**
   * True when at least one candidate anchor was passed in. False when
   * the driver collected zero anchors at all (e.g. it inspected a
   * page that wasn't `/stamps/main/role_change` or the page had not
   * yet hydrated).
   */
  roleChangePageSeen: boolean;
  /** Total candidates passed in. */
  candidateAnchorCount: number;
  /**
   * Candidates whose decoded href contains `/stamps/main/role_change/`.
   * Anchors not matching this prefix are dropped before matching —
   * they are not role-selection anchors.
   */
  filteredCandidateCount: number;
  /** Visible candidates (after the role-change href filter). */
  visibleCandidateCount: number;
  /** How many candidates matched the normalized firm name. */
  exactFirmMatchCount: number;
  /**
   * How many candidates matched both firm AND branch (when branch
   * was supplied in the config).
   */
  exactFirmAndBranchMatchCount: number;
  /** Final status. */
  matchStatus:
    | "no_candidates"
    | "no_match"
    | "ambiguous_match"
    | "unique_match";
  /** Whether `config.targetBranch` was supplied. */
  branchProvidedInConfig: boolean;
  /**
   * True iff branch was needed to narrow >1 firm match down to 1.
   * False when firm match was already unique without branch, even if
   * a branch was supplied.
   */
  branchUsedToDisambiguate: boolean;
}

// ─── Normalization ─────────────────────────────────────────────────

/**
 * Normalize a string for comparison. Trims, collapses internal
 * whitespace, upper-cases for case-insensitive comparison. We do
 * NOT strip diacritics — Bahasa Malaysia firm names rarely use them
 * and over-aggressive normalization could fold distinct firms.
 */
export function normalizeForMatch(s: string): string {
  return s.replace(/\s+/g, " ").trim().toUpperCase();
}

// ─── Matcher ───────────────────────────────────────────────────────

/**
 * Split a decoded href into its non-empty path segments and normalize
 * each. The role_change href shape (per passive HAR research) is
 * `/stamps/main/role_change/{role_type}/{num-id}/{num-id}/{num-id}/
 * {num-id}/{firm-text}/{role-text}/{branch-text}/` so the firm and
 * branch live as discrete segments. Splitting on "/" and comparing
 * each segment with normalized exact equality avoids any substring
 * matching at the click-approval layer.
 *
 * Filters out the empty strings produced by leading / trailing slash.
 */
function decodedHrefSegmentsNormalized(hrefDecoded: string): string[] {
  return hrefDecoded
    .split("/")
    .map((s) => normalizeForMatch(s))
    .filter((s) => s.length > 0);
}

/**
 * Does any URL path segment in the candidate's decoded href, when
 * normalized, equal the supplied normalized fragment? Pure exact
 * equality on segments — never substring across segment boundaries.
 */
function hrefHasSegmentExactlyEqual(
  hrefDecoded: string,
  targetNorm: string
): boolean {
  if (targetNorm === "") return false;
  return decodedHrefSegmentsNormalized(hrefDecoded).includes(targetNorm);
}

/**
 * Pure function. Given a list of candidate anchors collected by the
 * driver and the operator-configured target, returns a match outcome
 * with safe diagnostics.
 *
 * Matching policy (strict — never approve a click on substring):
 *
 *   - Empty candidates → `no_candidates`.
 *   - Filter to anchors whose decoded href contains
 *     `/stamps/main/role_change/`. Anchors that don't match this
 *     prefix are dropped (they aren't role-selection anchors).
 *   - Filter to visible candidates (`isVisible === true`).
 *   - **Firm match** (exact-equality only):
 *       a candidate qualifies iff
 *         normalize(visibleText) === normalize(targetFirm)
 *         OR
 *         some decoded-href URL segment === normalize(targetFirm).
 *   - **Branch disambiguation** (when `targetBranch` is supplied):
 *       narrow firm matches to those where some decoded-href URL
 *       segment === normalize(targetBranch). Visible-text branch
 *       matching is intentionally NOT supported — parsing branch out
 *       of mixed visible text (e.g. "{firm} ({branch})") is too
 *       brittle to be a click-approval signal.
 *   - Exactly one match → `unique_match` with that candidate's ordinal.
 *   - Zero matches → `no_match`.
 *   - More than one match → `ambiguous_match`.
 */
export function matchFirmAnchor(
  candidates: FirmAnchorCandidate[],
  config: FirmAnchorMatchConfig
): FirmAnchorMatchOutcome {
  const branchProvidedInConfig =
    typeof config.targetBranch === "string" &&
    config.targetBranch.trim().length > 0;
  const targetFirmNorm = normalizeForMatch(config.targetFirm);
  const targetBranchNorm = branchProvidedInConfig
    ? normalizeForMatch(config.targetBranch as string)
    : "";

  // Empty input — nothing to do. We still emit a diagnostic so the
  // caller can distinguish "page hadn't rendered" from "page rendered
  // but no role-change anchors found".
  if (candidates.length === 0) {
    const diagnostics: FirmAnchorMatchDiagnostics = {
      roleChangePageSeen: false,
      candidateAnchorCount: 0,
      filteredCandidateCount: 0,
      visibleCandidateCount: 0,
      exactFirmMatchCount: 0,
      exactFirmAndBranchMatchCount: 0,
      matchStatus: "no_candidates",
      branchProvidedInConfig,
      branchUsedToDisambiguate: false,
    };
    return { kind: "no_candidates", diagnostics };
  }

  // Filter: keep only anchors whose decoded href contains
  // `/stamps/main/role_change/`. The trailing slash matters — bare
  // `/stamps/main/role_change` is the page itself, not a selection
  // anchor on it.
  const filtered = candidates.filter((c) =>
    c.hrefDecoded.includes(ROLE_CHANGE_HREF_FRAGMENT)
  );

  const visibleFiltered = filtered.filter((c) => c.isVisible);

  // Phase 1 — firm match by exact equality only. Visible-text
  // exact-equals OR decoded-href URL segment exact-equals.
  const firmMatches = visibleFiltered.filter(
    (c) =>
      normalizeForMatch(c.visibleText) === targetFirmNorm ||
      hrefHasSegmentExactlyEqual(c.hrefDecoded, targetFirmNorm)
  );

  const exactFirmMatchCount = firmMatches.length;

  // Phase 2 — branch disambiguation (when supplied). Branch is
  // matched only against decoded-href URL segments — see policy
  // comment above for why visible-text branch parsing is omitted.
  let finalMatches = firmMatches;
  let branchUsedToDisambiguate = false;
  if (branchProvidedInConfig) {
    const branchMatches = firmMatches.filter((c) =>
      hrefHasSegmentExactlyEqual(c.hrefDecoded, targetBranchNorm)
    );
    // Branch acts as a narrowing filter. If branch knocks out every
    // candidate, we treat that as no_match (caller mis-configured the
    // branch, or no anchor with that branch exists).
    finalMatches = branchMatches;
    if (firmMatches.length > 1 && branchMatches.length >= 1) {
      branchUsedToDisambiguate = true;
    }
  }

  const exactFirmAndBranchMatchCount = branchProvidedInConfig
    ? finalMatches.length
    : 0;

  // Decide outcome.
  const baseDiagnostics = {
    roleChangePageSeen: true,
    candidateAnchorCount: candidates.length,
    filteredCandidateCount: filtered.length,
    visibleCandidateCount: visibleFiltered.length,
    exactFirmMatchCount,
    exactFirmAndBranchMatchCount,
    branchProvidedInConfig,
  };

  if (finalMatches.length === 0) {
    return {
      kind: "no_match",
      diagnostics: {
        ...baseDiagnostics,
        matchStatus: "no_match",
        branchUsedToDisambiguate: false,
      },
    };
  }
  if (finalMatches.length > 1) {
    return {
      kind: "ambiguous_match",
      diagnostics: {
        ...baseDiagnostics,
        matchStatus: "ambiguous_match",
        branchUsedToDisambiguate,
      },
    };
  }
  // Exactly one match.
  return {
    kind: "unique_match",
    ordinal: finalMatches[0].ordinal,
    diagnostics: {
      ...baseDiagnostics,
      matchStatus: "unique_match",
      branchUsedToDisambiguate,
    },
  };
}

