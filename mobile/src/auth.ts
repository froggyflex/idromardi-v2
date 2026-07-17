import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "idromardi.mobile.auth-token";
const USER_KEY = "idromardi.mobile.auth-user";
const DEVICE_KEY = "idromardi.mobile.device-id";

export async function getToken() {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function saveSession(token: string, user: unknown) {
  await Promise.all([
    SecureStore.setItemAsync(TOKEN_KEY, token),
    SecureStore.setItemAsync(USER_KEY, JSON.stringify(user || null)),
  ]);
}

export async function getStoredUser(): Promise<{
  id: string;
  username: string;
  role: string;
} | null> {
  const value = await SecureStore.getItemAsync(USER_KEY);
  if (!value) return null;
  try {
    const user = JSON.parse(value);
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

export async function clearSession() {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(USER_KEY),
  ]);
}

export async function getOrCreateDeviceId(createUuid: () => string) {
  const existing = await SecureStore.getItemAsync(DEVICE_KEY);
  if (existing) return existing;
  const id = createUuid();
  await SecureStore.setItemAsync(DEVICE_KEY, id);
  return id;
}
