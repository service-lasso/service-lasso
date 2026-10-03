#!/bin/sh
set -eu
test "$(id -u)" = 0 || { echo 'must run as root' >&2; exit 64; }
base=/usr/local/libexec/service-lasso; state=/var/db/service-lasso/host-runner
plist=/Library/LaunchDaemons/com.service-lasso.host-runner.plist; label=system/com.service-lasso.host-runner
src=${1:?usage: install.sh daemon daemon.sha256 client client.sha256}; manifest=${2:?missing daemon sha256 manifest}; client=${3:?missing owner-built client}; client_manifest=${4:?missing client sha256 manifest}
case "$src:$manifest:$client:$client_manifest" in /*:/*:/*:/*) ;; *) exit 64;; esac
safe_node() { test ! -L "$1" || { echo "link denied: $1" >&2; exit 69; }; }
safe_ancestors() { p=$1; while test "$p" != /; do safe_node "$p"; test ! -e "$p" || test "$(stat -f '%u:%Lp' "$p")" = '0:700' || test "$(stat -f '%u:%Lp' "$p")" = '0:755' || { echo "unsafe ancestor: $p" >&2; exit 69; }; p=$(dirname "$p"); done; }
safe_node "$src"; safe_node "$manifest"; safe_node "$client"; safe_node "$client_manifest"; safe_node "$plist"; safe_ancestors "$base"; safe_ancestors "$state"
test -f "$src" && test -f "$manifest" && test -f "$client" && test -f "$client_manifest" || exit 65
test "$(stat -f '%u:%g:%Lp' "$src")" = '0:0:500' && test "$(stat -f '%u:%g:%Lp' "$manifest")" = '0:0:600' && test "$(stat -f '%u:%g:%Lp' "$client")" = '0:0:500' && test "$(stat -f '%u:%g:%Lp' "$client_manifest")" = '0:0:600' || exit 66
expected=$(awk 'NF == 2 { print $1 }' "$manifest"); test "$(printf '%s' "$expected" | wc -c | tr -d ' ')" = 64 || exit 67
actual=$(shasum -a 256 "$src" | awk '{print $1}'); test "$actual" = "$expected" || exit 68; codesign --verify --strict --deep "$src"
client_expected=$(awk 'NF == 2 { print $1 }' "$client_manifest"); test "$(printf '%s' "$client_expected" | wc -c | tr -d ' ')" = 64 || exit 67
client_actual=$(shasum -a 256 "$client" | awk '{print $1}'); test "$client_actual" = "$client_expected" || exit 68; codesign --verify --strict --deep "$client"
install -d -o root -g wheel -m 0700 "$base" "$state" "$state/jobs"
stage=$(mktemp "$base/.host-runner.new.XXXXXX"); client_stage=$(mktemp "$base/.host-runner-client.new.XXXXXX"); requirement_stage=$(mktemp "$state/.client-requirement.new.XXXXXX"); old_binary="$base/.host-runner.previous"; old_client="$base/.host-runner-client.previous"; old_requirement="$state/.client-requirement.previous"; old_plist="$base/.host-runner.previous.plist"
had_binary=0; had_client=0; had_requirement=0; had_plist=0; was_loaded=0
cleanup() { rm -f "$stage" "$client_stage" "$requirement_stage"; }
rollback() { launchctl bootout "$label" >/dev/null 2>&1 || true; rm -f "$plist" "$base/service-lasso-host-runner" "$base/service-lasso-host-runner-client" "$state/client-requirement"; test "$had_binary" = 0 || mv "$old_binary" "$base/service-lasso-host-runner"; test "$had_client" = 0 || mv "$old_client" "$base/service-lasso-host-runner-client"; test "$had_requirement" = 0 || mv "$old_requirement" "$state/client-requirement"; test "$had_plist" = 0 || mv "$old_plist" "$plist"; if test "$was_loaded" = 1 && test -f "$plist"; then launchctl bootstrap system "$plist" >/dev/null 2>&1 || true; fi; cleanup; exit 71; }
trap 'cleanup' EXIT HUP INT TERM
install -o root -g wheel -m 0500 "$src" "$stage"; install -o root -g wheel -m 0500 "$client" "$client_stage"; test "$(shasum -a 256 "$stage" | awk '{print $1}')" = "$expected" && test "$(shasum -a 256 "$client_stage" | awk '{print $1}')" = "$client_expected" || rollback; codesign --verify --strict --deep "$stage" && codesign --verify --strict --deep "$client_stage" || rollback
codesign -dr - "$client_stage" 2>&1 | sed -n 's/^designated => //p' > "$requirement_stage"; test -s "$requirement_stage" && test "$(wc -l < "$requirement_stage" | tr -d ' ')" = 1 || rollback; chmod 0600 "$requirement_stage"
if test -f "$base/service-lasso-host-runner"; then test "$(stat -f '%u:%g:%Lp' "$base/service-lasso-host-runner")" = '0:0:500' || exit 69; cp -p "$base/service-lasso-host-runner" "$old_binary"; had_binary=1; fi
if test -f "$base/service-lasso-host-runner-client"; then test "$(stat -f '%u:%g:%Lp' "$base/service-lasso-host-runner-client")" = '0:0:500' || exit 69; cp -p "$base/service-lasso-host-runner-client" "$old_client"; had_client=1; fi
if test -f "$state/client-requirement"; then test "$(stat -f '%u:%g:%Lp' "$state/client-requirement")" = '0:0:600' || exit 69; cp -p "$state/client-requirement" "$old_requirement"; had_requirement=1; fi
if test -f "$plist"; then test "$(stat -f '%u:%g:%Lp' "$plist")" = '0:0:644' || exit 69; cp -p "$plist" "$old_plist"; had_plist=1; fi
if launchctl print "$label" >/dev/null 2>&1; then was_loaded=1; launchctl bootout "$label" || rollback; fi
mv "$stage" "$base/service-lasso-host-runner" || rollback
mv "$client_stage" "$base/service-lasso-host-runner-client" || rollback
mv "$requirement_stage" "$state/client-requirement" || rollback
install -o root -g wheel -m 0644 "$(dirname "$0")/com.service-lasso.host-runner.plist.in" "$plist" || rollback
launchctl bootstrap system "$plist" && launchctl kickstart -k "$label" && launchctl print "$label" >/dev/null || rollback
rm -f "$old_binary" "$old_client" "$old_requirement" "$old_plist"; trap - EXIT HUP INT TERM
echo "installed checksum=$actual; retain private receipt separately"
