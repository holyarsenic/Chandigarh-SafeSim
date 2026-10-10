
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";

maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

type BuildingProperties = {
  [key: string]: unknown;
  id?: number | string;
  name?: string;
  building?: string;
  buildingType?: string;
  levels?: string | number | null;
  affected?: boolean;
};

type BuildingGeometry = Polygon | MultiPolygon;
type BuildingFeature = Feature<BuildingGeometry, BuildingProperties>;

export type AffectedBuilding = {
  id: number;
  name: string;
  type: string;
  levels: string | number | null;
  distanceMeters: number;
};

export type SelectedBuilding = {
  id: number;
  name: string;
  type: string;
  levels: string | number | null;
  location: [number, number];
  affectedCount: number;
  affectedBuildings: AffectedBuilding[];
};

type Props = {
  radius: number;
  selectedLocation: [number, number] | null;
  onBuildingSelect: (building: SelectedBuilding) => void;
};

const CHANDIGARH_CENTER: [number, number] = [76.7794, 30.7333];

const MAP_STYLE =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

function makeCircle(lng: number, lat: number, radius: number) {
  const points: [number, number][] = [];
  const latOffset = radius / 111320;
  const lngOffset =
    radius / (111320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));

  for (let angle = 0; angle <= 360; angle += 5) {
    const radians = (angle * Math.PI) / 180;
    points.push([
      lng + lngOffset * Math.cos(radians),
      lat + latOffset * Math.sin(radians),
    ]);
  }

  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "Polygon" as const,
      coordinates: [points],
    },
  };
}

function isBuildingFeature(feature: Feature): feature is BuildingFeature {
  return (
    feature.geometry?.type === "Polygon" ||
    feature.geometry?.type === "MultiPolygon"
  );
}

function stableId(feature: BuildingFeature, index: number): number {
  const rawId = feature.properties?.id ?? feature.id;
  const id = Number(rawId);

  return rawId !== undefined &&
    rawId !== null &&
    Number.isFinite(id)
    ? id
    : index + 1;
}

function distanceMeters(
  a: [number, number],
  b: [number, number]
): number {
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return (
    6371000 *
    2 *
    Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)))
  );
}

function localXY(
  point: [number, number],
  origin: [number, number]
): [number, number] {
  const latitudeRadians = (origin[1] * Math.PI) / 180;

  return [
    (point[0] - origin[0]) * 111320 * Math.cos(latitudeRadians),
    (point[1] - origin[1]) * 111320,
  ];
}

function pointSegmentDistance(
  point: [number, number],
  start: [number, number],
  end: [number, number],
  origin: [number, number]
): number {
  const p = localXY(point, origin);
  const a = localXY(start, origin);
  const b = localXY(end, origin);

  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(p[0] - a[0], p[1] - a[1]);
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared
    )
  );

  return Math.hypot(
    p[0] - (a[0] + t * dx),
    p[1] - (a[1] + t * dy)
  );
}

function pointInRing(
  point: [number, number],
  ring: number[][]
): boolean {
  let inside = false;
  const [x, y] = point;

  if (ring.length < 3) return false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const crosses =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi;

    if (crosses) inside = !inside;
  }

  return inside;
}

function pointInPolygon(
  point: [number, number],
  polygon: number[][][]
): boolean {
  if (!polygon.length || !pointInRing(point, polygon[0])) {
    return false;
  }

  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(point, polygon[i])) return false;
  }

  return true;
}

function geometryIntersectsRadius(
  geometry: BuildingGeometry,
  center: [number, number],
  radius: number
): boolean {
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.coordinates;

  for (const polygon of polygons) {
    if (pointInPolygon(center, polygon)) return true;

    for (const ring of polygon) {
      if (
        ring.some(
          (coordinate) =>
            distanceMeters(
              center,
              coordinate as [number, number]
            ) <= radius
        )
      ) {
        return true;
      }

      for (let i = 0; i < ring.length - 1; i++) {
        const start = ring[i] as [number, number];
        const end = ring[i + 1] as [number, number];

        if (
          pointSegmentDistance(center, start, end, center) <= radius
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

function getApproxCenter(
  geometry: BuildingGeometry
): [number, number] {
  const ring =
    geometry.type === "Polygon"
      ? geometry.coordinates[0]
      : geometry.coordinates[0]?.[0];

  if (!ring?.length) return CHANDIGARH_CENTER;

  const total = ring.reduce(
    (sum, point) => [sum[0] + point[0], sum[1] + point[1]],
    [0, 0]
  );

  return [total[0] / ring.length, total[1] / ring.length];
}

function getBuildingDetails(
  feature: BuildingFeature,
  center: [number, number],
  index: number
): AffectedBuilding {
  const rawId = Number(feature.properties?.id);
  const id = Number.isFinite(rawId) ? rawId : index + 1;

  const rawLevels = feature.properties?.levels;

  return {
    id,
    name: String(feature.properties?.name || "Unnamed building"),
    type: String(
      feature.properties?.buildingType ||
        feature.properties?.building ||
        "Unknown"
    ),
    levels:
      typeof rawLevels === "string" || typeof rawLevels === "number"
        ? rawLevels
        : null,
    distanceMeters: Math.round(
      distanceMeters(center, getApproxCenter(feature.geometry))
    ),
  };
}

export default function BuildingCollapseMap({
  radius,
  selectedLocation,
  onBuildingSelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const buildingsRef = useRef<BuildingFeature[]>([]);
  const callbackRef = useRef(onBuildingSelect);
  const selectedIdRef = useRef<number | null>(null);
  const selectedDetailsRef = useRef<SelectedBuilding | null>(null);
  const selectedLocationRef = useRef(selectedLocation);
  const radiusRef = useRef(radius);
  const refreshRef = useRef<(() => void) | null>(null);

  const [buildingCount, setBuildingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState("");

  useEffect(() => {
    callbackRef.current = onBuildingSelect;
  }, [onBuildingSelect]);

  const selectedLocationLongitude = selectedLocation?.[0];
  const selectedLocationLatitude = selectedLocation?.[1];

  useEffect(() => {
    selectedLocationRef.current = selectedLocation;
    radiusRef.current = radius;

    const map = mapRef.current;
    if (!map) return;

    const impactSource = map.getSource("impact-zone") as
      | maplibregl.GeoJSONSource
      | undefined;

    impactSource?.setData({
      type: "FeatureCollection",
      features: selectedLocation
        ? [makeCircle(selectedLocation[0], selectedLocation[1], radius)]
        : [],
    });

    if (!selectedLocation) {
      selectedIdRef.current = null;
      selectedDetailsRef.current = null;

      if (map.getLayer("selected-building-fill")) {
        map.setFilter("selected-building-fill", [
          "==",
          ["get", "id"],
          -1,
        ]);
      }

      if (map.getLayer("selected-building-outline")) {
        map.setFilter("selected-building-outline", [
          "==",
          ["get", "id"],
          -1,
        ]);
      }
    }

    refreshRef.current?.();
  }, [
    radius,
    selectedLocation,
    selectedLocationLongitude,
    selectedLocationLatitude,
  ]);

  const showCity = useCallback(() => {
    mapRef.current?.flyTo({
      center: CHANDIGARH_CENTER,
      zoom: 12,
      duration: 800,
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    let cancelled = false;

    const map = new maplibregl.Map({
      container,
      style: MAP_STYLE,
      center: CHANDIGARH_CENTER,
      zoom: 12,
      minZoom: 3,
      maxZoom: 20,
      attributionControl: {},
    });

    mapRef.current = map;

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      "top-right"
    );

    map.on("error", (event) => {
      console.error("MapLibre error:", event.error);
    });

    map.on("load", async () => {
      if (cancelled) return;

      try {
        map.addSource("buildings-source", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [],
          },
        });

        map.addSource("impact-zone", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [],
          },
        });

        map.addLayer({
          id: "impact-zone-fill",
          type: "fill",
          source: "impact-zone",
          paint: {
            "fill-color": "#ef4444",
            "fill-opacity": 0.16,
          },
        });

        map.addLayer({
          id: "impact-zone-outline",
          type: "line",
          source: "impact-zone",
          paint: {
            "line-color": "#f87171",
            "line-width": 2,
            "line-dasharray": [2, 1.5],
          },
        });

        map.addLayer({
          id: "buildings-fill",
          type: "fill",
          source: "buildings-source",
          paint: {
            "fill-color": "#60a5fa",
            "fill-opacity": 0.32,
          },
        });

        map.addLayer({
          id: "affected-buildings-fill",
          type: "fill",
          source: "buildings-source",
          filter: ["==", ["get", "affected"], true],
          paint: {
            "fill-color": "#fb923c",
            "fill-opacity": 0.82,
          },
        });

        map.addLayer({
          id: "buildings-outline",
          type: "line",
          source: "buildings-source",
          paint: {
            "line-color": "#bfdbfe",
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              11,
              0.6,
              15,
              1.6,
              18,
              2.5,
            ],
            "line-opacity": 1,
          },
        });

        map.addLayer({
          id: "affected-buildings-outline",
          type: "line",
          source: "buildings-source",
          filter: ["==", ["get", "affected"], true],
          paint: {
            "line-color": "#fdba74",
            "line-width": 2,
          },
        });

        map.addLayer({
          id: "selected-building-fill",
          type: "fill",
          source: "buildings-source",
          filter: ["==", ["get", "id"], -1],
          paint: {
            "fill-color": "#dc2626",
            "fill-opacity": 0.95,
          },
        });

        map.addLayer({
          id: "selected-building-outline",
          type: "line",
          source: "buildings-source",
          filter: ["==", ["get", "id"], -1],
          paint: {
            "line-color": "#ffffff",
            "line-width": 3,
          },
        });

        const refreshSimulation = () => {
          const center = selectedLocationRef.current;
          const currentRadius = radiusRef.current;
          const selectedId = selectedIdRef.current;

          const updatedFeatures = buildingsRef.current.map((feature) => {
            const affected =
              center !== null &&
              Number(feature.properties?.id) !== selectedId &&
              geometryIntersectsRadius(
                feature.geometry,
                center,
                currentRadius
              );

            return {
              ...feature,
              properties: {
                ...feature.properties,
                affected,
              },
            };
          });

          buildingsRef.current = updatedFeatures;

          const source = map.getSource(
            "buildings-source"
          ) as maplibregl.GeoJSONSource | undefined;

          source?.setData({
            type: "FeatureCollection",
            features: updatedFeatures,
          });

          if (!center || selectedId === null) return;

          const selected = updatedFeatures.find(
            (feature) => Number(feature.properties?.id) === selectedId
          );

          if (!selected) return;

          const affectedBuildings = updatedFeatures
            .filter((feature) => feature.properties?.affected === true)
            .map((feature, index) =>
              getBuildingDetails(feature, center, index)
            )
            .sort((a, b) => a.distanceMeters - b.distanceMeters);

          // Always construct the complete, normalized data shape.
          const details: SelectedBuilding = {
            id: selectedId,
            name: String(selected.properties?.name || "Unnamed building"),
            type: String(
              selected.properties?.buildingType ||
                selected.properties?.building ||
                "Unknown"
            ),
            levels:
              typeof selected.properties?.levels === "string" ||
              typeof selected.properties?.levels === "number"
                ? selected.properties.levels
                : null,
            location: [center[0], center[1]],
            affectedCount: affectedBuildings.length,
            affectedBuildings,
          };

          const previous = selectedDetailsRef.current;
          selectedDetailsRef.current = details;

          const previousIds = (previous?.affectedBuildings ?? [])
            .map((building) => building.id)
            .join(",");

          const currentIds = details.affectedBuildings
            .map((building) => building.id)
            .join(",");

          if (
            !previous ||
            previous.id !== details.id ||
            previous.affectedCount !== details.affectedCount ||
            previousIds !== currentIds ||
            previous.location[0] !== details.location[0] ||
            previous.location[1] !== details.location[1]
          ) {
            callbackRef.current(details);
          }
        };

        refreshRef.current = refreshSimulation;

        map.on("click", "buildings-fill", (event) => {
          const clickedFeature = event.features?.[0];
          if (!clickedFeature) return;

          const id = Number(clickedFeature.properties?.id);
          if (!Number.isFinite(id)) return;

          const feature = buildingsRef.current.find(
            (item) => Number(item.properties?.id) === id
          );

          if (!feature) return;

          const location: [number, number] = [
            event.lngLat.lng,
            event.lngLat.lat,
          ];

          selectedIdRef.current = id;
          selectedLocationRef.current = location;
          selectedDetailsRef.current = null;

          map.setFilter("selected-building-fill", [
            "==",
            ["get", "id"],
            id,
          ]);

          map.setFilter("selected-building-outline", [
            "==",
            ["get", "id"],
            id,
          ]);

          const impactSource = map.getSource(
            "impact-zone"
          ) as maplibregl.GeoJSONSource;

          impactSource.setData({
            type: "FeatureCollection",
            features: [makeCircle(location[0], location[1], radiusRef.current)],
          });

          map.flyTo({
            center: location,
            zoom: Math.max(map.getZoom(), 16),
            duration: 700,
          });

          refreshSimulation();
        });

        map.on("mouseenter", "buildings-fill", () => {
          map.getCanvas().style.cursor = "pointer";
        });

        map.on("mouseleave", "buildings-fill", () => {
          map.getCanvas().style.cursor = "";
        });

        const response = await fetch("/api/buildings");

        if (!response.ok) {
          throw new Error(
            `Buildings API returned ${response.status}. Check /api/buildings.`
          );
        }

        const result: {
          success?: boolean;
          data?: FeatureCollection;
          error?: string;
        } = await response.json();

        if (!result.success || !result.data?.features) {
          throw new Error(
            result.error || "The API returned no building features."
          );
        }

        const features = result.data.features
          .filter(isBuildingFeature)
          .map((feature, index): BuildingFeature => ({
            ...feature,
            properties: {
              ...(feature.properties ?? {}),
              id: stableId(feature, index),
              affected: false,
            },
          }));

        if (cancelled) return;

        buildingsRef.current = features;
        setBuildingCount(features.length);

        const source = map.getSource(
          "buildings-source"
        ) as maplibregl.GeoJSONSource;

        source.setData({
          type: "FeatureCollection",
          features,
        });

        setLoading(false);

        if (!features.length) {
          setMapError(
            "No building footprints were returned. Check /api/buildings."
          );
          return;
        }

        setMapError("");

        const bounds = new maplibregl.LngLatBounds();

        for (const feature of features) {
          const polygons =
            feature.geometry.type === "Polygon"
              ? [feature.geometry.coordinates]
              : feature.geometry.coordinates;

          for (const polygon of polygons) {
            for (const ring of polygon) {
              for (const coordinate of ring) {
                bounds.extend(coordinate as [number, number]);
              }
            }
          }
        }

        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, {
            padding: 45,
            maxZoom: 15,
            duration: 600,
          });
        }

        map.resize();
      } catch (error) {
        if (cancelled) return;

        console.error("Building simulation map error:", error);
        setMapError(
          error instanceof Error
            ? error.message
            : "Failed to load building footprints."
        );
        setLoading(false);
      }
    });

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      refreshRef.current = null;
      map.remove();
      mapRef.current = null;
      buildingsRef.current = [];
    };
  }, []);

  return (
    <div className="relative h-full min-h-100 w-full overflow-hidden rounded-xl bg-slate-900">
      <div
        ref={containerRef}
        className="absolute inset-0 h-full w-full"
        aria-label="Interactive Chandigarh building-collapse simulation map"
      />

      <div className="absolute bottom-4 left-4 z-10 rounded-lg border border-slate-700 bg-slate-950/90 px-3 py-2 text-sm text-white shadow-lg">
        {loading ? "Loading buildings..." : `${buildingCount} buildings loaded`}
      </div>

      <div className="absolute left-4 top-4 z-10 flex flex-wrap gap-2 rounded-lg border border-slate-700 bg-slate-950/90 px-3 py-2 text-xs text-white shadow-lg">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-blue-400" />
          Buildings
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-orange-400" />
          Potentially affected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-red-500" />
          Selected
        </span>
      </div>

      <button
        type="button"
        onClick={showCity}
        className="absolute bottom-4 right-4 z-10 rounded-lg bg-foreground/80 px-3 py-2 text-sm font-medium text-background shadow-lg hover:bg-background hover:text-foreground transition-colors ease-in-out"
      >
        City overview
      </button>

      {mapError && (
        <div className="absolute left-4 right-4 top-16 z-10 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 shadow-lg">
          {mapError}
        </div>
      )}
    </div>
  );
}