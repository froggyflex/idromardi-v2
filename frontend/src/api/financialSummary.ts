import api from "./client";


export async function getFinancialSummary() {
  const { data } = await api.get("/financial-summary");
  return data;
}

export async function getFinancialRecentRows() {
  const { data } = await api.get("/financial-summary/recent");
  return data;
}