#!/usr/bin/env bash
set -euo pipefail

# A missing optional search binary must never produce a clean result.
script_directory=$(cd -- "${BASH_SOURCE[0]%/*}" && pwd)
exec node "$script_directory/scan-public.mjs" "${1:-.}"
