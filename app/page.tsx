
"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Waves,
  Flame,
  Activity,
  MapPin,
  ShieldCheck,
  Clock,
  ChevronRight,
  Target,
  RotateCcw,
  ClipboardCheck,
  Users,
  HardHat,
  Info,
  Sparkles,
  RefreshCw,
} from "lucide-react";

import BuildingCollapseMap, {
  type SelectedBuilding,
} from "@/components/BuildingCollapseMap";

const SCENARIOS = [
  {
    id: "building-collapse",
    name: "Building Collapse",
    description: "Simulate the impact of a building collapse",
    icon: Building2,
    status: "Available",
  },
  {
    id: "urban-flooding",
    name: "Urban Flooding",
    description: "Explore potential flood-affected areas",
    icon: Waves,
    status: "Coming soon",
  },
  {
    id: "major-fire",
    name: "Major Fire",
    description: "Explore a fire-related safety scenario",
    icon: Flame,
    status: "Available",
  },
  {
    id: "earthquake",
    name: "Earthquake",
    description: "Explore earthquake-related scenarios",
    icon: Activity,
    status: "Coming soon",
  },
];

const RADII = {
  Low: 75,
  Medium: 150,
  High: 250,
};

type Severity = keyof typeof RADII;

type GeminiRecommendations = {
  summary: string;
  precautions: {
    title: string;
    description: string;
  }[];
  nextSteps: string[];
};

type ApiResponse = {
  success?: boolean;
  data?: GeminiRecommendations;
  error?: string;
};

function getFallbackRecommendations(
  building: SelectedBuilding | null,
  radius: number,
  affectedCount: number,
  scenario: string = "building-collapse"
): GeminiRecommendations {
  const buildingName = building?.name || "the selected building";

  if (scenario === "major-fire") {
    return {
      summary:
        `The Major Fire simulation selected ${buildingName} and identified ${affectedCount} nearby building footprints within the illustrative ${radius} m zone. This does not predict fire spread or confirm damage.`,
      precautions: [
        {
          title: "Avoid fire and smoke",
          description:
            "Move away from danger and avoid breathing smoke. Never enter a burning building.",
        },
        {
          title: "Raise the alarm",
          description:
            "Contact emergency services and share the location if a real fire occurs.",
        },
        {
          title: "Use a safe exit",
          description:
            "Follow marked exits, avoid lifts during a fire, and do not re-enter the building.",
        },
      ],
      nextSteps: [
        "For a real emergency in India, call 112.",
        "Move to a safe location and follow emergency responders.",
        "Do not return until authorities confirm the area is safe.",
      ],
    };
  }

  return {
    summary: building
      ? `The simulation has selected ${buildingName} and identified ${affectedCount} other building${affectedCount === 1 ? "" : "s"} within the illustrative ${radius} m impact zone. This is a geographic scenario, not a structural damage prediction.`
      : "Select a building on the map to see scenario-specific safety guidance.",

    precautions: [
      {
        title: "Keep people away from the area",
        description:
          "For a real collapse or signs of structural instability, keep people away from the building and potentially hazardous surroundings. Do not enter damaged structures.",
      },
      {
        title: "Contact emergency services",
        description:
          "If there is an actual emergency in India, call 112. Share the location and any visible hazards with responders.",
      },
      {
        title: "Avoid obstructing responders",
        description:
          "Keep access routes clear and follow instructions from emergency personnel. Do not attempt an untrained rescue in an unstable structure.",
      },
    ],

    nextSteps: [
      "Verify the location and circumstances with local authorities.",
      "Ask qualified emergency personnel to assess the actual hazard.",
      "Use this map only as a preliminary visualization, not as an evacuation boundary.",
    ],
  };
}

export default function Home() {
  const [scenario, setScenario] = useState("building-collapse");
  const [severity, setSeverity] = useState<Severity>("Medium");
  const [selectedBuilding, setSelectedBuilding] =
    useState<SelectedBuilding | null>(null);

  const [aiRecommendations, setAiRecommendations] =
    useState<GeminiRecommendations | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const activeScenario =
    SCENARIOS.find((item) => item.id === scenario) ?? SCENARIOS[0];

  const affectedBuildings =
    selectedBuilding?.affectedBuildings ?? [];

  const affectedCount =
    selectedBuilding?.affectedCount ?? affectedBuildings.length;

  const radius = RADII[severity];

  function changeScenario(nextScenario: string) { 
    setScenario(nextScenario); 
    setSelectedBuilding(null); 
    setAiRecommendations(null); 
    setAiError(null); 
    setAiLoading(false); 
    setRetryCount(0); 
  }

  function clearSimulation() {
    setSelectedBuilding(null);
    setAiRecommendations(null);
    setAiError(null);
    setAiLoading(false);
    setRetryCount(0);
  }

  useEffect(() => {
    if (
      !["building-collapse", "major-fire"].includes(scenario) ||
      !selectedBuilding
    ) {
      return;
    }

    const controller = new AbortController();

    async function fetchRecommendations() {
      setAiLoading(true);
      setAiError(null);
      setAiRecommendations(null);

      try {
        const response = await fetch("/api/recommendations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            scenario,
            buildingName:
              selectedBuilding?.name || "Unnamed building",
            buildingType:
              selectedBuilding?.type || "Unknown",
            levels: selectedBuilding?.levels ?? null,
            radius,
            affectedCount,
          }),
        });

        const contentType =
          response.headers.get("content-type") ?? "";

        if (!contentType.includes("application/json")) {
          throw new Error(
            "The server returned an unexpected response. Check your terminal for API errors."
          );
        }

        const result = (await response.json()) as ApiResponse;

        if (!response.ok || !result.success || !result.data) {
          throw new Error(
            result.error ||
              "Could not generate Gemini recommendations."
          );
        }

        if (
          !result.data.summary ||
          !Array.isArray(result.data.precautions) ||
          !Array.isArray(result.data.nextSteps)
        ) {
          throw new Error(
            "The API returned an unexpected recommendation format."
          );
        }

        setAiRecommendations(result.data);
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          return;
        }

        if (error instanceof Error) {
          setAiError(error.message);
        } else {
          setAiError(
            "Something went wrong while generating recommendations."
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setAiLoading(false);
        }
      }
    }

    void fetchRecommendations();

    return () => {
      controller.abort();
    };
  }, [
    scenario,
    selectedBuilding,
    selectedBuilding?.id,
    selectedBuilding?.name,
    selectedBuilding?.type,
    selectedBuilding?.levels,
    selectedBuilding?.affectedCount,
    radius,
    affectedCount,
    retryCount,
  ]);

  const displayedRecommendations =
    aiRecommendations ??
    (!aiLoading && aiError
      ? getFallbackRecommendations(
          selectedBuilding,
          radius,
          affectedCount
        )
      : null);

  return (
    <main className="flex min-h-screen flex-col text-slate-900 lg:h-screen lg:overflow-hidden">
      {/* Header */}
      <header className="z-10 flex h-16 shrink-0 items-center justify-between border-b border-background bg-foreground px-4 md:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-background text-white">
            <ShieldCheck size={23} />
          </div>

          <div>
            <h1 className="text-lg font-bold tracking-tight">
              Chandigarh SafeSim
            </h1>
            <p className="text-xs text-slate-500">
              AI-powered urban safety simulation
            </p>
          </div>
        </div>

        <div className="hidden items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 sm:flex">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Prototype environment
        </div>
      </header>

      {/* Main workspace */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Sidebar */}
        <aside className="w-full shrink-0 overflow-y-auto border-b border-slate-200 bg-foreground p-4 sm:p-5 lg:w-95 lg:border-b-0 lg:border-r">
          <div className="mb-5">
            <div className="mb-1 flex items-center gap-2">
              <Target size={17} className="text-background" />
              <h2 className="text-sm font-bold">
                Simulation scenarios
              </h2>
            </div>
            <p className="text-xs leading-5 text-slate-500">
              Choose an urban safety scenario to explore.
            </p>
          </div>

          <div className="space-y-2">
            {SCENARIOS.map((item) => {
              const Icon = item.icon;
              const isActive = scenario === item.id;
              const isAvailable = item.status === "Available";

              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!isAvailable}
                  onClick={() => changeScenario(item.id)}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    isActive
                      ? "border-blue-300 bg-blue-50 ring-1 ring-blue-100"
                      : isAvailable
                        ? "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                        : "cursor-not-allowed border-slate-100 bg-slate-50 opacity-70"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                        isActive
                          ? "bg-background text-white"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      <Icon size={20} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">
                          {item.name}
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            isAvailable
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {item.status}
                        </span>
                      </div>

                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        {item.description}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Location */}
          <div className="mt-6 rounded-xl border border-slate-200 p-4">
            <div className="mb-3 flex items-center gap-2">
              <MapPin size={17} className="text-background" />
              <h3 className="text-sm font-bold">
                Simulation location
              </h3>
            </div>

            <p className="text-sm font-medium">Chandigarh, India</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Map centered on Chandigarh. Select a building footprint
              to explore an illustrative impact area.
            </p>
          </div>

          {/* Current scenario */}
          <div className="mt-4 rounded-xl border border-slate-200 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold">Current scenario</h3>
              <span className="rounded-full bg-blue-100 px-2 py-1 text-[10px] font-semibold text-background">
                Active
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-600">
                <Building2 size={20} />
              </div>

              <div>
                <p className="text-sm font-semibold">
                  {activeScenario.name}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {selectedBuilding
                    ? "Building selected"
                    : "Waiting for selection"}
                </p>
              </div>
            </div>

            <div className="mt-4 border-t border-slate-100 pt-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600">
                  Impact radius
                </span>
                <span className="text-xs font-bold text-slate-900">
                  {radius} m
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(
                  ["Low", "Medium", "High"] as Severity[]
                ).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setSeverity(level)}
                    className={`rounded-lg border px-2 py-2 text-xs font-semibold transition ${
                      severity === level
                        ? "border-blue-300 bg-background text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {level}
                    <span className="mt-1 block text-[10px] font-normal opacity-80">
                      {RADII[level]} m
                    </span>
                  </button>
                ))}
              </div>

              <p className="mt-2 text-[11px] leading-4 text-slate-500">
                Radius is a configurable visualization distance, not
                an official evacuation or danger boundary.
              </p>
            </div>
          </div>

          {/* Simulation results */}
          <div className="mt-4 rounded-xl border border-slate-200 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold">
                Simulation results
              </h3>

              {selectedBuilding && (
                <button
                  type="button"
                  onClick={clearSimulation}
                  className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900"
                >
                  <RotateCcw size={13} />
                  Reset
                </button>
              )}
            </div>

            {!selectedBuilding ? (
              <div className="rounded-lg bg-slate-50 px-3 py-4 text-center">
                <Target
                  size={22}
                  className="mx-auto mb-2 text-slate-400"
                />
                <p className="text-xs font-medium text-slate-700">
                  No building selected
                </p>
                <p className="mt-1 text-[11px] leading-4 text-slate-500">
                  Click a building footprint on the map to run a
                  simulation.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">
                    Selected building
                  </p>
                  <p className="mt-1 wrap-break-word text-sm font-semibold">
                    {selectedBuilding.name || "Unnamed building"}
                  </p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-md bg-white px-2 py-1 text-[10px] text-slate-600 ring-1 ring-slate-200">
                      Type: {selectedBuilding.type || "Unknown"}
                    </span>
                    <span className="rounded-md bg-white px-2 py-1 text-[10px] text-slate-600 ring-1 ring-slate-200">
                      Levels: {selectedBuilding.levels ?? "Unknown"}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                    <p className="text-[11px] text-orange-700">
                      Nearby footprints
                    </p>
                    <p className="mt-1 text-2xl font-bold text-orange-800">
                      {affectedCount}
                    </p>
                  </div>

                  <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                    <p className="text-[11px] text-red-700">
                      Radius
                    </p>
                    <p className="mt-1 text-2xl font-bold text-red-800">
                      {radius}
                      <span className="ml-1 text-xs font-medium">m</span>
                    </p>
                  </div>
                </div>

                {affectedBuildings.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold text-slate-700">
                      Nearby building footprints
                    </p>
                    <div className="max-h-40 space-y-2 overflow-y-auto">
                      {affectedBuildings.slice(0, 12).map((building) => (
                        <div
                          key={building.id}
                          className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 p-2"
                        >
                          <div className="min-w-0">
                            <p className="wrap-break-word text-xs font-medium text-slate-700">
                              {building.name || "Unnamed building"}
                            </p>
                            <p className="mt-1 text-[10px] text-slate-500">
                              {building.type || "Unknown type"}
                            </p>
                          </div>
                          <span className="shrink-0 text-[10px] text-slate-500">
                            {Math.round(building.distanceMeters)} m
                          </span>
                        </div>
                      ))}
                    </div>

                    {affectedBuildings.length > 12 && (
                      <p className="mt-2 text-[10px] text-slate-500">
                        Showing 12 of {affectedBuildings.length} footprints.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Gemini safety recommendations */}
          <div className="mt-4 rounded-xl border border-violet-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                <Sparkles size={18} />
              </div>

              <div>
                <h3 className="text-sm font-bold">
                  Safety Recommendations
                </h3>
                <p className="text-[10px] text-violet-700">
                  Gemini AI · Illustrative guidance
                </p>
              </div>
            </div>

            {!selectedBuilding ? (
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs leading-5 text-slate-600">
                  Select a building on the map to generate
                  recommendations for your scenario.
                </p>
              </div>
            ) : aiLoading ? (
              <div className="rounded-lg bg-violet-50 p-4 text-center">
                <RefreshCw
                  size={22}
                  className="mx-auto mb-2 animate-spin text-violet-600"
                />
                <p className="text-xs font-semibold text-violet-900">
                  Generating Gemini recommendations...
                </p>
                <p className="mt-1 text-[11px] text-violet-700">
                  Analyzing the selected scenario.
                </p>
              </div>
            ) : aiError && !aiRecommendations ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle
                      size={16}
                      className="mt-0.5 shrink-0 text-red-600"
                    />
                    <div>
                      <p className="text-xs font-semibold text-red-800">
                        Gemini recommendations unavailable
                      </p>
                      <p className="mt-1 wrap-break-word text-[11px] leading-5 text-red-700">
                        {aiError}
                      </p>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setRetryCount((count) => count + 1)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-violet-700"
                >
                  <RefreshCw size={14} />
                  Retry Gemini
                </button>

                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    General fallback guidance
                  </p>
                  <p className="text-xs leading-5 text-slate-600">
                    {getFallbackRecommendations(
                      selectedBuilding,
                      radius,
                      affectedCount
                    ).summary}
                  </p>
                </div>
              </div>
            ) : displayedRecommendations ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-violet-50 p-3">
                  <p className="text-xs leading-5 text-violet-950">
                    {displayedRecommendations.summary}
                  </p>
                </div>

                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <ClipboardCheck
                      size={15}
                      className="text-violet-700"
                    />
                    <h4 className="text-xs font-bold">
                      Recommended precautions
                    </h4>
                  </div>

                  <div className="space-y-2">
                    {displayedRecommendations.precautions.map(
                      (item, index) => (
                        <div
                          key={`${item.title}-${index}`}
                          className="rounded-lg border border-slate-100 p-3"
                        >
                          <p className="text-xs font-semibold text-slate-800">
                            {item.title}
                          </p>
                          <p className="mt-1 text-[11px] leading-5 text-slate-600">
                            {item.description}
                          </p>
                        </div>
                      )
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <ChevronRight
                      size={15}
                      className="text-violet-700"
                    />
                    <h4 className="text-xs font-bold">Suggested next steps</h4>
                  </div>

                  <ul className="space-y-2">
                    {displayedRecommendations.nextSteps.map(
                      (step, index) => (
                        <li
                          key={`${step}-${index}`}
                          className="flex items-start gap-2 text-xs leading-5 text-slate-600"
                        >
                          <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-800">
                            {index + 1}
                          </span>
                          <span>{step}</span>
                        </li>
                      )
                    )}
                  </ul>
                </div>

                <button
                  type="button"
                  onClick={() => setRetryCount((count) => count + 1)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-700 transition hover:bg-violet-50"
                >
                  <RefreshCw size={13} />
                  Regenerate recommendations
                </button>
              </div>
            ) : null}

            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <Info
                size={15}
                className="mt-0.5 shrink-0 text-amber-700"
              />
              <p className="text-[10px] leading-4 text-amber-900">
                AI guidance may be inaccurate. This simulation does
                not predict structural failure or establish safe
                evacuation boundaries. In an actual emergency in
                India, call 112 and follow official instructions.
              </p>
            </div>
          </div>

          {/* Planned capabilities */}
          <div className="mt-5">
            <h3 className="mb-3 text-sm font-bold">
              Planned capabilities
            </h3>

            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                  <Users size={16} />
                </div>
                <div>
                  <p className="text-xs font-semibold">
                    Community safety awareness
                  </p>
                  <p className="mt-1 text-[11px] leading-4 text-slate-500">
                    Clear, practical information for safer decision-making.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-700">
                  <HardHat size={16} />
                </div>
                <div>
                  <p className="text-xs font-semibold">
                    Emergency response support
                  </p>
                  <p className="mt-1 text-[11px] leading-4 text-slate-500">
                    Future integrations for verified local response resources.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Disclaimer */}
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle
                size={16}
                className="mt-0.5 shrink-0 text-amber-700"
              />
              <div>
                <p className="text-xs font-bold text-amber-900">
                  Prototype disclaimer
                </p>
                <p className="mt-1 text-[11px] leading-5 text-amber-800">
                  This is an experimental visualization. Nearby
                  footprints and impact radii are not verified
                  damage predictions or official emergency advice.
                </p>
              </div>
            </div>
          </div>
        </aside>

        {/* Map panel */}
        <section className="flex h-[65vh] min-h-112 min-w-0 shrink-0 flex-col bg-foreground lg:h-auto lg:min-h-0 lg:flex-1">
          <div className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-foreground px-4 py-3 sm:px-5">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold">Simulation map</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                  OpenStreetMap footprints
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Select a building to view the illustrative impact area.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="hidden items-center gap-1.5 text-xs text-slate-500 sm:flex">
                <Clock size={13} />
                Interactive simulation
              </span>

              <button
                type="button"
                onClick={clearSimulation}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <RotateCcw size={13} />
                Reset
              </button>
            </div>
          </div>

          <div className="relative min-h-0 flex-1">
            <BuildingCollapseMap
              radius={radius}
              selectedLocation={selectedBuilding?.location ?? null}
              onBuildingSelect={setSelectedBuilding}
            />
          </div>

          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-foreground px-4 py-2.5 text-[10px] text-slate-500 sm:px-5">
            <span className="flex items-center gap-1.5">
              <ShieldCheck size={13} className="text-emerald-600" />
              Chandigarh SafeSim · Experimental prototype
            </span>
            <span>
              Mapping data may be incomplete or outdated.
            </span>
          </footer>
        </section>
      </div>
    </main>
  );
}