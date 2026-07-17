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
import { downloadAssignment, listAssignments, login } from "./src/api";
import { clearSession, getOrCreateDeviceId, getStoredUser, getToken } from "./src/auth";
import {
  countUnsynchronized,
  initializeDatabase,
  listAssignmentItems,
  listLocalAssignments,
  saveAssignmentPackage,
  saveManualCapture,
} from "./src/database";
import { synchronizeOutbox } from "./src/sync";
import type { AssignmentItem, AssignmentSummary } from "./src/types";

export default function App() {
  const readingScrollRef = useRef<ScrollView>(null);
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [operatorId, setOperatorId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [remoteAssignments, setRemoteAssignments] = useState<AssignmentSummary[]>([]);
  const [localAssignments, setLocalAssignments] = useState<AssignmentSummary[]>([]);
  const [activeAssignment, setActiveAssignment] = useState<AssignmentSummary | null>(null);
  const [items, setItems] = useState<AssignmentItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
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
      setRemoteAssignments(
        result.assignments.filter((assignment) => assignment.operator_id === operatorId)
      );
    } catch (error) {
      setMessage((error as Error).message);
    }
  }, [operatorId]);

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
      await saveAssignmentPackage(payload);
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
    const loadedItems = await listAssignmentItems(assignment.id, operatorId);
    setItems(loadedItems);
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
        readingState: "K",
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
    setLocalAssignments([]);
    setActiveAssignment(null);
    setRemoteAssignments([]);
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
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Giri di lettura</Text>
          <Text style={styles.muted}>{unsynchronized} letture non sincronizzate</Text>
        </View>
        <Button title="Sincronizza" onPress={sync} disabled={busy} />
      </View>
      {!!message && <Text style={styles.message}>{message}</Text>}
      <ScrollView contentContainerStyle={styles.list}>
        <Text style={styles.sectionTitle}>Disponibili offline</Text>
        {localAssignments.length === 0 && <Text style={styles.muted}>Nessun giro scaricato.</Text>}
        {localAssignments.map((assignment) => (
          <Pressable key={assignment.id} style={styles.card} onPress={() => openAssignment(assignment)}>
            <Text style={styles.cardTitle}>{assignment.condominio_nome}</Text>
            <Text>{assignment.period_month}/{assignment.period_year}</Text>
            <Text style={styles.muted}>{assignment.condominio_indirizzo || ""}</Text>
          </Pressable>
        ))}

        <Text style={styles.sectionTitle}>Assegnati dal server</Text>
        {remoteAssignments.map((assignment) => (
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
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  readingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  badge: { maxWidth: 130, fontSize: 9, fontWeight: "700", color: "#475569" },
  progressPanel: { gap: 7, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "white" },
  progressLabel: { color: "#334155", fontSize: 12, fontWeight: "700" },
  progressTrack: { height: 8, overflow: "hidden", borderRadius: 999, backgroundColor: "#e2e8f0" },
  progressFill: { height: "100%", borderRadius: 999, backgroundColor: "#047857" },
});
