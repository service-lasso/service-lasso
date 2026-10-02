#!/bin/sh
set -eu
test "$(id -u)" = 0 || { echo 'must run as root' >&2; exit 64; }
base=/usr/local/libexec/service-lasso; state=/var/db/service-lasso/host-runner
plist=/Library/LaunchDaemons/com.service-lasso.host-runner.plist; label=system/com.service-lasso.host-runner
src=${1:?usage: install.sh /absolute/path/to/owner-built/service-lasso-host-runner /absolute/path/to/service-lasso-host-runner.sha256}; manifest=${2:?missing sha256 manifest}
case "$src:$manifest" in /*:/*) ;; *) exit 64;; esac
safe_node() { test ! -L "$1" || { echo "link denied: $1" >&2; exit 69; }; }
safe_ancestors() { p=$1; while test "$p" != /; do safe_node "$p"; test ! -e "$p" || test "$(stat -f '%u:%Lp' "$p")" = '0:700' || test "$(stat -f '%u:%Lp' "$p")" = '0:755' || { echo "unsafe ancestor: $p" >&2; exit 69; }; p=$(dirname "$p"); done; }
safe_node "$src"; safe_node "$manifest"; safe_node "$plist"; safe_ancestors "$base"; safe_ancestors "$state"
test -f "$src" && test -f "$manifest" || exit 65
test "$(stat -f '%u:%g:%Lp' "$src")" = '0:0:500' && test "$(stat -f '%u:%g:%Lp' "$manifest")" = '0:0:600' || exit 66
expected=$(awk 'NF == 2 { print $1 }' "$manifest"); test "$(printf '%s' "$expected" | wc -c | tr -d ' ')" = 64 || exit 67
actual=$(shasum -a 256 "$src" | awk '{print $1}'); test "$actual" = "$expected" || exit 68; codesign --verify --strict --deep "$src"
install -d -o root -g wheel -m 0700 "$base" "$state"
stage=$(mktemp "$base/.host-runner.new.XXXXXX"); old_binary="$base/.host-runner.previous"; old_plist="$base/.host-runner.previous.plist"
had_binary=0; had_plist=0; was_loaded=0
cleanup() { rm -f "$stage"; }
rollback() { launchctl bootout "$label" >/dev/null 2>&1 || true; rm -f "$plist" "$base/service-lasso-host-runner"; test "$had_binary" = 0 || mv "$old_binary" "$base/service-lasso-host-runner"; test "$had_plist" = 0 || mv "$old_plist" "$plist"; if test "$was_loaded" = 1 && test -f "$plist"; then launchctl bootstrap system "$plist" >/dev/null 2>&1 || true; fi; cleanup; exit 71; }
trap 'cleanup' EXIT HUP INT TERM
install -o root -g wheel -m 0500 "$src" "$stage"; test "$(shasum -a 256 "$stage" | awk '{print $1}')" = "$expected" || rollback; codesign --verify --strict --deep "$stage" || rollback
if test -f "$base/service-lasso-host-runner"; then test "$(stat -f '%u:%g:%Lp' "$base/service-lasso-host-runner")" = '0:0:500' || exit 69; cp -p "$base/service-lasso-host-runner" "$old_binary"; had_binary=1; fi
if test -f "$plist"; then test "$(stat -f '%u:%g:%Lp' "$plist")" = '0:0:644' || exit 69; cp -p "$plist" "$old_plist"; had_plist=1; fi
if launchctl print "$label" >/dev/null 2>&1; then was_loaded=1; launchctl bootout "$label" || rollback; fi
mv "$stage" "$base/service-lasso-host-runner" || rollback
install -o root -g wheel -m 0644 "$(dirname "$0")/com.service-lasso.host-runner.plist.in" "$plist" || rollback
launchctl bootstrap system "$plist" && launchctl kickstart -k "$label" && launchctl print "$label" >/dev/null || rollback
rm -f "$old_binary" "$old_plist"; trap - EXIT HUP INT TERM
echo "installed checksum=$actual; retain private receipt separately"
