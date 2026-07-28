import * as Crypto from "expo-crypto";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Button,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  downloadAssignment,
  listAssignments,
  listCondominiumCatalog,
  login,
  prepareWorkspace,
} from "./src/api";
import { clearSession, getOrCreateDeviceId, getStoredUser, getToken } from "./src/auth";
import {
  countUnsynchronized,
  initializeDatabase,
  listAssignmentItems,
  listLocalAssignments,
  listReadingStates,
  saveAssignmentPackage,
  saveManualCapture,
} from "./src/database";
import { synchronizeOutbox } from "./src/sync";
import type {
  AssignmentItem,
  AssignmentSummary,
  CondominiumCatalogItem,
  ReadingState,
} from "./src/types";

function currentLocalDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export default function App() {
  const readingScrollRef = useRef<ScrollView>(null);
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [operatorId, setOperatorId] = useState("");
  const [userRole, setUserRole] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [remoteAssignments, setRemoteAssignments] = useState<AssignmentSummary[]>([]);
  const [catalog, setCatalog] = useState<CondominiumCatalogItem[]>([]);
  const [selectedCondominiumIds, setSelectedCondominiumIds] = useState<string[]>([]);
  const [periodYear, setPeriodYear] = useState(String(new Date().getFullYear()));
  const [periodMonth, setPeriodMonth] = useState(String(new Date().getMonth() + 1));
  const [readingDate, setReadingDate] = useState(currentLocalDate());
  const [localAssignments, setLocalAssignments] = useState<AssignmentSummary[]>([]);
  const [activeAssignment, setActiveAssignment] = useState<AssignmentSummary | null>(null);
  const [items, setItems] = useState<AssignmentItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [stateDrafts, setStateDrafts] = useState<Record<string, string>>({});
  const [readingStates, setReadingStates] = useState<ReadingState[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [unsynchronized, setUnsynchronized] = useState(0);

  const refreshLocal = useCallback(async () => {
    if (!operatorId) return;
    setLocalAssignments(await listLocalAssignments(operatorId));
    setUnsynchronized(await countUnsynchronized(operatorId));
    if (activeAssignment) {
      setItems(await listAssignmentItems(activeAssignment.id, operatorId));
    }
  }, [activeAssignment, operatorId]);

  const refreshRemote = useCallback(async () => {
    if (!operatorId) return;
    try {
      const result = await listAssignments();
      setRemoteAssignments(result.assignments);
    } catch (error) {
      setMessage((error as Error).message);
    }
  }, [operatorId]);

  async function refreshCatalog() {
    const year = Number(periodYear);
    const month = Number(periodMonth);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      setMessage("Inserisci un anno valido.");
      return;
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      setMessage("Inserisci un mese da 1 a 12.");
      return;
    }
    try {
      const result = await listCondominiumCatalog(year, month);
      setCatalog(result.condomini);
      const availableIds = new Set(result.condomini.map((item) => item.condominio_id));
      setSelectedCondominiumIds((current) => current.filter((id) => availableIds.has(id)));
      setMessage(`${result.condomini.length} condomini attivi disponibili.`);
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  const sync = useCallback(async () => {
    if (!authenticated || !operatorId) return;
    setBusy(true);
    try {
      const result = await synchronizeOutbox(operatorId);
      if (result.authRequired) {
        await clearSession();
        setAuthenticated(false);
        setOperatorId("");
        setLocalAssignments([]);
        setActiveAssignment(null);
        setMessage("Sessione scaduta. Accedi di nuovo: le letture locali sono al sicuro.");
        return;
      }
      setMessage(
        result.failed
          ? `${result.uploaded} inviate, ${result.failed} ancora in attesa.`
          : `${result.uploaded} letture sincronizzate.`
      );
      await refreshLocal();
    } finally {
      setBusy(false);
    }
  }, [authenticated, operatorId, refreshLocal]);

  useEffect(() => {
    (async () => {
      await initializeDatabase();
      setDeviceId(await getOrCreateDeviceId(Crypto.randomUUID));
      const [token, user] = await Promise.all([getToken(), getStoredUser()]);
      if (token && user?.id) {
        setOperatorId(user.id);
        setUserRole(user.role);
        setAuthenticated(true);
        setLocalAssignments(await listLocalAssignments(user.id));
        setUnsynchronized(await countUnsynchronized(user.id));
      }
      setReady(true);
    })().catch((error) => {
      setMessage(error.message);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    void refreshRemote();
    void refreshCatalog();
    void sync();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void sync();
    });
    const interval = setInterval(() => void sync(), 30_000);
    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, [authenticated, refreshRemote, sync]);

  async function handleLogin() {
    setBusy(true);
    setMessage("");
    try {
      const result = await login(username, password);
      setOperatorId(result.user.id);
      setUserRole(result.user.role);
      setAuthenticated(true);
      setPassword("");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload(assignment: AssignmentSummary) {
    setBusy(true);
    try {
      const payload = await downloadAssignment(assignment.id);
      await saveAssignmentPackage(payload, operatorId);
      await refreshLocal();
      setMessage("Giro salvato sul dispositivo e disponibile offline.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openAssignment(assignment: AssignmentSummary) {
    setActiveAssignment(assignment);
    const [loadedItems, loadedStates] = await Promise.all([
      listAssignmentItems(assignment.id, operatorId),
      listReadingStates(assignment.id),
    ]);
    setItems(loadedItems);
    const usableStates = loadedStates.length
      ? loadedStates
      : [{ codice: "K", descrizione: "Lettura verificata", richiede_valore: 1 }];
    const fallbackStateCode = usableStates[0]?.codice || "K";
    setReadingStates(usableStates);
    setDrafts(
      Object.fromEntries(
        loadedItems.map((item) => [
          item.utenza_id,
          item.reading_value === null || item.reading_value === undefined
            ? ""
            : String(item.reading_value),
        ])
      )
    );
    setStateDrafts(
      Object.fromEntries(
        loadedItems.map((item) => {
          const preferred = item.reading_state || (item.previous_state === "Y" ? "Y" : "K");
          const valid = usableStates.some((state) => state.codice === preferred);
          return [item.utenza_id, valid ? preferred : fallbackStateCode];
        })
      )
    );
  }

  function toggleCondominium(condominioId: string) {
    setSelectedCondominiumIds((current) =>
      current.includes(condominioId)
        ? current.filter((id) => id !== condominioId)
        : [...current, condominioId]
    );
  }

  async function prepareOfflineWorkspace() {
    const year = Number(periodYear);
    const month = Number(periodMonth);
    if (selectedCondominiumIds.length === 0) {
      Alert.alert("Nessun condominio", "Seleziona almeno un condominio da preparare.");
      return;
    }
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      Alert.alert("Anno non valido", "Inserisci un anno compreso tra 2000 e 2100.");
      return;
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      Alert.alert("Mese non valido", "Inserisci un mese da 1 a 12.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(readingDate)) {
      Alert.alert("Data non valida", "Usa il formato AAAA-MM-GG.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const result = await prepareWorkspace({
        condominioIds: selectedCondominiumIds,
        periodYear: year,
        periodMonth: month,
        dataOperatore: readingDate,
      });
      for (const payload of result.assignments) {
        await saveAssignmentPackage(payload, operatorId);
      }
      await refreshLocal();
      await refreshRemote();
      await refreshCatalog();
      setSelectedCondominiumIds([]);
      const prepared = result.assignments.length;
      const failed = result.errors.length;
      setMessage(
        failed
          ? `${prepared} condomini pronti offline; ${failed} non preparati.`
          : `${prepared} condomini pronti per lavorare offline.`
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveReading(item: AssignmentItem) {
    const value = Number(drafts[item.utenza_id]);
    if (!Number.isSafeInteger(value) || value < 0) {
      Alert.alert("Valore non valido", "Inserisci una lettura intera maggiore o uguale a zero.");
      return;
    }
    try {
      await saveManualCapture({
        assignmentId: item.assignment_id,
        utenzaId: item.utenza_id,
        contextHash: item.context_hash,
        readingValue: value,
        readingState: stateDrafts[item.utenza_id] || "K",
        deviceId,
        operatorId,
      });
      await refreshLocal();
      setMessage("Lettura salvata localmente. Verrà inviata quando la rete è disponibile.");
      void sync();
    } catch (error) {
      Alert.alert("Lettura non salvata", (error as Error).message);
    }
  }

  async function logout() {
    const pending = await countUnsynchronized(operatorId);
    if (pending > 0) {
      Alert.alert(
        "Dati non sincronizzati",
        `Ci sono ${pending} letture non confermate dal server. Sincronizzale prima di uscire.`
      );
      return;
    }
    await clearSession();
    setAuthenticated(false);
    setOperatorId("");
    setUserRole("");
    setLocalAssignments([]);
    setActiveAssignment(null);
    setRemoteAssignments([]);
    setCatalog([]);
    setSelectedCondominiumIds([]);
  }

  if (!ready) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  if (!authenticated) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.loginCard}>
          <Text style={styles.title}>Idromardi Letture</Text>
          <Text style={styles.muted}>Accedi online; i giri già scaricati resteranno disponibili offline.</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            placeholder="Operatore"
          />
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Password"
          />
          <Button title={busy ? "Accesso..." : "Accedi"} onPress={handleLogin} disabled={busy} />
          {!!message && <Text style={styles.error}>{message}</Text>}
        </View>
      </SafeAreaView>
    );
  }

  if (activeAssignment) {
    const capturedItems = items.filter((item) => Boolean(item.local_status)).length;
    const progressPercent = items.length
      ? Math.round((capturedItems / items.length) * 100)
      : 0;
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <Pressable onPress={() => setActiveAssignment(null)}><Text style={styles.link}>‹ Giri</Text></Pressable>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>{activeAssignment.condominio_nome}</Text>
            <Text style={styles.muted}>{activeAssignment.period_month}/{activeAssignment.period_year}</Text>
          </View>
          <Text style={styles.counter}>{unsynchronized} in attesa</Text>
        </View>
        <View style={styles.progressPanel}>
          <View style={styles.rowBetween}>
            <Text style={styles.progressLabel}>Avanzamento giro</Text>
            <Text style={styles.progressLabel}>{capturedItems}/{items.length} ({progressPercent}%)</Text>
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${progressPercent}%` as `${number}%` },
              ]}
            />
          </View>
        </View>
        <ScrollView
          ref={readingScrollRef}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        >
          {items.map((item) => (
            <View key={item.utenza_id} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>#{item.snapshot.idUser} · Interno {item.snapshot.interno || "-"}</Text>
                <Text style={styles.badge}>{item.server_status || item.local_status || "DA LEGGERE"}</Text>
              </View>
              <Text>{[item.snapshot.nome, item.snapshot.cognome].filter(Boolean).join(" ") || "Senza intestatario"}</Text>
              <Text style={styles.muted}>Matricola: {item.meter_serial_snapshot || "-"} · Precedente: {item.previous_value ?? "-"}</Text>
              <View style={styles.stateRow}>
                {readingStates.map((state) => {
                  const selected = stateDrafts[item.utenza_id] === state.codice;
                  return (
                    <Pressable
                      key={state.codice}
                      accessibilityRole="button"
                      accessibilityLabel={`${state.codice}: ${state.descrizione}`}
                      style={[styles.stateChip, selected && styles.stateChipSelected]}
                      onPress={() =>
                        setStateDrafts((current) => ({
                          ...current,
                          [item.utenza_id]: state.codice,
                        }))
                      }
                    >
                      <Text style={[styles.stateChipText, selected && styles.stateChipTextSelected]}>
                        {state.codice}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.stateDescription}>
                {readingStates.find((state) => state.codice === stateDrafts[item.utenza_id])
                  ?.descrizione || "Stato lettura"}
              </Text>
              <View style={styles.readingRow}>
                <TextInput
                  style={[styles.input, styles.readingInput]}
                  keyboardType="number-pad"
                  value={drafts[item.utenza_id] || ""}
                  onChangeText={(value) => setDrafts((current) => ({ ...current, [item.utenza_id]: value }))}
                  placeholder="Lettura"
                />
                <Button title="Salva" onPress={() => saveReading(item)} />
              </View>
            </View>
          ))}
          {items.length > 5 && (
            <Button
              title="Torna in cima"
              onPress={() => readingScrollRef.current?.scrollTo({ y: 0, animated: true })}
            />
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  const localIds = new Set(localAssignments.map((assignment) => assignment.id));
  const normalizedSearch = catalogSearch.trim().toLocaleLowerCase("it");
  const filteredCatalog = catalog.filter((item) => {
    if (!normalizedSearch) return true;
    return [
      item.condominio_codice,
      item.condominio_nome,
      item.condominio_indirizzo,
    ].some((value) => String(value || "").toLocaleLowerCase("it").includes(normalizedSearch));
  });
  const remoteNotDownloaded = remoteAssignments.filter((assignment) => !localIds.has(assignment.id));
  const selectableVisibleIds = filteredCatalog
    .filter(
      (item) =>
        Number(item.utenze_count || 0) > 0 &&
        (!item.session_status || item.session_status === "BOZZA")
    )
    .map((item) => item.condominio_id);
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Ambiente letture</Text>
          <Text style={styles.muted}>{localAssignments.length} condomini offline · {unsynchronized} letture da inviare</Text>
        </View>
        <Button title="Sincronizza" onPress={sync} disabled={busy} />
      </View>
      {!!message && <Text style={styles.message}>{message}</Text>}
      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.setupPanel}>
          <View style={styles.rowBetween}>
            <View style={styles.cardText}>
              <Text style={styles.sectionHeading}>Prepara il lavoro</Text>
              <Text style={styles.muted}>Scegli periodo e condomini prima di lavorare offline.</Text>
            </View>
            <Text style={styles.selectionBadge}>{selectedCondominiumIds.length} selezionati</Text>
          </View>
          <View style={styles.setupRow}>
            <View style={styles.compactField}>
              <Text style={styles.fieldLabel}>ANNO</Text>
              <TextInput
                style={styles.compactInput}
                value={periodYear}
                onChangeText={setPeriodYear}
                keyboardType="number-pad"
                maxLength={4}
                placeholder="2026"
              />
            </View>
            <View style={styles.compactField}>
              <Text style={styles.fieldLabel}>MESE</Text>
              <TextInput
                style={styles.compactInput}
                value={periodMonth}
                onChangeText={setPeriodMonth}
                keyboardType="number-pad"
                maxLength={2}
                placeholder="7"
              />
            </View>
            <View style={styles.dateField}>
              <Text style={styles.fieldLabel}>DATA LETTURA</Text>
              <TextInput
                style={styles.compactInput}
                value={readingDate}
                onChangeText={setReadingDate}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
                placeholder="AAAA-MM-GG"
              />
            </View>
          </View>
          <Button title={busy ? "Caricamento..." : "Carica condomini"} onPress={refreshCatalog} disabled={busy} />
        </View>

        <View style={styles.catalogHeader}>
          <Text style={styles.sectionTitle}>Condomini attivi ({catalog.length})</Text>
          <View style={styles.catalogActions}>
            <Pressable
              onPress={() =>
                setSelectedCondominiumIds((current) =>
                  Array.from(new Set([...current, ...selectableVisibleIds]))
                )
              }
            >
              <Text style={styles.link}>Seleziona visibili</Text>
            </Pressable>
            <Pressable onPress={() => setSelectedCondominiumIds([])}>
              <Text style={styles.secondaryLink}>Azzera</Text>
            </Pressable>
          </View>
        </View>
        <TextInput
          style={styles.input}
          value={catalogSearch}
          onChangeText={setCatalogSearch}
          autoCapitalize="none"
          placeholder="Cerca codice, condominio o indirizzo"
        />
        {filteredCatalog.length === 0 && (
          <Text style={styles.muted}>Nessun condominio trovato per questo periodo.</Text>
        )}
        {filteredCatalog.map((item) => {
          const selected = selectedCondominiumIds.includes(item.condominio_id);
          const blocked = Boolean(item.session_status && item.session_status !== "BOZZA");
          const empty = Number(item.utenze_count || 0) === 0;
          return (
            <Pressable
              key={item.condominio_id}
              style={[
                styles.selectionCard,
                selected && styles.selectionCardSelected,
                (blocked || empty) && styles.selectionCardDisabled,
              ]}
              onPress={() => !blocked && !empty && toggleCondominium(item.condominio_id)}
              disabled={blocked || empty}
            >
              <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                {selected && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <View style={styles.cardText}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.condominio_codice ? `${item.condominio_codice} · ` : ""}{item.condominio_nome}
                </Text>
                <Text style={styles.muted} numberOfLines={1}>
                  {item.condominio_indirizzo || "Indirizzo non disponibile"}
                </Text>
              </View>
              <View style={styles.catalogMeta}>
                <Text style={styles.countText}>{Number(item.utenze_count || 0)} utenze</Text>
                {!!item.assignment_id && <Text style={styles.readyText}>Gia preparato</Text>}
                {blocked && <Text style={styles.closedText}>{item.session_status}</Text>}
              </View>
            </Pressable>
          );
        })}
        <View style={styles.prepareBar}>
          <View style={styles.cardText}>
            <Text style={styles.prepareTitle}>{selectedCondominiumIds.length} condomini selezionati</Text>
            <Text style={styles.prepareCaption}>Le utenze saranno salvate sul dispositivo.</Text>
          </View>
          <Pressable
            style={[styles.primaryAction, (!selectedCondominiumIds.length || busy) && styles.primaryActionDisabled]}
            onPress={prepareOfflineWorkspace}
            disabled={!selectedCondominiumIds.length || busy}
          >
            {busy ? <ActivityIndicator color="white" /> : <Text style={styles.primaryActionText}>Prepara offline</Text>}
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>Disponibili offline</Text>
        {localAssignments.length === 0 && <Text style={styles.muted}>Nessun giro scaricato.</Text>}
        {localAssignments.map((assignment) => (
          <Pressable key={assignment.id} style={styles.card} onPress={() => openAssignment(assignment)}>
            <Text style={styles.cardTitle}>{assignment.condominio_nome}</Text>
            <Text>{assignment.period_month}/{assignment.period_year}</Text>
            <Text style={styles.muted}>{assignment.condominio_indirizzo || ""}</Text>
          </Pressable>
        ))}

        <Text style={styles.sectionTitle}>Da scaricare dal server</Text>
        {remoteNotDownloaded.length === 0 && (
          <Text style={styles.muted}>Nessun giro ancora assegnato a questo operatore.</Text>
        )}
        {remoteNotDownloaded.map((assignment) => (
          <View key={assignment.id} style={styles.card}>
            <Text style={styles.cardTitle}>{assignment.condominio_nome}</Text>
            <Text>{assignment.period_month}/{assignment.period_year} · {assignment.item_count || 0} contatori</Text>
            <Button
              title={localIds.has(assignment.id) ? "Aggiorna copia offline" : "Scarica per uso offline"}
              onPress={() => handleDownload(assignment)}
              disabled={busy}
            />
          </View>
        ))}
        <Button title="Esci" color="#991b1b" onPress={logout} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  loginCard: { margin: 24, marginTop: 100, gap: 14, padding: 22, borderRadius: 18, backgroundColor: "white" },
  title: { fontSize: 24, fontWeight: "700", color: "#0f172a" },
  headerTitle: { fontSize: 17, fontWeight: "700", color: "#0f172a" },
  sectionTitle: { marginTop: 12, fontSize: 16, fontWeight: "700", color: "#334155" },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  muted: { color: "#64748b", lineHeight: 20 },
  error: { color: "#b91c1c" },
  message: { marginHorizontal: 16, padding: 10, borderRadius: 10, backgroundColor: "#e0f2fe", color: "#075985" },
  input: { borderWidth: 1, borderColor: "#cbd5e1", backgroundColor: "white", borderRadius: 10, padding: 12 },
  readingInput: { flex: 1, fontSize: 20, fontWeight: "700" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderBottomWidth: 1, borderColor: "#e2e8f0", backgroundColor: "white" },
  headerText: { flex: 1 },
  link: { color: "#2563eb", fontSize: 16, fontWeight: "600" },
  counter: { color: "#9a3412", fontSize: 12, fontWeight: "700" },
  list: { padding: 16, gap: 12, paddingBottom: 40 },
  card: { gap: 8, padding: 15, borderRadius: 14, backgroundColor: "white", borderWidth: 1, borderColor: "#e2e8f0" },
  cardText: { flex: 1 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  readingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stateRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  stateChip: { minWidth: 38, alignItems: "center", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "#f8fafc" },
  stateChipSelected: { borderColor: "#2563eb", backgroundColor: "#dbeafe" },
  stateChipText: { color: "#475569", fontSize: 12, fontWeight: "700" },
  stateChipTextSelected: { color: "#1d4ed8" },
  stateDescription: { color: "#64748b", fontSize: 11 },
  periodBadge: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: "#eff6ff", color: "#1d4ed8", fontSize: 12, fontWeight: "700" },
  badge: { maxWidth: 130, fontSize: 9, fontWeight: "700", color: "#475569" },
  progressPanel: { gap: 7, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "white" },
  progressLabel: { color: "#334155", fontSize: 12, fontWeight: "700" },
  progressTrack: { height: 8, overflow: "hidden", borderRadius: 999, backgroundColor: "#e2e8f0" },
  progressFill: { height: "100%", borderRadius: 999, backgroundColor: "#047857" },
  setupPanel: { gap: 12, padding: 14, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, backgroundColor: "white" },
  sectionHeading: { fontSize: 17, fontWeight: "700", color: "#0f172a" },
  selectionBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, backgroundColor: "#e0f2fe", color: "#075985", fontSize: 11, fontWeight: "700" },
  setupRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  compactField: { width: 72, gap: 5 },
  dateField: { flex: 1, gap: 5 },
  fieldLabel: { color: "#64748b", fontSize: 10, fontWeight: "700" },
  compactInput: { minHeight: 44, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, paddingHorizontal: 10, backgroundColor: "white", color: "#0f172a", fontSize: 15 },
  catalogHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 4 },
  catalogActions: { flexDirection: "row", alignItems: "center", gap: 14 },
  secondaryLink: { color: "#64748b", fontSize: 13, fontWeight: "600" },
  selectionCard: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: 11, padding: 12, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, backgroundColor: "white" },
  selectionCardSelected: { borderColor: "#2563eb", backgroundColor: "#eff6ff" },
  selectionCardDisabled: { opacity: 0.55 },
  checkbox: { width: 24, height: 24, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#94a3b8", borderRadius: 5, backgroundColor: "white" },
  checkboxSelected: { borderColor: "#2563eb", backgroundColor: "#2563eb" },
  checkmark: { color: "white", fontSize: 15, fontWeight: "800" },
  catalogMeta: { minWidth: 72, alignItems: "flex-end", gap: 2 },
  countText: { color: "#334155", fontSize: 11, fontWeight: "700" },
  readyText: { color: "#047857", fontSize: 9, fontWeight: "700" },
  closedText: { color: "#9a3412", fontSize: 9, fontWeight: "700" },
  prepareBar: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderWidth: 1, borderColor: "#bfdbfe", borderRadius: 8, backgroundColor: "#eff6ff" },
  prepareTitle: { color: "#1e3a8a", fontSize: 14, fontWeight: "700" },
  prepareCaption: { color: "#475569", fontSize: 10 },
  primaryAction: { minWidth: 112, minHeight: 42, alignItems: "center", justifyContent: "center", paddingHorizontal: 13, borderRadius: 8, backgroundColor: "#1d4ed8" },
  primaryActionDisabled: { backgroundColor: "#94a3b8" },
  primaryActionText: { color: "white", fontSize: 13, fontWeight: "700" },
});
