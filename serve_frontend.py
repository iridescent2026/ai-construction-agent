"""Local static server with the API ports selected by the demo launcher."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import sys


def main():
    web, gis, electrical, agent = map(int, sys.argv[1:])
    config = {name:f'http://127.0.0.1:{port}' for name,port in [('gis',gis),('electrical',electrical),('agent',agent)]}
    root = Path(__file__).resolve().parent / 'frontend'

    class Handler(SimpleHTTPRequestHandler):
        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()

        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

        def do_GET(self):
            if self.path.split('?')[0] == '/config.js':
                content = ('window.APP_CONFIG = ' + json.dumps(config) + ';').encode()
                self.send_response(200)
                self.send_header('Content-Type','text/javascript; charset=utf-8')
                self.send_header('Content-Length',str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            else:
                super().do_GET()

    with ThreadingHTTPServer(('127.0.0.1',web),Handler) as server:
        server.serve_forever()


if __name__ == '__main__':
    main()
