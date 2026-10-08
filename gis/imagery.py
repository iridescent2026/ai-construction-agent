"""Read current imagery citations at the public demo site, with bounded retries.

Tiles are requested by Leaflet from the official provider; no bulk tile scraping
or redistribution is done here. Only citation JSON is retained.
"""
import copy
import json
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SITE = json.loads((Path(__file__).resolve().parents[1]/'frontend/assets/factory/demo-site.json').read_text(encoding='utf-8'))
_lock=threading.Lock()
_cached=None
_expires=0


def imagery_metadata(refresh=False):
    global _cached,_expires
    with _lock:
        if _cached and not refresh and time.monotonic()<_expires:
            return copy.deepcopy(_cached)
        metadata=copy.deepcopy(SITE['imagery']['metadata'])
        metadata['checkedAt']=datetime.now(timezone.utc).isoformat()
        metadata['status']='live'
        params=urllib.parse.urlencode({'geometry':json.dumps(dict(zip(['x','y'],SITE['center']))),'geometryType':'esriGeometryPoint','inSR':4326,'spatialRel':'esriSpatialRelIntersects','outFields':'*','returnGeometry':'false','f':'json'})
        url=SITE['imagery']['serviceUrl']+'/11/query?'+params
        try:
            request=urllib.request.Request(url,headers={'User-Agent':'FactorySafetyLocalDemo/1.0'})
            with urllib.request.urlopen(request,timeout=5) as response:
                data=json.load(response)
            rows=[f['attributes'] for f in data.get('features',[])]
            if not rows:
                raise ValueError('No imagery citation at this point')
            row=max(rows,key=lambda item:(item.get('DrawOrder',0),item.get('SRC_DATE',0)))
            date=str(row.get('SRC_DATE',''))
            acquired=datetime.strptime(date,'%Y%m%d').date().isoformat() if len(date)==8 else None
            metadata.update(acquired=acquired,sourceResolution=row.get('SRC_RES'),displayResolution=row.get('SAMP_RES'),provider=row.get('NICE_DESC'),sensor=row.get('SRC_DESC'),release=row.get('ReleaseName'),minimumLevel=row.get('MinMapLevel'),maximumLevel=row.get('MaxMapLevel'),sourceUrl=url)
            _expires=time.monotonic()+86400
        except (OSError,ValueError,KeyError):
            metadata['status']='reference'
            metadata['message']='元数据暂不可达，显示此前核实的参考记录；影像加载状态另行显示。'
            _expires=time.monotonic()+60
        _cached=metadata
        return copy.deepcopy(metadata)
