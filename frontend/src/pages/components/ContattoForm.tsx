
import { useEffect, useState } from "react";
import api from "../../api/client";
import type { CondominioContatto } from "../../types/condominio";
 
 function ContattoForm({
  condominioId,
  initial,
  onClose,
  onSaved,
}: {
  condominioId: string;
  initial: CondominioContatto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    nome: initial?.nome || "",
    ruolo: initial?.ruolo || "",
    telefono: initial?.telefono || "",
    email: initial?.email || "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.nome.trim()) {
      alert("Il nome è obbligatorio.");
      return;
    }

    if (initial) {
      await api.put(
        `/condomini/${condominioId}/contatti/${initial.id}`,
        form
      );
    } else {
      await api.post(
        `/condomini/${condominioId}/contatti`,
        form
      );
    }

    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center">

      <div className="bg-white rounded-lg p-6 w-full max-w-md">

        <h3 className="text-lg font-semibold mb-4">
          {initial ? "Modifica Contatto" : "Nuovo Contatto"}
        </h3>

        <form onSubmit={handleSubmit} className="space-y-4">

          <Input label="Nome" name="nome" value={form.nome} onChange={handleChange} required />
          <Input label="Ruolo" name="ruolo" value={form.ruolo} onChange={handleChange} />
          <Input label="Telefono" name="telefono" value={form.telefono} onChange={handleChange} />
          <Input label="Email" name="email" value={form.email} onChange={handleChange} />

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 rounded-md"
            >
              Annulla
            </button>

            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md"
            >
              Salva
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}

function Input({
  label,
  name,
  value,
  onChange,
  required,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm text-slate-600 mb-1">
        {label}
      </label>
      <input
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        className="w-full px-4 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

export default ContattoForm;
