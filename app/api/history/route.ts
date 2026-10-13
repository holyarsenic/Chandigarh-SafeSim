import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

function getSql() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is not set");
  return neon(dbUrl);
}

export async function GET() {
  try {
    const sql = getSql();
    const records = await sql`
      SELECT *
      FROM simulations
      ORDER BY id DESC
      LIMIT 20;
    `;

    return NextResponse.json({
      success: true,
      source: "neon-db",
      count: records.length,
      data: records,
    });
  } catch (err) {
    console.error("[GET /api/history]", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err?.message : "An unexpected error occurred" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const body = await request.json().catch(() => ({}));

    const lat = Number(body.latitude ?? body.lat ?? 30.7398);
    const lon = Number(body.longitude ?? body.lon ?? 76.7827);
    const radius = Number(body.radius ?? body.impact_radius ?? 150);
    const hazardIndex = Number(body.hazard_index ?? 0);
    const createdAt = new Date().toISOString();

    const geojsonPayload = body.geojson_payload || body.metadata?.geojson || {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [lon, lat],
      },
      properties: {
        name: body.building_name || "Chandigarh Structure",
        scenario: body.scenario || "building-collapse",
        radius: radius,
        hazard_index: hazardIndex,
      },
    };

    const [inserted] = await sql`
      INSERT INTO simulations (
        latitude,
        longitude,
        radius,
        hazard_index,
        created_at,
        geojson_payload
      )
      VALUES (
        ${lat},
        ${lon},
        ${radius},
        ${hazardIndex},
        ${createdAt},
        ${JSON.stringify(geojsonPayload)}
      )
      RETURNING *;
    `;

    return NextResponse.json({
      success: true,
      source: "neon-db",
      data: inserted,
    });
  } catch (err) {
    console.error("[POST /api/history]", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "An unexpected error occurred"},
      { status: 500 }
    );
  }
}