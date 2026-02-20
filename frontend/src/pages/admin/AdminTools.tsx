import { useState } from "react";
import api from "../../api/client";

export default function AdminTools() {
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState<number | null>(null);

  const handleGeocode = async () => {
    setLoading(true);
    setUpdated(null);

    const res = await api.post("/admin/geocode-condomini")


    setUpdated(res.data.updated);
    setLoading(false);
  };

  return (
    <div className="space-y-6">

      <div className="bg-white border rounded-lg p-6">

        <h2 className="text-lg font-semibold mb-4">
          Strumenti Sistema
        </h2>

        <button
          onClick={handleGeocode}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-md"
        >
          {loading
            ? "Geolocalizzazione in corso..."
            : "Geolocalizza Condomini Mancanti"}
        </button>

        {updated !== null && (
          <div className="mt-4 text-green-600">
            Aggiornati {updated} condomini.
          </div>
        )}

      </div>

    </div>
  );
}
