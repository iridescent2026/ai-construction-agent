"""Start three APIs and the frontend; Ctrl+C stops only these child processes."""
from pathlib import Path
import socket
import subprocess
import sys
import time
import os

ROOT = Path(__file__).resolve().parent


def main():
    offset = int(os.getenv('DEMO_PORT_OFFSET', '0'))
    gis_port, electrical_port, agent_port, web_port = [p + offset for p in (8000,8001,8002,8080)]
    for port in (gis_port, electrical_port, agent_port, web_port):
        with socket.socket() as sock:
            try:
                sock.bind(('127.0.0.1', port))
            except OSError:
                raise SystemExit(f'Port {port} is in use. Stop the existing service before starting the demo.')
    commands = [
        ['-m', 'uvicorn', 'gis.main:app', '--host', '127.0.0.1', '--port', str(gis_port)],
        ['-m', 'uvicorn', 'electrical.main:app', '--host', '127.0.0.1', '--port', str(electrical_port)],
        ['-m', 'uvicorn', 'main:app', '--app-dir', str(ROOT/'math'), '--host', '127.0.0.1', '--port', str(agent_port)],
        ['serve_frontend.py', str(web_port), str(gis_port), str(electrical_port), str(agent_port)],
    ]
    env = {**os.environ, 'GIS_API':f'http://127.0.0.1:{gis_port}', 'ELEC_API':f'http://127.0.0.1:{electrical_port}', 'ALLOWED_ORIGINS':f'http://127.0.0.1:{web_port},http://localhost:{web_port}'}
    env.setdefault('FACTORY_ANALYSIS_DEMO','1')
    children = []
    try:
        for command in commands:
            children.append(subprocess.Popen([sys.executable, *command], cwd=ROOT, env=env))
        print(f'Demo: http://127.0.0.1:{web_port} | Ctrl+C to stop.', flush=True)
        while all(child.poll() is None for child in children):
            time.sleep(0.5)
        raise SystemExit('A service exited. Check its error above.')
    except KeyboardInterrupt:
        pass
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == '__main__':
    main()
