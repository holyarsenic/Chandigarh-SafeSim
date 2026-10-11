
import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const FacilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  location: z.tuple([z.number(), z.number()]),
  straightLineMeters: z.number().nonnegative(),
  directionsUrl: z.string().url(),
});

const RequestSchema = z.object({
  scenario: z.enum(["building-collapse", "major-fire"]),
  buildingName: z.string().min(1).max(200),
  buildingType: z.string().max(100).default("Unknown"),
  levels: z.union([z.string(), z.number(), z.null()]).optional(),
  radius: z.union([z.literal(75), z.literal(150), z.literal(250)]),
  affectedCount: z.number().int().min(0).max(100000),
  facilities: z.array(FacilitySchema).max(100).default([]),
});

const FacilityAnalysisSchema = z.object({
  recommendedFacilityIds: z.array(z.string()).max(5),
  explanation: z.string(),
});

const SafetySchema = z.object({
  summary: z.string(),
  precautions: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
    }),
  ).min(1).max(8),
  nextSteps: z.array(z.string()).min(1).max(6),
});

type RequestData = z.infer<typeof RequestSchema>;
type Facility = z.infer<typeof FacilitySchema>;
type SafetyData = z.infer<typeof SafetySchema>;

async function callGemma(prompt: string): Promise<string> {
  const apiKey = process.env.OLLAMA_API_KEY;
  if (!apiKey) throw new Error("OLLAMA_API_KEY is not configured.");

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
            "You analyze supplied emergency-facility data. Use only provided facility IDs. Never invent facilities, distances, opening hours, road conditions, or availability. Return JSON only.",
        },
        { role: "user", content: prompt },
      ],
      format: "json",
      stream: false,
      options: { temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new Error(`Gemma HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  const result = (await response.json()) as {
    message?: { content?: string };
  };

  if (!result.message?.content) throw new Error("Gemma returned no content.");
  return result.message.content;
}

async function callGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const ai = new GoogleGenAI({ apiKey });
  const result = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  });

  if (!result.text) throw new Error("Gemini returned no content.");
  return result.text;
}

function parseJson<T>(text: string, schema: z.ZodType<T>): T {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  return schema.parse(JSON.parse(cleaned));
}

function fallbackSafety(input: RequestData): SafetyData {
  const fire = input.scenario === "major-fire";

  return {
    summary: `${fire ? "Fire" : "Building-collapse"} simulation for ${input.buildingName}. Nearby facility information is based on supplied map data and may be incomplete. The simulation does not verify actual danger or safe routes.`,
    precautions: fire
      ? [
          {
            title: "Move away from fire and smoke",
            description: "Leave the immediate danger area if you can do so safely. Never enter a burning building.",
          },
          {
            title: "Raise the alarm",
            description: "Call emergency services and report the location and visible hazards.",
          },
          {
            title: "Avoid lifts",
            description: "Use an exit only when it is safe to do so. Follow responders' instructions and do not re-enter.",
          },
        ]
      : [
          {
            title: "Stay away from damaged structures",
            description: "Do not enter a damaged building or attempt an untrained rescue in an unstable area.",
          },
          {
            title: "Contact emergency services",
            description: "Report the location and visible hazards to emergency responders.",
          },
          {
            title: "Keep access clear",
            description: "Stay clear of responders and follow official instructions.",
          },
        ],
    nextSteps: [
      "For a real emergency in India, call 112.",
      "Use the supplied facility list as a starting point, not confirmation that a service is open or available.",
      "Open directions for a listed facility only when responders or the situation indicate it is safe to travel.",
    ],
  };
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON request." },
      { status: 400 },
    );
  }

  const validation = RequestSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid simulation details.",
        details: validation.error.flatten(),
      },
      { status: 400 },
    );
  }

  const input = validation.data;
  const facilities = [...input.facilities].sort(
    (a, b) => a.straightLineMeters - b.straightLineMeters,
  );

  let rankedFacilities: Facility[] = facilities.slice(0, 5);
  let gemmaExplanation =
    "Facilities are ordered by supplied straight-line distance. AI ranking was unavailable.";

  // Stage 1: Gemma analyses facility relevance and distance.
  if (process.env.OLLAMA_API_KEY && facilities.length > 0) {
    try {
      const ranking = parseJson(
        await callGemma(`
Analyze the nearby emergency facilities for this simulation.

Scenario: ${input.scenario}
Selected building: ${input.buildingName}
Building type: ${input.buildingType}

Facility records (authoritative input; do not change them):
${JSON.stringify(facilities)}

Choose up to 5 appropriate facility IDs from this list.
For a fire, prioritize fire stations for fire response; hospitals for injured people.
For a collapse, prioritize fire/rescue or police for scene response, and hospitals for medical care.
Use distance as a consideration, not proof of travel time or availability.
Return JSON exactly:
{
  "recommendedFacilityIds": ["existing-id"],
  "explanation": "Brief explanation"
}
Do not invent IDs or claim a facility is open.
`),
        FacilityAnalysisSchema,
      );

      const byId = new Map(facilities.map((facility) => [facility.id, facility]));
      const chosen = ranking.recommendedFacilityIds
        .map((id) => byId.get(id))
        .filter((facility): facility is Facility => Boolean(facility));

      if (chosen.length > 0) rankedFacilities = chosen;
      gemmaExplanation = ranking.explanation;
    } catch (error) {
      console.warn(
        "[recommendations] Gemma facility analysis failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const fallback = fallbackSafety(input);
  let safety: SafetyData = fallback;
  let safetyProvider: "gemini" | "built-in" = "built-in";

  // Stage 2: Gemini generates safety steps using the actual facility records.
  if (process.env.GEMINI_API_KEY) {
    try {
      safety = parseJson(
        await callGemini(`
You are a cautious urban-safety education assistant.

Scenario: ${input.scenario}
Selected building: ${input.buildingName}
Building type: ${input.buildingType}
Floors: ${input.levels ?? "Unknown"}
Illustrative radius: ${input.radius} metres
Other mapped building footprints: ${input.affectedCount}

Gemma's facility analysis:
${gemmaExplanation}

Actual facilities supplied by the application's map API:
${JSON.stringify(rankedFacilities)}

Write practical safety precautions and next steps in simple English.

Rules:
- Never invent a facility, ID, distance, opening hour, phone number, road condition, or travel time.
- Facility distances are straight-line distances, not driving distances.
- Use facility names and distances only from the supplied data.
- Do not claim that any facility is open or accepting patients.
- For real emergencies in India, advise calling 112.
- Never tell people to enter a burning, unstable, or damaged building.
- Do not assume travelling to a facility is safe during an active hazard.
- Clearly state that this is a simulation, not a verified emergency assessment.
- If no facilities were supplied, say no verified nearby facilities were returned; do not invent alternatives.
- Return JSON only:
{
  "summary": "Brief scenario summary and relevant facility information",
  "precautions": [{"title": "Short title", "description": "Practical advice"}],
  "nextSteps": ["Actionable step"]
}
Provide 3–5 precautions and 2–4 next steps.
`),
        SafetySchema,
      );

      safetyProvider = "gemini";
    } catch (error) {
      console.warn(
        "[recommendations] Gemini safety guidance failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      ...safety,
      nearbyFacilities: rankedFacilities,
      facilityAnalysis: gemmaExplanation,
    },
    provider: safetyProvider,
    facilityProvider:
      process.env.OLLAMA_API_KEY && gemmaExplanation !==
      "Facilities are ordered by supplied straight-line distance. AI ranking was unavailable."
        ? "gemma"
        : "distance-sort",
    fallback: safetyProvider === "built-in",
  });
}
