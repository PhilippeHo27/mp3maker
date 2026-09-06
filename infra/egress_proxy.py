"""Small HTTPS CONNECT proxy. DNS is resolved, validated, and pinned before connect.
Run only on a private Docker network. Never publish port 3128 on the host.
Workers must have no other route to the Internet.
"""
import ipaddress
import re
import select
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def parse_authority(value):
    match = re.fullmatch(r'([a-zA-Z0-9.-]{1,253}):443', value)
    if not match:
        raise ValueError('Only HTTPS destinations on port 443 are allowed')
    return match.group(1), 443


def resolve_public(host, port):
    # IPv4 only: avoid IPv6 transition and mapped-address ambiguity.
    records = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)
    addresses = []
    for record in records:
        address = ipaddress.ip_address(record[4][0])
        if not address.is_global or address.is_multicast or address.is_reserved:
            raise ValueError('Non-public destination denied')
        item = (str(address), port)
        if item not in addresses:
            addresses.append(item)
    if not addresses:
        raise ValueError('No public address')
    return addresses


class Proxy(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, *args):
        # No requested URLs, credentials, or signed queries in logs.
        pass

    def do_CONNECT(self):
        upstream = None
        try:
            host, port = parse_authority(self.path)
            addresses = resolve_public(host, port)
            for address in addresses:
                try:
                    # Connect directly to validated IP; do not resolve host again.
                    upstream = socket.create_connection(address, timeout=15)
                    break
                except OSError:
                    continue
            if upstream is None:
                raise OSError('Destination unavailable')
        except (ValueError, OSError):
            self.send_error(403, 'Destination denied or unavailable')
            self.close_connection = True
            return
        try:
            self.send_response(200, 'Connection established')
            self.end_headers()
            self.wfile.flush()
            deadline = time.monotonic() + 600
            while time.monotonic() < deadline:
                readable, _, _ = select.select([self.connection, upstream], [], [], 30)
                if not readable:
                    break
                for source in readable:
                    data = source.recv(65536)
                    if not data:
                        return
                    target = upstream if source is self.connection else self.connection
                    target.sendall(data)
        except (OSError, TimeoutError):
            pass
        finally:
            upstream.close()
            self.close_connection = True

    def do_GET(self):
        self.send_error(405, 'HTTPS CONNECT required')
        self.close_connection = True

    do_POST = do_GET
    do_PUT = do_GET
    do_DELETE = do_GET


class BoundedServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 32

    def __init__(self, *args, **kwargs):
        self.slots = threading.BoundedSemaphore(32)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


if __name__ == '__main__':
    BoundedServer(('0.0.0.0', 3128), Proxy).serve_forever()
