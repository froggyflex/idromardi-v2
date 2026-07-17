import { useEffect, useState } from "react";
import api from "../../api/client";

type Props = { sessionId: string; disabled?: boolean };
type Operator = { id: string; username: string; role: "ADMIN" | "REVIEWER" | "METER_READER" };

export default function MobileAssignmentControls({ sessionId, disabled = false }: Props) {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [operatorId, setOperatorId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api.get("/auth/users").then(({ data }) => {
      const available = (data.users || []).filter((user: Operator) =>
        ["METER_READER", "ADMIN"].includes(user.role)
      );
      setOperators(available);
      setOperatorId(available[0]?.id || "");
    }).catch(() => setOperators([]));
  }, []);

  async function createAssignment() {
    if (!operatorId) return;
    setLoading(true);
    setMessage("");
    try {
      const { data } = await api.post("/mobile-readings/assignments", { sessionId, operatorId });
      setMessage(`Giro pronto: ${data.items?.length || 0} contatori. L'operatore può scaricarlo dall'app.`);
    } catch (error: any) {
      setMessage(error?.response?.data?.error || "Impossibile preparare il giro mobile.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex-1">
          <div className="text-sm font-bold text-blue-950">Giro letture mobile</div>
          <div className="mt-1 text-xs text-blue-700">Prepara una copia contestualizzata utilizzabile anche senza rete.</div>
        </div>
        <label className="min-w-56 text-xs font-semibold text-blue-900">
          Operatore
          <select value={operatorId} onChange={(e) => setOperatorId(e.target.value)} disabled={disabled || loading}
            className="mt-1 block w-full rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm text-slate-800">
            {operators.length === 0 && <option value="">Nessun operatore disponibile</option>}
            {operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.username} · {operator.role}</option>)}
          </select>
        </label>
        <button type="button" disabled={disabled || loading || !operatorId} onClick={createAssignment}
          className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
          {loading ? "Preparazione..." : "Prepara giro mobile"}
        </button>
      </div>
      {message && <div className="mt-3 text-xs font-semibold text-blue-900">{message}</div>}
    </div>
  );
}
