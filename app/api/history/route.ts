
import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { auth } from "@/lib/auth";

function getSql() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is not set");
  return neon(dbUrl);
}

async function getCurrentUserId(
  email: string
): Promise<number | null> {
  const sql = getSql();

  const users = await sql`
    SELECT id
    FROM users
    WHERE email = ${email}
    LIMIT 1;
  `;

  if (users.length === 0) return null;

  return Number(users[0].id);
}

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json(
        { success: false, error: "Please sign in with Google first." },
        { status: 401 }
      );
    }

    const userId = await getCurrentUserId(session.user.email);

    if (userId === null) {
      return NextResponse.json(
        { success: false, error: "User account not found." },
        { status: 404 }
      );
    }

    const sql = getSql();

    const records = await sql`
      SELECT *
      FROM simulations
      WHERE user_id = ${userId}
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
      {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : "An unexpected error occurred",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json(
        { success: false, error: "Please sign in with Google first." },
        { status: 401 }
      );
    }

    const userId = await getCurrentUserId(session.user.email);

    if (userId === null) {
      return NextResponse.json(
        { success: false, error: "User account not found." },
        { status: 404 }
      );
    }

    const sql = getSql();
    const body = await request.json().catch(() => ({}));

    const lat = Number(body.latitude ?? body.lat ?? 30.7398);
    const lon = Number(body.longitude ?? body.lon ?? 76.7827);
    const radius = Number(body.radius ?? body.impact_radius ?? 150);
    const hazardIndex = Number(body.hazard_index ?? 0);

    if (
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      !Number.isFinite(lon) ||
      lon < -180 ||
      lon > 180 ||
      !Number.isFinite(radius) ||
      radius <= 0 ||
      !Number.isFinite(hazardIndex)
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid simulation parameters." },
        { status: 400 }
      );
    }

    const createdAt = new Date().toISOString();

    const geojsonPayload =
      body.geojson_payload ||
      body.metadata?.geojson || {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [lon, lat],
        },
        properties: {
          name: body.building_name || "Chandigarh Structure",
          scenario: body.scenario || "building-collapse",
          radius,
          hazard_index: hazardIndex,
        },
      };

    const [inserted] = await sql`
      INSERT INTO simulations (
        user_id,
        latitude,
        longitude,
        radius,
        hazard_index,
        created_at,
        geojson_payload
      )
      VALUES (
        ${userId},
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
      {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : "An unexpected error occurred",
      },
      { status: 500 }
    );
  }
}
