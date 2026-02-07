#!/bin/sh
set -e

echo "Builder entrypoint: configuring isolation..."

# --- 1. iptables: Drop all FORWARD from buildkit0 ---
# buildkit0 does not exist yet, but the rules take effect once the interface is created
iptables -A FORWARD -i buildkit0 -j DROP
ip6tables -A FORWARD -i buildkit0 -j DROP
echo "iptables: FORWARD from buildkit0 blocked (IPv4/IPv6)"

# --- 1b. Block direct access to buildkitd API from buildkit0 ---
iptables -A INPUT -i buildkit0 -p tcp --dport 1234 -j DROP
ip6tables -A INPUT -i buildkit0 -p tcp --dport 1234 -j DROP
echo "iptables: INPUT to buildkitd API from buildkit0 blocked (IPv4/IPv6)"

# --- 2. dnsmasq: Start in background ---
dnsmasq --conf-file=/etc/dnsmasq.conf
echo "dnsmasq: started"

# --- 3. nginx: Generate config and start ---

# Set default values
PROXY_MODE=${PROXY_MODE:-"restrict"}
ALLOWED_HTTP_DOMAINS=${ALLOWED_HTTP_DOMAINS:-""}
ALLOWED_HTTPS_DOMAINS=${ALLOWED_HTTPS_DOMAINS:-""}
HTTP_PORTS=${HTTP_PORTS:-"80"}
HTTPS_PORTS=${HTTPS_PORTS:-"443"}
EXTERNAL_RESOLVER=${EXTERNAL_RESOLVER:-"1.1.1.1 8.8.8.8 valid=300s"}

echo "Proxy mode: $PROXY_MODE"
echo "Allowed HTTP domains: $ALLOWED_HTTP_DOMAINS"
echo "Allowed HTTPS domains: $ALLOWED_HTTPS_DOMAINS"
echo "HTTP ports: $HTTP_PORTS"
echo "HTTPS ports: $HTTPS_PORTS"
echo "Resolver: $EXTERNAL_RESOLVER"

# Generate listen directives
NGINX_HTTPS_LISTEN=""
for port in $(echo "$HTTPS_PORTS" | tr ',' ' '); do
    port=$(echo "$port" | xargs)
    if [ -n "$port" ]; then
        NGINX_HTTPS_LISTEN="${NGINX_HTTPS_LISTEN}        listen $port;
"
    fi
done

NGINX_HTTP_LISTEN=""
NGINX_HTTP_LISTEN_DEFAULT=""
first_http_port=1
for port in $(echo "$HTTP_PORTS" | tr ',' ' '); do
    port=$(echo "$port" | xargs)
    if [ -n "$port" ]; then
        if [ $first_http_port -eq 1 ]; then
            NGINX_HTTP_LISTEN_DEFAULT="${NGINX_HTTP_LISTEN_DEFAULT}        listen $port default_server;
"
            first_http_port=0
        else
            NGINX_HTTP_LISTEN_DEFAULT="${NGINX_HTTP_LISTEN_DEFAULT}        listen $port;
"
        fi
        NGINX_HTTP_LISTEN="${NGINX_HTTP_LISTEN}        listen $port;
"
    fi
done

# Generate allowed domain maps
NGINX_HTTPS_ALLOWED_MAP=""
NGINX_HTTP_ALLOWED_MAP=""

if [ "$PROXY_MODE" = "audit" ]; then
    echo "Configuring audit mode (all connections allowed, logged only)..."
    NGINX_HTTPS_DEFAULT_ALLOWED="1"
    NGINX_HTTP_DEFAULT_ALLOWED="1"
else
    echo "Configuring restrict mode (only allowed domains)..."
    echo "Generating allowed HTTPS domain map..."
    for domain in $(echo "$ALLOWED_HTTPS_DOMAINS" | tr ',' ' '); do
        domain=$(echo "$domain" | xargs)
        if [ -n "$domain" ]; then
            echo "  Adding HTTPS domain: $domain"
            NGINX_HTTPS_ALLOWED_MAP="${NGINX_HTTPS_ALLOWED_MAP}        $domain 1;
"
        fi
    done
    echo "Generating allowed HTTP domain map..."
    for domain in $(echo "$ALLOWED_HTTP_DOMAINS" | tr ',' ' '); do
        domain=$(echo "$domain" | xargs)
        if [ -n "$domain" ]; then
            echo "  Adding HTTP domain: $domain"
            NGINX_HTTP_ALLOWED_MAP="${NGINX_HTTP_ALLOWED_MAP}        $domain 1;
"
        fi
    done
    NGINX_HTTPS_DEFAULT_ALLOWED="0"
    NGINX_HTTP_DEFAULT_ALLOWED="0"
fi

# Set access decision label
if [ "$PROXY_MODE" = "audit" ]; then
    NGINX_ACCESS_DECISION="AUDIT"
else
    NGINX_ACCESS_DECISION="ALLOWED"
fi

export PROXY_MODE ALLOWED_HTTP_DOMAINS ALLOWED_HTTPS_DOMAINS HTTP_PORTS HTTPS_PORTS
export NGINX_HTTPS_LISTEN NGINX_HTTP_LISTEN NGINX_HTTP_LISTEN_DEFAULT
export NGINX_HTTPS_ALLOWED_MAP NGINX_HTTPS_DEFAULT_ALLOWED
export NGINX_HTTP_ALLOWED_MAP NGINX_HTTP_DEFAULT_ALLOWED
export NGINX_ACCESS_DECISION EXTERNAL_RESOLVER

# Generate config file from nginx.conf.template
echo "Generating nginx.conf from template..."
envsubst '$PROXY_MODE $ALLOWED_HTTP_DOMAINS $ALLOWED_HTTPS_DOMAINS $HTTP_PORTS $HTTPS_PORTS $NGINX_HTTPS_LISTEN $NGINX_HTTP_LISTEN $NGINX_HTTP_LISTEN_DEFAULT $NGINX_HTTPS_ALLOWED_MAP $NGINX_HTTPS_DEFAULT_ALLOWED $NGINX_HTTP_ALLOWED_MAP $NGINX_HTTP_DEFAULT_ALLOWED $NGINX_ACCESS_DECISION $EXTERNAL_RESOLVER' \
  < /etc/nginx/nginx.conf.template \
  > /etc/nginx/nginx.conf

nginx
echo "nginx: started"

# --- 4. buildkitd: Start as PID 1 ---
echo "Starting buildkitd..."
exec buildkitd --oci-worker-net=cni --addr tcp://0.0.0.0:1234 "$@"
