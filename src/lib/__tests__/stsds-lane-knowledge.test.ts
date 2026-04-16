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
    const profile = getLaneKnowledgeProfile("sewa_pajakan");

    it("marks lane automation as NOT proven", () => {
      expect(profile.laneAutomationProven).toBe(false);
    });

    it("marks declaration gate as unknown", () => {
      expect(profile.declarationGateProven).toBe("unknown");
    });

    it("marks Bahagian A gate as unknown", () => {
      expect(profile.bahagianAGateProven).toBe("unknown");
    });

    it("marks Bahagian B accessibility as unknown", () => {
      expect(profile.bahagianBAccessibleWithEmptyA).toBe("unknown");
    });

    it("marks Rumusan accessibility as unknown", () => {
      expect(profile.rumusanAccessible).toBe("unknown");
    });

    it("does NOT copy proven facts from penyeteman_am", () => {
      expect(profile.bahagianBSavePermissive).toBe("unknown");
      expect(profile.lampiranAccessible).toBe("unknown");
      expect(profile.perakuanAccessible).toBe("unknown");
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

  it("returns assessment_limited for sewa_pajakan", () => {
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
    expect(result!.status).toBe("assessment_limited");
    expect(result!.gatesProvenForLane).toBe(false);
    expect(result!.provenBlockers).toHaveLength(0);
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
