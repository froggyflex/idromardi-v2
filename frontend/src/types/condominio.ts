export interface Condominio {
  id: string;
  legacy_id?: number;

  codice: number;
  nome: string;
  indirizzo: string;
  cap?: string;
  citta?: string;

  isolato?: string;
  scala?: string;
  iva?: string;
  sezione?: string;
  ruolo?: string;
  nuae?: string;
  categoria?: string;
  totale_residenti?: number;
  potenza_contatore?: string;

  oneri?: number;
  oneri_doppio?: number;
  annotazione?: string;
  fatturazione?: "MEN" | "BIM" | "TRIM" | "SEM";
  registro_pagamenti?: string;
  periodo_letture_utenti?: number;
  arco_temporale?: string;

  codice_azienda?: number;
  contratto?: string;

  stato: "ATTIVO" | "CHIUSO";

  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}


export interface CondominioListItem {
  id: string;
  codice: number;
  nome: string;
  indirizzo: string;
  citta?: string;
  amministratore?: string;
  image_url?: string;
}


export interface CondominioContatto {
  id: string;
  condominio_id: string;

  nome: string;
  ruolo?: string;
  telefono?: string;
  email?: string;

  created_at?: string;
  updated_at?: string;
}


export type ApiResponse = {
  data: Condominio[];
  total: number;
  page: number;
  totalPages: number;
};
