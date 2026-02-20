const axios = require("axios");

async function geocodeAddress(indirizzo, citta) {
  const query = `${indirizzo}, ${citta}, Italy`;

  const response = await axios.get(
    "https://nominatim.openstreetmap.org/search",
    {
      params: {
        street: indirizzo,
        city: citta,
        country: "Italy",
        format: "json",
        limit: 1,
      },
      headers: {
        "User-Agent": "IdromardiApp/1.0"
      }
    }
  );

  if (response.data.length === 0) return null;

  return {
    latitude: parseFloat(response.data[0].lat),
    longitude: parseFloat(response.data[0].lon),
  };
}

module.exports = { geocodeAddress };
