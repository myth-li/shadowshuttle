FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    openvpn curl ca-certificates iproute2 iptables procps python3 \
    build-essential git \
    && git clone --depth 1 https://github.com/rofl0r/microsocks.git /tmp/microsocks \
    && make -C /tmp/microsocks \
    && install -m 755 /tmp/microsocks/microsocks /usr/local/bin/microsocks \
    && rm -rf /tmp/microsocks \
    && apt-get remove -y build-essential git \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY select_node.py /app/select_node.py
COPY vpn-up.sh /app/vpn-up.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /app/vpn-up.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
