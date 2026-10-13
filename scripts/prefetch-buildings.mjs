/**
 * Pre-fetch Chandigarh building footprints from Overpass API
 * and save as a static JSON file for instant serving.
 *
 * Usage:  node scripts/prefetch-buildings.mjs
 */

const BOUNDS = "30.71,76.75,30.76,76.81";

const OVERPASS_SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const [south, west, north, east] = BOUNDS.split(",").map(Number);

const query = `
  [out:json][timeout:90];
  way["building"](${south},${west},${north},${east});
  out body geom;
`;

function cleanTag(value) {
  const cleaned = value?.trim();
  return cleaned || null;
}

function getAddress(tags) {
  const fullAddress = cleanTag(tags["addr:full"]);
  if (fullAddress) return fullAddress;
  const houseName = cleanTag(tags["addr:housename"]);
  const houseNumber = cleanTag(tags["addr:housenumber"]);
  const street = cleanTag(tags["addr:street"]);
  const place = cleanTag(tags["addr:place"]);
  if (houseName) return houseName;
  const parts = [houseNumber, street || place].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

const categoryLabels = {
  hospital: "Hospital", clinic: "Clinic", doctors: "Medical Clinic",
  school: "School", university: "University", college: "College",
  kindergarten: "Kindergarten", library: "Library", police: "Police Station",
  fire_station: "Fire Station", townhall: "Government Building",
  community_centre: "Community Centre", place_of_worship: "Place of Worship",
  pharmacy: "Pharmacy", bank: "Bank", restaurant: "Restaurant",
  cafe: "Cafe", supermarket: "Supermarket", hotel: "Hotel",
  museum: "Museum", theatre: "Theatre", cinema: "Cinema",
  marketplace: "Market", dentist: "Dental Clinic",
};

const buildingLabels = {
  residential: "Residential Building", apartments: "Apartment Building",
  house: "House", detached: "House", semidetached_house: "Semi-Detached House",
  terrace: "Terraced House", commercial: "Commercial Building",
  industrial: "Industrial Building", retail: "Retail Building",
  office: "Office Building", hospital: "Hospital Building",
  school: "School Building", university: "University Building",
  college: "College Building", hotel: "Hotel Building",
  public: "Public Building", government: "Government Building",
  church: "Church", mosque: "Mosque", temple: "Temple",
  garage: "Garage", warehouse: "Warehouse", dormitory: "Dormitory",
};

function getBuildingName(tags) {
  const address = getAddress(tags);
  const realName = [tags.name, tags.official_name, tags["name:en"], tags["building:name"], tags.short_name, tags.brand]
    .map(cleanTag).find(Boolean);
  if (realName) return { name: realName, address, hasRealName: true };

  const category = cleanTag(tags.amenity) || cleanTag(tags.healthcare) || cleanTag(tags.shop) ||
    cleanTag(tags.office) || cleanTag(tags.tourism) || cleanTag(tags.historic);
  if (category) {
    const label = categoryLabels[category] ?? category.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
    return { name: address ? `${label} · ${address}` : label, address, hasRealName: false };
  }

  const building = cleanTag(tags.building);
  const buildingLabel = building
    ? (buildingLabels[building] ?? (building === "yes" ? "Building" : building.replace(/_/g, " ")))
    : "Building";
  return { name: address ? `${buildingLabel} · ${address}` : buildingLabel, address, hasRealName: false };
}

function toBuildingFeature(element) {
  const geometry = element.geometry;
  if (!geometry || geometry.length < 3) return null;

  const coordinates = geometry.map(p => [p.lon, p.lat]);
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coordinates.push([first[0], first[1]]);
  if (coordinates.length < 4) return null;

  const tags = element.tags ?? {};
  const bn = getBuildingName(tags);
  const rawLevels = Number(tags["building:levels"]);

  return {
    type: "Feature",
    id: element.id,
    properties: {
      id: element.id, name: bn.name, address: bn.address,
      building: tags.building ?? "yes",
      buildingType: tags.amenity ?? tags.healthcare ?? tags.shop ?? tags.office ?? tags.building ?? "unknown",
      levels: Number.isFinite(rawLevels) && rawLevels > 0 ? rawLevels : null,
      hasRealName: bn.hasRealName,
      amenity: cleanTag(tags.amenity), shop: cleanTag(tags.shop),
      office: cleanTag(tags.office), healthcare: cleanTag(tags.healthcare),
      tourism: cleanTag(tags.tourism), historic: cleanTag(tags.historic),
      landuse: cleanTag(tags.landuse), operator: cleanTag(tags.operator),
      brand: cleanTag(tags.brand),
    },
    geometry: { type: "Polygon", coordinates: [coordinates] },
  };
}

async function main() {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");

  const outDir = join(process.cwd(), "public", "data");
  const outFile = join(outDir, "buildings.json");

  for (let i = 0; i < OVERPASS_SERVERS.length; i++) {
    const server = OVERPASS_SERVERS[i];
    if (i > 0) {
      console.log("  Waiting 3s before next server...");
      await new Promise(r => setTimeout(r, 3000));
    }

    console.log(`\n[${i + 1}/${OVERPASS_SERVERS.length}] Trying: ${server}`);

    try {
      const res = await fetch(server, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "ChandigarhSafeSim/1.0 (educational-project, one-time-prefetch)",
        },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        console.log(`  ✗ HTTP ${res.status}`);
        continue;
      }

      const result = await res.json();
      const features = (result.elements ?? [])
        .filter(e => e.type === "way")
        .map(toBuildingFeature)
        .filter(Boolean);

      if (features.length === 0) {
        console.log("  ✗ No features returned");
        continue;
      }

      const data = {
        success: true,
        count: features.length,
        data: { type: "FeatureCollection", features },
      };

      mkdirSync(outDir, { recursive: true });
      writeFileSync(outFile, JSON.stringify(data));

      const sizeMB = (Buffer.byteLength(JSON.stringify(data)) / 1024 / 1024).toFixed(2);
      console.log(`\n✓ Saved ${features.length} buildings to ${outFile} (${sizeMB} MB)`);
      console.log("  The API route will now serve this file instantly.\n");
      return;
    } catch (err) {
      console.log(`  ✗ ${err.message}`);
    }
  }

  console.error("\n✗ All servers failed. Try again later or use a VPN.\n");
  process.exit(1);
}

main();
