import { NextResponse } from "next/server";

interface Facility {
  id: string;
  name: string;
  type: string;
  location: number[];
  straightLineMeters: number;
  directionsUrl: string;
}
const EMERGENCY_FACILITIES = [
  { id: "hosp-1", name: "PGIMER Chandigarh", type: "hospital", lat: 30.7656, lon: 76.7735 },
  { id: "hosp-2", name: "GMSH Hospital Sector 16", type: "hospital", lat: 30.7463, lon: 76.7794 },
  { id: "fire-1", name: "Sector 17 Central Fire Station", type: "fire_station", lat: 30.7410, lon: 76.7820 },
  { id: "hosp-3", name: "GMCH Sector 32 Hospital", type: "hospital", lat: 30.7108, lon: 76.7801 },
  { id: "fire-2", name: "Sector 32 Fire Sub-Station", type: "fire_station", lat: 30.7150, lon: 76.7720 },
  { id: "police-1", name: "Sector 17 Police Headquarters", type: "police", lat: 30.7420, lon: 76.7845 },
  { id: "hosp-4", name: "Fortis Hospital Mohali (Border)", type: "hospital", lat: 30.7025, lon: 76.7230 },
];

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = parseFloat(searchParams.get("lat") || "30.7338");
  const lon = parseFloat(searchParams.get("lon") || "76.7794");
  const radius = parseFloat(searchParams.get("radius") || "5000");

  const facilities: Facility[] = EMERGENCY_FACILITIES.map((f) => {
    const dist = haversineMeters(lat, lon, f.lat, f.lon);
    return {
      id: f.id,
      name: f.name,
      type: f.type,
      location: [f.lon, f.lat],
      straightLineMeters: dist,
      directionsUrl: `https://www.google.com/maps/dir/?api=1&origin=${lat},${lon}&destination=${f.lat},${f.lon}&travelmode=driving`,
    };
  })
    .filter((f) => f.straightLineMeters <= radius)
    .sort((a, b) => a.straightLineMeters - b.straightLineMeters);

  return NextResponse.json({
    success: true,
    facilities,
  });
}