
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

export async function GET() {
  // Return cached buildings when available.
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

          // GeoJSON polygon rings must be closed.
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

      const data: BuildingsResponse = {
        success: true,
        count: features.length,
        data: {
          type: "FeatureCollection",
          features,
        },
      };

      // Cache successful responses for 30 minutes.
      cachedData = {
        data,
        expiresAt: Date.now() + 30 * 60 * 1000,
      };

      console.log(`Loaded ${features.length} buildings successfully.`);
      return NextResponse.json(data);
    } catch (error) {
      // Record the failure and continue to the next server.
      lastError =
        error instanceof Error ? error.message : String(error);

      console.error(`Buildings server failed (${server}):`, lastError);
    }
  }

  // Reached only if every server failed.
  return NextResponse.json(
    {
      success: false,
      error: "Could not load building data. Please try again.",
      details: lastError,
    },
    { status: 502 }
  );
}