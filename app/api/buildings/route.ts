import { NextResponse } from "next/server";
export const maxDuration = 60;

// Wider Chandigarh-area bounding box:
// south, west, north, east
const BOUNDS = "30.60,76.65,30.82,76.90";

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
    buildingType: string;
    levels: number | null;
    address: string | null;
    hasRealName: boolean;
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

let cachedData: {
  expiresAt: number;
  data: BuildingsResponse;
} | null = null;

function getBuildingName(
  tags: Record<string, string>,
  id: number
): {
  name: string;
  address: string | null;
  hasRealName: boolean;
} {
  const realName =
    tags.name?.trim() ||
    tags["addr:housename"]?.trim() ||
    tags["official_name"]?.trim() ||
    tags["short_name"]?.trim();

  const houseNumber = tags["addr:housenumber"]?.trim();
  const street = tags["addr:street"]?.trim();
  const place = tags["addr:place"]?.trim();

  const address =
    [houseNumber, street || place].filter(Boolean).join(", ") ||
    tags["addr:full"]?.trim() ||
    null;

  if (realName) {
    return {
      name: realName,
      address,
      hasRealName: true,
    };
  }

  if (address) {
    return {
      name: address,
      address,
      hasRealName: false,
    };
  }

  // This is a generated label, not an actual registered building name.
  return {
    name: `Building #${id}`,
    address: null,
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

  // GeoJSON polygon rings must be closed.
  if (first[0] !== last[0] || first[1] !== last[1]) {
    coordinates.push([first[0], first[1]]);
  }

  if (coordinates.length < 4) {
    return null;
  }

  const tags = element.tags ?? {};
  const buildingName = getBuildingName(tags, element.id);
  const rawLevels = Number(tags["building:levels"]);

  return {
    type: "Feature",
    id: element.id,
    properties: {
      id: element.id,
      name: buildingName.name,
      buildingType: tags.building ?? "yes",
      levels:
        Number.isFinite(rawLevels) && rawLevels > 0
          ? rawLevels
          : null,
      address: buildingName.address,
      hasRealName: buildingName.hasRealName,
    },
    geometry: {
      type: "Polygon",
      coordinates: [coordinates],
    },
  };
}

export async function GET() {
  if (cachedData && cachedData.expiresAt > Date.now()) {
    return NextResponse.json(cachedData.data);
  }

  const [south, west, north, east] = BOUNDS.split(",").map(Number);

  const query = `
    [out:json][timeout:45];
    way["building"](${south},${west},${north},${east});
    out body geom;
  `;

  const errors: string[] = [];

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
          (feature): feature is BuildingFeature => feature !== null
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

      cachedData = {
        data,
        expiresAt: Date.now() + 30 * 60 * 1000,
      };

      console.log(`Loaded ${features.length} building footprints.`);

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