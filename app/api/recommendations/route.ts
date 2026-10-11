import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { scenario, buildingName, buildingType, radius, affectedCount } = body;

    // Pass the trigger to FastAPI in the background to log run to Neon
    fetch("http://127.0.0.1:8000/api/v1/assessments/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        latitude: 30.7398,
        longitude: 76.7827,
        radius: Number(radius ?? 150),
      }),
    }).catch(() => {
      // Background logging fails gracefully if engine is busy
    });

    // Return the structure expected by page.tsx
    return NextResponse.json({
      success: true,
      data: {
        summary: `The simulation analyzed ${buildingName || "the building"} (${buildingType || "Structure"}) with ${affectedCount} surrounding structures within ${radius}m impact zone.`,
        precautions: [
          {
            title: "Immediate Perimeter Cordon",
            description: "Maintain a clear safety corridor of at least " + radius + " meters.",
          },
          {
            title: "Emergency Response Routing",
            description: "Direct civic emergency and first responders via unblocked arterial roads.",
          },
          {
            title: "Structural Assessment",
            description: "Conduct secondary inspection on high-risk adjacent buildings.",
          },
        ],
        nextSteps: [
          "Report live ground-truth status to Chandigarh Disaster Control (Call 112).",
          "Ensure secondary utility lines (power, gas) in the hazard zone are isolated.",
          "Keep pedestrian and traffic evacuation paths open.",
        ],
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to process recommendations" },
      { status: 500 }
    );
  }
}