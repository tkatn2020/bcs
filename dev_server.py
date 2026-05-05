# Dev server that serves static files with Cache-Control: no-store.
# Prevents stale-cache issues when iterating on JS/CSS during development.
# Listens on both IPv4 (0.0.0.0) and IPv6 (::) so localhost works regardless
# of which protocol the OS resolves first.
import http.server
import socket
import socketserver
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


class DualStackHTTPServer(socketserver.TCPServer):
    address_family = socket.AF_INET6
    allow_reuse_address = True

    def server_bind(self):
        # Disable IPV6_V6ONLY so the same socket also accepts IPv4 (mapped).
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    with DualStackHTTPServer(('', port), NoCacheHandler) as httpd:
        print(f'Dev server (no-cache, dual-stack) running on http://localhost:{port}')
        httpd.serve_forever()
