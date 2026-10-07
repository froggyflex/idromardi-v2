const path = require("path");
const fs = require("fs/promises");

const BACKEND_ROOT = path.resolve(__dirname, "../..");

function resolveRipartizionePdfPath(filepath) {
  const value = String(filepath || "").trim().replace(/\\/g, "/");
  if (!value) return null;
  // Archived paths beginning /uploads or /storage are URL paths, not filesystem roots.
  // Resolve them against the backend even when Node starts from the repo root.
  if (/^\/?(?:uploads|storage)\//.test(value)) return path.resolve(BACKEND_ROOT, value.replace(/^\//, ""));
  if (value.startsWith("backend/uploads/")) return path.resolve(BACKEND_ROOT, value.slice("backend/".length));
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(BACKEND_ROOT, value);
}

async function readRipartizionePdf(pdf) {
  const filepath = resolveRipartizionePdfPath(pdf.filepath);
  try {
    if (filepath) return await fs.readFile(filepath);
  } catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
  }
  const error = new Error("La bolletta è presente in archivio, ma il file PDF non è disponibile. L’operatore deve ripristinare il file originale.");
  error.statusCode = 410;
  error.code = "PDF_FILE_MISSING";
  throw error;
}

module.exports = { readRipartizionePdf, resolveRipartizionePdfPath };
