import { useNavigate } from "react-router-dom";
import api from "../api/client";
import CondominioForm from "./components/CondominioForm";
import { useEffect, useState } from "react";

export default function CondominioCreate() {
    const navigate = useNavigate();
    const [nextCodice, setNextCodice] = useState<number | null>(null);

    useEffect(() => {
    api.get("/condomini/next-codice").then(res => {
        setNextCodice(res.data.nextCodice);
    });
    }, []);

  const initialValues = {
    codice: nextCodice?.toString() || "",
    nome: "",
    indirizzo: "",
    cap: "",
    citta: "",
    isolato: "",
    scala: "",
    iva: "",
    sezione: "",
    ruolo: "",
    nuae: "",
    categoria: "",
    contratto: "",
    totale_residenti: 0,
    potenza_contatore: "",
    oneri: 0,
    oneri_doppio: 0,
    annotazione: "",
    fatturazione: "TRIM",
    registro_pagamenti: "",
    periodo_letture_utenti: 1,
    arco_temporale: "",
    stato: "ATTIVO",
  };

  return (
    <CondominioForm
      initialValues={initialValues}
      codicePreview={nextCodice}
      onSubmit={async (data) => {
      try {
            const res = await api.post("/condomini", data);
            navigate(`/condomini/${res.data.id}`);
        } catch (err) {
            alert("Errore durante la creazione del condominio");
        }
     }}
    />
  );
}
