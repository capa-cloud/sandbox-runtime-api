#!/usr/bin/env bash
set -euo pipefail

root="${1:-.}"
status=0
credential_pattern='(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|authorization:[[:space:]]*bearer[[:space:]]+[A-Za-z0-9._-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|sk-(proj-)?[A-Za-z0-9_-]{20,}|api[_-]?key[^[:alnum:]]{0,4}[:=][[:space:]]*[\x22\x27][^\x22\x27]{12,}[\x22\x27])'

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
  output=$(rg -l -i --hidden \
    --glob '!.git/**' --glob '!node_modules/**' --glob '!coverage/**' --glob '!pnpm-lock.yaml' \
    --glob '!scripts/scan-public.sh' \
    "$pattern" "$root" || true)
  if [[ -n "$output" ]]; then
    printf '%s:\n%s\n' "$label" "$output"
    status=1
  fi
}

scan 'credential-shaped content' \
  "$credential_pattern"
scan 'local absolute path or private-network literal' \
  '(/Users/[A-Za-z0-9._-]+|/home/[A-Za-z0-9._-]+|https?://[^/[:space:]]+\.(internal|local)(/|[[:space:]]|$)|(^|[^0-9])(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3})([^0-9]|$))'

if [[ -d "$root/docs/assets" ]]; then
  image_metadata=$(find "$root/docs/assets" -type f \( \
    -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.webp' \
  \) -print0 | xargs -0 strings 2>/dev/null | \
    rg -n -i '(trc_[a-z0-9]{16,}|atomic_[a-z0-9-]{16,}|/Users/[A-Za-z0-9._-]+|/home/[A-Za-z0-9._-]+)' || true)
  if [[ -n "$image_metadata" ]]; then
    printf 'sensitive-shaped image metadata found\n'
    status=1
  fi
fi

if git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  history=$(git -C "$root" log --all -p -- . ':!pnpm-lock.yaml' ':!scripts/scan-public.sh' | \
    rg --count-matches -i "$credential_pattern|/Users/[A-Za-z0-9._-]+|/home/[A-Za-z0-9._-]+|https?://[^/[:space:]]+\.(internal|local)(/|[[:space:]]|$)" || true)
  if [[ -n "$history" ]]; then
    printf 'sensitive-shaped git history content detected: %s matching lines; values withheld\n' "$history"
    status=1
  fi
fi

exit "$status"
