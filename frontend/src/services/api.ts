import axios from "axios";


export const api = axios.create({
  baseURL:   "https://idromardi-v2.onrender.com"+ "/api" ,
});
