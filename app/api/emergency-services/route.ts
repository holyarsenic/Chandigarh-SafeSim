
import { NextRequest, NextResponse } from "next/server";

type Element = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string | undefined>;
};

type Facility = {
  id: string;
  name: string;
  type: string;
  location: [number, number];
  straightLineMeters: number;
  directionsUrl: string;
};

const ENDPOINT = "https://overpass-api.de/api/interpreter";
const CACHE_TTL = 5 * 60 * 1000;

const cache = new Map<string, { expires: number; data: Facility[] }>();
const cooldown = new Map<string, number>();
const pending = new Map<string, Promise<Facility[]>>();

function distance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const rad = (n: number) => (n * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) *
      Math.cos(rad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function loadFacilities(
  lat: number,
  lon: number,
  radius: number,
  key: string
): Promise<Facility[]> {
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.data;

  const existing = pending.get(key);
  if (existing) return existing;

  const retryAfter = cooldown.get(ENDPOINT) ?? 0;
  if (Date.now() < retryAfter) {
    throw new Error("Overpass is rate-limited. Please try again later.");
  }

  const task = (async () => {
    const query = `
      [out:json][timeout:20];
      (
        node["amenity"~"^(hospital|clinic|doctors|police|fire_station|pharmacy)$"](around:${radius},${lat},${lon});
        way["amenity"~"^(hospital|clinic|doctors|police|fire_station|pharmacy)$"](around:${radius},${lat},${lon});
        relation["amenity"~"^(hospital|clinic|doctors|police|fire_station|pharmacy)$"](around:${radius},${lat},${lon});
      );
      out center tags;
    `;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": "ChandigarhSafeSim/1.0",
        },
        body: new URLSearchParams({ data: query }),
        signal: controller.signal,
        cache: "no-store",
      });

      if (response.status === 429 || response.status === 406) {
        cooldown.set(ENDPOINT, Date.now() + 60_000);
        throw new Error(`Overpass returned HTTP ${response.status}`);
      }

      if (!response.ok) {
        throw new Error(`Overpass returned HTTP ${response.status}`);
      }

      const json = (await response.json()) as { elements?: Element[] };
      if (!Array.isArray(json.elements)) {
        throw new Error("Invalid Overpass response");
      }

      const facilities = json.elements
        .flatMap((element): Facility[] => {
          const fLat = element.lat ?? element.center?.lat;
          const fLon = element.lon ?? element.center?.lon;

          if (fLat === undefined || fLon === undefined) return [];

          const meters = Math.round(distance(lat, lon, fLat, fLon));
          if (meters > radius) return [];

          const amenity = element.tags?.amenity ?? "emergency_service";
          const name =
            element.tags?.name?.trim() ||
            amenity.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());

          return [{
            id: `${element.type}-${element.id}`,
            name,
            type: amenity.replaceAll("_", " "),
            location: [fLon, fLat],
            straightLineMeters: meters,
            directionsUrl: `https://www.google.com/maps/dir/?api=1&origin=${lat},${lon}&destination=${fLat},${fLon}&travelmode=driving`,
          }];
        })
        .sort((a, b) => a.straightLineMeters - b.straightLineMeters);

      cache.set(key, { expires: Date.now() + CACHE_TTL, data: facilities });
      cooldown.delete(ENDPOINT);
      return facilities;
    } finally {
      clearTimeout(timeout);
    }
  })();

  pending.set(key, task);

  try {
    return await task;
  } finally {
    pending.delete(key);
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const radius = Number(params.get("radius") ?? "5000");

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return NextResponse.json(
      { success: false, error: "Invalid latitude or longitude." },
      { status: 400 }
    );
  }

  if (!Number.isFinite(radius) || radius < 100 || radius > 20000) {
    return NextResponse.json(
      { success: false, error: "Radius must be between 100 and 20000 meters." },
      { status: 400 }
    );
  }

  const key = `${lat.toFixed(4)}:${lon.toFixed(4)}:${radius}`;

  try {
    const facilities = await loadFacilities(lat, lon, radius, key);

    return NextResponse.json({
      success: true,
      facilities,
      count: facilities.length,
      source: "OpenStreetMap",
    });
  } catch (error) {
    console.error("[emergency-services]", error);

    return NextResponse.json(
      {
        success: false,
        facilities: [],
        error: "Emergency-service data is temporarily unavailable. Please try again shortly.",
      },
      { status: 503 }
    );
  }
}
