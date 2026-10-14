"""Resolve maintained device names against the current factory catalogue."""
import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path


def normalized(value):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value).casefold())


@lru_cache(maxsize=1)
def aliases():
    return json.loads(Path(__file__).with_name('device-aliases.json').read_text(encoding='utf-8'))


@lru_cache(maxsize=1)
def default_devices():
    return json.loads(Path(__file__).with_name('factory-catalog.json').read_text(encoding='utf-8'))['entities']


def resolve_device_names(query, devices=None):
    """Specific phrases win over substrings; independent mentions stay separate."""
    text=normalized(query)
    devices=[d for d in (default_devices() if devices is None else devices) if d.get('kind')=='device']
    by_id={d['id']:d for d in devices}
    names={}
    for device in devices:
        for value in [device['title'],*aliases().get(device['id'],[])]:
            name=normalized(value)
            if name:
                ids,titles=names.setdefault(name,(set(),set()))
                ids.add(device['id'])
                if name==normalized(device['title']):titles.add(device['id'])
    areas=set(re.findall(r'(?<![a-z0-9])([ab])(?:工区|区|车间)',text))
    if any(v in text for v in ('装配区','装配工区','装配车间')):areas.add('a')
    if any(v in text for v in ('动力区','动力工区','动力车间')):areas.add('b')
    if '室外' in text:areas.add('overview')
    matches=[]
    for name,(ids,titles) in names.items():
        pattern=('(?<![a-z0-9_])' if name[0].isascii() and name[0].isalnum() else '')+re.escape(name)+('(?![a-z0-9_])' if name[-1].isascii() and name[-1].isalnum() else '')
        for match in re.finditer(pattern,text):matches.append((match.start(),match.end(),ids,titles))
    result=set();area_mismatch=False
    for start,end,ids,titles in matches:
        if any(s<=start and end<=e and e-s>end-start for s,e,_,_ in matches):continue
        if len(areas)==1:
            area=next(iter(areas))
            ids={id for id in ids if by_id[id]['view']==area}
            if not ids:area_mismatch=True
        result.update((titles&ids) or ids)
    return result,area_mismatch


def named_devices(query, devices=None):
    return resolve_device_names(query,devices)[0]
