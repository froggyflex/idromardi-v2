import { ApiError, reconcileStatuses, submitReading, uploadReadingPhoto } from "./api";
import {
  getPendingCaptures,
  getReconcileCandidates,
  markRetry,
  markServerConfirmed,
  markUploading,
  updateReconciledStatus,
} from "./database";

let syncPromise: Promise<{ uploaded: number; failed: number; authRequired: boolean }> | null = null;

export function synchronizeOutbox(operatorId: string) {
  if (syncPromise) return syncPromise;
  syncPromise = runSync(operatorId).finally(() => {
    syncPromise = null;
  });
  return syncPromise;
}

async function runSync(operatorId: string) {
  let uploaded = 0;
  let failed = 0;
  let authRequired = false;
  const captures = await getPendingCaptures(operatorId);

  for (const capture of captures) {
    try {
      await markUploading(capture.id);
      const metadataResult = await submitReading({
        id: capture.id,
        assignmentId: capture.assignment_id,
        utenzaId: capture.utenza_id,
        deviceId: capture.device_id,
        captureSequence: capture.capture_sequence,
        source: capture.source,
        readingValue: capture.reading_value,
        readingState: capture.reading_state,
        capturedAt: capture.captured_at,
        timezoneOffsetMinutes: capture.timezone_offset_minutes,
        contextHash: capture.context_hash,
        operatorNote: capture.operator_note,
        ocrSuggestedValue: capture.ocr_suggested_value,
        ocrRaw: capture.ocr_raw_json ? JSON.parse(capture.ocr_raw_json) : null,
        ocrConfirmed: Boolean(capture.ocr_confirmed),
        expectedPhotoSha256: capture.photo_sha256,
      });
      let workflowStatus = metadataResult.submission.workflow_status;

      if (capture.source === "PHOTO") {
        if (!capture.photo_uri || !capture.photo_sha256 || !capture.photo_mime_type) {
          throw new Error("File foto locale incompleto");
        }
        const photoResult = await uploadReadingPhoto(capture.id, {
          uri: capture.photo_uri,
          mimeType: capture.photo_mime_type,
          sha256: capture.photo_sha256,
        });
        workflowStatus = photoResult.submission.workflow_status;
      }

      await markServerConfirmed(capture.id, workflowStatus);
      uploaded += 1;
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      await markRetry(
        capture.id,
        capture.attempts + 1,
        (error as Error)?.message || "Errore sincronizzazione",
        apiError?.status === 401
      );
      failed += 1;
      if (apiError?.status === 401) {
        authRequired = true;
        break;
      }
    }
  }

  const confirmed = await getReconcileCandidates(operatorId);
  for (let index = 0; index < confirmed.length; index += 100) {
    const chunk = confirmed.slice(index, index + 100);
    try {
      const result = await reconcileStatuses(chunk.map((capture) => capture.id));
      for (const serverSubmission of result.submissions) {
        await updateReconciledStatus(serverSubmission.id, serverSubmission.workflow_status);
      }
    } catch {
      // Reconciliation is best-effort. Confirmed data remains safely queued locally.
    }
  }

  return { uploaded, failed, authRequired };
}
