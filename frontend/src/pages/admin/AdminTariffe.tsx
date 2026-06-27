import { useEffect, useMemo, useState } from "react";
import {
  type Categoria,
  type Scaglione,
  type Provider,
  type TariffVersion,
  createProvider,
  createQuotaFissa,
  createScaglione,
  createVersion,
  deleteQuotaFissa,
  deleteScaglione,
  getVersionFull,
  listProviders,
  listVersions,
  upsertCategory,
  updateQuotaFissa,
  updateScaglione,
  updateVersion,
  createComponenteMC,
  updateComponenteMC,
  deleteComponenteMC,
  saveCategoryConfig,
} from "../../api/tariffe";

// UI-only marker for locally added rows (not saved yet)
type EditableScaglione = Scaglione & { _isNew?: boolean };
type EditableQuotaFissa = {
  id: string;
  id_categoria: string;
  codice: string;
  importo: string;
  _isNew?: boolean;
};
type EditableComponenteMC = {
  id: string;
  id_categoria: string;
  codice: string;
  prezzo_mc: string;
  _isNew?: boolean;
};
type EditableCategoria = Categoria & {
  scaglioni: EditableScaglione[];
  quote_fisse: EditableQuotaFissa[];
  componenti_mc: EditableComponenteMC[];
  _dirty?: boolean;
};

export default function AdminTariffe() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState<string>("");

  const [versions, setVersions] = useState<TariffVersion[]>([]);
  const [versionId, setVersionId] = useState<string>("");

  const [version, setVersion] = useState<TariffVersion | null>(null);

  const [loading, setLoading] = useState(false);

  // create provider form
  const [newCodice, setNewCodice] = useState("");
  const [newNome, setNewNome] = useState("");

  // create version form
  const [anno, setAnno] = useState<number>(new Date().getFullYear());
  const [validFrom, setValidFrom] = useState<string>(`${new Date().getFullYear()}-01-01`);
  const [validTo, setValidTo] = useState<string>(`${new Date().getFullYear()}-12-31`);
  const [descrizione, setDescrizione] = useState<string>("");

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === providerId) || null,
    [providers, providerId]
  );

  const [categories, setCategories] = useState<EditableCategoria[]>([]);

  async function refreshProviders() {
    const data = await listProviders();
    setProviders(data.providers);
  }

  async function refreshVersions(pid: string) {
    const data = await listVersions(pid);
    setVersions(data.versions);
  }

  async function loadVersionFull(vid: string) {
    const data = await getVersionFull(vid);
    setVersion(data.version);

    // Normalize arrays so UI doesn't crash on undefined
    const normalized = (data.categories as any[]).map((c) => ({
      ...c,
      scaglioni: c.scaglioni ?? [],
      quote_fisse: c.quote_fisse ?? [],
      componenti_mc: c.componenti_mc ?? [],
    }));

    setCategories(normalized as any);
  }

  function updateCategoryDraft(
    categoryId: string,
    updater: (category: EditableCategoria) => EditableCategoria
  ) {
    setCategories((prev) =>
      prev.map((cat) =>
        cat.id === categoryId ? { ...updater(cat), _dirty: true } : cat
      )
    );
  }

  function markCategorySaved(categoryId: string) {
    setCategories((prev) =>
      prev.map((cat) => (cat.id === categoryId ? { ...cat, _dirty: false } : cat))
    );
  }

  function normalizeSavedCategories(nextCategories: Categoria[]) {
    return (nextCategories as any[]).map((c) => ({
      ...c,
      scaglioni: c.scaglioni ?? [],
      quote_fisse: c.quote_fisse ?? [],
      componenti_mc: c.componenti_mc ?? [],
      _dirty: false,
    })) as EditableCategoria[];
  }

  /* ---------------- Componenti MC ---------------- */

  async function addComponente(categoryId: string) {
    setLoading(true);
    try {
      const res: any = await createComponenteMC(categoryId, {
        codice: "FOGNATURA",
        prezzo_mc: 0,
      });

      setCategories((prev) =>
        prev.map((cat) =>
          cat.id !== categoryId
            ? cat
            : { ...cat, componenti_mc: [...(cat as any).componenti_mc, res.componente] }
        )
      );
    } finally {
      setLoading(false);
      alert("Componente creato con successo.");
    }
  }

  async function saveComponente(c: any) {
    setLoading(true);
    try {
      const res: any = await updateComponenteMC(c.id, {
        codice: c.codice,
        prezzo_mc: Number(c.prezzo_mc),
      });

      setCategories((prev) =>
        prev.map((cat) => ({
          ...cat,
          componenti_mc: (cat as any).componenti_mc.map((x: any) => (x.id === c.id ? res.componente : x)),
        }))
      );
    } finally {
      setLoading(false);
      alert("Componente " + c.codice + " salvato con successo.");
      
    }
  }

  async function removeComponente(id: string) {
    setLoading(true);
    try {
      await deleteComponenteMC(id);
      setCategories((prev) =>
        prev.map((cat) => ({
          ...cat,
          componenti_mc: (cat as any).componenti_mc.filter((x: any) => x.id !== id),
        }))
      );
    } finally {
      setLoading(false);
    }
  }

  /* ---------------- Effects ---------------- */

  useEffect(() => {
    refreshProviders();
  }, []);

  useEffect(() => {
    // reset on provider change
    setVersions([]);
    setVersionId("");
    setVersion(null);
    setCategories([]);

    if (!providerId) return;
    refreshVersions(providerId);
  }, [providerId]);

  useEffect(() => {
    // reset on version change
    setVersion(null);
    setCategories([]);
    if (!versionId) return;
    loadVersionFull(versionId);
  }, [versionId]);

  /* ---------------- Provider/Version ---------------- */

  async function handleCreateProvider() {
    if (!newCodice.trim() || !newNome.trim()) return;
    setLoading(true);
    try {
      const res: any = await createProvider({ codice: newCodice, nome: newNome });
      await refreshProviders();
      setProviderId(res.provider.id);
      setNewCodice("");
      setNewNome("");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateVersion() {
    if (!providerId) return;
    setLoading(true);
    try {
      const res: any = await createVersion(providerId, {
        anno,
        valid_from: validFrom,
        valid_to: validTo || null,
        descrizione: descrizione || null,
      });
      await refreshVersions(providerId);
      setVersionId(res.version.id);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateVersion() {
    if (!version) return;
    setLoading(true);
    try {
      const res: any = await updateVersion(version.id, {
        anno: version.anno,
        valid_from: version.valid_from,
        valid_to: version.valid_to,
        descrizione: version.descrizione,
      });
      setVersion(res.version);
      await refreshVersions(version.id_casa_idrica);
    } finally {
      setLoading(false);
    }
  }

  async function ensureCategory(code: "RESIDENTE" | "NON_RESIDENTE") {
    if (!versionId) return;
    setLoading(true);
    try {
      await upsertCategory(versionId, { codice: code, descrizione: null });
      await loadVersionFull(versionId);
    } finally {
      setLoading(false);
    }
  }

  /* ---------------- Scaglioni ---------------- */

  function addScaglioneLocal(categoryId: string) {
    const tempId = crypto.randomUUID();

    updateCategoryDraft(categoryId, (c) => ({
      ...c,
      scaglioni: [
        ...c.scaglioni,
        {
          id: tempId,
          id_categoria: categoryId,
          ordine: c.scaglioni.length + 1,
          nome: "",
          mc_da_base: 0,
          mc_a_base: null,
          moltiplica_per_nucleo: 1,
          prezzo_acquedotto: "0",
          _isNew: true,
        },
      ],
    }));
  }

  function scaglioniOverlap(scaglioni: EditableScaglione[]) {
    // overlap check with null = Infinity
    for (let i = 0; i < scaglioni.length; i++) {
      const a = scaglioni[i];
      const aStart = Number(a.mc_da_base);
      const aEnd = a.mc_a_base === null || (a as any).mc_a_base === "" ? Infinity : Number(a.mc_a_base);

      for (let j = i + 1; j < scaglioni.length; j++) {
        const b = scaglioni[j];
        const bStart = Number(b.mc_da_base);
        const bEnd = b.mc_a_base === null || (b as any).mc_a_base === "" ? Infinity : Number(b.mc_a_base);

        if (aStart < bEnd && bStart < aEnd) return true;
      }
    }
    return false;
  }

  async function saveScaglione(categoryId: string, scaglione: EditableScaglione) {
    // Client-side validation to avoid DB overlap errors
    const cat = categories.find((c) => c.id === categoryId);
    if (cat && scaglioniOverlap(cat.scaglioni)) {
      alert("Scaglioni sovrapposti: correggi mc_da/mc_a prima di salvare.");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        ordine: Number(scaglione.ordine),
        nome: String(scaglione.nome || "").trim(),
        mc_da_base: Number(scaglione.mc_da_base),
        mc_a_base:
          scaglione.mc_a_base === null || (scaglione as any).mc_a_base === ""
            ? null
            : Number(scaglione.mc_a_base),
        moltiplica_per_nucleo: Number(scaglione.moltiplica_per_nucleo) ? 1 : 0,
        prezzo_acquedotto: Number(scaglione.prezzo_acquedotto),
      };

      if (scaglione._isNew) {
        const res: any = await createScaglione(categoryId, payload);
        setCategories((prev) =>
          prev.map((c) =>
            c.id !== categoryId
              ? c
              : {
                  ...c,
                  scaglioni: c.scaglioni.map((s) => (s.id === scaglione.id ? res.scaglione : s)),
                }
          )
        );
      } else {
        await updateScaglione(scaglione.id, payload);
        // Keep local state in sync (no reload)
            setCategories((prev) =>
            prev.map((c) =>
                c.id !== categoryId
                ? c
                : {
                    ...c,
                    scaglioni: c.scaglioni.map((s) =>
                        s.id === scaglione.id
                        ? {
                            ...s,
                            ordine: payload.ordine,
                            nome: payload.nome,
                            mc_da_base: payload.mc_da_base,
                            mc_a_base: payload.mc_a_base,
                            moltiplica_per_nucleo: payload.moltiplica_per_nucleo,
                            prezzo_acquedotto: String(payload.prezzo_acquedotto),
                            _isNew: false,
                            }
                        : s
                    ),
                    }
            )
            );

      }
    } finally {
      setLoading(false);
      alert("Scaglione " + scaglione.mc_da_base + " - " + scaglione.mc_a_base + " salvato con successo.");
    }
  }

  async function removeScaglione(categoryId: string, s: EditableScaglione) {
    updateCategoryDraft(categoryId, (c) => ({
      ...c,
      scaglioni: c.scaglioni.filter((x) => x.id !== s.id),
    }));
  }

  /* ---------------- Quote Fisse ---------------- */

  function addQF(categoryId: string) {
    updateCategoryDraft(categoryId, (c) => ({
      ...c,
      quote_fisse: [
        ...(c as any).quote_fisse,
        {
          id: crypto.randomUUID(),
          id_categoria: categoryId,
          codice: "QF",
          importo: "0",
          _isNew: true,
        },
      ],
    }));
  }

  async function saveQF(q: any) {
    setLoading(true);
    try {
      const res: any = await updateQuotaFissa(q.id, { codice: q.codice, importo: Number(q.importo) });
      const updated = res.quota_fissa ?? res.quota ?? null;

      if (updated) {
        setCategories((prev) =>
          prev.map((c) => ({
            ...c,
            quote_fisse: (c as any).quote_fisse.map((x: any) => (x.id === q.id ? updated : x)),
          }))
        );
      } else {
        // optimistic local sync
        setCategories((prev) =>
          prev.map((c) => ({
            ...c,
            quote_fisse: (c as any).quote_fisse.map((x: any) =>
              x.id === q.id ? { ...x, codice: q.codice, importo: q.importo } : x
            ),
          }))
        );
      }
    } finally {
      setLoading(false);
      alert("Quota Fissa " + q.importo + " salvata con successo.");
    }
  }

  function removeQF(categoryId: string, id: string) {
    updateCategoryDraft(categoryId, (c) => ({
      ...c,
      quote_fisse: (c as any).quote_fisse.filter((x: any) => x.id !== id),
    }));
  }

  async function saveCategoryDraft(cat: EditableCategoria) {
    if (scaglioniOverlap(cat.scaglioni)) {
      alert("Scaglioni sovrapposti: correggi mc_da/mc_a prima di salvare.");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        scaglioni: cat.scaglioni.map((s) => ({
          id: s.id,
          id_categoria: cat.id,
          ordine: Number(s.ordine),
          nome: String(s.nome || "").trim(),
          mc_da_base: Number(s.mc_da_base || 0),
          mc_a_base:
            s.mc_a_base === null || (s as any).mc_a_base === ""
              ? null
              : Number(s.mc_a_base),
          moltiplica_per_nucleo: Number(s.moltiplica_per_nucleo) ? 1 : 0,
          prezzo_acquedotto: String(s.prezzo_acquedotto || "0"),
        })) as any,
        quote_fisse: (cat as any).quote_fisse.map((q: any) => ({
          id: q.id,
          id_categoria: cat.id,
          codice: String(q.codice || "QF").trim().toUpperCase(),
          importo: String(q.importo || "0"),
        })),
        componenti_mc: (cat as any).componenti_mc
          .filter((c: any) => String(c.codice || "").trim())
          .map((c: any) => ({
            id: c.id,
            id_categoria: cat.id,
            codice: String(c.codice || "").trim().toUpperCase(),
            prezzo_mc: String(c.prezzo_mc || "0"),
          })),
      };

      const saved = await saveCategoryConfig(cat.id, payload).catch((err: any) => {
        if (err?.response?.status === 404) {
          return saveCategoryDraftLegacy(cat.id, payload);
        }

        throw err;
      });
      setVersion(saved.version);
      setCategories(normalizeSavedCategories(saved.categories));
      markCategorySaved(cat.id);
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.response?.data?.message || err?.message || "Errore salvataggio categoria");
    } finally {
      setLoading(false);
    }
  }

  async function saveCategoryDraftLegacy(categoryId: string, payload: {
    scaglioni: any[];
    quote_fisse: any[];
    componenti_mc: any[];
  }) {
    if (!versionId) {
      throw new Error("Seleziona una versione tariffaria prima di salvare.");
    }

    const latest = await getVersionFull(versionId);
    const currentCategory = latest.categories.find((category) => category.id === categoryId);

    if (!currentCategory) {
      throw new Error("Categoria non trovata.");
    }

    const currentScaglioni = currentCategory.scaglioni || [];
    const currentQuote = currentCategory.quote_fisse || [];
    const currentComponenti = currentCategory.componenti_mc || [];

    const nextScaglioneIds = new Set(payload.scaglioni.map((row) => row.id));
    const currentScaglioneIds = new Set(currentScaglioni.map((row) => row.id));

    for (const existing of currentScaglioni) {
      if (!nextScaglioneIds.has(existing.id)) {
        await deleteScaglione(existing.id);
      }
    }

    for (const row of payload.scaglioni) {
      const body = {
        ordine: Number(row.ordine),
        nome: String(row.nome || "").trim(),
        mc_da_base: Number(row.mc_da_base || 0),
        mc_a_base:
          row.mc_a_base === null || row.mc_a_base === ""
            ? null
            : Number(row.mc_a_base),
        moltiplica_per_nucleo: Number(row.moltiplica_per_nucleo) ? 1 : 0,
        prezzo_acquedotto: Number(row.prezzo_acquedotto || 0),
      };

      if (currentScaglioneIds.has(row.id)) {
        await updateScaglione(row.id, body);
      } else {
        await createScaglione(categoryId, body);
      }
    }

    const nextQuoteIds = new Set(payload.quote_fisse.map((row) => row.id));
    const currentQuoteIds = new Set(currentQuote.map((row) => row.id));

    for (const existing of currentQuote) {
      if (!nextQuoteIds.has(existing.id)) {
        await deleteQuotaFissa(existing.id);
      }
    }

    for (const row of payload.quote_fisse) {
      const body = {
        codice: String(row.codice || "QF").trim().toUpperCase(),
        importo: Number(row.importo || 0),
      };

      if (currentQuoteIds.has(row.id)) {
        await updateQuotaFissa(row.id, body);
      } else {
        await createQuotaFissa(categoryId, body);
      }
    }

    const nextComponentIds = new Set(payload.componenti_mc.map((row) => row.id));
    const currentComponentIds = new Set(currentComponenti.map((row) => row.id));

    for (const existing of currentComponenti) {
      if (!nextComponentIds.has(existing.id)) {
        await deleteComponenteMC(existing.id);
      }
    }

    for (const row of payload.componenti_mc) {
      const body = {
        codice: String(row.codice || "").trim().toUpperCase(),
        prezzo_mc: Number(row.prezzo_mc || 0),
      };

      if (currentComponentIds.has(row.id)) {
        await updateComponenteMC(row.id, body);
      } else {
        await createComponenteMC(categoryId, body);
      }
    }

    return getVersionFull(versionId);
  }

  /* ---------------- Render ---------------- */

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="border-b border-slate-100 pb-5">
          <div className="text-lg font-semibold text-slate-800">Tariffe Casa Idrica</div>
          <div className="mt-1 text-sm text-slate-500">
            Crea o seleziona una versione tariffaria, poi compila scaglioni, quote fisse e componenti in un unico salvataggio.
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
                1
              </div>
              <div>
                <div className="text-sm font-bold text-slate-800">Casa idrica</div>
                <div className="text-xs text-slate-500">Seleziona il provider o creane uno nuovo.</div>
              </div>
            </div>
            <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Provider esistente</div>
            <select
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
            >
              <option value="">Seleziona Casa Idrica</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codice} — {p.nome}
                </option>
              ))}
            </select>

            <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-white p-3">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Nuovo provider
              </div>
              <div className="grid grid-cols-1 gap-2">
              <input
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                placeholder="Codice (es. ABC)"
                value={newCodice}
                onChange={(e) => setNewCodice(e.target.value)}
              />
              <input
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                placeholder="Nome (es. Acquedotto ABC)"
                value={newNome}
                onChange={(e) => setNewNome(e.target.value)}
              />
              <button
                className="rounded-xl bg-blue-600 text-white px-4 py-2 text-sm disabled:opacity-50"
                disabled={loading || !newCodice.trim() || !newNome.trim()}
                onClick={handleCreateProvider}
              >
                Crea Casa Idrica
              </button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
                2
              </div>
              <div>
                <div className="text-sm font-bold text-slate-800">Versione tariffaria</div>
                <div className="text-xs text-slate-500">Apri un anno già salvato o prepara una nuova validità.</div>
              </div>
            </div>
            <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Versioni salvate</div>
            <select
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              value={versionId}
              onChange={(e) => setVersionId(e.target.value)}
              disabled={!providerId}
            >
              <option value="">Seleziona Tariffa (Anno)</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.anno} ({v.valid_from} → {v.valid_to ?? "∞"})
                </option>
              ))}
            </select>

            <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-white p-3">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Nuova versione
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-semibold text-slate-500">
                  Anno
                  <input
                    type="number"
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800"
                    value={anno}
                    onChange={(e) => {
                      const y = Number(e.target.value);
                      setAnno(y);
                      setValidFrom(`${y}-01-01`);
                      setValidTo(`${y}-12-31`);
                    }}
                    placeholder="Anno"
                    disabled={!providerId}
                  />
                </label>
                <label className="text-xs font-semibold text-slate-500">
                  Descrizione
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800"
                    value={descrizione}
                    onChange={(e) => setDescrizione(e.target.value)}
                    placeholder="Opzionale"
                    disabled={!providerId}
                  />
                </label>
                <label className="text-xs font-semibold text-slate-500">
                  Valida dal
                  <input
                    type="date"
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800"
                    value={validFrom}
                    onChange={(e) => setValidFrom(e.target.value)}
                    disabled={!providerId}
                  />
                </label>
                <label className="text-xs font-semibold text-slate-500">
                  Valida al
                  <input
                    type="date"
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800"
                    value={validTo}
                    onChange={(e) => setValidTo(e.target.value)}
                    disabled={!providerId}
                  />
                </label>
                <button
                  className="col-span-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  disabled={loading || !providerId || !anno || !validFrom}
                  onClick={handleCreateVersion}
                >
                  Crea versione tariffaria
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
                3
              </div>
              <div>
                <div className="text-sm font-bold text-slate-800">Configurazione</div>
                <div className="text-xs text-slate-500">Crea la categoria e poi compila le voci sotto.</div>
              </div>
            </div>
            {version ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="font-medium text-slate-800">
                  {selectedProvider?.codice} — {version.anno}
                </div>
                <div className="text-sm text-slate-500 mt-1">
                  {version.valid_from} → {version.valid_to ?? "∞"}
                </div>

                <div className="mt-3 grid grid-cols-1 gap-2">
                  <button
                    className="rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm disabled:opacity-50"
                    disabled={loading}
                    onClick={() => ensureCategory("RESIDENTE")}
                  >
                    Crea/aggiorna categoria RESIDENTE
                  </button>
                  {/* <button
                    className="rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm disabled:opacity-50"
                    disabled={loading}
                    onClick={() => ensureCategory("NON_RESIDENTE")}
                  >
                    Crea/aggiorna categoria NON_RESIDENTE
                  </button> */}
                  <button
                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold"
                    disabled={loading}
                    onClick={handleUpdateVersion}
                  >
                    Salva metadati tariffa
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-500">
                Seleziona una tariffa per configurare categorie, scaglioni e quote fisse.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Categories */}
      {version && (
        <div className="space-y-4">
          {categories.map((cat) => (
            <div key={cat.id} className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-semibold text-slate-800">{cat.codice}</div>
                    {cat._dirty && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                        Modifiche non salvate
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">Scaglioni, quote fisse e componenti per m³</div>
                </div>
                <div className="flex gap-2">
                  <button
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    onClick={() => addScaglioneLocal(cat.id)}
                    disabled={loading}
                  >
                    + Scaglione
                  </button>
                  <button
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    onClick={() => addQF(cat.id)}
                    disabled={loading}
                  >
                    + QF
                  </button>
                  <button
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => saveCategoryDraft(cat)}
                    disabled={loading}
                  >
                    {loading ? "Salvataggio..." : "Salva categoria"}
                  </button>
                </div>
              </div>

              {/* Scaglioni table */}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="py-2">Ord</th>
                      <th>Nome</th>
                      <th>mc_da</th>
                      <th>mc_a</th>
                      <th>*n</th>
                      <th>Tariffa Acquedotto</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cat.scaglioni.map((s) => (
                      <tr key={s.id} className="border-t">
                        <td className="py-2">
                          <input
                            className="w-14 rounded-lg border border-slate-200 px-2 py-1"
                            value={s.ordine}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              updateCategoryDraft(cat.id, (c) => ({
                                ...c,
                                scaglioni: c.scaglioni.map((x) => (x.id === s.id ? { ...x, ordine: v } : x)),
                              }));
                            }}
                          />
                        </td>
                        <td>
                          <input
                            className="w-40 rounded-lg border border-slate-200 px-2 py-1"
                            value={s.nome}
                            onChange={(e) => {
                              const v = e.target.value;
                              updateCategoryDraft(cat.id, (c) => ({
                                ...c,
                                scaglioni: c.scaglioni.map((x) => (x.id === s.id ? { ...x, nome: v } : x)),
                              }));
                            }}
                          />
                        </td>
                        <td>
                          <input
                            className="w-20 rounded-lg border border-slate-200 px-2 py-1"
                            value={s.mc_da_base}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              updateCategoryDraft(cat.id, (c) => ({
                                ...c,
                                scaglioni: c.scaglioni.map((x) => (x.id === s.id ? { ...x, mc_da_base: v } : x)),
                              }));
                            }}
                          />
                        </td>
                        <td>
                          <input
                            className="w-20 rounded-lg border border-slate-200 px-2 py-1"
                            value={s.mc_a_base ?? ""}
                            onChange={(e) => {
                              const raw = e.target.value;
                              const v = raw === "" ? null : Number(raw);
                              updateCategoryDraft(cat.id, (c) => ({
                                ...c,
                                scaglioni: c.scaglioni.map((x) => (x.id === s.id ? { ...x, mc_a_base: v } : x)),
                              }));
                            }}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={!!Number(s.moltiplica_per_nucleo)}
                            onChange={(e) => {
                              const v = e.target.checked ? 1 : 0;
                              updateCategoryDraft(cat.id, (c) => ({
                                ...c,
                                scaglioni: c.scaglioni.map((x) =>
                                  x.id === s.id ? { ...x, moltiplica_per_nucleo: v } : x
                                ),
                              }));
                            }}
                          />
                        </td>
                        <td>
                          <input
                            className="w-28 rounded-lg border border-slate-200 px-2 py-1"
                            value={s.prezzo_acquedotto as any}
                            onChange={(e) => {
                              const v = e.target.value;
                              updateCategoryDraft(cat.id, (c) => ({
                                ...c,
                                scaglioni: c.scaglioni.map((x) =>
                                  x.id === s.id ? { ...x, prezzo_acquedotto: v as any } : x
                                ),
                              }));
                            }}
                          />
                        </td>

                        <td className="text-right whitespace-nowrap">
                          <button
                            className="rounded-lg bg-rose-600 text-white px-3 py-1 text-xs"
                            disabled={loading}
                            onClick={() => removeScaglione(cat.id, s)}
                          >
                            Elimina
                          </button>
                        </td>
                      </tr>
                    ))}
                    {cat.scaglioni.length === 0 && (
                      <tr className="border-t">
                        <td colSpan={9} className="py-4 text-slate-500">
                          Nessuno scaglione. Aggiungi con “+ Scaglione”.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Quote fisse */}
              <div className="mt-6">
                <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Quote fisse</div>
                <div className="space-y-2">
                  {(cat as any).quote_fisse.map((q: any) => (
                    <div key={q.id} className="flex items-center gap-2">
                      <input
                        className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-sm"
                        value={q.codice}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateCategoryDraft(cat.id, (c) => ({
                            ...c,
                            quote_fisse: (c as any).quote_fisse.map((x: any) => (x.id === q.id ? { ...x, codice: v } : x)),
                          }));
                        }}
                      />
                      <input
                        className="w-40 rounded-lg border border-slate-200 px-2 py-1 text-sm"
                        value={q.importo}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateCategoryDraft(cat.id, (c) => ({
                            ...c,
                            quote_fisse: (c as any).quote_fisse.map((x: any) => (x.id === q.id ? { ...x, importo: v } : x)),
                          }));
                        }}
                      />
                      <button
                        className="rounded-lg bg-rose-600 text-white px-3 py-1 text-xs"
                        disabled={loading}
                        onClick={() => removeQF(cat.id, q.id)}
                      >
                        Elimina
                      </button>
                    </div>
                  ))}
                  {(cat as any).quote_fisse.length === 0 && (
                    <div className="text-sm text-slate-500">Nessuna quota fissa. Aggiungi con “+ QF”.</div>
                  )}
                </div>
              </div>

              {/* Componenti */}
              <div className="mt-6">
            <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">
                Componenti per m³
            </div>

            {["FOGNATURA", "DEPURAZIONE"].map((tipo) => {
                const comp = (cat as any).componenti_mc?.find((x: any) => x.codice === tipo);

                return (
                <div key={tipo} className="flex items-center gap-4 mb-2">
                    <div className="w-32 text-sm text-slate-600">
                    {tipo}
                    </div>

                    <input
                    className="w-40 rounded-lg border border-slate-200 px-2 py-1 text-sm"
                    value={comp?.prezzo_mc ?? ""}
                    onChange={(e) => {
                        const v = e.target.value;
                        updateCategoryDraft(cat.id, (c) => {
                          const existing = (c as any).componenti_mc || [];
                          const hasComponent = existing.some((x: any) => x.codice === tipo);

                          return {
                            ...c,
                            componenti_mc: hasComponent
                              ? existing.map((x: any) =>
                                  x.codice === tipo ? { ...x, prezzo_mc: v } : x
                                )
                              : [
                                  ...existing,
                                  {
                                    id: crypto.randomUUID(),
                                    id_categoria: cat.id,
                                    codice: tipo,
                                    prezzo_mc: v,
                                    _isNew: true,
                                  },
                                ],
                          };
                        });
                    }}
                    />
                </div>
                );
            })}
              </div>

            </div>
          ))}

          {categories.length === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-500">
              Nessuna categoria. Crea dalla card “Versione selezionata”.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
