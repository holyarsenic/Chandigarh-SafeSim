import { NextResponse } from "next/server";
import { z } from "zod";

const FacilitySchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(100),
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  straightLineMeters: z.number().min(0).max(1000000),
  directionsUrl: z.string().url().max(2000),
});

const RequestSchema = z.object({
  buildingName: z.string().min(1).max(200).default("Selected building"),
  scenario: z.enum(["building-collapse", "major-fire"]).default("building-collapse"),
  location: z.object({
    longitude: z.number().min(-180).max(180),
    latitude: z.number().min(-90).max(90),
  }),
  facilities: z.array(FacilitySchema).min(1).max(10),
});

const GuidanceSchema = z.object({
  summary: z.string().min(1).max(1000),
  nearestFacility: z.string().min(1).max(1000),
  recommendedActions: z.array(z.string().min(1).max(500)).min(1).max(6),
  precautions: z.array(
    z.object({
      title: z.string().min(1).max(150),
      description: z.string().min(1).max(600),
    })
  ).min(1).max(6),
  nextSteps: z.array(z.string().min(1).max(500)).min(1).max(6),
});

type Guidance = z.infer<typeof GuidanceSchema>;

function fallbackGuidance(
  facilities: z.infer<typeof FacilitySchema>[],
  scenario: "building-collapse" | "major-fire"
): Guidance {
  const nearest = [...facilities].sort(
    (a, b) => a.straightLineMeters - b.straightLineMeters
  )[0];

  const distance =
    nearest.straightLineMeters < 1000
      ? `${Math.round(nearest.straightLineMeters)} m`
      : `${(nearest.straightLineMeters / 1000).toFixed(2)} km`;

  const nearestFacility =
    `${nearest.name} (${nearest.type}), approximately ${distance} away in a straight line.`;

  if (scenario === "major-fire") {
    return {
      summary:
        "A mapped emergency facility is listed nearby, but its current availability and the safety of the route are not verified.",
      nearestFacility,
      recommendedActions: [
        "Move away from fire and smoke; do not enter a burning building.",
        "Call 112 in India and give the exact incident location.",
        "Use the facility directions link only if it is safe and responders advise you to travel there.",
      ],
      precautions: [
        {
          title: "Avoid smoke",
          description:
            "Move away from smoke and stay out of smoke-filled buildings.",
        },
        {
          title: "Use safe exits",
          description:
            "Follow marked exits and emergency responders' instructions. Do not use lifts during a fire.",
        },
      ],
      nextSteps: [
        "Contact emergency services and describe the hazards.",
        "Keep access routes clear for responders.",
        "Do not return until authorities say it is safe.",
      ],
    };
  }

  return {
    summary:
      "A mapped emergency facility is listed nearby, but its current availability and the safety of the route are not verified.",
    nearestFacility,
    recommendedActions: [
      "Move away from damaged or unstable structures.",
      "Call 112 in India if anyone is injured, trapped, or in immediate danger.",
      "Check the directions link and follow emergency responders' advice before travelling.",
    ],
    precautions: [
      {
        title: "Avoid unstable buildings",
        description:
          "Do not enter damaged structures or approach unstable walls and debris.",
      },
      {
        title: "Avoid untrained rescue attempts",
        description:
          "Wait for trained responders if someone may be trapped.",
        },
      ],
    nextSteps: [
      "Call 112 and provide the incident location and known hazards.",
      "Follow emergency responders' instructions.",
      "Have suspected structural damage assessed by qualified professionals.",
    ],
  };
}

async function generateWithGemma(prompt: string): Promise<string> {
  const apiKey = process.env.OLLAMA_API_KEY;

  if (!apiKey) {
    throw new Error("OLLAMA_API_KEY is not configured.");
  }

  const response = await fetch("https://ollama.com/api/chat", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || "gemma4:cloud",
      messages: [
        {
          role: "system",
          content:
            "You are a cautious emergency-information assistant. Use only the supplied facilities. Never invent a facility, distance, road route, travel time, opening status, or service availability. Distances are straight-line measurements. Return only JSON matching the requested schema. For real emergencies in India, advise calling 112.",
        },
        { role: "user", content: prompt },
      ],
      format: "json",
      stream: false,
      options: { temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new Error(
      `Ollama Cloud returned HTTP ${response.status}: ${(await response.text()).slice(0, 250)}`
    );
  }

  const result: {
    message?: { content?: string };
  } = await response.json();

  if (!result.message?.content) {
    throw new Error("Gemma returned an empty response.");
  }

  return result.message.content;
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON request." },
      { status: 400 }
    );
  }

  const parsed = RequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid emergency guidance request.",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const { buildingName, scenario, location, facilities } = parsed.data;

  const sortedFacilities = [...facilities].sort(
    (a, b) => a.straightLineMeters - b.straightLineMeters
  );

  const prompt = `
Generate practical emergency guidance for a college urban-safety prototype.

Selected building: ${buildingName}
Scenario: ${scenario === "major-fire" ? "Major Fire" : "Building Collapse"}
Selected building coordinates: ${location.latitude}, ${location.longitude}

REAL FACILITY DATA FROM THE APPLICATION:
${JSON.stringify(sortedFacilities, null, 2)}

Return a JSON object with exactly these fields:
{
  "summary": "Brief explanation of the nearby mapped options and their limitations",
  "nearestFacility": "Name, type and supplied straight-line distance of the nearest mapped facility",
  "recommendedActions": ["Practical actions in priority order"],
  "precautions": [{"title": "Short title", "description": "Practical precaution"}],
  "nextSteps": ["Practical next step"]
}

Rules:
- Use only the supplied facility list. Do not invent facilities or details.
- The list is sorted by straight-line distance. Do not claim the closest straight-line facility is necessarily the quickest or safest to reach.
- Mention the nearest facility by its supplied name, type, and straight-line distance.
- Explain that straight-line distance is not road distance or travel time.
- Do not generate turn-by-turn road directions. Tell the user to open the supplied directions link and verify the route.
- Do not claim a facility is open, available, staffed, or equipped unless the data explicitly confirms it.
- For a real emergency in India, call 112 first.
- For fire: move away from fire and smoke; do not enter burning buildings.
- For collapse: stay away from unstable structures; do not enter damaged buildings or attempt untrained rescues.
- Never recommend travelling toward a dangerous scene.
- Use simple English and concise steps.
- Include 2 to 4 precautions and 2 to 4 next steps.
- Return only valid JSON without Markdown fences.
`;

  try {
    const generated = await generateWithGemma(prompt);
    const cleaned = generated
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");

    const output = GuidanceSchema.parse(JSON.parse(cleaned));

    return NextResponse.json({
      success: true,
      data: output,
      provider: "gemma",
      fallback: false,
    });
  } catch (error) {
    console.warn(
      "Gemma emergency guidance failed; using built-in guidance:",
      error instanceof Error ? error.message : error
    );

    return NextResponse.json({
      success: true,
      data: fallbackGuidance(sortedFacilities, scenario),
      provider: "built-in",
      fallback: true,
    });
  }
}