import axios from "axios";
import { clearAuthSession, getAuthToken } from "../auth";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
});

api.interceptors.request.use((config) => {
  if (config.url?.startsWith("/meta/") && !config.timeout) config.timeout = 60000;
  const token = getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401 && window.location.pathname !== "/login") {
      clearAuthSession();
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export default api;
