import httpx
from typing import List, Dict, Any, Tuple

OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

async def fetch_overpass_elements(latitude: float, longitude: float, radius: int) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    query = f"""
    [out:json][timeout:20];
    (
      way(around:{radius},{latitude},{longitude})["building"];
      way(around:{radius},{latitude},{longitude})["highway"];
    );
    out tags geom;
    """
    
    raw_elements = []
    async with httpx.AsyncClient(timeout=25.0) as client:
        for server in OVERPASS_SERVERS:
            try:
                res = await client.post(server, data={"data": query})
                if res.status_code == 200:
                    raw_elements = res.json().get("elements", [])
                    break
            except Exception:
                continue

    buildings = []
    roads = []

    for way in raw_elements:
        geom = way.get("geometry", [])
        if len(geom) < 2:
            continue
            
        tags = way.get("tags", {})
        
        if "building" in tags and len(geom) >= 3:
            coords = [[pt["lon"], pt["lat"]] for pt in geom]
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            buildings.append({
                "type": "Feature",
                "properties": {
                    "id": way["id"],
                    "name": tags.get("name"),
                    "type": tags.get("building", "unknown"),
                    "levels": int(tags["building:levels"]) if tags.get("building:levels", "").isdigit() else None
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [coords]
                }
            })
            
        elif "highway" in tags:
            roads.append({
                "type": "Feature",
                "properties": {
                    "id": way["id"],
                    "name": tags.get("name"),
                    "type": tags.get("highway", "unknown"),
                    "levels": None
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[pt["lon"], pt["lat"]] for pt in geom]
                }
            })

    return buildings, roads