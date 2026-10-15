"""Optional Windows-user encrypted settings for the local preview only."""
import ctypes
import json
import os
from pathlib import Path


def local_model_settings():
    if os.name != 'nt':
        return {}
    path = Path(__file__).resolve().parents[1] / '.local' / 'aliyun-model.dpapi'
    if not path.is_file():
        return {}
    # DPAPI binds the encrypted blob to this Windows account. No key is served
    # by the frontend, checked into Git, or included in diagnostics.
    class Blob(ctypes.Structure):
        _fields_ = [('size', ctypes.c_ulong), ('data', ctypes.POINTER(ctypes.c_ubyte))]
    output = Blob()
    try:
        raw = path.read_bytes()
        buffer = (ctypes.c_ubyte * len(raw)).from_buffer_copy(raw)
        source = Blob(len(raw), buffer)
        decrypt = ctypes.windll.crypt32.CryptUnprotectData
        decrypt.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
                            ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(Blob)]
        decrypt.restype = ctypes.c_int
        if not decrypt(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output)):
            return {}
        value = json.loads(ctypes.string_at(output.data, output.size).decode('utf-8'))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError, UnicodeError):
        return {}
    finally:
        if output.data:
            ctypes.windll.kernel32.LocalFree.argtypes = [ctypes.c_void_p]
            ctypes.windll.kernel32.LocalFree(output.data)
