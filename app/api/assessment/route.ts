import { NextRequest, NextResponse } from "next/server";

type OSMNode = {
  lat: number;
  lon: number;
};

type OSMWay = {
  type: "way";
  id: number;
  tags?: Record<string, string>;
  geometry?: OSMNode[];
};

type AssessmentFeature = {
  type: "Feature";
  properties: {
    id: number;
    name: string | null;
    type: string;
    levels: number | null;
  };
  geometry: {
    type: "Polygon" | "LineString";
    coordinates: number[][][] | number[][];
  };
};

const ALLOWED_RADII = [75, 150, 250];

const OVERPASS_SERVERS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

function distanceMeters(
  first: [number, number],
  second: [number, number]
): number {
  const earthRadius = 6_371_000;
  const radians = Math.PI / 180;

  const lat1 = first[1] * radians;
  const lat2 = second[1] * radians;

  const deltaLat = (second[1] - first[1]) * radians;
  const deltaLon = (second[0] - first[0]) * radians;

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLon / 2) ** 2;

  return (
    earthRadius *
    2 *
    Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  );
}

function getCenter(
  coordinates: OSMNode[]
): [number, number] | null {
  if (coordinates.length === 0) {
    return null;
  }

  const longitude =
    coordinates.reduce((sum, point) => sum + point.lon, 0) /
    coordinates.length;

  const latitude =
    coordinates.reduce((sum, point) => sum + point.lat, 0) /
    coordinates.length;

  return [longitude, latitude];
}

function toBuildingFeature(
  way: OSMWay
): AssessmentFeature | null {
  const geometry = way.geometry;

  if (!geometry || geometry.length < 3) {
    return null;
  }

  const coordinates: [number, number][] = geometry.map(
    (point) => [point.lon, point.lat]
  );

  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];

  if (
    first[0] !== last[0] ||
    first[1] !== last[1]
  ) {
    coordinates.push([...first]);
  }

  return {
    type: "Feature",
    properties: {
      id: way.id,
      name: way.tags?.name ?? null,
      type: way.tags?.building ?? "unknown",
      levels: way.tags?.["building:levels"]
        ? Number(way.tags["building:levels"])
        : null,
    },
    geometry: {
      type: "Polygon",
      coordinates: [coordinates],
    },
  };
}

function toRoadFeature(
  way: OSMWay
): AssessmentFeature | null {
  const geometry = way.geometry;

  if (!geometry || geometry.length < 2) {
    return null;
  }

  return {
    type: "Feature",
    properties: {
      id: way.id,
      name: way.tags?.name ?? null,
      type: way.tags?.highway ?? "unknown",
      levels: null,
    },
    geometry: {
      type: "LineString",
      coordinates: geometry.map((point) => [
        point.lon,
        point.lat,
      ]),
    },
  };
}

async function fetchOverpass(
  latitude: number,
  longitude: number,
  radius: number
): Promise<OSMWay[]> {
  const query = `
    [out:json][timeout:20];
    (
      way(around:${radius},${latitude},${longitude})["building"];
      way(around:${radius},${latitude},${longitude})["highway"];
    );
    out tags geom;
  `;

  let lastError = "OpenStreetMap data is temporarily unavailable.";

  for (const server of OVERPASS_SERVERS) {
    try {
      const response = await fetch(server, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ data: query }).toString(),
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      });

      if (!response.ok) {
        lastError = `OpenStreetMap returned HTTP ${response.status}.`;
        continue;
      }

      const result: { elements?: OSMWay[] } =
        await response.json();

      return result.elements ?? [];
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "Failed to retrieve OpenStreetMap data.";
    }
  }

  throw new Error(lastError);
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();

    if (
      typeof body !== "object" ||
      body === null ||
      !("latitude" in body) ||
      !("longitude" in body) ||
      !("radius" in body)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Latitude, longitude, and radius are required.",
        },
        { status: 400 }
      );
    }

    const { latitude, longitude, radius } = body as {
      latitude: unknown;
      longitude: unknown;
      radius: unknown;
    };

    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid latitude or longitude.",
        },
        { status: 400 }
      );
    }

    if (
      typeof radius !== "number" ||
      !ALLOWED_RADII.includes(radius)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Radius must be 75, 150, or 250 meters.",
        },
        { status: 400 }
      );
    }

    const elements = await fetchOverpass(
      latitude,
      longitude,
      radius
    );

    const buildings: AssessmentFeature[] = [];
    const roads: AssessmentFeature[] = [];

    const location: [number, number] = [
      longitude,
      latitude,
    ];

    for (const way of elements) {
      if (!way.geometry || way.geometry.length < 2) {
        continue;
      }

      if (way.tags?.building) {
        const center = getCenter(way.geometry);

        if (
          center &&
          distanceMeters(center, location) <= radius
        ) {
          const feature = toBuildingFeature(way);

          if (feature) {
            buildings.push(feature);
          }
        }
      }

      if (way.tags?.highway) {
        const roadIsNearby = way.geometry.some((point) => {
          return (
            distanceMeters(
              [point.lon, point.lat],
              location
            ) <= radius
          );
        });

        if (roadIsNearby) {
          const feature = toRoadFeature(way);

          if (feature) {
            roads.push(feature);
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        location: {
          latitude,
          longitude,
        },
        radiusMeters: radius,
        buildings: {
          count: buildings.length,
          type: "FeatureCollection",
          features: buildings,
        },
        roads: {
          count: roads.length,
          type: "FeatureCollection",
          features: roads,
        },
        disclaimer:
          "Preliminary proximity assessment based on OpenStreetMap data. Counts are approximate and do not predict actual damage or road blockage.",
      },
    });
  } catch (error) {
    console.error("Safety assessment error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to complete the assessment. OpenStreetMap may be temporarily unavailable.",
      },
      { status: 502 }
    );
  }
}