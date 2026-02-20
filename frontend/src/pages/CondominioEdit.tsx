import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import api from "../api/client";
import type { Condominio } from "../types/condominio";

export default function CondominioEdit() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [form, setForm] = useState<Condominio | null>(null);

  useEffect(() => {
    api.get(`/condomini/${id}`).then((res) => {
      setForm(res.data);
    });
  }, [id]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    if (!form) return;

    setForm({
      ...form,
      [e.target.name]:
        e.target.type === "number"
          ? Number(e.target.value)
          : e.target.value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;

    await api.put(`/condomini/${id}`, form);
    navigate(`/condomini/${id}`);
  };

  if (!form) return <div>Loading...</div>;

  return (
    <form onSubmit={handleSubmit} className="space-y-8">

      {/* ================== DATI ANAGRAFICI ================== */}
      <Section title="Dati Anagrafici">
        <Grid>

          <Input label="ID Condo" name="codice" value={form.codice} onChange={handleChange} type="number" />
          <Input label="Indirizzo" name="indirizzo" value={form.indirizzo || ""} onChange={handleChange} />
          <Input label="CAP" name="cap" value={form.cap || ""} onChange={handleChange} />
          <Input label="Isolato" name="isolato" value={form.isolato || ""} onChange={handleChange} />
          <Input label="Scala" name="scala" value={form.scala || ""} onChange={handleChange} />
          <Input label="Città" name="citta" value={form.citta || ""} onChange={handleChange} />
          <Input label="IVA" name="iva" value={form.iva || ""} onChange={handleChange} />
          <Input label="Sezione" name="sezione" value={form.sezione || ""} onChange={handleChange} />
          <Input label="Ruolo" name="ruolo" value={form.ruolo || ""} onChange={handleChange} />
          <Input label="NUAE" name="nuae" value={form.nuae || ""} onChange={handleChange} />
          <Input label="Categoria" name="categoria" value={form.categoria || ""} onChange={handleChange} />
          <Input label="Contratto" name="contratto" value={form.contratto || ""} onChange={handleChange} />
          <Input label="Totale Residenti" name="totale_residenti" value={form.totale_residenti || 0} onChange={handleChange} type="number" />
          <Input label="Potenza Contatore" name="potenza_contatore" value={form.potenza_contatore || ""} onChange={handleChange} />

        </Grid>
      </Section>

      {/* ================== DATI ECONOMICI ================== */}
      <Section title="Dati Economici">
        <Grid>

          <Input label="Oneri" name="oneri" value={form.oneri || 0} onChange={handleChange} type="number" />
          <Input label="Oneri Doppio Contatore" name="oneri_doppio" value={form.oneri_doppio || 0} onChange={handleChange} type="number" />

          <div className="col-span-2">
            <label className="block text-sm text-slate-600 mb-1">
              Annotazione
            </label>
            <textarea
              name="annotazione"
              value={form.annotazione || ""}
              onChange={handleChange}
              className="w-full border border-slate-300 rounded-md px-3 py-2"
            />
          </div>

          <Select
            label="Fatturazione"
            name="fatturazione"
            value={form.fatturazione || "TRIM"}
            onChange={handleChange}
            options={["MEN", "BIM", "TRIM", "SEM"]}
          />

          <Input
            label="Registro Pagamenti"
            name="registro_pagamenti"
            value={form.registro_pagamenti || ""}
            onChange={handleChange}
          />

          <Input
            label="Periodo Letture Utenti"
            name="periodo_letture_utenti"
            value={form.periodo_letture_utenti || 1}
            onChange={handleChange}
            type="number"
          />

          <Input
            label="Arco Temporale"
            name="arco_temporale"
            value={form.arco_temporale || ""}
            onChange={handleChange}
          />

        </Grid>
      </Section>

      <div className="flex justify-end space-x-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="px-4 py-2 border border-slate-300 rounded-md"
        >
          Annulla
        </button>

        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 text-white rounded-md"
        >
          Salva Modifiche
        </button>
      </div>

    </form>
  );
}
function Section({ title, children }: any) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6">
      <h3 className="text-lg font-semibold mb-6 text-slate-800">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Grid({ children }: any) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {children}
    </div>
  );
}

function Input({ label, ...props }: any) {
  return (
    <div>
      <label className="block text-sm text-slate-600 mb-1">
        {label}
      </label>
      <input
        {...props}
        className="w-full border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

function Select({ label, options, ...props }: any) {
  return (
    <div>
      <label className="block text-sm text-slate-600 mb-1">
        {label}
      </label>
      <select
        {...props}
        className="w-full border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500"
      >
        {options.map((o: string) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}
