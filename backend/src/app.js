const express = require("express");
const cors = require("cors");

const lettureRoutes   = require("./modules/letture/letture.routes");
const condominiRoutes = require("./modules/condomini/condomini.routes");
const utenzeRoutes = require("./modules/utenze/utenze.routes");
const tariffeRoutes = require("./modules/tariffe/tariffe.routes");
const fattureRoutes = require("./modules/fatture/fatture.routes");

const app = express();
const path = require("path");



app.use(cors());
app.use(express.json());

app.use("/api/condomini", condominiRoutes);
app.use("/api", utenzeRoutes);
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
app.use("/api/dashboard", require("./modules/dashboard/dashboard.routes"));
app.use("/api/admin", require("./modules/admin/admin.routes"));
app.use("/api/letture", lettureRoutes);
app.use("/api/tariffe", tariffeRoutes);

app.use("/api/fatture", fattureRoutes);
module.exports = app;
