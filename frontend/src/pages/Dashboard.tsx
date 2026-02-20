import { useEffect, useState } from "react";
import api from "../api/client";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap
} from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer
} from "recharts";
import "leaflet/dist/leaflet.css";

// Fix Leaflet icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ---------- FIT BOUNDS COMPONENT ----------
function FitBounds({ data }: { data: any[] }) {
  const map = useMap();

  useEffect(() => {
    if (!data.length) return;

    const bounds = L.latLngBounds(
      data.map(c => [c.latitude, c.longitude])
    );

    map.fitBounds(bounds, { padding: [80, 80] });

  }, [data, map]);

  return null;
}


// ---------- MAIN DASHBOARD ----------
export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [mapData, setMapData] = useState<any[]>([]);

  useEffect(() => {
    api.get("/dashboard/stats").then(res => setStats(res.data));
    api.get("/dashboard/map").then(res => { console.log("RAW MAP DATA SAMPLE:", res.data.slice(0, 5));
    setMapData(res.data)});
  }, []);

  //  SANITIZE DATA ONCE
        const validMapData = mapData
        .filter(c => {
            const lat = Number(c.latitude);
            const lng = Number(c.longitude);

            return (
            !isNaN(lat) &&
            !isNaN(lng) &&
            lat !== 0 &&
            lng !== 0 &&
            lat > 35 && lat < 47 &&
            lng > 6 && lng < 19
            );
        })
        .map(c => ({
            ...c,
            latitude: Number(c.latitude),
            longitude: Number(c.longitude),
        }));


    const defaultCenter: [number, number] = [40.8065, 14.2055];
     

  return (
    <div className="bg-white border rounded-xl p-4 shadow-sm">

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card title="Condomini Attivi">
          <div className="text-3xl font-semibold text-blue-600">
            {stats?.condomini.active ?? "-"}
          </div>
        </Card>

        <Card title="Utenze Attive">
          <div className="text-3xl font-semibold text-green-600">
            {stats?.utenze.active ?? "-"}
          </div>
        </Card>
      </div>

      {/* Chart */}
      {stats && (
        <div className="bg-white border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">
            Stato Condomini
          </h2>

          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={[
                  { name: "Attivi", value: stats.condomini.active },
                  {
                    name: "Non Attivi",
                    value:
                      stats.condomini.total -
                      stats.condomini.active,
                  },
                ]}
                dataKey="value"
                outerRadius={80}
                label
              >
                <Cell fill="#2563eb" />
                <Cell fill="#94a3b8" />
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Map */}
      <div className="bg-white border rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-4">
          Mappa Condomini
        </h2>

        <MapContainer
          center={defaultCenter}
          zoom={25}
          className="h-[650px] w-full rounded-xl"
        >
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* Fit bounds only on valid data */}
          <FitBounds data={validMapData} />

          <MarkerClusterGroup
            iconCreateFunction={(cluster: { getChildCount: () => any; }) => {
                const count = cluster.getChildCount();

                return L.divIcon({
                html: `
                    <div class="custom-cluster">
                    ${count}
                    </div>
                `,
                className: "cluster-wrapper",
                iconSize: L.point(50, 50, true),
                });
            }}
            >

            {validMapData.map(c => (
            <Marker
                key={c.id}
                position={[
                    parseFloat(c.latitude),
                    parseFloat(c.longitude)
                ]}
            >
                <Popup>
                <strong>ID {c.codice}</strong>
                <br />
                {c.indirizzo}
                </Popup>
            </Marker>
            ))}

          </MarkerClusterGroup>
        </MapContainer>
      </div>
    </div>
  );
}

function Card({ title, children }: any) {
  return (
    <div className="bg-white border rounded-lg p-6">
      <div className="text-sm text-slate-500 mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}
