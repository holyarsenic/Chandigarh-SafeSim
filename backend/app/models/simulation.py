from datetime import datetime
from sqlalchemy import Column, Integer, Float, DateTime, JSON
from app.core.database import Base

class SimulationRecord(Base):
    __tablename__ = "simulations"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    radius = Column(Integer, nullable=False)
    hazard_index = Column(Float, nullable=False, default=0.0)
    total_buildings = Column(Integer, default=0)
    collapsed_buildings_count = Column(Integer, default=0)
    blocked_roads_count = Column(Integer, default=0)
    geojson_payload = Column(JSON, nullable=False)
    ai_incident_brief = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)