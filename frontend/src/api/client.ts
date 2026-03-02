import axios from "axios";

const api = axios.create({
  baseURL: "https://idromardi-v2.onrender.com."  //"http://localhost:4000/api",
});

export default api;
