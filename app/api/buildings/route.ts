import { NextResponse } from "next/server";
import buildingsData from "@/lib/data/chandigarh_buildings.json";

export const maxDuration = 60;

const BOUNDS = "30.71,76.75,30.76,76.81";
const CACHE_DURATION = 30 * 60 * 1000;

const OVERPASS_SERVERS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

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
  source: "openstreetmap" | "local-fallback";
  data: {
    type: "FeatureCollection";
    features: BuildingFeature[];
  };
};

let cachedData: {
  expiresAt: number;
  data: BuildingsResponse;
} | null = null;

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
  element: OverpassElement,
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

// Return local Chandigarh data when live data is unavailable.
function getLocalFallback(): BuildingsResponse {
  const features = buildingsData.features as BuildingFeature[];

  return {
    success: true,
    count: features.length,
    source: "local-fallback",
    data: {
      type: "FeatureCollection",
      features,
    },
  };
}

export async function GET() {
  // Reuse successful live data while its cache is valid.
  if (cachedData && cachedData.expiresAt > Date.now()) {
    return NextResponse.json(cachedData.data);
  }

  const fallback = getLocalFallback();
  const [south, west, north, east] = BOUNDS.split(",").map(Number);

  const query = `
    [out:json][timeout:25];
    way["building"](${south},${west},${north},${east});
    out body geom;
  `;

  const errors: string[] = [];

  // Try each Overpass server independently.
  for (const server of OVERPASS_SERVERS) {
    try {
      console.log("Fetching building footprints from:", server);

      const response = await fetch(server, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "ChandigarhSafeSim/1.0",
        },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      });

      // HTTP 502/504 responses do not automatically throw.
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
          (feature): feature is BuildingFeature => feature !== null,
        );

      if (features.length === 0) {
        errors.push(`${server}: no valid building footprints returned`);
        continue;
      }

      const data: BuildingsResponse = {
        success: true,
        count: features.length,
        source: "openstreetmap",
        data: {
          type: "FeatureCollection",
          features,
        },
      };

      cachedData = {
        data,
        expiresAt: Date.now() + CACHE_DURATION,
      };

      console.log(`Loaded ${features.length} OpenStreetMap buildings.`);

      return NextResponse.json(data);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);

      errors.push(`${server}: ${message}`);
      console.error("Building data request failed:", server, message);
    }
  }

  // All Overpass servers failed: return local data, not HTTP 502.
  console.warn(
    "All Overpass servers failed. Returning local Chandigarh fallback data.",
    errors,
  );

  return NextResponse.json({
    ...fallback,
    fallbackReason: "Live building data is temporarily unavailable.",
  });
}