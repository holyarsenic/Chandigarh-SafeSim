
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
});

type Guidance = z.infer<typeof GuidanceSchema>;

type Facility = z.infer<typeof FacilitySchema>;

function getNearestFacility(facilities: Facility[]) {
  if (facilities.length === 0) return null;

  return [...facilities].sort(
    (a, b) => a.straightLineMeters - b.straightLineMeters,
  )[0];
}

function distanceLabel(meters: number) {
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(2)} km`;
}

function getFallbackGuidance(
  scenario: "building-collapse" | "major-fire",
): Guidance {
  if (scenario === "major-fire") {
    return {
      immediateActions: [
        "If this is a real emergency in India, call 112. Give the building name, location, and known hazards.",
        "Leave the fire area using a safe, accessible exit if one is available. Stay low if you must move through smoke.",
        "Do not use lifts during a fire. Do not enter smoke-filled rooms or return for belongings.",
      ],
      evacuationInstructions: [
        "Move away from the building and visible smoke when it is safe to do so.",
        "Follow marked emergency exits, evacuation signs, and instructions from firefighters.",
        "Move to an assembly point only if it is designated and safe. Do not assume a nearby building is a safe shelter.",
        "Do not approach a mapped emergency facility through fire, smoke, blocked roads, or other hazards.",
      ],
      ifTrapped: [
        "Call 112 and tell responders your exact location, floor, and whether anyone is injured.",
        "If an exit is blocked by fire or smoke, do not force your way through it. Move to a safer room away from smoke if possible.",
        "Close doors between you and the smoke if possible, signal your location, and follow emergency operator instructions.",
      ],
      precautions: [
        "Avoid smoke, flames, electrical hazards, and falling debris.",
        "Do not re-enter the building until authorities confirm it is safe.",
      ],
      nextSteps: [
        "Tell emergency responders if anyone is missing, injured, or trapped.",
        "Use the mapped facility list only as location information; opening status and emergency capacity are not verified.",
      ],
    };
  }

  return {
    immediateActions: [
      "If people are injured, trapped, or in immediate danger in India, call 112.",
      "Move away from visibly damaged structures, leaning walls, hanging debris, and areas where material is falling, if you can do so without crossing another hazard.",
      "Do not enter or re-enter a damaged building. Watch for dust, falling objects, fire, and damaged electrical wires.",
    ],
    evacuationInstructions: [
      "If your current structure appears unstable and an exit is accessible without passing through falling debris, leave carefully and move into an open area away from buildings, walls, poles, and overhead hazards.",
      "Do not run toward another building simply because it is nearby. A mapped building has not been verified as structurally safe.",
      "Follow police, fire services, and disaster-response personnel instructions. Do not cross debris or blocked roads to reach a facility.",
      "Use the nearest-facility information as a starting point for contacting responders, not as proof that the facility is safe to enter.",
    ],
    ifTrapped: [
      "Call 112 if possible and share your exact location, floor, visible injuries, and nearby hazards.",
      "Avoid unnecessary movement if debris may shift. Protect your head and neck from falling material.",
      "If you are trapped, make noise or use your phone to signal rescuers when safe. Conserve your phone battery.",
      "Do not light matches or use a flame where gas leakage may be present.",
    ],
    precautions: [
      "Stay away from visibly cracked, leaning, or partially collapsed structures.",
      "Do not attempt to lift heavy debris or conduct an untrained rescue.",
      "Be alert for aftershocks or secondary collapse if an earthquake has occurred.",
    ],
    nextSteps: [
      "Give responders the exact location and the number of people who may be injured or trapped.",
      "Wait for qualified responders to assess damaged structures before returning.",
      "Seek medical assistance for injuries and follow official evacuation instructions.",
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
          content: [
            "You provide cautious emergency information, professional rescue instructions.",
            "Use only supplied facts and make users to tell how escape using nearest safest location out of harmed placed. Never invent safe buildings, shelters, exits, roads, routes, distances, travel times, or facility availability.",
            "Do not claim that a facility is safe merely because it is nearby.",
            "Do not instruct people to travel through smoke, fire, debris, unstable structures, or blocked routes.",
            "For fire, prioritize leaving the fire area through a safe accessible exit, avoiding smoke, and following firefighters.",
            "For structural collapse, prioritize avoiding unstable structures and falling debris when a safe exit is available.",
            "For trapped people, advise calling emergency services and following dispatcher instructions. Never advise moving heavy debris.",
            "For emergencies in India, say to call 112.",
            "Return only JSON with these fields: immediateActions, evacuationInstructions, ifTrapped, precautions, nextSteps.",
            "Each field must be an array of concise strings.",
          ].join(" "),
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
Create concise emergency guidance for a Chandigarh urban-safety prototype.

Scenario: ${scenario}
Selected location: ${buildingName}
Coordinates: ${location.latitude}, ${location.longitude}

Mapped emergency facilities:
${JSON.stringify(
  facilities.map((facility) => ({
    name: facility.name,
    type: facility.type,
    straightLineMeters: facility.straightLineMeters,
  })),
  null,
  2,
)}

Return JSON containing:
- immediateActions: actions to take now
- evacuationInstructions: how to move away from danger
- ifTrapped: what to do if an exit is blocked or a person is trapped
- precautions: hazards to avoid
- nextSteps: practical follow-up actions

Do not invent a destination, safe building, exit, route, facility capability, or opening status.
Do not treat the nearest facility as a safe evacuation destination.
Use simple English. Prioritize calling 112 in an actual emergency.
Return only valid JSON.
`;

  let guidance: Guidance;
  let provider: "gemma" | "built-in" = "built-in";

  try {
    const raw = await generateWithGemma(prompt);
    const output = GuidanceSchema.safeParse(JSON.parse(raw));

    if (!output.success) {
      throw new Error("Gemma returned guidance in an invalid format.");
    }

    guidance = output.data;
    provider = "gemma";
  } catch (error) {
    console.warn(
      "Emergency guidance fallback:",
      error instanceof Error ? error.message : error,
    );

    guidance = getFallbackGuidance(scenario);
  }

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
            "Nearest by straight-line distance only. Route safety, opening status, and service availability have not been verified.",
        }
      : null,
    facilityNotice: nearest
      ? null
      : "No mapped emergency facilities were supplied. Call 112 for immediate danger and follow official responder instructions.",
    disclaimer:
      "This is planning support, not a live hazard assessment. Follow emergency services and local authorities.",
  });
}
