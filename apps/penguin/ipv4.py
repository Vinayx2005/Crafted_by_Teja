"""Use IPv4 only for every network connection Penguin makes. On this network the IPv6 addresses Google resolves to are unreachable: Python tried each one in turn
(each timing out), so the first Gemini / voice call after a quiet spell took 60-160 s. `import ipv4` once, before any network use; it is process-wide."""
import socket

_real = socket.getaddrinfo
socket.getaddrinfo = lambda *a, **k: [r for r in _real(*a, **k) if r[0] == socket.AF_INET] or _real(*a, **k)       # ponytail: on an IPv6-only network this still falls back to everything
