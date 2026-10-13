
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  Flame,
  Hospital,
  LoaderCircle,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Info,
} from "lucide-react";

type EmergencyFacility = {
  id: string | number;
  name?: string | null;
  type?: string | null;
  location: [number, number]; // [longitude, latitude]
  straightLineMeters: number;
  directionsUrl?: string | null;
};

type FacilitiesResponse = {
  success?: boolean;
  facilities?: EmergencyFacility[];
  data?: EmergencyFacility[];
  error?: string;
};

type EmergencyGuidance = {
  immediateActions: string[];
  evacuationInstructions: string[];
  ifTrapped: string[];
  precautions: string[];
  nextSteps: string[];
};

type NearestFacility = {
  id: string;
  name: string;
  type: string;
  longitude: number;
  latitude: number;
  straightLineMeters: number;
  distanceLabel: string;
  directionsUrl: string | null;
  warning?: string;
};

type GuidanceResponse = {
  success?: boolean;
  provider?: "gemma" | "built-in";
  scenario?: "building-collapse" | "major-fire";
  emergencyNumber?: string;
  guidance?: EmergencyGuidance;
  nearestFacility?: NearestFacility | null;
  facilityNotice?: string | null;
  disclaimer?: string;
  error?: string;
};

type FacilitiesState = {
  key: string;
  data: EmergencyFacility[];
  error: string | null;
};

type GuidanceState = {
  key: string;
  data: EmergencyGuidance | null;
  nearestFacility: NearestFacility | null;
  provider: "gemma" | "built-in" | null;
  error: string | null;
};

type Props = {
  location: [number, number] | null;
  buildingName?: string;
  scenario?: "building-collapse" | "major-fire";
};

function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) {
    return "Distance unavailable";
  }

  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }

  return `${(meters / 1000).toFixed(2)} km`;
}

function getFacilityIcon(type?: string | null) {
  const value = (type ?? "").toLowerCase();

  if (value.includes("fire")) {
    return Flame;
  }

  if (
    value.includes("hospital") ||
    value.includes("clinic") ||
    value.includes("doctor") ||
    value.includes("health")
  ) {
    return Hospital;
  }

  return ShieldCheck;
}

function getDirectionsUrl(facility: EmergencyFacility): string {
  if (facility.directionsUrl) {
    return facility.directionsUrl;
  }

  const [longitude, latitude] = facility.location;

  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
}

function isEmergencyFacility(
  value: unknown
): value is EmergencyFacility {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const item = value as Partial<EmergencyFacility>;

  return (
    (typeof item.id === "string" || typeof item.id === "number") &&
    Array.isArray(item.location) &&
    item.location.length === 2 &&
    typeof item.location[0] === "number" &&
    Number.isFinite(item.location[0]) &&
    typeof item.location[1] === "number" &&
    Number.isFinite(item.location[1]) &&
    typeof item.straightLineMeters === "number" &&
    Number.isFinite(item.straightLineMeters)
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string")
  );
}

function isEmergencyGuidance(
  value: unknown
): value is EmergencyGuidance {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const item = value as Partial<EmergencyGuidance>;

  return (
    isStringArray(item.immediateActions) &&
    isStringArray(item.evacuationInstructions) &&
    isStringArray(item.ifTrapped) &&
    isStringArray(item.precautions) &&
    isStringArray(item.nextSteps)
  );
}

function GuidanceList({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <div>
      <p className="text-xs font-bold text-slate-900">{title}</p>

      {items.length > 0 ? (
        <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-5 text-slate-700">
          {items.map((item, index) => (
            <li key={`${index}-${item}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-slate-500">
          No additional instructions provided.
        </p>
      )}
    </div>
  );
}

export default function EmergencyServicesPanel({
  location,
  buildingName = "Selected building",
  scenario = "building-collapse",
}: Props) {
  const [retryCount, setRetryCount] = useState(0);

  const [facilitiesState, setFacilitiesState] =
    useState<FacilitiesState | null>(null);

  const [guidanceState, setGuidanceState] =
    useState<GuidanceState | null>(null);

  const [facilitiesLoadingKey, setFacilitiesLoadingKey] =
    useState<string | null>(null);

  const [guidanceLoadingKey, setGuidanceLoadingKey] =
    useState<string | null>(null);

  const locationKey = location
    ? `${location[0]},${location[1]}`
    : null;

  const facilitiesRequestKey = locationKey
    ? `${locationKey}|${retryCount}`
    : null;

  const guidanceRequestKey =
    locationKey && facilitiesRequestKey
      ? `${locationKey}|${buildingName}|${scenario}|${retryCount}`
      : null;

  const currentFacilities = useMemo(
    () =>
      facilitiesState?.key === facilitiesRequestKey
        ? facilitiesState.data
        : [],
    [facilitiesState, facilitiesRequestKey]
  );

  const facilitiesError =
    facilitiesState?.key === facilitiesRequestKey
      ? facilitiesState.error
      : null;

  const loading =
    Boolean(location) &&
    facilitiesRequestKey !== null &&
    facilitiesLoadingKey === facilitiesRequestKey &&
    facilitiesState?.key !== facilitiesRequestKey;

  const facilitiesReady =
    facilitiesRequestKey !== null &&
    facilitiesState?.key === facilitiesRequestKey &&
    facilitiesState.error === null;

  const guidance =
    guidanceState?.key === guidanceRequestKey
      ? guidanceState.data
      : null;

  const guidanceProvider =
    guidanceState?.key === guidanceRequestKey
      ? guidanceState.provider
      : null;

  const guidanceError =
    guidanceState?.key === guidanceRequestKey
      ? guidanceState.error
      : null;

  const nearestFacility =
    guidanceState?.key === guidanceRequestKey
      ? guidanceState.nearestFacility
      : null;

  const guidanceLoading =
    guidanceRequestKey !== null &&
    guidanceLoadingKey === guidanceRequestKey &&
    guidanceState?.key !== guidanceRequestKey;

  // Load nearby emergency facilities.
  useEffect(() => {
    if (!location || !facilitiesRequestKey) {
      return;
    }

    const [longitude, latitude] = location;

    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude)
    ) {
      return;
    }

    const controller = new AbortController();
    const requestKey = facilitiesRequestKey;

    async function fetchFacilities(): Promise<void> {
      if (controller.signal.aborted) return;

      setFacilitiesLoadingKey(requestKey);

      try {
        const params = new URLSearchParams({
          lat: String(latitude),
          lon: String(longitude),
          radius: "5000",
        });

        const response = await fetch(
          `/api/emergency-services?${params.toString()}`,
          {
            method: "GET",
            signal: controller.signal,
            cache: "no-store",
          }
        );

        const contentType =
          response.headers.get("content-type") ?? "";

        if (!contentType.includes("application/json")) {
          throw new Error(
            "The API returned a non-JSON response. Check your terminal."
          );
        }

        const result =
          (await response.json()) as FacilitiesResponse;

        if (!response.ok || result.success === false) {
          throw new Error(
            result.error ||
              `Could not load facilities (HTTP ${response.status}).`
          );
        }

        const items = result.facilities ?? result.data;

        if (!Array.isArray(items)) {
          throw new Error(
            "The API response must contain a facilities or data array."
          );
        }

        const validFacilities = items.filter(isEmergencyFacility);

        validFacilities.sort(
          (a, b) =>
            a.straightLineMeters - b.straightLineMeters
        );

        if (controller.signal.aborted) return;

        setFacilitiesState({
          key: requestKey,
          data: validFacilities,
          error: null,
        });
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.name === "AbortError"
        ) {
          return;
        }

        if (!controller.signal.aborted) {
          setFacilitiesState({
            key: requestKey,
            data: [],
            error:
              err instanceof Error
                ? err.message
                : "Unable to load emergency services.",
          });
        }
      }
    }

    void fetchFacilities();

    return () => controller.abort();
  }, [location, facilitiesRequestKey]);

  // Generate guidance after facilities load, even if none are found.
  useEffect(() => {
    if (
      !location ||
      !locationKey ||
      !guidanceRequestKey ||
      !facilitiesReady
    ) {
      return;
    }

    const controller = new AbortController();
    const requestKey = guidanceRequestKey;

    const [longitude, latitude] = location;

    async function fetchGuidance(): Promise<void> {
      if (controller.signal.aborted) return;

      setGuidanceLoadingKey(requestKey);

      try {
        const response = await fetch("/api/emergency-guidance", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            buildingName,
            scenario,
            location: {
              longitude,
              latitude,
            },
            facilities: currentFacilities.slice(0, 10).map(
              (facility) => ({
                id: String(facility.id),
                name:
                  facility.name?.trim() ||
                  "Unnamed mapped facility",
                type: facility.type ?? "Emergency service",
                longitude: facility.location[0],
                latitude: facility.location[1],
                straightLineMeters: facility.straightLineMeters,
                directionsUrl: getDirectionsUrl(facility),
              })
            ),
          }),
        });

        const contentType =
          response.headers.get("content-type") ?? "";

        if (!contentType.includes("application/json")) {
          throw new Error(
            "The guidance API returned a non-JSON response."
          );
        }

        const result =
          (await response.json()) as GuidanceResponse;

        if (
          !response.ok ||
          !result.success ||
          !isEmergencyGuidance(result.guidance)
        ) {
          throw new Error(
            result.error ||
              "Could not generate valid emergency guidance."
          );
        }

        if (controller.signal.aborted) return;

        setGuidanceState({
          key: requestKey,
          data: result.guidance,
          nearestFacility: result.nearestFacility ?? null,
          provider: result.provider ?? "built-in",
          error: null,
        });
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.name === "AbortError"
        ) {
          return;
        }

        if (!controller.signal.aborted) {
          setGuidanceState({
            key: requestKey,
            data: null,
            nearestFacility: null,
            provider: null,
            error:
              err instanceof Error
                ? err.message
                : "Unable to generate emergency guidance.",
          });
        }
      }
    }

    void fetchGuidance();

    return () => controller.abort();
  }, [
    location,
    locationKey,
    guidanceRequestKey,
    facilitiesReady,
    currentFacilities,
    buildingName,
    scenario,
  ]);

  const refresh = () => setRetryCount((count) => count + 1);

  return (
    <section className="mt-4 rounded-xl border border-emerald-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
          <Hospital size={19} />
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-900">
            Nearby Emergency Services
          </h3>
          <p className="text-[10px] text-emerald-700">
            OpenStreetMap · Search radius: 5 km
          </p>
        </div>

        {location && (
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            aria-label="Refresh emergency services"
            title="Refresh facilities and guidance"
            className="rounded-lg border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw
              size={14}
              className={loading ? "animate-spin" : ""}
            />
          </button>
        )}
      </div>

      {!location ? (
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs leading-5 text-slate-600">
            Select a building on the map to find nearby emergency
            facilities and get emergency guidance.
          </p>
        </div>
      ) : loading ? (
        <div className="rounded-lg bg-emerald-50 p-4 text-center">
          <RefreshCw
            size={22}
            className="mx-auto mb-2 animate-spin text-emerald-700"
          />
          <p className="text-xs font-semibold text-emerald-900">
            Searching nearby facilities...
          </p>
          <p className="mt-1 text-[11px] text-emerald-800">
            Checking mapped emergency resources.
          </p>
        </div>
      ) : facilitiesError ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle
              size={16}
              className="mt-0.5 shrink-0 text-amber-700"
            />

            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-amber-900">
                Facilities could not be loaded
              </p>

              <p className="mt-1 wrap-break-word text-[11px] leading-5 text-amber-800">
                {facilitiesError}
              </p>

              <button
                type="button"
                onClick={refresh}
                className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-200"
              >
                <RefreshCw size={12} />
                Try again
              </button>
            </div>
          </div>
        </div>
      ) : !facilitiesReady ? (
        <div className="rounded-lg bg-emerald-50 p-4 text-center">
          <LoaderCircle
            size={22}
            className="mx-auto mb-2 animate-spin text-emerald-700"
          />
          <p className="text-xs font-semibold text-emerald-900">
            Searching nearby facilities...
          </p>
        </div>
      ) : currentFacilities.length === 0 ? (
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs leading-5 text-slate-600">
            No matching facilities were returned. This does not
            confirm that no emergency services exist nearby.
          </p>
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-slate-600">
            {currentFacilities.length} mapped{" "}
            {currentFacilities.length === 1
              ? "facility"
              : "facilities"}{" "}
            found. Sorted by straight-line distance.
          </p>

          <div className="max-h-80 space-y-2 overflow-y-auto">
            {currentFacilities.map((facility, index) => {
              const Icon = getFacilityIcon(facility.type);

              return (
                <article
                  key={`${facility.type ?? "facility"}-${facility.id}`}
                  className="rounded-lg border border-slate-200 p-3"
                >
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                      <Icon size={16} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="wrap-break-word text-xs font-semibold text-slate-900">
                        {facility.name?.trim() ||
                          `Unnamed mapped facility ${index + 1}`}
                      </p>

                      <p className="mt-1 text-[10px] capitalize text-slate-500">
                        {(facility.type ?? "Emergency service")
                          .replaceAll("_", " ")}
                      </p>

                      <div className="mt-2 flex flex-wrap items-center gap-1 text-xs font-semibold text-emerald-700">
                        <MapPin size={12} />
                        {formatDistance(facility.straightLineMeters)}
                        <span className="font-normal text-slate-500">
                          straight-line distance
                        </span>
                      </div>

                      <a
                        href={getDirectionsUrl(facility)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
                      >
                        Get directions
                        <ExternalLink size={12} />
                      </a>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      {/* New emergency guidance output */}
      {location && facilitiesReady && (
        <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50 p-3">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles size={16} className="text-indigo-700" />

            <h4 className="text-xs font-bold text-indigo-950">
              AI Emergency Guidance
            </h4>

            {guidanceProvider && (
              <span className="ml-auto rounded-full bg-white px-2 py-1 text-[9px] font-semibold text-indigo-700">
                {guidanceProvider === "gemma"
                  ? "Gemma"
                  : "Built-in guidance"}
              </span>
            )}
          </div>

          {guidanceLoading || (!guidance && !guidanceError) ? (
            <div className="flex items-center gap-2 py-2 text-xs text-indigo-800">
              <LoaderCircle size={15} className="animate-spin" />
              Preparing emergency guidance...
            </div>
          ) : guidanceError ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs leading-5 text-amber-900">
                Guidance could not be generated: {guidanceError}
              </p>
              <button
                type="button"
                onClick={refresh}
                className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1.5 text-xs font-semibold text-amber-900"
              >
                <RefreshCw size={12} />
                Retry
              </button>
            </div>
          ) : guidance ? (
            <div className="space-y-4">
              <div className="rounded-md border border-red-200 bg-red-50 p-3">
                <p className="text-xs font-bold text-red-900">
                  <AlertTriangle
                    size={14}
                    className="mr-1 inline"
                  />
                  Immediate actions
                </p>

                <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-5 text-red-950">
                  {guidance.immediateActions.map((action, index) => (
                    <li key={`${index}-${action}`}>{action}</li>
                  ))}
                </ol>
              </div>

              <GuidanceList
                title="Evacuation instructions"
                items={guidance.evacuationInstructions}
              />

              <GuidanceList
                title="If trapped"
                items={guidance.ifTrapped}
              />

              <GuidanceList
                title="Precautions"
                items={guidance.precautions}
              />

              <GuidanceList
                title="Next steps"
                items={guidance.nextSteps}
              />

              <div>
                <p className="text-xs font-bold text-slate-900">
                  Nearest mapped emergency facility
                </p>

                {nearestFacility ? (
                  <div className="mt-2 rounded-md border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold text-slate-900">
                      {nearestFacility.name}
                    </p>

                    <p className="mt-1 text-xs text-slate-600">
                      {nearestFacility.type.replaceAll("_", " ")}{" "}
                      ·{" "}
                      {nearestFacility.distanceLabel ||
                        formatDistance(
                          nearestFacility.straightLineMeters
                        )}
                    </p>

                    {nearestFacility.warning && (
                      <p className="mt-2 text-xs leading-5 text-amber-800">
                        {nearestFacility.warning}
                      </p>
                    )}

                    {nearestFacility.directionsUrl && (
                      <a
                        href={nearestFacility.directionsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
                      >
                        Open directions <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    No nearby facility was identified from the mapped
                    data. Contact emergency services for assistance.
                  </p>
                )}
              </div>

              <div className="rounded-md bg-white p-3">
                <p className="text-xs font-bold text-slate-900">
                  Emergency number
                </p>
                <a
                  href="tel:112"
                  className="mt-1 inline-flex items-center gap-2 text-sm font-bold text-red-700"
                >
                  112 — India emergency services
                </a>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
        <Info
          size={15}
          className="mt-0.5 shrink-0 text-amber-700"
        />
        <p className="text-[10px] leading-4 text-amber-900">
          Distances are approximate straight-line measurements, not
          road distances or travel times. OpenStreetMap data may be
          incomplete or outdated. AI-generated guidance does not
          verify facility availability, building stability, or road
          safety. For an actual emergency in India, call 112 and
          follow emergency responders&apos; instructions.
        </p>
      </div>
    </section>
  );
}
