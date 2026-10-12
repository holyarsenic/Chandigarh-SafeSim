import { NextResponse } from "next/server";
import buildingsData from "@/lib/data/chandigarh_buildings.json";

export async function GET() {
  return NextResponse.json({
    success: true,
    count: buildingsData.features.length,
    data: buildingsData,
  });
}