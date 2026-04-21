/**
 * Tests for Portal Lane Knowledge Profile consistency.
 *
 * Verifies that the lane knowledge profile correctly distinguishes
 * proven from unproven facts, and that consuming layers behave
 * consistently with the profile.
 */

import { getLaneKnowledgeProfile } from "../stsds-lane-knowledge";
import { evaluateSubmissionReadiness } from "../stsds-submission-readiness";
import { StampingJob } from "../stamping-types";

describe("PortalLaneKnowledgeProfile", () => {
  describe("penyeteman_am", () => {
    const profile = getLaneKnowledgeProfile("penyeteman_am");

    it("marks lane automation as proven", () => {
      expect(profile.laneAutomationProven).toBe(true);
    });

    it("marks declaration gate as proven", () => {
      expect(profile.declarationGateProven).toBe("proven");
    });

    it("marks Bahagian A gate as proven", () => {
      expect(profile.bahagianAGateProven).toBe("proven");
    });

    it("marks Bahagian B accessible with empty A as proven", () => {
      expect(profile.bahagianBAccessibleWithEmptyA).toBe("proven");
    });

    it("marks Bahagian B save as proven permissive", () => {
      expect(profile.bahagianBSavePermissive).toBe("proven");
    });

    it("marks Rumusan accessible as proven", () => {
      expect(profile.rumusanAccessible).toBe("proven");
    });

    it("marks party entry as frozen", () => {
      expect(profile.partyEntryFrozen).toBe(true);
    });

    it("marks live execution as not enabled", () => {
      expect(profile.liveExecutionEnabled).toBe(false);
    });
  });

  describe("sewa_pajakan", () => {
    // Apr-22 live gate-discovery probe flipped several unknowns to
    // "proven" based on observed behavior on /formv2/p5/. The facts
    // that remain "unknown" do so because the probe was blocked by
    // the Hantar pds_suratcara gate before those gates could be
    // exercised.
    const profile = getLaneKnowledgeProfile("sewa_pajakan");

    it("marks lane automation as proven (MA→P5 + tabs + Hantar first gate)", () => {
      expect(profile.laneAutomationProven).toBe(true);
    });

    it("marks declaration gate as still unknown (Hantar blocked earlier)", () => {
      expect(profile.declarationGateProven).toBe("unknown");
    });

    it("marks Bahagian A gate as proven (par_id in Hantar :invalid set)", () => {
      expect(profile.bahagianAGateProven).toBe("proven");
    });

    it("marks Bahagian B accessible-with-empty-A as proven (tab clicked, panel rendered)", () => {
      expect(profile.bahagianBAccessibleWithEmptyA).toBe("proven");
    });

    it("marks Rumusan accessibility as proven (tab clicked, panel rendered)", () => {
      expect(profile.rumusanAccessible).toBe("proven");
    });

    it("marks Lampiran accessibility as proven (tab clicked, panel rendered)", () => {
      expect(profile.lampiranAccessible).toBe("proven");
    });

    it("marks Perakuan accessibility as proven (tab clicked, pds_akuan checkbox visible)", () => {
      expect(profile.perakuanAccessible).toBe("proven");
    });

    it("keeps Bahagian B save permissiveness unknown (save not attempted)", () => {
      expect(profile.bahagianBSavePermissive).toBe("unknown");
    });

    it("keeps party entry frozen (identity/TIN flow unchanged)", () => {
      expect(profile.partyEntryFrozen).toBe(true);
    });

    it("keeps live execution not enabled", () => {
      expect(profile.liveExecutionEnabled).toBe(false);
    });
  });
});

describe("Submission readiness consistency with lane profile", () => {
  const baseJob: StampingJob = {
    id: "test-1",
    originalFileName: "test.pdf",
    mimeType: "application/pdf",
    fileSize: 1000,
    documentCategory: "other",
    status: "uploaded",
    storagePath: "/test",
    supportedForAutomation: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("returns blocked for sewa_pajakan with no preparation inputs (Bahagian A gate proven)", () => {
    const job: StampingJob = {
      ...baseJob,
      routingSuggestion: {
        suggestedLane: "sewa_pajakan",
        suggestedPortalDocumentName: null,
        expectedDerivedDocumentGroup: null,
        observedEditableInstrumentCategory: null,
        source: "category_match",
        confidence: "high",
        suggestedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const result = evaluateSubmissionReadiness(job);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("blocked");
    expect(result!.gatesProvenForLane).toBe(true);
    // Only Bahagian A is a proven blocker for sewa_pajakan today —
    // declaration gate remains "unknown" because Hantar was blocked
    // by pds_suratcara before Perakuan could be exercised.
    expect(result!.provenBlockers).toHaveLength(1);
    expect(result!.provenBlockers[0].key).toBe("bahagian_a_completeness");
    expect(result!.provenBlockers[0].satisfied).toBe(false);
  });

  it("returns blocked for penyeteman_am with no preparation inputs", () => {
    const job: StampingJob = {
      ...baseJob,
      routingSuggestion: {
        suggestedLane: "penyeteman_am",
        suggestedPortalDocumentName: "Employment Contract",
        expectedDerivedDocumentGroup: "Perjanjian Pekerjaan",
        observedEditableInstrumentCategory: "Prinsipal",
        source: "catalogue_search",
        confidence: "high",
        suggestedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const result = evaluateSubmissionReadiness(job);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("blocked");
    expect(result!.gatesProvenForLane).toBe(true);
    expect(result!.provenBlockers).toHaveLength(2);
    expect(result!.provenBlockers.every((b) => !b.satisfied)).toBe(true);
  });

  it("returns ready_with_caveats when all proven gates are satisfied", () => {
    const job: StampingJob = {
      ...baseJob,
      routingSuggestion: {
        suggestedLane: "penyeteman_am",
        suggestedPortalDocumentName: "Employment Contract",
        expectedDerivedDocumentGroup: "Perjanjian Pekerjaan",
        observedEditableInstrumentCategory: "Prinsipal",
        source: "catalogue_search",
        confidence: "high",
        suggestedAt: "2026-01-01T00:00:00.000Z",
      },
      preparationInputs: {
        declarationPrepared: true,
        bahagianAFirstPartyPrepared: true,
        bahagianASecondPartyPrepared: true,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const result = evaluateSubmissionReadiness(job);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("ready_with_caveats");
    expect(result!.provenBlockers.every((b) => b.satisfied)).toBe(true);
  });
});
