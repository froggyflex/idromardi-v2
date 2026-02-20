import { useState } from "react";
import api from "../../api/client";
import { useEffect } from "react";


type Props = {
  initialValues: any;
  onSubmit: (data: any) => Promise<void>;
  codicePreview?: number | null;
};

export default function CondominioForm({
  initialValues,
  codicePreview,
  onSubmit,
}: Props) {
  const [form, setForm] = useState(initialValues);
  const [loading, setLoading] = useState(false);
  const [codiceAvailable, setCodiceAvailable] = useState(true);
  const [codiceTouched, setCodiceTouched] = useState(false);


  useEffect(() => {
    if (codicePreview && !codiceTouched && !form.codice) {
      setForm((prev: any) => ({
        ...prev,
        codice: codicePreview,
      }));
    }
  }, [codicePreview]);


  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;

    setForm({
      ...form,
      [name]: type === "number" ? Number(value) : value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await onSubmit(form);
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-10">

      {/* ================= DATI ANAGRAFICI ================= */}
      <div>
       

      </div>
      <Section title="Dati Anagrafici">
        <Grid>
         <div>
            <label className="block text-sm text-slate-600 mb-1">
              Codice {codicePreview && `(proposto: ${codicePreview})`}
            </label>
            
            <input
              name="codice"
              type="number"
              value={ form.codice ?? "" }
              onChange={async (e) => {
                  const value = Number(e.target.value);

                  setCodiceTouched(true);

                  setForm((prev: any) => ({
                    ...prev,
                    codice: value,
                  }));

                  if (value) {
                    try {
                      const res = await api.get(`/condomini/check-codice/${value}`);
                      setCodiceAvailable(!res.data.exists);
                    } catch {
                      setCodiceAvailable(true);
                    }
                  }
                }}
              className={`w-full border rounded-md px-3 py-2
                ${codiceAvailable
                  ? "border-slate-300"
                  : "border-red-500 bg-red-50"}`}
            />

            {!codiceAvailable && (
              <p className="text-xs text-red-500 mt-1">
                Questo codice è già utilizzato.
              </p>
            )}

            <p className="text-xs text-slate-400 mt-1">
              Proposto automaticamente, ma modificabile. Se lasciato vuoto, verrà assegnato il prossimo codice disponibile al momento del salvataggio.
            </p>
          </div>
          <Input label="Nome" name="nome" value={form.nome} onChange={handleChange} required />
          <Input label="Indirizzo" name="indirizzo" value={form.indirizzo} onChange={handleChange} required />
          <Input label="CAP" name="cap" value={form.cap} onChange={handleChange} />
          <Input label="Città" name="citta" value={form.citta} onChange={handleChange} required />
          <Input label="Isolato" name="isolato" value={form.isolato} onChange={handleChange} />
          <Input label="Scala" name="scala" value={form.scala} onChange={handleChange} />
          <Input label="IVA" name="iva" value={form.iva} onChange={handleChange} />
          <Input label="Sezione" name="sezione" value={form.sezione} onChange={handleChange} />
          <Input label="Ruolo" name="ruolo" value={form.ruolo} onChange={handleChange} />
          <Input label="NUAE" name="nuae" value={form.nuae} onChange={handleChange} />
          <Input label="Categoria" name="categoria" value={form.categoria} onChange={handleChange} />
          <Input label="Contratto" name="contratto" value={form.contratto} onChange={handleChange} />
          <Input label="Totale Residenti" name="totale_residenti" type="number" value={form.totale_residenti} onChange={handleChange} />
          <Input label="Potenza Contatore" name="potenza_contatore" value={form.potenza_contatore} onChange={handleChange} />

          <Select
            label="Stato"
            name="stato"
            value={form.stato}
            onChange={handleChange}
            options={["ATTIVO", "CHIUSO"]}
          />

        </Grid>
      </Section>

      {/* ================= DATI ECONOMICI ================= */}
      <Section title="Dati Economici">
        <Grid>

          <Input label="Oneri" name="oneri" type="number" value={form.oneri} onChange={handleChange} />
          <Input label="Oneri Doppio Contatore" name="oneri_doppio" type="number" value={form.oneri_doppio} onChange={handleChange} />

          <Select
            label="Fatturazione"
            name="fatturazione"
            value={form.fatturazione}
            onChange={handleChange}
            options={["MEN", "BIM", "TRIM", "SEM"]}
          />

          <Input
            label="Registro Pagamenti"
            name="registro_pagamenti"
            value={form.registro_pagamenti}
            onChange={handleChange}
          />

          <Input
            label="Periodo Letture Utenti"
            name="periodo_letture_utenti"
            type="number"
            value={form.periodo_letture_utenti}
            onChange={handleChange}
          />

          <Input
            label="Arco Temporale"
            name="arco_temporale"
            value={form.arco_temporale}
            onChange={handleChange}
          />

          <div className="col-span-1 md:col-span-2">
            <label className="block text-sm text-slate-600 mb-1">
              Annotazione
            </label>
            <textarea
              name="annotazione"
              value={form.annotazione}
              onChange={handleChange}
              className="w-full border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500"
              rows={3}
            />
          </div>

        </Grid>
      </Section>

      {/* ================= SUBMIT ================= */}
      <div className="flex justify-end pt-4">
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Salvataggio..." : "Salva"}
        </button>
      </div>

    </form>
  );
}

/* ================= REUSABLE COMPONENTS ================= */

function Section({ title, children }: any) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6">
      <h3 className="text-lg font-semibold text-slate-800 mb-6">
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

function Input({ label, required, ...props }: any) {
  return (
    <div>
      <label className="block text-sm text-slate-600 mb-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <input
        {...props}
        required={required}
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
