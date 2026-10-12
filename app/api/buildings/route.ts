import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const maxDuration = 60;

const BOUNDS = "30.71,76.75,30.76,76.81";

// Ordered by reliability — main server first, mirrors after
const OVERPASS_SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

// 6 hours — building footprints are static map data
const MEMORY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// 24 hours for disk cache
const DISK_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const CACHE_DIR = path.join(process.cwd(), ".next", "cache", "buildings");
const CACHE_FILE = path.join(CACHE_DIR, "buildings.json");
// Pre-fetched static data (created by scripts/prefetch-buildings.mjs)
const STATIC_FILE = path.join(process.cwd(), "public", "data", "buildings.json");

type OverpassElement = {
  type: string;
  id: number;
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
};

type BuildingFeature = {
  type: "Feature";
  id: number;
  properties: {
    id: number;
    name: string;
    address: string | null;
    building: string;
    buildingType: string;
    levels: number | null;
    hasRealName: boolean;
    amenity: string | null;
    shop: string | null;
    office: string | null;
    healthcare: string | null;
    tourism: string | null;
    historic: string | null;
    landuse: string | null;
    operator: string | null;
    brand: string | null;
  };
  geometry: {
    type: "Polygon";
    coordinates: [number, number][][];
  };
};

type BuildingsResponse = {
  success: boolean;
  count: number;
  data: {
    type: "FeatureCollection";
    features: BuildingFeature[];
  };
};

// ── In-memory cache ──────────────────────────────────────────────────
let cachedData: {
  expiresAt: number;
  data: BuildingsResponse;
} | null = null;

// ── Disk cache helpers ───────────────────────────────────────────────
async function readDiskCache(): Promise<BuildingsResponse | null> {
  try {
    const raw = await readFile(CACHE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as {
      expiresAt: number;
      data: BuildingsResponse;
    };
    if (parsed.expiresAt > Date.now()) {
      console.log("Loaded buildings from disk cache.");
      return parsed.data;
    }
  } catch {
    // cache miss or corrupt — fine, we'll fetch fresh
  }
  return null;
}

async function writeDiskCache(data: BuildingsResponse): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(
      CACHE_FILE,
      JSON.stringify({ expiresAt: Date.now() + DISK_CACHE_TTL_MS, data }),
    );
  } catch (err) {
    console.warn("Could not write buildings disk cache:", err);
  }
}

// Pre-fetched static file (instant, no expiry — it's committed data)
async function readStaticData(): Promise<BuildingsResponse | null> {
  try {
    const raw = await readFile(STATIC_FILE, "utf-8");
    const parsed = JSON.parse(raw) as BuildingsResponse;
    if (parsed.success && parsed.data?.features?.length > 0) {
      console.log(`Serving ${parsed.count} buildings from static file.`);
      return parsed;
    }
  } catch {
    // static file doesn't exist yet — run scripts/prefetch-buildings.mjs
  }
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanTag(value?: string): string | null {
  const cleaned = value?.trim();
  return cleaned || null;
}

function getAddress(tags: Record<string, string>): string | null {
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

function getBuildingName(
  tags: Record<string, string>,
): {
  name: string;
  address: string | null;
  hasRealName: boolean;
} {
  const address = getAddress(tags);

  const realName = [
    tags.name,
    tags.official_name,
    tags["name:en"],
    tags["building:name"],
    tags.short_name,
    tags.brand,
  ]
    .map(cleanTag)
    .find(Boolean);

  if (realName) {
    return {
      name: realName,
      address,
      hasRealName: true,
    };
  }

  const category =
    cleanTag(tags.amenity) ||
    cleanTag(tags.healthcare) ||
    cleanTag(tags.shop) ||
    cleanTag(tags.office) ||
    cleanTag(tags.tourism) ||
    cleanTag(tags.historic);

  const categoryLabels: Record<string, string> = {
    hospital: "Hospital",
    clinic: "Clinic",
    doctors: "Medical Clinic",
    school: "School",
    university: "University",
    college: "College",
    kindergarten: "Kindergarten",
    library: "Library",
    police: "Police Station",
    fire_station: "Fire Station",
    townhall: "Government Building",
    community_centre: "Community Centre",
    place_of_worship: "Place of Worship",
    pharmacy: "Pharmacy",
    bank: "Bank",
    restaurant: "Restaurant",
    cafe: "Cafe",
    supermarket: "Supermarket",
    hotel: "Hotel",
    museum: "Museum",
    theatre: "Theatre",
    cinema: "Cinema",
    marketplace: "Market",
    dentist: "Dental Clinic",
  };

  if (category) {
    const label =
      categoryLabels[category] ??
      category
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());

    return {
      name: address ? `${label} · ${address}` : label,
      address,
      hasRealName: false,
    };
  }

  const building = cleanTag(tags.building);

  const buildingLabels: Record<string, string> = {
    residential: "Residential Building",
    apartments: "Apartment Building",
    house: "House",
    detached: "House",
    semidetached_house: "Semi-Detached House",
    terrace: "Terraced House",
    commercial: "Commercial Building",
    industrial: "Industrial Building",
    retail: "Retail Building",
    office: "Office Building",
    hospital: "Hospital Building",
    school: "School Building",
    university: "University Building",
    college: "College Building",
    hotel: "Hotel Building",
    public: "Public Building",
    government: "Government Building",
    church: "Church",
    mosque: "Mosque",
    temple: "Temple",
    garage: "Garage",
    warehouse: "Warehouse",
    dormitory: "Dormitory",
  };

  const buildingLabel = building
    ? buildingLabels[building] ??
      (building === "yes"
        ? "Building"
        : building.replace(/_/g, " "))
    : "Building";

  return {
    name: address ? `${buildingLabel} · ${address}` : buildingLabel,
    address,
    hasRealName: false,
  };
}

function toBuildingFeature(
  element: OverpassElement
): BuildingFeature | null {
  const geometry = element.geometry;

  if (!geometry || geometry.length < 3) {
    return null;
  }

  const coordinates: [number, number][] = geometry.map((point) => [
    point.lon,
    point.lat,
  ]);

  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];

  if (first[0] !== last[0] || first[1] !== last[1]) {
    coordinates.push([first[0], first[1]]);
  }

  if (coordinates.length < 4) {
    return null;
  }

  const tags = element.tags ?? {};
  const buildingName = getBuildingName(tags);
  const rawLevels = Number(tags["building:levels"]);

  return {
    type: "Feature",
    id: element.id,
    properties: {
      id: element.id,
      name: buildingName.name,
      address: buildingName.address,
      building: tags.building ?? "yes",
      buildingType:
        tags.amenity ??
        tags.healthcare ??
        tags.shop ??
        tags.office ??
        tags.building ??
        "unknown",
      levels:
        Number.isFinite(rawLevels) && rawLevels > 0
          ? rawLevels
          : null,
      hasRealName: buildingName.hasRealName,
      amenity: cleanTag(tags.amenity),
      shop: cleanTag(tags.shop),
      office: cleanTag(tags.office),
      healthcare: cleanTag(tags.healthcare),
      tourism: cleanTag(tags.tourism),
      historic: cleanTag(tags.historic),
      landuse: cleanTag(tags.landuse),
      operator: cleanTag(tags.operator),
      brand: cleanTag(tags.brand),
    },
    geometry: {
      type: "Polygon",
      coordinates: [coordinates],
    },
  };
}

// ── Route handler ────────────────────────────────────────────────────
export async function GET() {
  // 1. Check in-memory cache first (instant)
  if (cachedData && cachedData.expiresAt > Date.now()) {
    return NextResponse.json(cachedData.data);
  }

  // 2. Check pre-fetched static file (< 50ms, no expiry)
  const staticData = await readStaticData();
  if (staticData) {
    cachedData = { data: staticData, expiresAt: Date.now() + MEMORY_CACHE_TTL_MS };
    return NextResponse.json(staticData);
  }

  // 3. Check disk cache (survives dev-server restarts)
  const diskData = await readDiskCache();
  if (diskData) {
    cachedData = { data: diskData, expiresAt: Date.now() + MEMORY_CACHE_TTL_MS };
    return NextResponse.json(diskData);
  }

  // 3. Fetch from Overpass servers with delays between retries
  const [south, west, north, east] = BOUNDS.split(",").map(Number);

  const query = `
    [out:json][timeout:45];
    way["building"](${south},${west},${north},${east});
    out body geom;
  `;

  const errors: string[] = [];

  for (let i = 0; i < OVERPASS_SERVERS.length; i++) {
    const server = OVERPASS_SERVERS[i];

    // Wait 2 seconds between retries to avoid hammering servers
    if (i > 0) {
      console.log(`Waiting 2s before trying next Overpass server...`);
      await sleep(2000);
    }

    try {
      console.log(`Fetching building footprints from: ${server}`);

      const response = await fetch(server, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "ChandigarhSafeSim/1.0 (educational-project)",
        },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(50_000),
        cache: "no-store",
      });

      if (!response.ok) {
        errors.push(`${server}: HTTP ${response.status}`);
        continue;
      }

      const result = (await response.json()) as {
        elements?: OverpassElement[];
      };

      const features = (result.elements ?? [])
        .filter((element) => element.type === "way")
        .map(toBuildingFeature)
        .filter(
          (feature): feature is BuildingFeature =>
            feature !== null
        );

      if (features.length === 0) {
        errors.push(`${server}: no building footprints returned`);
        continue;
      }

      const data: BuildingsResponse = {
        success: true,
        count: features.length,
        data: {
          type: "FeatureCollection",
          features,
        },
      };

      // Populate both caches
      cachedData = {
        data,
        expiresAt: Date.now() + MEMORY_CACHE_TTL_MS,
      };
      await writeDiskCache(data);

      console.log(`Loaded ${features.length} building footprints from ${server}.`);

      return NextResponse.json(data);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      errors.push(`${server}: ${message}`);
      console.error("Building data request failed:", server, message);
    }
  }

  return NextResponse.json(
    {
      success: false,
      error:
        "Could not load building data from any Overpass server. Please try again later.",
      details: errors,
    },
    { status: 502 }
  );
}