#!/usr/bin/env bash
set -euo pipefail

root="${1:-.}"
status=0

dangerous_files=$(find "$root" \
  -path '*/.git' -prune -o \
  -path '*/node_modules' -prune -o \
  -path '*/dist' -prune -o \
  -type f \( \
    -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.key' -o \
    -name 'id_rsa' -o -name '.DS_Store' \
  \) ! -name '.env.example' -print)

if [[ -n "$dangerous_files" ]]; then
  printf 'dangerous files found:\n%s\n' "$dangerous_files"
  status=1
fi

scan() {
  local label="$1"
  local pattern="$2"
  local output
  output=$(rg -n -i --hidden \
    --glob '!.git/**' --glob '!node_modules/**' --glob '!dist/**' --glob '!pnpm-lock.yaml' \
    --glob '!scripts/scan-public.sh' \
    "$pattern" "$root" || true)
  if [[ -n "$output" ]]; then
    printf '%s:\n%s\n' "$label" "$output"
    status=1
  fi
}

scan 'credential-shaped content' \
  '(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|authorization:[[:space:]]*bearer[[:space:]]+[A-Za-z0-9._-]{16,}|api[_-]?key[[:space:]]*[:=][[:space:]]*["'"'][^"'"']{12,}["'"'])'
scan 'local absolute path or private-network literal' \
  '(/Users/[A-Za-z0-9._-]+|/home/[A-Za-z0-9._-]+|https?://[^/[:space:]]+\.(internal|local)(/|[[:space:]]|$)|(^|[^0-9])(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3})([^0-9]|$))'

exit "$status"
