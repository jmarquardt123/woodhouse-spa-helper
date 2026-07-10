// Location registry access for the API functions. The registry is generated
// by scripts/enumerate-locations.js and committed.
const registry = require("../../config/locations.json");

const byKey = new Map(registry.locations.map((l) => [l.key, l]));

function getLocation(key) {
  return byKey.get(String(key || "")) || null;
}

module.exports = { registry, getLocation, BASE_URL: "https://na1.meevo.com" };
