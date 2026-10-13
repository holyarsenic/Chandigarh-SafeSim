"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronUp,
  Clock,
  Flame,
  History,
  MapPin,
  RefreshCw,
  X,
} from "lucide-react";

type HistoryRecord = {
  id: number | string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  radius?: number | string | null;
  hazard_index?: number | string | null;
  created_at?: string | null;
  geojson_payload?: unknown;
};

type HistoryResponse = {
  success?: boolean;
  data?: HistoryRecord[];
  error?: string;
};

type HistoryProperties = {
  name?: string;
  building_name?: string;
  radius?: number | string;
  hazard_index?: number | string;
  scenario?: string;
};

function getProperties(payload: unknown): HistoryProperties {
  let parsed = payload;

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return {};
  }

  const object = parsed as {
    properties?: unknown;
    metadata?: unknown;
  };

  const properties = object.properties ?? object.metadata;

  if (!properties || typeof properties !== "object") {
    return {};
  }

  return properties as HistoryProperties;
}

function formatDate(value?: string | null): string {
  if (!value) return "Date unavailable";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleString();
}

function formatNumber(
  value: number | string | null | undefined,
  suffix = "",
): string {
  if (value == null || value === "") return "—";

  const number = Number(value);

  return Number.isFinite(number)
    ? `${number.toLocaleString()}${suffix}`
    : "—";
}

function getScenarioLabel(value?: string): string {
  switch (value) {
    case "major-fire":
      return "Major Fire";
    case "building-collapse":
      return "Building Collapse";
    case "urban-flooding":
      return "Urban Flooding";
    case "earthquake":
      return "Earthquake";
    default:
      return value || "Simulation";
  }
}

export default function SimulationHistory() {
  const [isOpen, setIsOpen] = useState(false);
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | number | null>(
    null,
  );

  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchHistory = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError(null);

    try {
      const response = await fetch("/api/history", {
        method: "GET",
        cache: "no-store",
      });

      const contentType = response.headers.get("content-type") ?? "";

      if (!contentType.includes("application/json")) {
        throw new Error("Unexpected server response. Please try again.");
      }

      const result = (await response.json()) as HistoryResponse;

      if (
        !response.ok ||
        !result.success ||
        !Array.isArray(result.data)
      ) {
        throw new Error(
          result.error || "Could not load simulation history.",
        );
      }

      setRecords(result.data);
      setHasLoaded(true);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while loading history.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const handleToggle = () => {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);

    if (nextOpen && !hasLoaded && !loading) {
      void fetchHistory();
    }
  };

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div ref={dropdownRef} className="relative">
      {/* Navbar button */}
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label="Toggle simulation history"
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
          isOpen
            ? "border-blue-200 bg-blue-50 text-blue-700"
            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
        }`}
      >
        <History size={17} aria-hidden="true" />
        <span>History</span>
        <ChevronDown
          size={15}
          aria-hidden="true"
          className={`transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Simulation history"
          className="absolute sm:right-1 md:right-0 top-full z-100 mt-2 w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        >
          {/* Panel header */}
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                <History size={17} aria-hidden="true" />
              </div>

              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Simulation History
                </h2>
                <p className="text-[10px] text-slate-500">
                  Your recent saved simulations
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void fetchHistory(true)}
                disabled={loading || refreshing}
                aria-label="Refresh history"
                className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"
              >
                <RefreshCw
                  size={15}
                  className={refreshing ? "animate-spin" : ""}
                  aria-hidden="true"
                />
              </button>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close history"
                className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Panel content */}
          <div className="max-h-[min(70vh,600px)] overflow-y-auto p-3">
            {loading ? (
              <div
                role="status"
                className="flex items-center justify-center gap-2 rounded-lg bg-slate-50 p-8 text-xs text-slate-500"
              >
                <RefreshCw
                  size={16}
                  className="animate-spin"
                  aria-hidden="true"
                />
                Loading simulation history...
              </div>
            ) : error ? (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 p-4"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle
                    size={17}
                    className="mt-0.5 shrink-0 text-red-600"
                    aria-hidden="true"
                  />

                  <div>
                    <p className="text-xs font-semibold text-red-800">
                      Could not load history
                    </p>
                    <p className="mt-1 wrap-break-word text-[11px] leading-5 text-red-700">
                      {error}
                    </p>

                    <button
                      type="button"
                      onClick={() => void fetchHistory(true)}
                      disabled={refreshing}
                      className="mt-2 text-xs font-semibold text-red-800 underline disabled:opacity-50"
                    >
                      Try again
                    </button>
                  </div>
                </div>
              </div>
            ) : records.length === 0 ? (
              <div className="rounded-lg bg-slate-50 px-4 py-8 text-center">
                <History
                  size={26}
                  className="mx-auto mb-2 text-slate-400"
                  aria-hidden="true"
                />
                <p className="text-sm font-semibold text-slate-700">
                  No simulations yet
                </p>
                <p className="mx-auto mt-1 max-w-62 text-[11px] leading-5 text-slate-500">
                  Select a building on the map to save your first
                  simulation.
                </p>
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-slate-500">
                    {records.length} recent{" "}
                    {records.length === 1 ? "record" : "records"}
                  </p>

                  <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">
                    Neon PostgreSQL
                  </span>
                </div>

                <div className="space-y-2">
                  {records.map((record) => {
                    const properties = getProperties(
                      record.geojson_payload,
                    );

                    const name =
                      properties.name ||
                      properties.building_name ||
                      "Chandigarh Structure";

                    const radius =
                      record.radius ?? properties.radius;

                    const hazardIndex =
                      record.hazard_index ?? properties.hazard_index;

                    const scenario = getScenarioLabel(
                      properties.scenario,
                    );

                    const isExpanded = expandedId === record.id;
                    const isFire = scenario === "Major Fire";

                    return (
                      <article
                        key={record.id}
                        className="rounded-lg border border-slate-200 bg-white p-3 transition hover:border-slate-300"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedId(
                              isExpanded ? null : record.id,
                            )
                          }
                          aria-expanded={isExpanded}
                          className="flex w-full items-start gap-3 text-left"
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                            {isFire ? (
                              <Flame
                                size={17}
                                aria-hidden="true"
                              />
                            ) : (
                              <Building2
                                size={17}
                                aria-hidden="true"
                              />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="wrap-break-word text-xs font-semibold text-slate-800">
                              {name}
                            </p>

                            <p className="mt-1 text-[10px] text-slate-500">
                              {scenario}
                            </p>

                            <p className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
                              <Clock
                                size={11}
                                aria-hidden="true"
                              />
                              {formatDate(record.created_at)}
                            </p>
                          </div>

                          <span className="mt-1 shrink-0 text-slate-400">
                            {isExpanded ? (
                              <ChevronUp
                                size={16}
                                aria-hidden="true"
                              />
                            ) : (
                              <ChevronDown
                                size={16}
                                aria-hidden="true"
                              />
                            )}
                          </span>
                        </button>

                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <div className="rounded-md bg-slate-50 p-2">
                            <p className="text-[10px] text-slate-500">
                              Impact radius
                            </p>
                            <p className="mt-1 text-sm font-bold text-slate-800">
                              {formatNumber(radius, " m")}
                            </p>
                          </div>

                          <div className="rounded-md bg-slate-50 p-2">
                            <p className="text-[10px] text-slate-500">
                              Hazard index
                            </p>
                            <p className="mt-1 text-sm font-bold text-slate-800">
                              {formatNumber(hazardIndex)}
                            </p>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              Record details
                            </p>

                            <p className="break-all text-[11px] text-slate-600">
                              Record ID: {record.id}
                            </p>

                            <div className="flex items-start gap-1.5 text-[11px] text-slate-600">
                              <MapPin
                                size={13}
                                className="mt-0.5 shrink-0"
                                aria-hidden="true"
                              />
                              <span>
                                {record.latitude != null &&
                                record.longitude != null
                                  ? `${record.latitude}, ${record.longitude}`
                                  : "Coordinates not saved"}
                              </span>
                            </div>

                            <p className="text-[11px] leading-5 text-slate-500">
                              This is a saved simulation record, not
                              a verified damage assessment.
                            </p>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Panel footer */}
          <div className="border-t border-slate-100 bg-slate-50 px-4 py-2">
            <p className="text-center text-[10px] text-slate-500">
              Simulation records are provided for planning purposes.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}