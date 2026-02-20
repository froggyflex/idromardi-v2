import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import api from "../api/client";
import type { Condominio } from "../types/condominio";
import type { Utenza } from "../types/utenza";
 
export default function CondominioDetail() {
  const { id } = useParams();
  const [condominio, setCondominio] = useState<Condominio | null>(null);
  const [utenze, setUtenze] = useState<Utenza[]>([]);

  useEffect(() => {
    api.get(`/condomini/${id}`).then(res => {
      setCondominio(res.data);
    });

    api.get(`/utenze?condominio_id=${id}`).then(res => {
      setUtenze(res.data);
    });
  }, [id]);

  if (!condominio) return <div>Loading...</div>;

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-2">
        {condominio.nome}
      </h2>

      <p className="text-gray-600 mb-6">
        {condominio.indirizzo} - {condominio.citta}
      </p>

      <div className="bg-white shadow rounded">
        <table className="w-full">
          <thead className="bg-gray-100 text-left">
            <tr>
              <th className="p-3">Interno</th>
              <th className="p-3">Intestatario</th>
              <th className="p-3">Stato</th>
            </tr>
          </thead>
          <tbody>
            {utenze.map(u => (
              <tr key={u.id} className="border-t hover:bg-gray-50">
                <td className="p-3">{u.interno}</td>
                <td className="p-3">
                  {u.intestatario_nome} {u.intestatario_cognome}
                </td>
                <td className="p-3">{u.stato}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
