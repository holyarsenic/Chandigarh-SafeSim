
import { NextResponse } from "next/server";
import { z } from "zod";

export const maxDuration = 25;

const FacilitySchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(100),
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  straightLineMeters: z.number().min(0).max(1_000_000),
  directionsUrl: z.string().url().max(2000),
});

const RequestSchema = z.object({
  buildingName: z.string().min(1).max(200).default("Selected building"),
  scenario: z
    .enum(["building-collapse", "major-fire"])
    .default("building-collapse"),
  location: z.object({
    longitude: z.number().min(-180).max(180),
    latitude: z.number().min(-90).max(90),
  }),
  facilities: z.array(FacilitySchema).max(10).default([]),
});

const GuidanceSchema = z.object({
  immediateActions: z.array(z.string().min(1).max(500)).min(1).max(5),
  evacuationInstructions: z.array(z.string().min(1).max(500)).min(1).max(6),
  ifTrapped: z.array(z.string().min(1).max(500)).min(1).max(5),
  precautions: z.array(z.string().min(1).max(500)).min(1).max(5),
  nextSteps: z.array(z.string().min(1).max(500)).min(1).max(5),

  // Must refer to a facility supplied in the request, or null.
  recommendedFacilityId: z.string().max(100).nullable(),
  destinationReason: z.string().min(1).max(500),
});

type Guidance = z.infer<typeof GuidanceSchema>;
type Facility = z.infer<typeof FacilitySchema>;

function getNearestFacility(facilities: Facility[]) {
  return [...facilities].sort(
    (a, b) => a.straightLineMeters - b.straightLineMeters,
  )[0] ?? null;
}

function distanceLabel(meters: number) {
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(2)} km`;
}

// Tolerate accidental Markdown fences while still validating the result  against the complete Zod schema below.
function parseGemmaJson(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  return JSON.parse(cleaned);
}

function getFallbackGuidance(
  scenario: "building-collapse" | "major-fire",
): Guidance {
  const common = {
    recommendedFacilityId: null,
    destinationReason:
      "No facility has been verified as a safe destination. Call 112 and follow emergency responders' directions.",
  };

  if (scenario === "major-fire") {
    return {
      ...common,
      immediateActions: [
        "In India, call 112 for an actual emergency and report the location and known hazards.",
        "Leave by an accessible exit only if you can do so without moving through fire or dangerous smoke.",
        "Stay low if you must pass through smoke. Never use a lift during a fire.",
      ],
      evacuationInstructions: [
        "Move away from the fire and smoke when safe.",
        "Follow marked exits and instructions from firefighters.",
        "Do not enter smoke-filled areas or cross fire to reach a mapped facility.",
        "Use a designated assembly point only when authorities identify it as safe.",
      ],
      ifTrapped: [
        "Call 112 and provide your exact location, floor, and injuries.",
        "Do not force your way through fire or smoke. Move away from smoke if possible.",
        "Close doors between you and smoke if possible, signal your location, and follow dispatcher instructions.",
      ],
      precautions: [
        "Avoid smoke, flames, electrical hazards, and falling debris.",
        "Do not return until authorities confirm the building is safe.",
      ],
      nextSteps: [
        "Tell responders if anyone is missing, injured, or trapped.",
        "Treat mapped facilities as unverified until responders confirm where you should go.",
      ],
    };
  }

  return {
    ...common,
    immediateActions: [
      "Call 112 in India if anyone is injured, trapped, or in immediate danger.",
      "Move away from visibly damaged structures and falling debris if you can do so safely.",
      "Do not enter or re-enter a damaged building. Avoid exposed wires and other hazards.",
    ],
    evacuationInstructions: [
      "If the structure appears unstable, use an accessible exit only if reaching it does not expose you to falling debris or another hazard.",
      "If you can leave safely, move to an open area away from buildings, walls, poles, and overhead hazards.",
      "Do not enter another building just because it is nearby or appears undamaged.",
      "Follow police, fire services, and disaster-response personnel.",
    ],
    ifTrapped: [
      "Call 112 if possible and give your exact location, floor, injuries, and nearby hazards.",
      "Avoid unnecessary movement if debris may shift; protect your head and neck.",
      "Signal rescuers using your phone or by making noise when safe. Conserve battery.",
      "Do not move heavy debris or use flames if a gas leak is possible.",
    ],
    precautions: [
      "Stay away from visibly cracked, leaning, or partially collapsed structures.",
      "Do not attempt an untrained rescue or lift heavy debris.",
      "Be alert for aftershocks and secondary collapse if an earthquake occurred.",
    ],
    nextSteps: [
      "Tell responders the location and number of people who may be injured or trapped.",
      "Wait for qualified responders to assess damaged structures before returning.",
      "Seek medical assistance and follow official evacuation instructions.",
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
          content: `
You are a cautious emergency-information assistant for a Chandigarh
urban-safety prototype. Your response may be used in a stressful situation.

Use only the supplied facts. Never invent exits, routes, shelters, buildings,
facility capabilities, opening status, road conditions, or travel times.

For fire, prioritize leaving the affected area through an accessible exit
only when doing so does not require crossing dangerous fire or smoke.
For structural collapse, avoid unstable structures and falling debris.
For trapped people, advise calling emergency services and following
dispatcher instructions. Never advise moving heavy debris.
For an actual emergency in India, say to call 112.

DESTINATION RULES:
1. You may select recommendedFacilityId ONLY from the exact facility IDs
   supplied in the user prompt.
2. Select a facility only as a possible contact/assistance option when
   relevant to the scenario; proximity alone does not establish suitability.
3. If no facility is appropriate, return null.
4. Never claim that a facility or route is safe, open, available, or capable
   of handling this emergency. These facts have not been verified.
5. destinationReason must clearly explain the limitations. Do not tell a
   person to travel to a facility through hazards.
6. Do not invent a safe destination. Tell users to call 112 and follow
   responders' directions when immediate danger exists.

Return only valid JSON with exactly these fields:
{
  "immediateActions": ["..."],
  "evacuationInstructions": ["..."],
  "ifTrapped": ["..."],
  "precautions": ["..."],
  "nextSteps": ["..."],
  "recommendedFacilityId": "an exact supplied ID or null",
  "destinationReason": "..."
}
Each list must contain concise strings. Use simple English.
          `.trim(),
        },
        { role: "user", content: prompt },
      ],
      format: "json",
      stream: false,
      options: { temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(18000),
  });

  if (!response.ok) {
    throw new Error(`Ollama Cloud returned HTTP ${response.status}`);
  }

  const result: { message?: { content?: string } } =
    await response.json();

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
      { status: 400 },
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
      { status: 400 },
    );
  }

  const { buildingName, scenario, location, facilities } = parsed.data;
  const nearest = getNearestFacility(facilities);

  const prompt = `
Scenario: ${scenario}
Selected building/location: ${buildingName}
Coordinates: ${location.latitude}, ${location.longitude}

Supplied mapped facilities:
${JSON.stringify(
  facilities.map((facility) => ({
    id: facility.id,
    name: facility.name,
    type: facility.type,
    straightLineMeters: facility.straightLineMeters,
  })),
  null,
  2,
)}

Create concise, scenario-specific emergency guidance.
Choose recommendedFacilityId only if a supplied facility is relevant as
a possible assistance/contact option. Otherwise return null.
Do not equate nearest with safest. Explain that straight-line distances
are not route distances and that facility status and route safety are
unverified. Never instruct people to travel through hazards.
In immediate danger, prioritize calling 112 and following responders.
  `.trim();

  let guidance: Guidance;
  let provider: "gemma" | "built-in" = "built-in";

  try {
    const raw = await generateWithGemma(prompt);
    const output = GuidanceSchema.safeParse(parseGemmaJson(raw));

    if (!output.success) {
      console.warn("Invalid Gemma guidance schema:", output.error.flatten());
      throw new Error("Gemma returned guidance in an invalid format.");
    }

    const candidate = output.data;

    // Prevent the model from referencing an ID that was not supplied.
    if (
      candidate.recommendedFacilityId !== null &&
      !facilities.some(
        (facility) => facility.id === candidate.recommendedFacilityId,
      )
    ) {
      throw new Error("Gemma selected an unknown facility ID.");
    }

    guidance = candidate;
    provider = "gemma";
  } catch (error) {
    console.warn(
      "Emergency guidance fallback:",
      error instanceof Error ? error.message : error,
    );

    guidance = getFallbackGuidance(scenario);
  }

  const recommendedFacility = guidance.recommendedFacilityId
    ? facilities.find(
        (facility) => facility.id === guidance.recommendedFacilityId,
      ) ?? null
    : null;

  return NextResponse.json({
    success: true,
    provider,
    scenario,
    selectedLocation: {
      name: buildingName,
      ...location,
    },
    emergencyNumber: "112",
    guidance,

    // This is a possible assistance option, not a verified safe destination.
    recommendedDestination: recommendedFacility
      ? {
          id: recommendedFacility.id,
          name: recommendedFacility.name,
          type: recommendedFacility.type,
          latitude: recommendedFacility.latitude,
          longitude: recommendedFacility.longitude,
          straightLineMeters: recommendedFacility.straightLineMeters,
          distanceLabel: distanceLabel(
            recommendedFacility.straightLineMeters,
          ),
          directionsUrl: recommendedFacility.directionsUrl,
          reason: guidance.destinationReason,
          warning:
            "This facility is not verified as safe, open, or able to help. Route safety is unknown. Call 112 and follow responders' instructions.",
        }
      : null,

    // the AI-recommended destination.
    nearestFacility: nearest
      ? {
          id: nearest.id,
          name: nearest.name,
          type: nearest.type,
          latitude: nearest.latitude,
          longitude: nearest.longitude,
          straightLineMeters: nearest.straightLineMeters,
          distanceLabel: distanceLabel(nearest.straightLineMeters),
          directionsUrl: nearest.directionsUrl,
          warning:
            "Nearest by straight-line distance only. This is not a safety recommendation; route conditions and facility availability are unverified.",
        }
      : null,

    facilityNotice: facilities.length === 0
      ? "No mapped facilities were supplied. Call 112 for immediate danger and follow official responder instructions."
      : null,

    disclaimer:
      "Prototype planning support only, not a live hazard assessment or certified evacuation plan. Follow emergency services and local authorities.",
  });
}
