import math
from typing import List, Dict, Any, Tuple
from app.schemas.assessment import GeoJSONFeature

def haversine(p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
    R = 6371000
    dlat = math.radians(p2[0] - p1[0])
    dlon = math.radians(p2[1] - p1[1])
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(p1[0])) * math.cos(math.radians(p2[0])) * math.sin(dlon / 2)**2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def simulate_disaster_impact(
    epicenter: Tuple[float, float],
    radius: int,
    raw_buildings: List[Dict[str, Any]],
    raw_roads: List[Dict[str, Any]]
) -> Tuple[List[GeoJSONFeature], List[GeoJSONFeature], float]:
    processed_buildings = []
    processed_roads = []
    total_risk = 0.0

    for b in raw_buildings:
        coords = b["geometry"]["coordinates"][0]
        avg_lon = sum(pt[0] for pt in coords) / len(coords)
        avg_lat = sum(pt[1] for pt in coords) / len(coords)
        dist = haversine(epicenter, (avg_lat, avg_lon))

        levels = b["properties"].get("levels") or 2
        proximity = max(0.0, 1.0 - (dist / radius))
        risk_score = round(min(1.0, proximity * (1.0 + (levels * 0.1))), 2)
        total_risk += risk_score

        damage_state = "COLLAPSED" if risk_score > 0.65 else "MODERATE_DAMAGE" if risk_score > 0.3 else "SAFE"
        props = dict(b["properties"])
        props["collapse_risk_score"] = risk_score
        props["structural_damage_state"] = damage_state

        processed_buildings.append(GeoJSONFeature(type="Feature", properties=props, geometry=b["geometry"]))

    for r in raw_roads:
        pts = r["geometry"]["coordinates"]
        min_dist = min(haversine(epicenter, (pt[1], pt[0])) for pt in pts)
        debris_severity = round(max(0.0, 1.0 - (min_dist / radius)), 2)
        is_blocked = debris_severity > 0.5

        props = dict(r["properties"])
        props["debris_severity"] = debris_severity
        props["is_blocked"] = is_blocked

        processed_roads.append(GeoJSONFeature(type="Feature", properties=props, geometry=r["geometry"]))

    hazard_index = round((total_risk / max(len(processed_buildings), 1)) * 100, 1)
    return processed_buildings, processed_roads, hazard_index