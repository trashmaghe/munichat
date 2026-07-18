#!/bin/sh
# Generate the runtime config the SPA reads (window.__ELYZIAN__), so one
# prebuilt image serves any deployment. nginx runs everything in
# /docker-entrypoint.d/ before starting; this drops in as one of those steps.
set -e
cat > /usr/share/nginx/html/config.js <<CONFIG
window.__ELYZIAN__ = { apiUrl: "${VITE_API_URL:-}", wsUrl: "${VITE_WS_URL:-}" };
CONFIG
echo "elyzian: wrote /config.js (apiUrl=${VITE_API_URL:-<empty>})"
