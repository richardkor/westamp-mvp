/**
 * WeStamp — STSDS Document Catalogue Search
 *
 * Ranked search over the internal document catalogue.
 *
 * Ranking strategy (highest to lowest):
 * 1. Exact match on portalDocumentName (score 100)
 * 2. Exact match on an alias (score 90)
 * 3. Prefix match on portalDocumentName (score 80)
 * 4. Prefix match on an alias (score 70)
 * 5. Contains match on portalDocumentName (score 60)
 * 6. Contains match on an alias (score 50)
 * 7. Token overlap — weighted by fraction of query tokens found (score 10–40)
 *
 * All matching is case-insensitive.
 * Near-duplicates are deduplicated by catalogue item ID.
 * Results are sorted by score descending.
 */

import { getCatalogue } from "./stsds-catalogue";
import {
  StsdsDocumentCatalogueItem,
  StsdsSearchResult,
  SearchMatchType,
  PortalLane,
} from "./stsds-types";

/** Maximum results returned from a search. */
const MAX_RESULTS = 10;

/**
 * Search the STSDS document catalogue.
 *
 * @param query - Free-text search query (user input or extracted text)
 * @param laneFilter - Optional: restrict results to a specific portal lane
 * @returns Ranked search results, up to MAX_RESULTS
 */
export function searchCatalogue(
  query: string,
  laneFilter?: PortalLane
): StsdsSearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const catalogue = getCatalogue();
  const queryTokens = tokenize(normalizedQuery);
  const resultMap = new Map<string, StsdsSearchResult>();

  for (const item of catalogue) {
    // Apply lane filter if specified
    if (laneFilter && item.portalLane !== laneFilter) continue;

    let bestScore = 0;
    let bestMatchType: SearchMatchType = "token_overlap";

    // ── Match against primary name ────────────────────────────────
    const nameScore = scoreMatch(normalizedQuery, queryTokens, item.normalizedName);
    if (nameScore.score > bestScore) {
      bestScore = nameScore.score;
      bestMatchType = nameScore.matchType;
    }

    // ── Match against aliases ─────────────────────────────────────
    for (const alias of item.aliases) {
      const aliasScore = scoreMatch(normalizedQuery, queryTokens, alias);
      // Aliases score slightly lower than primary name for the same match type
      const adjustedScore = aliasScore.matchType === "exact"
        ? 90
        : aliasScore.matchType === "prefix"
          ? 70
          : aliasScore.matchType === "contains"
            ? 50
            : aliasScore.score;

      if (adjustedScore > bestScore) {
        bestScore = adjustedScore;
        bestMatchType = aliasScore.matchType === "token_overlap"
          ? "token_overlap"
          : "alias";
      }
    }

    // Only include if there was some match
    if (bestScore > 0) {
      const existing = resultMap.get(item.id);
      if (!existing || existing.score < bestScore) {
        resultMap.set(item.id, {
          item,
          matchType: bestMatchType,
          score: bestScore,
        });
      }
    }
  }

  // Sort by score descending, then alphabetically for ties
  const results = Array.from(resultMap.values());
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.item.portalDocumentName.localeCompare(b.item.portalDocumentName);
  });

  return results.slice(0, MAX_RESULTS);
}

// ─── Internal Scoring ───────────────────────────────────────────────

interface MatchScore {
  score: number;
  matchType: SearchMatchType;
}

function scoreMatch(
  query: string,
  queryTokens: string[],
  target: string
): MatchScore {
  // Exact match
  if (query === target) {
    return { score: 100, matchType: "exact" };
  }

  // Prefix match
  if (target.startsWith(query)) {
    return { score: 80, matchType: "prefix" };
  }

  // Contains match
  if (target.includes(query)) {
    return { score: 60, matchType: "contains" };
  }

  // Token overlap
  if (queryTokens.length > 0) {
    const targetTokens = tokenize(target);
    let matchedTokens = 0;

    for (const qt of queryTokens) {
      // A query token matches if any target token starts with it or equals it
      if (targetTokens.some((tt) => tt === qt || tt.startsWith(qt))) {
        matchedTokens++;
      }
    }

    if (matchedTokens > 0) {
      const overlap = matchedTokens / queryTokens.length;
      // Score: 10 (minimal overlap) to 40 (full token overlap)
      const score = Math.round(10 + overlap * 30);
      return { score, matchType: "token_overlap" };
    }
  }

  return { score: 0, matchType: "token_overlap" };
}

/**
 * Tokenize a string into lowercase words, removing common noise.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s/\-&,.()+]+/)
    .filter((t) => t.length > 1) // Drop single-char tokens
    .filter((t) => !STOP_WORDS.has(t));
}

/** Common words to exclude from token matching. */
const STOP_WORDS = new Set([
  "of", "and", "the", "a", "an", "for", "in", "to", "or", "by", "on",
  "dan", "dan", "untuk", "di", "ke", "atau",
]);
