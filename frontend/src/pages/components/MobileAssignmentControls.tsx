import { useEffect, useState } from "react";
import api from "../../api/client";
import { Smartphone, Loader2 } from "lucide-react";

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
    <section aria-label="Giro letture mobile" className="border-b border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Smartphone size={17} aria-hidden="true" />
          Giro letture mobile
        </div>
        <label className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-slate-600">
          Operatore
          <select value={operatorId} onChange={(e) => setOperatorId(e.target.value)} disabled={disabled || loading}
            className="h-9 w-56 max-w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800">
            {operators.length === 0 && <option value="">Nessun operatore disponibile</option>}
            {operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.username} · {operator.role}</option>)}
          </select>
        </label>
        <button type="button" disabled={disabled || loading || !operatorId} onClick={createAssignment}
          className="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40">
          {loading && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          {loading ? "Preparazione..." : "Prepara giro mobile"}
        </button>
      </div>
      {message && <div role="status" className="mt-2 text-xs font-medium text-slate-700">{message}</div>}
    </section>
  );
}
