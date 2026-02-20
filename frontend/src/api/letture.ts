import api from "./client";

/* ---------- Types ---------- */

export interface CreateSessionPayload {
  idCondominio: string;
  periodYear: number | null;
  periodMonth: number | null;
  dataOperatore?: string | null;
  dataCasaIdrica?: string | null;
  note?: string;
}

export interface LetturaRowInput {
  idUtenza: string;
  valore: number | null;
  stato: string;
}

/* ---------- API Calls ---------- */

export async function createOrLoadSession(
  payload: CreateSessionPayload
) {
  const { data } = await api.post("/letture/sessioni", payload);
  return data;
}

export async function getSessionGrid(sessionId: string) {
  const { data } = await api.get(
    `/letture/sessioni/${sessionId}`
  );
  return data;
}

export async function saveSessionRows(
  sessionId: string,
  rows: LetturaRowInput[]
) {
  const { data } = await api.put(
    `/letture/sessioni/${sessionId}/righe`,
    { rows }
  );
  return data;
}

export async function closeSession(sessionId: string) {
  const { data } = await api.post(
    `/letture/sessioni/${sessionId}/chiudi`
  );
  return data;
}

export async function getCondominio(id:string | undefined) {
  const { data } = await api.get(`/condomini/${id}`);
  return data;
}