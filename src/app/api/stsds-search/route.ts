/**
 * GET /api/stsds-search?q=<query>&lane=<optional-lane>
 *
 * Searches the internal STSDS document catalogue and returns
 * ranked results with portal lane, document name, expected derived
 * document group, observed editable instrument category, and mapping evidence.
 *
 * This is an internal helper for the intake UI.
 * Does NOT interact with the live e-Duti Setem portal.
 */

import { NextRequest } from "next/server";
import { searchCatalogue } from "../../../lib/stsds-search";
import { PortalLane } from "../../../lib/stsds-types";

const VALID_LANES: PortalLane[] = ["sewa_pajakan", "penyeteman_am"];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const laneParam = searchParams.get("lane")?.trim() ?? "";

  if (!query) {
    return Response.json({ results: [] });
  }

  const laneFilter: PortalLane | undefined = VALID_LANES.includes(
    laneParam as PortalLane
  )
    ? (laneParam as PortalLane)
    : undefined;

  const results = searchCatalogue(query, laneFilter);

  return Response.json({
    query,
    laneFilter: laneFilter ?? null,
    results: results.map((r) => ({
      id: r.item.id,
      portalLane: r.item.portalLane,
      portalDocumentName: r.item.portalDocumentName,
      expectedDerivedDocumentGroup: r.item.expectedDerivedDocumentGroup,
      observedEditableInstrumentCategory:
        r.item.observedEditableInstrumentCategory,
      supportedForAutomation: r.item.supportedForAutomation,
      mappingEvidence: r.item.mappingEvidence,
      matchType: r.matchType,
      score: r.score,
    })),
  });
}
