#!/usr/bin/env bash
# Local dev server. Prints the LAN URL so you can open it on the phone.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-8080}"
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '127.0.0.1')"

echo "  Mac:    http://localhost:${PORT}"
echo "  iPhone: http://${IP}:${PORT}"
echo
echo "  Note: clipboard buttons need a secure context, so Copy/Ask Claude only"
echo "        work on localhost or the deployed HTTPS URL — not over LAN IP."
echo
exec python3 -m http.server "${PORT}" --bind 0.0.0.0
