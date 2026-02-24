import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api/client";

type BillingGroup = {
  id: string;
  nome: string;
  condominio_id: string;
};

type Utenza = {
  id: string;

  condominio_id: string;
  id_user: number;

  Nome: string;
  Cognome: string;

  Interno: string;
  Scala: string | null;
  Isolato: string | null;
  Piano: number;
  billing_group_id: string | null;
  Mobile: string | null;
  Fisso: string | null;
  C_F: string | null;

  Matricola_Contatore: string;

  Doppio_Contatore: "SI" | "NO";
  Contatore_Inverso: "SI" | "NO";
  Bonus_Idrico: "SI" | "NO";
  Tipo: "NORMAL" | "SPECIAL";
  Palazzina: "SI" | "NO";
  Domestico: "SI" | "NO";
  Artigianale: "SI" | "NO";

  Nucleo: number;

  stato: "ATTIVA" | "CHIUSA";

  created_at?: string;
  updated_at?: string;
};

type RowError = {
  id: string;
  fields: Partial<Record<keyof Utenza, string>>;
};

function normStr(v: unknown) {
  return String(v ?? "").trim();
}

function toIntSafe(v: unknown, fallback = 0) {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toNumSafe(v: unknown, fallback = 0) {
  const n = Number(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

export default function CondominioUtenze() {
  const { id: condominioId } = useParams();
  const [loading, setLoading] = useState(true);
  const [original, setOriginal] = useState<Utenza[]>([]);
  const [draft, setDraft] = useState<Utenza[]>([]);
  const [query, setQuery] = useState("");
  const [errors, setErrors] = useState<RowError[]>([]);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Utenza | null>(null);
  const [deleteResequence, setDeleteResequence] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
 
  const [billingGroups, setBillingGroups] = useState<BillingGroup[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);

  
  useEffect(() => {
    if (!condominioId) return;
    (async () => {
      setLoading(true);
      try {
        // expects backend already filters to ATTIVA; if not, we filter in UI too.
        const res = await api.get<Utenza[]>(`/condomini/${condominioId}/utenze`);
        const rows = (res.data ?? []).slice().sort((a, b) => a.id_user - b.id_user);
        setOriginal(rows);
        setDraft(rows);

        const bgRes = await api.get<BillingGroup[]>(
          `/condomini/${condominioId}/billing-groups`
        );
        setBillingGroups(bgRes.data ?? []);

      } finally {
        setLoading(false);
      }
    })();
  }, [condominioId]);

  const dirtyIds = useMemo(() => {
    const map = new Map(original.map((r) => [r.id, r]));
    const out = new Set<string>();
    for (const r of draft) {
      const o = map.get(r.id);
      if (!o) continue;
      if (JSON.stringify(o) !== JSON.stringify(r)) out.add(r.id);
    }
    return out;
  }, [original, draft]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = draft.filter((r) => r.stato !== "CHIUSA"); // keep only active in table view
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        r.id_user,
        r.Nome,
        r.Cognome,
        r.Interno,
        r.Scala,
        r.Isolato,
        r.Mobile,
        r.Matricola_Contatore,
      ]
        .map((x) => String(x ?? ""))
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [draft, query]);

  function setCell(rowId: string, key: keyof Utenza, value: any) {
    setDraft((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, [key]: value } : r))
    );
  }

  function validate(rows: Utenza[]): RowError[] {
    // Enforce uniqueness in-memory for what the platform cares about (ATTIVA rows)
    const errs: RowError[] = [];

    const active = rows.filter((r) => r.stato === "ATTIVA");

    // id_user must be unique per condominio (hard rule)
    const idUserMap = new Map<number, Utenza[]>();
    for (const r of active) {
      const key = toIntSafe(r.id_user, 0);
      if (!idUserMap.has(key)) idUserMap.set(key, []);
      idUserMap.get(key)!.push(r);
    }
    for (const [k, list] of idUserMap.entries()) {
      if (!k || list.length <= 1) continue;
      for (const r of list) {
        errs.push({
          id: r.id,
          fields: { id_user: `id_user duplicato (${k}) nello stesso condominio` },
        });
      }
    }

    // interno: you said duplicates may exist for CHIUSA; for ATTIVA we enforce uniqueness here
    const internoMap = new Map<string, Utenza[]>();
    for (const r of active) {
      const key = normStr(r.Interno);
      if (!internoMap.has(key)) internoMap.set(key, []);
      internoMap.get(key)!.push(r);
    }
    for (const [k, list] of internoMap.entries()) {
      if (!k || list.length <= 1) continue;
      for (const r of list) {
        errs.push({
          id: r.id,
          fields: { Interno: `Interno duplicato (${k}) tra utenze ATTIVE` },
        });
      }
    }

    // basic sanity
    for (const r of active) {
      const f: RowError = { id: r.id, fields: {} };
      if (!normStr(r.Interno)) f.fields.Interno = "Interno obbligatorio";
      if (toIntSafe(r.id_user, 0) <= 0) f.fields.id_user = "id_user deve essere > 0";
      if (toIntSafe(r.Nucleo, 0) < 0) f.fields.Nucleo = "Nucleo non valido";
      if (Object.keys(f.fields).length) errs.push(f);
    }

    // merge per id
    const merged = new Map<string, RowError>();
    for (const e of errs) {
      const cur = merged.get(e.id);
      if (!cur) merged.set(e.id, e);
      else merged.set(e.id, { id: e.id, fields: { ...cur.fields, ...e.fields } });
    }
    return Array.from(merged.values());
  }

  const errorMap = useMemo(() => {
    const m = new Map<string, RowError>();
    for (const e of errors) m.set(e.id, e);
    return m;
  }, [errors]);

  async function reload() {
    if (!condominioId) return;
    setLoading(true);
    try {
      const res = await api.get<Utenza[]>(`/condomini/${condominioId}/utenze`);
      const rows = (res.data ?? []).slice().sort((a, b) => a.id_user - b.id_user);
      setOriginal(rows);
      setDraft(rows);
      setErrors([]);
    } finally {
      setLoading(false);
    }
  }

  async function onSaveAll() {
    // validate whole draft (ATTIVA)
    const v = validate(draft);
    setErrors(v);
    if (v.length) return;

    const changes = draft.filter((r) => dirtyIds.has(r.id));
    if (changes.length === 0) return;

    console.log(changes)

    setSaving(true);
    try {
      // send only fields that backend updates (add more if you want)
      const payload = changes.map((r) => ({
        id: r.id,
        id_user: r.id_user,
        Nome: r.Nome,
        Cognome: r.Cognome,
        Interno: r.Interno,
        Scala: r.Scala,
        Isolato: r.Isolato,
        Piano: r.Piano,
        Mobile: r.Mobile,
        Fisso: r.Fisso,
        C_F: r.C_F,
        Nucleo: r.Nucleo,
        billing_group_id: r.billing_group_id,
        Matricola_Contatore: r.Matricola_Contatore,
        Doppio_Contatore: r.Doppio_Contatore,
        Contatore_Inverso: r.Contatore_Inverso,
        Bonus_Idrico: r.Bonus_Idrico,
        Tipo: r.Tipo,
        Palazzina: r.Palazzina,
        Domestico: r.Domestico,
        Artigianale: r.Artigianale,
        stato: r.stato,
      }));

      await api.put(`/condomini/${condominioId}/utenze/batch`, payload);
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function onAdd() {
    
    if (!condominioId) return;
    // minimal new row; backend assigns next id_user
    const blank = {
      Nome: "",
      Cognome: "",
      Interno: "",
      Scala: null,
      Isolato: null,
      Piano: 0,
      Mobile: null,
      Fisso: null,
      C_F: null,
      Nucleo: 0,
      Matricola_Contatore: "0000",
      Doppio_Contatore: "NO" as const,
      Contatore_Inverso: "NO" as const,
      Bonus_Idrico: "NO" as const,
      Tipo: "NORMAL" as const,
      Palazzina: "NO" as const,
      Domestico: "SI" as const,
      Artigianale: "NO" as const,
      stato: "ATTIVA" as const,
    };

    const res = await api.post(`/condomini/${condominioId}/utenze`, blank);
    // reload to get assigned id_user + id
    await reload();
    // optional: auto-scroll/highlight could be added
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/utenze/${deleteTarget.id}`, {
        data: { resequence: deleteResequence },
      });
      setDeleteTarget(null);
      setDeleteResequence(false);
      await reload();
    } finally {
      setDeleting(false);
    }
  }

  const dirtyCount = dirtyIds.size;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xl font-semibold text-slate-800">Utenze</div>
          <div className="text-sm text-slate-500">
            Modifica in batch. Ordinamento per <span className="font-medium">id_user</span>.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cerca (nome, interno, id_user...)"
              className="w-72 max-w-[70vw] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </div>

          <button
            onClick={onAdd}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            + Nuova Utenza
          </button>

          <button
            onClick={onSaveAll}
            disabled={saving || dirtyCount === 0}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? "Salvataggio..." : `Salva (${dirtyCount})`}
          </button>

          <button
            onClick={() => {
              setDraft(original);
              setErrors([]);
            }}
            disabled={saving || dirtyCount === 0}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Annulla
          </button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <div className="font-semibold">Errori di validazione</div>
          <div className="mt-1">
            Correggi i campi evidenziati (duplicati / campi obbligatori) prima di salvare.
          </div>
        </div>
      )}

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="max-h-[90vh] overflow-y-auto">
                <div className=" ">
            <div className="flex justify-between items-center mb-3">
     

            <button
                style={{"padding":"10px"}}
                onClick={() => setShowAdvanced(prev => !prev)}
                className="text-xs font-medium text-blue-600 hover:underline"
            >
                {showAdvanced ? "Nascondi Campi Avanzati ▴" : "Mostra Campi Avanzati ▾"}
            </button>
            </div>

          <table className="min-w-max border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr className="text-left text-slate-600">
                <Th className="w-[70px]">ID</Th>
                <Th>Nome</Th>
                <Th>Cognome</Th>
                <Th className="w-[90px]">Interno</Th>
                {showAdvanced && <Th>Scala</Th>}
                {showAdvanced && <Th>Isolato</Th>}
                {showAdvanced && <Th>Piano</Th>}
                {showAdvanced && <Th>Mobile</Th>}
                <Th  >Nucleo</Th>
                <Th  >Matricola</Th>
                <Th  >Billing Group</Th>
                <Th>Doppio</Th>
                <Th>Inverso</Th>
                <Th>Bonus</Th>
                <Th>Tipo</Th>
                <Th>Palazzina</Th>
                <Th>Dom</Th>
                <Th>Art</Th>
                <Th className="w-[120px]">Azioni</Th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={18} className="p-4 text-slate-500">
                    Caricamento...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={18} className="p-4 text-slate-500">
                    Nessuna utenza.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const isDirty = dirtyIds.has(r.id);
                  const rowErr = errorMap.get(r.id);

                  return (
                    <tr
                      key={r.id}
                      className={[
                        "border-t",
                        isDirty ? "bg-amber-50/40" : "bg-white",
                      ].join(" ")}
                    >
                      <Td>
                        <Input
                          value={r.id_user}
                          onChange={(v) => setCell(r.id, "id_user", toIntSafe(v, r.id_user))}
                          error={rowErr?.fields.id_user}
                          inputMode="numeric"
                        />
                      </Td>

                      <Td>
                        <Input
                          value={r.Nome}
                          onChange={(v) => setCell(r.id, "Nome", v)}
                          placeholder="(vuoto ok)"
                        />
                      </Td>

                      <Td>
                        <Input
                          value={r.Cognome}
                          onChange={(v) => setCell(r.id, "Cognome", v)}
                        />
                      </Td>

                      <Td>
                        <Input
                          value={r.Interno}
                          onChange={(v) => setCell(r.id, "Interno", v)}
                          error={rowErr?.fields.Interno}
                        />
                      </Td>

                        {showAdvanced && (
                        <Td>
                            <Input
                            value={r.Scala ?? ""}
                            onChange={(v) => setCell(r.id, "Scala", normStr(v) ? v : null)}
                            />
                        </Td>
                        )}

                        {showAdvanced && (
                        <Td>
                            <Input
                            value={r.Isolato ?? ""}
                            onChange={(v) => setCell(r.id, "Isolato", normStr(v) ? v : null)}
                            />
                        </Td>
                        )}

                        {showAdvanced && (
                        <Td>
                            <Input
                            value={r.Piano}
                            onChange={(v) => setCell(r.id, "Piano", toIntSafe(v, r.Piano))}
                            inputMode="numeric"
                            />
                        </Td>
                        )}

                        {showAdvanced && (
                      <Td>
                        <Input
                          value={r.Mobile ?? ""}
                          onChange={(v) => setCell(r.id, "Mobile", normStr(v) ? v : null)}
                        />
                      </Td>
                        )}

                      <Td>
                        <Input
                          value={r.Nucleo}
                          onChange={(v) => setCell(r.id, "Nucleo", toIntSafe(v, r.Nucleo))}
                          error={rowErr?.fields.Nucleo}
                          inputMode="numeric"
                        />
                      </Td>

                      <Td>
                        <Input
                          value={r.Matricola_Contatore}
                          onChange={(v) => setCell(r.id, "Matricola_Contatore", v)}
                        />
                      </Td>
                      <Td>
                        <div className="flex gap-2 items-center min-w-[180px]">
                          <select
                            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                            value={r.billing_group_id ?? ""}
                            onChange={(e) =>
                              setCell(
                                r.id,
                                "billing_group_id",
                                e.target.value || null
                              )
                            }
                          >
                            <option value="">— Nessun Gruppo —</option>
                            {billingGroups.map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.nome}
                              </option>
                            ))}
                          </select>

                          <button
                            onClick={() => setCreatingGroup(true)}
                            className="text-xs text-blue-600 hover:underline"
                            type="button"
                          >
                            +
                          </button>
                        </div>
                      </Td>
                      <Td>
                        <SelectYN
                          value={r.Doppio_Contatore}
                          onChange={(v) => setCell(r.id, "Doppio_Contatore", v)}
                        />
                      </Td>

                      <Td>
                        <SelectYN
                          value={r.Contatore_Inverso as any}
                          onChange={(v) => setCell(r.id, "Contatore_Inverso", v)}
                          options={[
                            { value: "NO", label: "NO" },
                            { value: "SI", label: "SI" },
                          ]}
                        />
                      </Td>

                      <Td>
                        <SelectYN
                          value={r.Bonus_Idrico as any}
                          onChange={(v) => setCell(r.id, "Bonus_Idrico", v)}
                          options={[
                            { value: "NO", label: "NO" },
                            { value: "SI", label: "SI" },
                          ]}
                        />
                      </Td>

                      <Td>
                        <select
                          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                          value={r.Tipo}
                          onChange={(e) => setCell(r.id, "Tipo", e.target.value)}
                        >
                          <option value="NORMAL">NORMAL</option>
                          <option value="SPECIAL">SPECIAL</option>
                        </select>
                      </Td>

                      <Td>
                        <SelectYN
                          value={r.Palazzina as any}
                          onChange={(v) => setCell(r.id, "Palazzina", v)}
                          options={[
                            { value: "NO", label: "NO" },
                            { value: "SI", label: "SI" },
                          ]}
                        />
                      </Td>

                      <Td>
                        <SelectYN
                          value={r.Domestico as any}
                          onChange={(v) => setCell(r.id, "Domestico", v)}
                          options={[
                            { value: "SI", label: "SI" },
                            { value: "NO", label: "NO" },
                          ]}
                        />
                      </Td>

                      <Td>
                        <SelectYN
                          value={r.Artigianale as any}
                          onChange={(v) => setCell(r.id, "Artigianale", v)}
                          options={[
                            { value: "NO", label: "NO" },
                            { value: "SI", label: "SI" },
                          ]}
                        />
                      </Td>

                      <Td>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setDeleteTarget(r)}
                            className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
                          >
                            Elimina
                          </button>
                        </div>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div> 
        </div>
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <div className="text-lg font-semibold text-slate-800">
              Chiudere questa utenza?
            </div>
            <div className="mt-1 text-sm text-slate-600">
              Verrà impostata come <span className="font-medium">CHIUSA</span>. Vuoi anche
              riordinare gli <span className="font-medium">id_user</span> delle utenze ATTIVE?
            </div>

            <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={deleteResequence}
                onChange={(e) => setDeleteResequence(e.target.checked)}
              />
              Riordina (1..N) dopo la rimozione
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteResequence(false);
                }}
                disabled={deleting}
              >
                Annulla
              </button>

              <button
                className="rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50"
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? "Eliminazione..." : "Conferma"}
              </button>
            </div>
          </div>
        </div>
      )}

      {creatingGroup && (
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
        <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
          <div className="text-lg font-semibold text-slate-800">
            Nuovo Billing Group
          </div>

          <input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="Nome gruppo"
            className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />

          <div className="mt-5 flex justify-end gap-2">
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              onClick={() => {
                setCreatingGroup(false);
                setNewGroupName("");
              }}
            >
              Annulla
            </button>

            <button
              className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white"
              onClick={async () => {
                if (!newGroupName.trim()) return;

                const res = await api.post(
                  `/condomini/${condominioId}/billing-groups`,
                  { nome: newGroupName }
                );

                setBillingGroups((prev) => [...prev, res.data]);
                setCreatingGroup(false);
                setNewGroupName("");
              }}
            >
              Crea
            </button>
          </div>
        </div>
      </div>
    )}
    </div>
  );
}

function Th({ children, className = "" }: any) {
  return (
    <th className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide ${className}`}>
      {children}
    </th>
  );
}

function Td({ children }: any) {
  return <td className="px-3 py-2 align-top">{children}</td>;
}

function Input({
  value,
  onChange,
  placeholder,
  inputMode,
  error,
}: {
  value: any;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  error?: string;
}) {
  return (
    <div className="min-w-[90px]">
      <input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className={[
          "w-full rounded-md border bg-white px-2 py-1.5 text-sm",
          error ? "border-rose-300 focus:outline-rose-400" : "border-slate-300",
        ].join(" ")}
      />
      {error && <div className="mt-1 text-xs text-rose-700">{error}</div>}
    </div>
  );
}

function SelectYN({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options?: { value: string; label: string }[];
}) {
  const opts =
    options ??
    [
      { value: "NO", label: "NO" },
      { value: "SI", label: "SI" },
    ];

  return (
    <select
      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    >
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
