from google import genai
from google.genai import types
from app.core.config import settings
from app.schemas.assessment import AIIncidentBrief

def get_gemini_client():
    if not settings.GEMINI_API_KEY:
        return None
    return genai.Client(api_key=settings.GEMINI_API_KEY)

async def generate_incident_brief(
    lat: float, lon: float, radius: int, 
    hazard_index: float, collapsed_count: int, blocked_roads: list[str]
) -> AIIncidentBrief | None:
    client = get_gemini_client()
    if not client:
        return None

    prompt = f"""
    DISASTER INCIDENT REPORT - CIVIL DEFENSE DIRECTIVE
    Chandigarh Sector Simulation Coordinates: ({lat}, {lon})
    Impact Zone Radius: {radius} meters
    Overall Hazard Index: {hazard_index} / 100
    Total Structural Collapses: {collapsed_count}
    Compromised Road Arterials: {', '.join(blocked_roads[:5]) if blocked_roads else 'None identified'}

    Provide an actionable civil defense disaster briefing with clear directives, evacuation corridors, and identified structural risks.
    """

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=AIIncidentBrief,
                temperature=0.2,
            ),
        )
        return AIIncidentBrief.model_validate_json(response.text)
    except Exception as e:
        print(f"Gemini API warning: {e}")
        return None