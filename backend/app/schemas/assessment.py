from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Dict, Any

class AssessmentRequest(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    radius: int = Field(..., description="Allowed radii: 75, 150, 250")

class GeoJSONFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    properties: Dict[str, Any]
    geometry: Dict[str, Any]

class AICommandAction(BaseModel):
    priority: Literal["URGENT", "HIGH", "MODERATE"]
    directive: str
    target_zone: str

class AIIncidentBrief(BaseModel):
    threat_summary: str
    evacuation_routes: List[str]
    critical_vulnerabilities: List[str]
    action_items: List[AICommandAction]

class AssessmentResponse(BaseModel):
    success: bool
    data: Dict[str, Any]
    simulation_id: int
    overall_hazard_index: float
    ai_brief: Optional[AIIncidentBrief] = None