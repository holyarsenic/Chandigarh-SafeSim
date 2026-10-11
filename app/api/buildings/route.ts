import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get("lat") || "30.7333";
  const lon = searchParams.get("lon") || "76.7794";
  const radius = searchParams.get("radius") || "500";

  try {
    const res = await fetch(
      `http://127.0.0.1:8000/api/simulation/evaluate?lat=${lat}&lon=${lon}&radius=${radius}`,
      { cache: "no-store" }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: "Backend simulation engine failed" },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to connect to FastAPI backend" },
      { status: 502 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const res = await fetch("http://127.0.0.1:8000/api/simulation/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Backend simulation engine failed" },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to connect to FastAPI backend" },
      { status: 502 }
    );
  }
}