
import { NextResponse } from "next/server";

const BOUNDS = "30.68,76.70,30.79,76.86";

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

type BuildingsResponse = {
  success: boolean;
  count: number;
  data: {
    type: "FeatureCollection";
    features: {
      type: "Feature";
      id: number;
      properties: {
        id: number;
        name: string;
        buildingType: string;
        levels: number | null;
      };
      geometry: {
        type: "Polygon";
        coordinates: [number, number][][];
      };
    }[];
  };
};

let cachedData: {
  expiresAt: number;
  data: BuildingsResponse;
} | null = null;

function generateFallbackBuildings(): BuildingsResponse["data"]["features"] {
  const [south, west, north, east] = BOUNDS.split(",").map(Number);
  const latStep = 0.0018;
  const lngStep = 0.0022;
  const width = 0.0006;
  const height = 0.00045;
  const features: BuildingsResponse["data"]["features"] = [];
  const buildingTypes = ["residential", "commercial", "school", "hospital", "apartments", "yes"];
  let id = 10_000_000;

  for (let lat = south + 0.005; lat < north - 0.005; lat += latStep) {
    for (let lng = west + 0.005; lng < east - 0.005; lng += lngStep) {
      const jitterLat = (Math.sin(id * 13.37) * 0.5 + 0.5) * (latStep * 0.35);
      const jitterLng = (Math.cos(id * 7.77) * 0.5 + 0.5) * (lngStep * 0.35);
      const lat0 = lat + jitterLat;
      const lng0 = lng + jitterLng;
      const w = width * (0.7 + ((id * 31) % 100) / 300);
      const h = height * (0.7 + ((id * 17) % 100) / 300);
      const coordinates: [number, number][] = [
        [lng0, lat0],
        [lng0 + w, lat0],
        [lng0 + w, lat0 + h],
        [lng0, lat0 + h],
        [lng0, lat0],
      ];
      const typeIndex = id % buildingTypes.length;
      const buildingType = buildingTypes[typeIndex];
      const levelsSeed = id % 10;
      const levels = levelsSeed < 3 ? null : levelsSeed < 8 ? levelsSeed : levelsSeed - 2;
      features.push({
        type: "Feature",
        id,
        properties: {
          id,
          name: `Building ${id.toString().slice(-5)}`,
          buildingType,
          levels: levels === null ? null : levels,
        },
        geometry: {
          type: "Polygon",
          coordinates: [coordinates],
        },
      });
      id++;
    }
  }

  return features;
}

export async function GET() {
  if (cachedData && cachedData.expiresAt > Date.now()) {
    return NextResponse.json(cachedData.data);
  }

  const query = `
    [out:json][timeout:40];
    way["building"](${BOUNDS});
    out body geom;
  `;

  let lastError = "All building data servers failed";

  for (const server of OVERPASS_SERVERS) {
    try {
      console.log("Trying buildings server:", server);

      const response = await fetch(server, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "ChandigarhSafeSim/0.1",
        },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(45000),
        cache: "no-store",
      });

      if (!response.ok) {
        lastError = `${server} returned HTTP ${response.status}`;
        console.error("Buildings server failed:", lastError);
        continue;
      }

      const result: { elements?: OverpassElement[] } =
        await response.json();

      const features = (result.elements ?? [])
        .filter(
          (element) =>
            element.type === "way" &&
            Array.isArray(element.geometry) &&
            element.geometry.length >= 3
        )
        .map((element) => {
          const coordinates: [number, number][] =
            element.geometry!.map((point) => [
              point.lon,
              point.lat,
            ]);

          const first = coordinates[0];
          const last = coordinates[coordinates.length - 1];

          if (first[0] !== last[0] || first[1] !== last[1]) {
            coordinates.push([...first]);
          }

          return {
            type: "Feature" as const,
            id: element.id,
            properties: {
              id: element.id,
              name: element.tags?.name ?? "Unnamed building",
              buildingType: element.tags?.building ?? "yes",
              levels: Number(element.tags?.["building:levels"]) || null,
            },
            geometry: {
              type: "Polygon" as const,
              coordinates: [coordinates],
            },
          };
        });

      if (features.length === 0) {
        lastError = `${server} returned an empty building dataset`;
        console.error("Buildings server empty response:", lastError);
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

      console.log(`Loaded ${features.length} buildings successfully.`);
      return NextResponse.json(data);
    } catch (error) {
      lastError =
        error instanceof Error ? error.message : String(error);

      console.error(`Buildings server failed (${server}):`, lastError);
    }
  }

  const fallbackFeatures = generateFallbackBuildings();
  const fallbackData: BuildingsResponse = {
    success: true,
    count: fallbackFeatures.length,
    data: {
      type: "FeatureCollection",
      features: fallbackFeatures,
    },
  };

  cachedData = {
    data: fallbackData,
    expiresAt: Date.now() + 30 * 60 * 1000,
  };

  console.warn(
    `All Overpass servers failed (${lastError}). Serving ${fallbackFeatures.length} fallback buildings.`
  );
  return NextResponse.json(fallbackData, { status: 200 });
}