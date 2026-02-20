import { useParams, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import api from "../api/client";
import type { CondominioListItem, Condominio } from "../types/condominio";

export default function CondominioOverview() {
  const { id } = useParams();
  const [condominio, setCondominio] = useState<CondominioListItem | null>(null);

  useEffect(() => {
    api.get(`/condomini/${id}`).then((res) => {
      setCondominio(res.data);
    });
  }, [id]);

  if (!condominio) return <div>Loading...</div>;

  return (
<div className="space-y-8">

    {/* ================= HEADER SECTION ================= */}
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">

        <div className="grid grid-cols-1 md:grid-cols-3">

            {/* ================= IMAGE BLOCK ================= */}
            <div className="relative h-56 md:h-full">

            {condominio.image_url ? (
                <img
                src={condominio.image_url}
                alt={condominio.nome}
                className="w-full h-full object-cover"
                />
            ) : (
                <div className="w-full h-full flex items-center justify-center
                                bg-gradient-to-br from-blue-100 to-blue-300">

                <div className="w-24 h-24 rounded-full bg-white
                                flex items-center justify-center
                                text-2xl font-semibold text-blue-600 shadow">
                    {getInitials(condominio.nome)}
                </div>
                </div>
            )}

            {/* Upload Button Overlay */}
                <input
                type="file"
                accept="image/*"
                className="hidden"
                id="uploadInput"
                onChange={async (e) => {
                    if (!e.target.files?.[0]) return;

                    const formData = new FormData();
                    formData.append("image", e.target.files[0]);

                    const res = await api.post(
                    `/condomini/${condominio.id}/upload-image`,
                    formData,
                    { headers: { "Content-Type": "multipart/form-data" } }
                    );

                    window.location.reload(); // simple refresh for now
                }}
                />

                <button
                onClick={() => document.getElementById("uploadInput")?.click()}
                className="absolute top-3 right-3 bg-white/80 backdrop-blur px-3 py-1 rounded-md text-xs text-slate-700 hover:bg-white shadow"
                >
                Cambia Immagine
                </button>


            {/* Status Badge */}
            <div className="absolute bottom-3 left-3">
                {/* <StatusBadge stato={condominio.stato} /> */}
            </div>

            </div>

            {/* ================= INFO BLOCK ================= */}
            <div className="col-span-2 p-6 flex flex-col justify-between">

            <div>
                <h2 className="text-2xl font-semibold text-slate-800">
                Condominio {condominio.codice}
                </h2>

                <p className="text-slate-500 mt-1">
                {condominio.indirizzo} - {condominio.citta}
                </p>

                <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
                 
                <Info label="Amministratore" value={condominio.amministratore} />
                 
                </div>
            </div>

            <div className="flex justify-end pt-6">
                <Link
                to={`/condomini/${condominio.id}/edit`}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                Modifica
                </Link>
            </div>

            </div>
        </div>
        </div>
    </div>
  );
}
function Info({ label, value }: { label: string; value?: any }) {
  return (
    <div>
      <div className="text-xs text-slate-400 uppercase mb-1">
        {label}
      </div>
      <div className="text-slate-800 font-medium">
        {value || "-"}
      </div>
    </div>
  );
}


function Detail({ label, value }: { label: string; value?: any }) {
  return (
    <div>
      <div className="text-xs text-slate-400 uppercase mb-1">{label}</div>
      <div className="text-slate-800 font-medium">
        {value || "-"}
      </div>
    </div>
  );
}
function getInitials(name?: string) {
  if (!name) return "CO";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();
}

function StatusBadge({ stato }: { stato: string }) {
  const isActive = stato === "ATTIVO";

  return (
    <span
      className={`px-3 py-1 text-xs font-medium rounded-full
        ${isActive
          ? "bg-green-100 text-green-700"
          : "bg-red-100 text-red-700"}`}
    >
      {stato}
    </span>
  );
}
