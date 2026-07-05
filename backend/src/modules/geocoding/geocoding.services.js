const axios = require("axios");

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_HEADERS = {
  "User-Agent": "IdromardiApp/1.0 (admin@idromardi.it)",
};

function cleanAddress(value) {
  return String(value || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bp\.?\s*co\b/gi, "Parco")
    .replace(/\b(is|isolato|sc|scala|lotto|palazzo)\.?\s+[a-z0-9/.-]+\b/gi, " ")
    .replace(/\b(gas|utenze condominiali)\b/gi, " ")
    .replace(/[-,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function validPostcode(value) {
  const postcode = String(value || "").trim();
  return /^\d{5}$/.test(postcode) ? postcode : "";
}

function compact(parts) {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
}

function uniqueQueries(queries) {
  const seen = new Set();
  return queries.filter((query) => {
    const key = JSON.stringify(query).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseResult(result, attemptedQuery) {
  if (!result) return null;

  const latitude = Number.parseFloat(result.lat);
  const longitude = Number.parseFloat(result.lon);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
    display_name: result.display_name,
    address: result.address || null,
    attemptedQuery,
  };
}

function isPlausibleResult(result, { citta, cap }) {
  const city = normalize(citta);
  const postcode = validPostcode(cap);
  const display = normalize(result.display_name);
  const address = result.address || {};
  const addressText = normalize(
    [
      address.city,
      address.town,
      address.village,
      address.municipality,
      address.county,
      address.state,
      result.display_name,
    ]
      .filter(Boolean)
      .join(" ")
  );

  if (postcode && address.postcode && !String(address.postcode).startsWith(postcode)) {
    return false;
  }

  if (city && !addressText.includes(city) && !display.includes(city)) {
    return false;
  }

  return true;
}

async function requestNominatim(params) {
  const response = await axios.get(NOMINATIM_URL, {
    params: {
      ...params,
      countrycodes: "it",
      format: "json",
      addressdetails: 1,
      limit: 1,
    },
    headers: NOMINATIM_HEADERS,
    timeout: 15000,
  });

  return Array.isArray(response.data) ? response.data : [];
}

async function geocodeAddress(indirizzo, citta, cap = "") {
  const clean = cleanAddress(indirizzo);
  const city = String(citta || "").trim();
  const postcode = String(cap || "").trim();

  const queries = uniqueQueries([
    {
      kind: "structured-original",
      params: {
        street: indirizzo,
        city,
        postalcode: postcode,
        country: "Italy",
      },
    },
    {
      kind: "q-original",
      params: {
        q: compact([indirizzo, postcode, city, "Italy"]),
      },
    },
    {
      kind: "q-clean",
      params: {
        q: compact([clean, postcode, city, "Italy"]),
      },
    },
    {
      kind: "q-clean-no-cap",
      params: {
        q: compact([clean, city, "Italy"]),
      },
    },
    {
      kind: "q-address-only",
      params: {
        q: compact([clean || indirizzo, "Italy"]),
      },
    },
  ]);

  let lastError = null;

  for (const query of queries) {
    try {
      if (!query.params.q && !query.params.street) continue;

      const rows = await requestNominatim(query.params);
      const result = parseResult(rows[0], query);

      if (result && isPlausibleResult(result, { citta: city, cap: postcode })) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    const wrapped = new Error(lastError.message || "Errore geocoding");
    wrapped.code = lastError.code;
    wrapped.status = lastError.response?.status;
    throw wrapped;
  }

  return null;
}

module.exports = { geocodeAddress, cleanAddress };
