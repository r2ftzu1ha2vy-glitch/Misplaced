#!/usr/bin/env python3
"""Tiny static server. Browsers refuse to load ES modules / GLB files from file://, so run this."""
import argparse, http.server, os, socketserver, sys

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript',
                      '.glb': 'model/gltf-binary', '.json': 'application/json'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

def main():
    ap = argparse.ArgumentParser(description='Serve the game folder.')
    ap.add_argument('--port', type=int, default=8080)
    ap.add_argument('--host', default='127.0.0.1')
    a = ap.parse_args()
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.TCPServer.allow_reuse_address = True
    try:
        with socketserver.ThreadingTCPServer((a.host, a.port), Handler) as srv:
            print(f'Serving on http://{a.host}:{a.port}  (Ctrl+C to stop)')
            srv.serve_forever()
    except OSError as e:
        print(f'Could not bind {a.host}:{a.port}: {e}', file=sys.stderr); sys.exit(1)
    except KeyboardInterrupt:
        print('\nStopped.')

if __name__ == '__main__':
    main()
