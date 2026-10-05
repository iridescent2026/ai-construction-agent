"""Compatibility entry point; the API and CLI use the same spatial rules."""
from pathlib import Path
import json
try:
    from .spatial import load_zones_from_geojson, check_person_in_danger
except ImportError:
    from spatial import load_zones_from_geojson, check_person_in_danger

if __name__ == "__main__":
    zones = load_zones_from_geojson(Path(__file__).with_name("danger_zones.geojson"))
    print(json.dumps(check_person_in_danger("P001",120.008,30.2945,zones),ensure_ascii=False,indent=2))
