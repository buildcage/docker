#!/bin/sh
set -e

echo "Builder entrypoint: configuring isolation..."

# --- 1. iptables: REDIRECT for all TCP from buildkit0 ---
# buildkit0 does not exist yet, but the rules take effect once the interface is created

# All TCP from buildkit0: REDIRECT → haproxy:10024
iptables -t nat -A PREROUTING -i buildkit0 -p tcp \
  -j REDIRECT --to-ports 10024

# Drop all FORWARD from buildkit0 (blocks non-TCP: UDP/ICMP)
iptables -A FORWARD -i buildkit0 -j DROP
ip6tables -A FORWARD -i buildkit0 -j DROP
echo "iptables: REDIRECT configured, FORWARD from buildkit0 blocked (IPv4/IPv6)"

# Block direct access to buildkitd API from buildkit0
iptables -A INPUT -i buildkit0 -p tcp --dport 1234 -j DROP
ip6tables -A INPUT -i buildkit0 -p tcp --dport 1234 -j DROP
echo "iptables: INPUT to buildkitd API from buildkit0 blocked (IPv4/IPv6)"

# --- 2. dnsmasq: Start in background ---
dnsmasq --conf-file=/etc/dnsmasq.conf
echo "dnsmasq: started"

# --- 3. haproxy: Generate config and start ---

# Set default values
PROXY_MODE=${PROXY_MODE:-"restrict"}
ALLOWED_HTTPS_RULES=${ALLOWED_HTTPS_RULES:-""}
ALLOWED_HTTP_RULES=${ALLOWED_HTTP_RULES:-""}
ALLOWED_IP_RULES=${ALLOWED_IP_RULES:-""}
EXTERNAL_RESOLVER=${EXTERNAL_RESOLVER:-"1.1.1.1,8.8.8.8"}

echo "Proxy mode: $PROXY_MODE"
echo "Allowed HTTPS rules: $ALLOWED_HTTPS_RULES"
echo "Allowed HTTP rules: $ALLOWED_HTTP_RULES"
echo "Allowed IP rules: $ALLOWED_IP_RULES"
echo "Resolver: $EXTERNAL_RESOLVER"

# Generate lst files
mkdir -p /etc/haproxy/rules
if [ "$PROXY_MODE" = "audit" ]; then
    echo "Configuring audit mode (all connections allowed, logged only)..."
    echo ".*" > /etc/haproxy/rules/allowed_https.lst
    echo ".*" > /etc/haproxy/rules/allowed_http.lst
    echo ".*" > /etc/haproxy/rules/allowed_ips.lst
else
    echo "Configuring restrict mode (only allowed rules)..."
    # Convert comma-separated rules to newline-separated lst files
    if [ -n "$ALLOWED_HTTPS_RULES" ]; then
        echo "$ALLOWED_HTTPS_RULES" | tr ',' '\n' > /etc/haproxy/rules/allowed_https.lst
    else
        : > /etc/haproxy/rules/allowed_https.lst
    fi
    if [ -n "$ALLOWED_HTTP_RULES" ]; then
        echo "$ALLOWED_HTTP_RULES" | tr ',' '\n' > /etc/haproxy/rules/allowed_http.lst
    else
        : > /etc/haproxy/rules/allowed_http.lst
    fi
    if [ -n "$ALLOWED_IP_RULES" ]; then
        echo "$ALLOWED_IP_RULES" | tr ',' '\n' > /etc/haproxy/rules/allowed_ips.lst
    else
        : > /etc/haproxy/rules/allowed_ips.lst
    fi
fi

# Generate nameserver lines from EXTERNAL_RESOLVER (comma-separated IPs)
HAPROXY_NAMESERVERS=""
RESOLVER_IDX=1
IFS=','
for ip in $EXTERNAL_RESOLVER; do
    HAPROXY_NAMESERVERS="${HAPROXY_NAMESERVERS}
    nameserver ns${RESOLVER_IDX} ${ip}:53"
    RESOLVER_IDX=$((RESOLVER_IDX + 1))
done
unset IFS

# Set decision label and audit accept
if [ "$PROXY_MODE" = "audit" ]; then
    HAPROXY_DECISION_LABEL="AUDIT"
    HAPROXY_AUDIT_ACCEPT="tcp-request content accept if !is_dns_routed !is_ip_match"
else
    HAPROXY_DECISION_LABEL="ALLOWED"
    HAPROXY_AUDIT_ACCEPT=""
fi

export HAPROXY_NAMESERVERS HAPROXY_DECISION_LABEL HAPROXY_AUDIT_ACCEPT

# Generate config file from template
echo "Generating haproxy.cfg from template..."
envsubst '${HAPROXY_NAMESERVERS} ${HAPROXY_DECISION_LABEL} ${HAPROXY_AUDIT_ACCEPT}' \
  < /etc/haproxy/haproxy.cfg.template \
  > /etc/haproxy/haproxy.cfg

haproxy -f /etc/haproxy/haproxy.cfg &
echo "haproxy: started"

# --- 4. buildkitd: Start as PID 1 ---
echo "Starting buildkitd..."
exec buildkitd --oci-worker-net=cni --addr tcp://0.0.0.0:1234 "$@"
