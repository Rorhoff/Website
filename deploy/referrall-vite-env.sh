#!/usr/bin/env bash
# referrall-vite-env.sh — export VITE_* vars from an env file for Referr-All SPA builds.
#
# Usage:
#   source deploy/referrall-vite-env.sh
#   referrall_export_vite_build_env /home/ubuntu/website-referrall/.env.referrall

referrall_export_vite_build_env() {
  local env_file="${1:-}"
  [[ -n "$env_file" && -f "$env_file" ]] || return 0
  local line key val
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" ]] && continue
    [[ "$line" == export* ]] && line="${line#export }"
    key="${line%%=*}"
    key="${key%"${key##*[![:space:]]}"}"
    [[ "$key" == VITE_* ]] || continue
    val="${line#*=}"
    val="${val#"${val%%[![:space:]]*}"}"
    val="${val%${val##*[![:space:]]}}"
    val="${val#\"}"
    val="${val%\"}"
    val="${val#\'}"
    val="${val%\'}"
    export "$key=$val"
  done < "$env_file"
}
