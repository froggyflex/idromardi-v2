import api from "./client";

export type Provider = {
  id: string;
  codice: string;
  nome: string;
  attiva: number;
};

export type TariffVersion = {
  id: string;
  id_casa_idrica: string;
  anno: number;
  valid_from: string; // YYYY-MM-DD
  valid_to: string | null;
  descrizione: string | null;
};

export type ComponenteMC = {
  id: string;
  id_categoria: string;
  codice: string;
  prezzo_mc: string;
};

export type Categoria = {
  id: string;
  id_tariffa: string;
  codice: string;
  descrizione: string | null;
  scaglioni: Scaglione[];
  quote_fisse: QuotaFissa[];
  componenti_mc: ComponenteMC[];
};

export type EditableScaglione = Scaglione & {
  _isNew?: boolean;
};

export type Scaglione = {
  id: string;
  id_categoria: string;
  ordine: number;
  nome: string;
  mc_da_base: number;
  mc_a_base: number | null;
  moltiplica_per_nucleo: number; // 0/1
  prezzo_acquedotto: string;

};

export type QuotaFissa = {
  id: string;
  id_categoria: string;
  codice: string;
  importo: string;
};

export async function listProviders() {
  const { data } = await api.get("/tariffe/providers");
  return data as { providers: Provider[] };
}

export async function createProvider(payload: { codice: string; nome: string }) {
  const { data } = await api.post("/tariffe/providers", payload);
  return data as { provider: Provider };
}

export async function listVersions(providerId: string) {
  const { data } = await api.get(`/tariffe/providers/${providerId}/versions`);
  return data as { versions: TariffVersion[] };
}

export async function createVersion(providerId: string, payload: {
  anno: number;
  valid_from: string;
  valid_to?: string | null;
  descrizione?: string | null;
}) {
  const { data } = await api.post(`/tariffe/providers/${providerId}/versions`, payload);
  return data as { version: TariffVersion };
}

export async function updateVersion(versionId: string, payload: {
  anno: number;
  valid_from: string;
  valid_to?: string | null;
  descrizione?: string | null;
}) {
  const { data } = await api.put(`/tariffe/versions/${versionId}`, payload);
  return data as { version: TariffVersion };
}

export async function getVersionFull(versionId: string) {
  const { data } = await api.get(`/tariffe/versions/${versionId}`);
  return data as { version: TariffVersion; categories: Categoria[] };
}

export async function upsertCategory(versionId: string, payload: { codice: string; descrizione?: string | null }) {
  const { data } = await api.post(`/tariffe/versions/${versionId}/categories`, payload);
  return data as { category: Omit<Categoria, "scaglioni" | "quote_fisse"> };
}

export async function createScaglione(categoryId: string, payload: any) {
  const { data } = await api.post(`/tariffe/categories/${categoryId}/scaglioni`, payload);
  return data as { scaglione: Scaglione };
}

export async function updateScaglione(scaglioneId: string, payload: any) {
  const { data } = await api.put(`/tariffe/scaglioni/${scaglioneId}`, payload);
  return data as { scaglione: Scaglione };
}

export async function deleteScaglione(scaglioneId: string) {
  const { data } = await api.delete(`/tariffe/scaglioni/${scaglioneId}`);
  return data as { ok: boolean };
}

export async function createQuotaFissa(categoryId: string, payload: any) {
  const { data } = await api.post(`/tariffe/categories/${categoryId}/quote-fisse`, payload);
  return data as { quota: QuotaFissa };
}

export async function updateQuotaFissa(quotaId: string, payload: any) {
  const { data } = await api.put(`/tariffe/quote-fisse/${quotaId}`, payload);
  return data as { quota: QuotaFissa };
}

export async function deleteQuotaFissa(quotaId: string) {
  const { data } = await api.delete(`/tariffe/quote-fisse/${quotaId}`);
  return data as { ok: boolean };
}

export async function createComponenteMC(categoryId: string, payload: {
  codice: string;
  prezzo_mc: number;
}) {
  const { data } = await api.post(
    `/tariffe/categories/${categoryId}/componenti-mc`,
    payload
  );
  return data as { componente: ComponenteMC };
}

export async function updateComponenteMC(componenteId: string, payload: {
  codice: string;
  prezzo_mc: number;
}) {
  const { data } = await api.put(
    `/tariffe/componenti-mc/${componenteId}`,
    payload
  );
  return data as { componente: ComponenteMC };
}

export async function deleteComponenteMC(componenteId: string) {
  const { data } = await api.delete(
    `/tariffe/componenti-mc/${componenteId}`
  );
  return data as { ok: boolean };
}
