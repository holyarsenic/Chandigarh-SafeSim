"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";

maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

type BuildingProperties = {
  [key: string]: unknown;
  id?: number | string;
  name?: string | null;
  address?: string | null;
  building?: string;
  buildingType?: string;
  levels?: string | number | null;
  affected?: boolean;
  selected?: boolean;
  hasRealName?: boolean | null;
  amenity?: string | null;
  healthcare?: string | null;
  shop?: string | null;
  office?: string | null;
  tourism?: string | null;
  historic?: string | null;
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
    radius /
    (111320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));

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

/**
 * Converts OSM properties into a user-friendly display name.
 * The numeric OSM ID is never used as a display name.
 */
function getBuildingDisplayName(feature: {
  id?: number | string;
  properties?: {
    id?: number | string;
    name?: string | null;
    address?: string | null;
    hasRealName?: boolean | null;
    building?: string;
    buildingType?: string;
    amenity?: string | null;
    healthcare?: string | null;
    shop?: string | null;
    office?: string | null;
    tourism?: string | null;
    historic?: string | null;
  };
}): string {
  const properties = feature.properties;

  if (!properties) {
    return "Unnamed Building";
  }

  const name = properties.name?.trim();

  // Prefer the name provided by the API.
  if (
    name &&
    name.toLowerCase() !== "building" &&
    name.toLowerCase() !== "unnamed building"
  ) {
    return name;
  }

  // If there is no useful name, use the address.
  const address = properties.address?.trim();

  if (address) {
    return address;
  }

  const categoryLabels: Record<string, string> = {
    hospital: "Hospital",
    clinic: "Clinic",
    doctors: "Medical Clinic",
    school: "School",
    university: "University",
    college: "College",
    kindergarten: "Kindergarten",
    library: "Library",
    police: "Police Station",
    fire_station: "Fire Station",
    pharmacy: "Pharmacy",
    bank: "Bank",
    restaurant: "Restaurant",
    cafe: "Cafe",
    supermarket: "Supermarket",
    hotel: "Hotel",
    museum: "Museum",
    theatre: "Theatre",
    cinema: "Cinema",
    marketplace: "Market",
    dentist: "Dental Clinic",
    place_of_worship: "Place of Worship",
    commercial: "Commercial Building",
    residential: "Residential Building",
    apartments: "Apartment Building",
    house: "House",
    detached: "House",
    industrial: "Industrial Building",
    retail: "Retail Building",
    office: "Office Building",
    public: "Public Building",
    government: "Government Building",
    warehouse: "Warehouse",
    dormitory: "Dormitory",
    church: "Church",
    mosque: "Mosque",
    temple: "Temple",
  };

  const categories = [
    properties.amenity,
    properties.healthcare,
    properties.shop,
    properties.office,
    properties.tourism,
    properties.historic,
    properties.buildingType,
    properties.building,
  ];

  for (const value of categories) {
    const category = value?.trim().toLowerCase();

    if (!category || category === "yes") {
      continue;
    }

    if (categoryLabels[category]) {
      return categoryLabels[category];
    }

    // Format an unfamiliar OSM category into readable text.
    if (
      category === properties.buildingType?.toLowerCase() ||
      category === properties.building?.toLowerCase()
    ) {
      return category
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
    }
  }

  return "Unnamed Building";
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
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLng / 2) ** 2;

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
      (yi > y) !== (yj > y) &&
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

  const total = ring.reduce<[number, number]>(
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
    // FIX: Pass the complete feature, not feature.properties.
    name: getBuildingDisplayName(feature),
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

  // 3D mode state
  const [is3D, setIs3D] = useState(false);
  const is3DRef = useRef(false);
  const [cornerRadius, setCornerRadius] = useState(5);
  const [heightMultiplier, setHeightMultiplier] = useState(1.0);
  const [extrusionOpacity, setExtrusionOpacity] = useState(0.8);
  const cornerRadiusRef = useRef(5);
  const heightMultiplierRef = useRef(1.0);
  const extrusionOpacityRef = useRef(0.8);

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

  // Toggle 3D mode
  const toggle3D = useCallback(() => {
    const next = !is3DRef.current;
    setIs3D(next);
    is3DRef.current = next;
    const map = mapRef.current;
    if (!map) return;
    if (map.getLayer("buildings-3d")) {
      map.setLayoutProperty("buildings-3d", "visibility", next ? "visible" : "none");
    }
    if (map.getLayer("buildings-fill")) {
      map.setLayoutProperty("buildings-fill", "visibility", next ? "none" : "visible");
    }
    if (map.getLayer("affected-buildings-fill")) {
      map.setLayoutProperty("affected-buildings-fill", "visibility", next ? "none" : "visible");
    }
    if (map.getLayer("selected-building-fill")) {
      map.setLayoutProperty("selected-building-fill", "visibility", next ? "none" : "visible");
    }
    refreshRef.current?.();
    map.easeTo({
      pitch: next ? 58 : 0,
      bearing: next ? -20 : 0,
      duration: 900,
    });
  }, []);

  // Sync cornerRadius to map layer
  useEffect(() => {
    cornerRadiusRef.current = cornerRadius;
    const map = mapRef.current;
    if (!map || !map.getLayer("buildings-3d")) return;
    map.setLayoutProperty("buildings-3d", "fill-extrusion-rounded-corner-distance", cornerRadius);
  }, [cornerRadius]);

  // Sync heightMultiplier to map layer
  useEffect(() => {
    heightMultiplierRef.current = heightMultiplier;
    const map = mapRef.current;
    if (!map || !map.getLayer("buildings-3d")) return;
    map.setPaintProperty("buildings-3d", "fill-extrusion-height", [
      "interpolate",
      ["linear"],
      ["zoom"],
      12, 0,
      14,
      [
        "max",
        [
          "*",
          ["to-number", ["coalesce", ["get", "levels"], 2], 2],
          3.5 * heightMultiplier,
        ],
        6 * heightMultiplier,
      ],
    ]);
  }, [heightMultiplier]);

  // Sync extrusionOpacity to map layer
  useEffect(() => {
    extrusionOpacityRef.current = extrusionOpacity;
    const map = mapRef.current;
    if (!map || !map.getLayer("buildings-3d")) return;
    map.setPaintProperty("buildings-3d", "fill-extrusion-opacity", extrusionOpacity);
  }, [extrusionOpacity]);

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
              11, 0.6,
              15, 1.6,
              18, 2.5,
            ],
            "line-opacity": 1,
          },
        });

        map.addLayer({
          id: "building-labels",
          type: "symbol",
          source: "buildings-source",
          minzoom: 13,
          layout: {
            "text-field": [
              "case",
              [
                "all",
                ["==", ["get", "hasRealName"], true],
                ["has", "name"],
                ["!=", ["get", "name"], ""],
              ],
              ["get", "name"],
              [
                "all",
                ["has", "address"],
                ["!=", ["get", "address"], null],
                ["!=", ["get", "address"], ""],
              ],
              ["get", "address"],
              [
                "all",
                ["has", "name"],
                ["!=", ["get", "name"], ""],
                ["!=", ["get", "name"], "Building"],
                ["!=", ["get", "name"], "Unnamed Building"],
              ],
              ["get", "name"],
              "",
            ],
            "text-font": ["Open Sans Regular"],
            "text-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              13, 10,
              16, 12,
              19, 14,
            ],
            "text-anchor": "center",
            "text-max-width": 12,
            "text-allow-overlap": false,
            "text-ignore-placement": false,
            "symbol-sort-key": [
              "case",
              ["==", ["get", "hasRealName"], true],
              0,
              1,
            ],
          },
          paint: {
            "text-color": "#ffffff",
            "text-halo-color": "#0f172a",
            "text-halo-width": 1.5,
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

        // Add 3D fill-extrusion layer (initially hidden)
        map.addLayer({
          id: "buildings-3d",
          type: "fill-extrusion",
          source: "buildings-source",
          layout: {
            visibility: "none",
            "fill-extrusion-rounded-corner-distance": cornerRadiusRef.current,
          },
          paint: {
            "fill-extrusion-color": [
              "case",
              ["==", ["get", "selected"], true],
              "#dc2626",
              ["==", ["get", "affected"], true],
              "#f97316",
              "#38bdf8",
            ],
            "fill-extrusion-height": [
              "interpolate",
              ["linear"],
              ["zoom"],
              12, 0,
              14,
              [
                "max",
                [
                  "*",
                  ["to-number", ["coalesce", ["get", "levels"], 2], 2],
                  3.5 * heightMultiplierRef.current,
                ],
                6 * heightMultiplierRef.current,
              ],
            ],
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": extrusionOpacityRef.current,
          },
        });

        const refreshSimulation = () => {
          const center = selectedLocationRef.current;
          const currentRadius = radiusRef.current;
          const selectedId = selectedIdRef.current;

          const updatedFeatures = buildingsRef.current.map((feature) => {
            const isSelected =
              selectedId !== null &&
              Number(feature.properties?.id) === selectedId;

            const affected =
              center !== null &&
              !isSelected &&
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
                selected: isSelected,
              },
            };
          });

          buildingsRef.current = updatedFeatures;

          const source = map.getSource("buildings-source") as
            | maplibregl.GeoJSONSource
            | undefined;

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

          const details: SelectedBuilding = {
            id: selectedId,

            // FIX: Pass the complete feature.
            name: getBuildingDisplayName(selected),

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
            previous.name !== details.name ||
            previous.affectedCount !== details.affectedCount ||
            previousIds !== currentIds ||
            previous.location[0] !== details.location[0] ||
            previous.location[1] !== details.location[1]
          ) {
            callbackRef.current(details);
          }
        };

        refreshRef.current = refreshSimulation;

        const handleBuildingClick = (
          event: maplibregl.MapLayerMouseEvent & {
            features?: maplibregl.MapGeoJSONFeature[];
          }
        ) => {
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

          impactSource?.setData({
            type: "FeatureCollection",
            features: [
              makeCircle(location[0], location[1], radiusRef.current),
            ],
          });

          map.flyTo({
            center: location,
            zoom: Math.max(map.getZoom(), 16),
            duration: 700,
          });

          refreshSimulation();
        };

        map.on("click", "buildings-fill", handleBuildingClick);
        map.on("click", "buildings-3d", handleBuildingClick);

        map.on("mouseenter", "buildings-fill", () => {
          map.getCanvas().style.cursor = "pointer";
        });

        map.on("mouseleave", "buildings-fill", () => {
          map.getCanvas().style.cursor = "";
        });

        map.on("mouseenter", "buildings-3d", () => {
          map.getCanvas().style.cursor = "pointer";
        });

        map.on("mouseleave", "buildings-3d", () => {
          map.getCanvas().style.cursor = "";
        });

        const response = await fetch("/api/buildings");

        if (!response.ok) {
          throw new Error(`Buildings API returned ${response.status}.`);
        }

        const result: {
          success?: boolean;
          count?: number;
          data?: {
            type: "FeatureCollection";
            features: Feature[];
          };
          error?: string;
        } = await response.json();

        if (!result.success || !result.data?.features) {
          throw new Error(
            result.error || "The API returned no building features."
          );
        }

        const features = result.data.features
          .filter(isBuildingFeature)
          .map((feature, index): BuildingFeature => {
            const id = stableId(feature, index);
            const isSelected =
              selectedIdRef.current !== null &&
              id === selectedIdRef.current;
            return {
              ...feature,
              properties: {
                ...(feature.properties ?? {}),
                id,
                affected: false,
                selected: isSelected,
              },
            };
          });

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
          setMapError("No building footprints were returned.");
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

      {/* Bottom-left: Building count */}
      <div className="absolute bottom-4 left-4 z-10 rounded-lg border border-slate-700/80 bg-slate-950/90 backdrop-blur-md px-3 py-2 text-sm text-white shadow-lg">
        {loading
          ? "Loading buildings..."
          : `${buildingCount} buildings loaded`}
      </div>

      {/* Top-left: Legend + 3D controls */}
      <div className="absolute left-4 top-4 z-10 flex flex-col gap-2">
        {/* Legend */}
        <div className="flex flex-wrap gap-2 rounded-lg border border-slate-700/80 bg-slate-950/90 backdrop-blur-md px-3 py-2 text-xs text-white shadow-lg">
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
          {/* 3D Toggle */}
          <button
            type="button"
            onClick={toggle3D}
            className={`ml-1 rounded px-2 py-0.5 text-[11px] font-semibold transition ${
              is3D
                ? "bg-blue-600 text-white shadow-[0_0_10px_rgba(37,99,235,0.55)]"
                : "bg-slate-700 text-slate-200 hover:bg-slate-600"
            }`}
          >
            {is3D ? "3D On" : "3D"}
          </button>
        </div>

        {/* 3D Controls Card — shown only in 3D mode */}
        {is3D && (
          <div className="w-72 rounded-xl border border-slate-600/70 bg-black/75 backdrop-blur-md px-4 py-3 text-white shadow-2xl">
            <p className="mb-3 text-[10px] leading-snug text-slate-400">
              Use fill-extrusion-rounded-corner-distance to round the corners of extruded polygons.
            </p>

            {/* Corner radius slider */}
            <div className="mb-3">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-slate-200">Corner radius (m)</span>
                <span className="min-w-[2rem] text-right font-semibold text-white">{cornerRadius}</span>
              </div>
              <input
                type="range"
                min={0}
                max={15}
                step={0.5}
                value={cornerRadius}
                onChange={(e) => setCornerRadius(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer accent-blue-500"
              />
            </div>

            {/* Height multiplier slider */}
            <div className="mb-3">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-slate-200">Height multiplier</span>
                <span className="min-w-[2rem] text-right font-semibold text-white">{heightMultiplier.toFixed(1)}×</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={3.0}
                step={0.1}
                value={heightMultiplier}
                onChange={(e) => setHeightMultiplier(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer accent-blue-500"
              />
            </div>

            {/* Opacity slider */}
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-slate-200">Opacity</span>
                <span className="min-w-[2rem] text-right font-semibold text-white">{Math.round(extrusionOpacity * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.2}
                max={1.0}
                step={0.01}
                value={extrusionOpacity}
                onChange={(e) => setExtrusionOpacity(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer accent-blue-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Bottom-right: City overview button */}
      <button
        type="button"
        onClick={showCity}
        className="absolute bottom-4 right-4 z-10 rounded-lg bg-foreground/80 px-3 py-2 text-sm font-medium text-background shadow-lg transition-colors ease-in-out hover:bg-background hover:text-foreground"
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