import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const RequestSchema = z.object({
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
): RecommendationData {
  return {
    summary:
      `This is an educational building-collapse simulation for ${buildingName}. ` +
      "Mapped proximity identifies nearby building footprints but does not prove structural damage or predict a collapse.",
    precautions: [
      {
        title: "Stay away from immediate danger",
        description:
          "If a real collapse or visible structural failure occurs, move away from the affected area without approaching the structure.",
      },
      {
        title: "Follow emergency instructions",
        description:
          "Follow directions from emergency responders and local authorities. Do not enter a damaged or unstable building.",
      },
      {
        title: "Keep routes clear",
        description:
          "Avoid blocking access routes needed by emergency services. Do not assume the simulated radius is a safe evacuation boundary.",
      },
      {
        title: "Do not treat the simulation as a prediction",
        description:
          "Mapped building proximity alone cannot establish structural integrity, collapse probability, or actual damage.",
      },
    ],
    nextSteps: [
      "For a real emergency in India, call 112 and provide the location and known hazards.",
      "Move away from immediate danger and follow instructions from emergency responders.",
      "Have any suspected structural damage assessed by qualified professionals and the relevant authorities.",
    ],
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return null;
  }

  const status = Number(error.status);
  return Number.isFinite(status) ? status : null;
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
      const retryable =
        status === 429 ||
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
      { error: "Invalid JSON request." },
      { status: 400 },
    );
  }

  const parsed = RequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid building or simulation details." },
      { status: 400 },
    );
  }

  const {
    buildingName,
    buildingType,
    levels,
    radius,
    affectedCount,
  } = parsed.data;

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    // Return general safety guidance even without AI access.
    return NextResponse.json({
      success: true,
      data: getFallbackRecommendations(buildingName),
      fallback: true,
    });
  }

  const prompt = `
You are a safety education assistant for a college urban-safety prototype.

Provide general, cautious safety education for a hypothetical building-collapse scenario.

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
    {"title": "Short title", "description": "Practical general precaution"}
  ],
  "nextSteps": ["Practical general action"]
}

Requirements:
- Include 3 to 5 precautions and 2 to 4 next steps.
- Explain that mapped proximity does not prove structural damage.
- Do not estimate collapse probability, casualties, structural integrity, or a safe evacuation radius.
- Never claim the simulation is a verified prediction.
- For a real emergency, advise moving away from immediate danger, following emergency responders, and contacting emergency services. In India, the emergency number is 112.
- Use simple English.
- Do not provide instructions to enter, inspect, or rescue people from an unstable structure.
- Return only valid JSON, without Markdown fences.
`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const text = await generateWithRetry(ai, prompt);
    const recommendations: unknown = JSON.parse(text);
    const validated = OutputSchema.safeParse(recommendations);

    if (!validated.success) {
      console.error(
        "Gemini returned invalid recommendation data:",
        validated.error.flatten(),
      );

      return NextResponse.json({
        success: true,
        data: getFallbackRecommendations(buildingName),
        fallback: true,
      });
    }

    return NextResponse.json({
      success: true,
      data: validated.data,
    });
  } catch (error) {
    console.error("Safety recommendations error:", error);

    // Gemini is unavailable, but the safety feature remains usable.
    return NextResponse.json({
      success: true,
      data: getFallbackRecommendations(buildingName),
      fallback: true,
    });
  }
}