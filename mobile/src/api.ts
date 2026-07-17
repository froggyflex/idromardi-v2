import { getToken, saveSession } from "./auth";
import type { AssignmentPackage, AssignmentSummary } from "./types";

const API_URL = String(process.env.EXPO_PUBLIC_API_URL || "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!API_URL) throw new ApiError("EXPO_PUBLIC_API_URL non configurato", 0, "NO_API_URL");
  const token = await getToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : null;
    if (!response.ok) {
      throw new ApiError(
        payload?.error || payload?.message || `Errore server (${response.status})`,
        response.status,
        payload?.code
      );
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as Error)?.name === "AbortError") {
      throw new ApiError("Timeout di rete: i dati restano salvati sul dispositivo", 0, "TIMEOUT");
    }
    throw new ApiError(
      "Server non raggiungibile: i dati restano salvati sul dispositivo",
      0,
      "OFFLINE"
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function login(username: string, password: string) {
  const result = await request<{ token: string; user: { id: string; username: string; role: string } }>(
    "/auth/login",
    { method: "POST", body: JSON.stringify({ username, password }) }
  );
  if (!new Set(["METER_READER", "ADMIN"]).has(result.user.role)) {
    throw new ApiError("Questo account non è abilitato alle letture mobili", 403, "INVALID_ROLE");
  }
  await saveSession(result.token, result.user);
  return result;
}

export function listAssignments() {
  return request<{ assignments: AssignmentSummary[] }>("/mobile-readings/assignments");
}

export function downloadAssignment(id: string) {
  return request<AssignmentPackage>(`/mobile-readings/assignments/${id}`);
}

export function submitReading(payload: unknown) {
  return request<{ submission: { id: string; workflow_status: string }; idempotentReplay: boolean }>(
    "/mobile-readings/submissions",
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export function uploadReadingPhoto(
  submissionId: string,
  photo: { uri: string; mimeType: string; sha256: string }
) {
  const form = new FormData();
  form.append("photo", {
    uri: photo.uri,
    type: photo.mimeType,
    name: `meter-${submissionId}.jpg`,
  } as unknown as Blob);
  return request<{ submission: { workflow_status: string }; idempotentReplay: boolean }>(
    `/mobile-readings/submissions/${submissionId}/photo`,
    {
      method: "POST",
      body: form,
      headers: { "X-Photo-SHA256": photo.sha256 },
    }
  );
}

export function reconcileStatuses(ids: string[]) {
  return request<{
    submissions: Array<{
      id: string;
      workflow_status: string;
      conflict_reason?: string | null;
      version: number;
    }>;
  }>("/mobile-readings/sync/status", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}
