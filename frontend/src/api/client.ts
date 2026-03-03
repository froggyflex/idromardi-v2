import axios from "axios";

const api = axios.create({
  baseURL: "https://SHOULD-BREAK-THIS.com/api" //"http://localhost:4000/api",
});

export default api;
