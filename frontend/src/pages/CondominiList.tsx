import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import type { Condominio } from "../types/condominio";
import type { ApiResponse } from "../types/condominio";
import type { CondominioListItem } from "../types/condominio";

export default function CondominiList() {
 const [condomini, setCondomini] = useState<CondominioListItem[]>([]);
const [page, setPage] = useState(1);
const [totalPages, setTotalPages] = useState(1);
const [search, setSearch] = useState("");


useEffect(() => {
  const timeout = setTimeout(() => {
    api
      .get<ApiResponse>(
        `/condomini?page=${page}&limit=15&search=${search}`
      )
      .then((res) => {
        setCondomini(res.data.data);
        setTotalPages(res.data.totalPages);
      });
  }, 400); // debounce

  return () => clearTimeout(timeout);
}, [page, search]);


  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4">Condomini</h2>

<div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">

    <div style={{"padding":"10px"}} className="mb-4 flex justify-between items-center">
  
         <Link
            to="/condomini/new"
            className="px-4 py-2 bg-blue-600 text-white rounded-md"
          >
            Nuovo Condominio
          </Link>
 
      <input
        
        type="text"
        placeholder="Search codice, indirizzo, amministratore..."
        value={search}
        onChange={(e) => {
          setPage(1);
          setSearch(e.target.value);
        }}
        className="px-4 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>

  <table className="w-full text-sm">
    <thead className="bg-slate-100 text-slate-600 uppercase text-xs tracking-wide">
      <tr>
        <th className="px-4 py-3 text-left">Codice</th>
        <th className="px-4 py-3 text-left">Indirizzo</th>
        <th className="px-4 py-3 text-left">Amministratore</th>
         <th className="px-4 py-3 text-left">Azioni</th>
      </tr>
    </thead>
    <tbody>
      {condomini.map((c) => (
        <tr
          key={c.id}
          className="border-t border-slate-200 hover:bg-slate-50 transition"
        >
          <td className="px-4 py-3 font-medium text-slate-800">
            <Link
              to={`/condomini/${c.id}`}
              className="hover:text-blue-600"
            >
              {c.codice}
            </Link>
          </td>
          <td className="px-4 py-3 text-slate-600">
            {c.indirizzo}
          </td>
          <td className="px-4 py-3 text-slate-600">
            {c.amministratore || "-"}
          </td>
          <td><Link
              to={`/condomini/${c.id}`}
              className="px-4 py-2 bg-blue-600 text-white rounded-md"
            >
              Gestisci
            </Link>
          </td>
        </tr>
      ))}
    </tbody>
  </table>

  <div className="flex justify-between items-center mt-4">
  <button
    disabled={page === 1}
    onClick={() => setPage((p) => p - 1)}
    className="px-4 py-2 bg-slate-200 rounded disabled:opacity-50"
  >
    Precedente
  </button>

  <span className="text-sm text-slate-600">
    Pagina {page} di {totalPages}
  </span>

  <button
    disabled={page === totalPages}
    onClick={() => setPage((p) => p + 1)}
    className="px-4 py-2 bg-slate-200 rounded disabled:opacity-50"
  >
    Prossima
  </button>
</div>


</div>

</div>

    </div>
  );
}
