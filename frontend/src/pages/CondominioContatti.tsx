import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import api from "../api/client";
import type { CondominioContatto } from "../types/condominio";
import ContattoForm from "./components/ContattoForm";

export default function CondominioContatti() {
  const { id } = useParams();
  const [contatti, setContatti] = useState<CondominioContatto[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CondominioContatto | null>(null);

  const load = () => {
    api.get(`/condomini/${id}/contatti`).then((res) => {
      setContatti(res.data);
    });
  };

  useEffect(() => {
    load();
  }, [id]);

  const handleDelete = async (contattoId: string) => {
    if (!confirm("Sei sicuro di voler eliminare questo contatto?")) return;
    await api.delete(`/condomini/${id}/contatti/${contattoId}`);
    load();
  };

  return (
    <div className="space-y-6">

      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-semibold text-slate-800">
          Contatti Condominio
        </h2>

        <button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="px-4 py-2 bg-blue-600 text-white rounded-md"
        >
          Nuovo Contatto
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-600 uppercase text-xs">
            <tr>
              <th className="px-4 py-3 text-left">Nome</th>
              <th className="px-4 py-3 text-left">Ruolo</th>
              <th className="px-4 py-3 text-left">Telefono</th>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {contatti.map((c) => (
              <tr
                key={c.id}
                className="border-t border-slate-200 hover:bg-slate-50"
              >
                <td className="px-4 py-3 font-medium text-slate-800">
                  {c.nome}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {c.ruolo || "-"}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {c.telefono || "-"}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {c.email || "-"}
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button
                    onClick={() => {
                      setEditing(c);
                      setShowForm(true);
                    }}
                    className="text-blue-600 text-sm"
                  >
                    Modifica
                  </button>
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="text-red-600 text-sm"
                  >
                    Elimina
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <ContattoForm
          condominioId={id!}
          initial={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}
    </div>
  );
}
