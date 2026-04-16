/**
 * Fulfilment Integrity Evaluator
 *
 * Derives obvious contradictions in a job's fulfilment state.
 * This is detection only — no data is mutated, no repair is performed.
 *
 * The result is a list of human-readable anomaly messages.
 * An empty list means no contradictions were detected.
 */

export interface FulfilmentIntegrityInput {
  paymentStatus: string;
  certificateStatus: string;
  adjudicationNumber: string | null;
  certificateStoragePath: string | null;
}

export interface FulfilmentIntegrityResult {
  anomalies: string[];
  hasAnomalies: boolean;
}

/**
 * Evaluates the fulfilment state for obvious internal contradictions.
 * Returns an empty anomalies list for healthy jobs.
 */
export function evaluateFulfilmentIntegrity(
  state: FulfilmentIntegrityInput | null
): FulfilmentIntegrityResult {
  if (!state) {
    return { anomalies: [], hasAnomalies: false };
  }

  const anomalies: string[] = [];

  // 1. certificate_retrieved but no certificate file attached
  if (
    state.certificateStatus === "certificate_retrieved" &&
    !state.certificateStoragePath
  ) {
    anomalies.push(
      "Certificate is marked as retrieved but no certificate file is attached."
    );
  }

  // 2. waiting_for_certificate but payment is not marked done
  if (
    state.certificateStatus === "waiting_for_certificate" &&
    state.paymentStatus !== "payment_marked_done"
  ) {
    anomalies.push(
      "Certificate is waiting but payment has not been marked done."
    );
  }

  // 3. payment_marked_done but no adjudication number
  if (
    state.paymentStatus === "payment_marked_done" &&
    !state.adjudicationNumber
  ) {
    anomalies.push(
      "Payment is marked done but no adjudication number is recorded."
    );
  }

  // 4. awaiting_payment but no adjudication number
  if (
    state.paymentStatus === "awaiting_payment" &&
    !state.adjudicationNumber
  ) {
    anomalies.push(
      "Payment is awaiting but no adjudication number is recorded."
    );
  }

  return {
    anomalies,
    hasAnomalies: anomalies.length > 0,
  };
}
