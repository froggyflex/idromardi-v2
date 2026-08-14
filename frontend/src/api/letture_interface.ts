import type { ReactNode } from "react";

export interface Stato {
  codice: string;
  descrizione: string;
}

export interface Utenza {
  [x: string]: ReactNode;
  id: string;
  id_user?: string;
  nome?: string;
  cognome?: string;
  interno?: string;
}

export interface HistoryRow {
  period_year: number;
  period_month: number;
  data_lettura_operatore?: string | null;
  data_lettura_casa_idrica?: string | null;
  valore_lettura: number | null;
  stato_lettura: string;
  consumo_fatturato?: number | string | null;
  consumo_calcolato?: number | string | null;
  consumo_storico?: number | string | null;
  consumo_source?: "fatturato" | "calcolato" | null;
}

export interface GridRow {
  utenza: Utenza;
  current: {
    valore: number | null;
    stato: string;
  };
  history: HistoryRow[];
}

export interface Session {
  data_lettura_operatore: any;
  data_lettura_casa_idrica: any;
  dataCasa: any;
  dataOperatore: any;
  id: string;
  stato: "BOZZA" | "CHIUSA";
  period_year: number;
  period_month: number;
}
