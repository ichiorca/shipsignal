// T3/T4 (spec 019) — the outbound distribution dispatcher: wires the pure webhook layer
// (payload/signing/retry) to the delivery ledger and the network. Called by the Gate #2
// approve route (per-artifact) and the resume-artifacts route (run-level sweep).
//
// P5 (Safety rails) / §18.1: the payload is built ONLY from the approved snapshot. Dispatch is
// fail-soft by design — a webhook outage must never fail or roll back the human approval that
// triggered it; outcomes land on the audit ledger and in secret-free logs. Server-only: the
// signing secret is read here at call time and never reaches a component or log line.

import 'server-only';
import {
  ARTIFACT_APPROVED_EVENT,
  DELIVERY_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  buildArtifactApprovedPayload,
  deliveryIdFor,
  getOutboundWebhookConfig,
  postWithRetry,
  signWebhookBody,
} from '@/app/lib/outboundWebhook.ts';
import { getApprovedSnapshotForArtifact } from '@/app/lib/db/approvedSnapshots.ts';
import {
  ensureDelivery,
  listUndeliveredApprovedArtifacts,
  recordDeliveryAttempt,
} from '@/app/lib/db/outboundWebhookDeliveries.ts';

export type DispatchResult =
  | 'delivered'
  | 'failed'
  | 'skipped-no-config'
  | 'skipped-already-delivered'
  | 'skipped-no-snapshot';

/** Send the artifact.approved webhook for ONE approved artifact. Never throws. */
export async function dispatchArtifactApprovedWebhook(
  artifactId: string,
): Promise<DispatchResult> {
  try {
    const config = getOutboundWebhookConfig();
    if (config === null) return 'skipped-no-config';

    const snapshot = await getApprovedSnapshotForArtifact(artifactId);
    if (snapshot === null) return 'skipped-no-snapshot';

    const deliveryId = deliveryIdFor(ARTIFACT_APPROVED_EVENT, artifactId);
    const { shouldDispatch } = await ensureDelivery({
      deliveryId,
      releaseRunId: snapshot.release_run_id,
      artifactId: snapshot.artifact_id,
      eventType: ARTIFACT_APPROVED_EVENT,
      targetUrl: config.url,
    });
    // Already delivered, or another dispatcher (sweep vs. per-artifact) holds the in-flight claim.
    if (!shouldDispatch) return 'skipped-already-delivered';

    const rawBody = JSON.stringify(buildArtifactApprovedPayload(snapshot, deliveryId));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signWebhookBody(config.secret, timestamp, rawBody);

    const outcome = await postWithRetry(() =>
      fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [DELIVERY_HEADER]: deliveryId,
          [TIMESTAMP_HEADER]: timestamp,
          [SIGNATURE_HEADER]: signature,
        },
        body: rawBody,
        signal: AbortSignal.timeout(10_000),
      }),
    );
    await recordDeliveryAttempt(deliveryId, outcome);
    if (!outcome.ok) {
      // Metadata only: ids + class of failure. Never the URL, secret, or payload.
      console.error('outbound webhook delivery failed', {
        artifactId,
        deliveryId,
        status: outcome.status,
        attempts: outcome.attempts,
      });
    }
    return outcome.ok ? 'delivered' : 'failed';
  } catch (err) {
    // Fail-soft: the approval already succeeded; surface the class of error and move on.
    console.error('outbound webhook dispatch errored', {
      artifactId,
      // err.name (class) not err.message: the message can carry the target URL/secret, which must
      // never reach a log line (constitution §5). Metadata only: ids + class of failure.
      message: err instanceof Error ? err.name : 'unknown',
    });
    return 'failed';
  }
}

/** Run-level sweep at Gate #2 "Approve & resume": dispatch every approved artifact in the run
 *  that has no successful delivery yet (covers per-artifact dispatch failures and approvals
 *  that predate webhook configuration). Never throws. */
export async function sweepApprovedArtifactWebhooks(
  releaseRunId: string,
): Promise<{ readonly dispatched: number; readonly failed: number }> {
  try {
    if (getOutboundWebhookConfig() === null) return { dispatched: 0, failed: 0 };
    const pending = await listUndeliveredApprovedArtifacts(
      releaseRunId,
      ARTIFACT_APPROVED_EVENT,
    );
    let dispatched = 0;
    let failed = 0;
    // Sequential on purpose: a run has at most a handful of artifacts, and serial sends keep
    // the consumer's ordering simple and our egress polite.
    for (const artifactId of pending) {
      const result = await dispatchArtifactApprovedWebhook(artifactId);
      if (result === 'delivered') dispatched += 1;
      else if (result === 'failed') failed += 1;
    }
    return { dispatched, failed };
  } catch (err) {
    console.error('outbound webhook sweep errored', {
      releaseRunId,
      // err.name (class) not err.message: the message can carry the target URL/secret, which must
      // never reach a log line (constitution §5). Metadata only: ids + class of failure.
      message: err instanceof Error ? err.name : 'unknown',
    });
    return { dispatched: 0, failed: 0 };
  }
}
