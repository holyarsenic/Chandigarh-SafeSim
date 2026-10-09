import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const RequestSchema = z.object({
  scenario: z
    .enum(["building-collapse", "major-fire"])
    .default("building-collapse"),
  buildingName: z.string().min(1).max(200),
  buildingType: z.string().max(100).default("Unknown"),
  levels: z.union([z.string(), z.number(), z.null()]).optional(),
  radius: z.union([
    z.literal(75),
    z.literal(150),
    z.literal(250),
  ]),
  affectedCount: z.number().int().min(0).max(100000),
});

const OutputSchema = z.object({
  summary: z.string(),
  precautions: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
    }),
  ).min(1).max(8),
  nextSteps: z.array(z.string()).min(1).max(6),
});

type RecommendationData = z.infer<typeof OutputSchema>;

function getFallbackRecommendations(
  buildingName: string,
  scenario: "building-collapse" | "major-fire",
  radius: number,
  affectedCount: number,
): RecommendationData {
  if (scenario === "major-fire") {
    return {
      summary:
        `The Major Fire simulation selected ${buildingName} and identified ` +
        `${affectedCount} other mapped building footprints within the illustrative ` +
        `${radius} m zone. This does not predict fire spread or confirm damage.`,

      precautions: [
        {
          title: "Move away from fire and smoke",
          description:
            "If a real fire occurs, leave the immediate danger area and avoid breathing smoke. Do not enter a burning building.",
        },
        {
          title: "Raise the alarm",
          description:
            "Alert people nearby if you can do so safely. Contact emergency services and provide the exact location.",
        },
        {
          title: "Use a safe exit",
          description:
            "Follow marked exits and emergency instructions. Do not use lifts during a fire, and do not re-enter the building.",
        },
        {
          title: "Keep access routes clear",
          description:
            "Stay clear of fire engines and emergency responders. Do not treat the simulated radius as a safe evacuation boundary.",
        },
      ],

      nextSteps: [
        "For a real emergency in India, call 112.",
        "Move to a safe location and follow instructions from emergency responders.",
        "Do not return until authorities confirm the area is safe.",
      ],
    };
  }

  return {
    summary:
      `The Building Collapse simulation selected ${buildingName} and identified ` +
      `${affectedCount} other mapped building footprints within the illustrative ` +
      `${radius} m zone. Nearby footprints do not prove structural damage or predict collapse.`,

    precautions: [
      {
        title: "Stay away from immediate danger",
        description:
          "If a real collapse or visible structural failure occurs, move away from the affected area. Do not enter damaged structures.",
      },
      {
        title: "Follow emergency instructions",
        description:
          "Follow directions from emergency responders and local authorities. Do not attempt an untrained rescue in an unstable building.",
      },
      {
        title: "Keep routes clear",
        description:
          "Avoid blocking access routes needed by emergency services. Do not assume the simulated radius is a safe evacuation boundary.",
      },
      {
        title: "Do not treat this as a prediction",
        description:
          "Mapped building proximity alone cannot establish structural integrity, collapse probability, or actual damage.",
      },
    ],

    nextSteps: [
      "For a real emergency in India, call 112 and provide the location and known hazards.",
      "Move away from immediate danger and follow emergency responders.",
      "Have suspected structural damage assessed by qualified professionals and relevant authorities.",
    ],
  };
}

function getErrorStatus(error: unknown): number | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("status" in error)
  ) {
    return null;
  }

  const status = Number(error.status);
  return Number.isFinite(status) ? status : null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithRetry(
  ai: GoogleGenAI,
  prompt: string,
): Promise<string> {
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0.3,
        },
      });

      if (!response.text) {
        throw new Error("Gemini returned an empty response.");
      }

      return response.text;
    } catch (error) {
      const status = getErrorStatus(error);

      // Quota/rate-limit errors should not be retried immediately.
      if (status === 429) {
        throw error;
      }

      const retryable =
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504;

      if (!retryable || attempt === maxAttempts - 1) {
        throw error;
      }

      console.warn(
        `Gemini request failed with status ${status}. ` +
          `Retrying (${attempt + 1}/${maxAttempts - 1})...`,
      );

      await wait(1000 * 2 ** attempt);
    }
  }

  throw new Error("Gemini generation failed.");
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
      { success: false, error: "Invalid simulation details." },
      { status: 400 },
    );
  }

  const {
    scenario,
    buildingName,
    buildingType,
    levels,
    radius,
    affectedCount,
  } = parsed.data;

  const fallback = getFallbackRecommendations(
    buildingName,
    scenario,
    radius,
    affectedCount,
  );

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json({
      success: true,
      data: fallback,
      fallback: true,
    });
  }

  const scenarioName =
    scenario === "major-fire" ? "Major Fire" : "Building Collapse";

  const scenarioInstructions =
    scenario === "major-fire"
      ? `
- Give general fire and smoke safety guidance.
- Advise leaving the danger area, raising the alarm, and contacting emergency services.
- Do not predict fire spread or claim nearby buildings will catch fire.
`
      : `
- Give general building-collapse safety guidance.
- Advise moving away from unstable structures and following emergency responders.
- Do not estimate collapse probability, casualties, or structural integrity.
`;

  const prompt = `
You are a safety education assistant for a college urban-safety prototype.

Scenario: ${scenarioName}

Simulation information:
- Building: ${buildingName}
- Building type: ${buildingType}
- Floors: ${levels ?? "Unknown"}
- Illustrative radius: ${radius} metres
- Other mapped building footprints within the zone: ${affectedCount}

Return a JSON object with exactly these fields:
{
  "summary": "A short explanation of what this simulation shows",
  "precautions": [
    {
      "title": "Short title",
      "description": "Practical general precaution"
    }
  ],
  "nextSteps": ["Practical general action"]
}

Requirements:
- Include 3 to 5 precautions and 2 to 4 next steps.
- Use simple English.
- Explain that the map is an illustrative simulation, not a verified prediction.
- Do not invent real-time emergency information or claim the mapped radius is a safe boundary.
- For a real emergency in India, advise contacting emergency services at 112.
- Do not provide dangerous rescue or entry instructions.
${scenarioInstructions}
Return only valid JSON without Markdown fences.
`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const responseText = await generateWithRetry(ai, prompt);

    let recommendations: unknown;

    try {
      recommendations = JSON.parse(responseText);
    } catch {
      return NextResponse.json({
        success: true,
        data: fallback,
        fallback: true,
      });
    }

    const validated = OutputSchema.safeParse(recommendations);

    if (!validated.success) {
      return NextResponse.json({
        success: true,
        data: fallback,
        fallback: true,
      });
    }

    return NextResponse.json({
      success: true,
      data: validated.data,
      fallback: false,
    });
  } catch (error) {
    const status = getErrorStatus(error);

    if (status === 429) {
      console.warn(
        "Gemini quota/rate limit reached. Using fallback recommendations.",
      );
    } else {
      console.error("Safety recommendations error:", error);
    }

    return NextResponse.json({
      success: true,
      data: fallback,
      fallback: true,
    });
  }
}