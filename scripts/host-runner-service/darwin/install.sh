#!/bin/sh
set -eu
test "$(id -u)" = 0 || { echo 'must run as root' >&2; exit 64; }
base=/usr/local/libexec/service-lasso; state=/var/db/service-lasso/host-runner; plist=/Library/LaunchDaemons/com.service-lasso.host-runner.plist; label=system/com.service-lasso.host-runner
src=${1:?usage: install.sh /absolute/path/to/owner-built/service-lasso-host-runner /absolute/path/to/service-lasso-host-runner.sha256}; manifest=${2:?missing sha256 manifest}
case "$src:$manifest" in /*:/*) ;; *) exit 64;; esac
test -f "$src" && test ! -L "$src" && test -f "$manifest" && test ! -L "$manifest" || exit 65
test "$(stat -f '%u:%g:%Lp' "$src")" = '0:0:500' && test "$(stat -f '%u:%g:%Lp' "$manifest")" = '0:0:600' || exit 66
expected=$(awk 'NF == 2 { print $1 }' "$manifest"); test "$(printf '%s' "$expected" | wc -c | tr -d ' ')" = 64 || exit 67
actual=$(shasum -a 256 "$src" | awk '{print $1}'); test "$actual" = "$expected" || exit 68; codesign --verify --strict --deep "$src"
test ! -L "$base" && test ! -L "$state" && test ! -L "$plist" || exit 69
if test -e "$base"; then test "$(stat -f '%u:%g:%Lp' "$base")" = '0:0:700' || exit 69; fi
if test -e "$state"; then test "$(stat -f '%u:%g:%Lp' "$state")" = '0:0:700' || exit 69; fi
install -d -o root -g wheel -m 0700 "$base" "$state"; stage=$(mktemp "$base/.host-runner.XXXXXX"); backup="$base/service-lasso-host-runner.previous"; trap 'rm -f "$stage"' EXIT HUP INT TERM
install -o root -g wheel -m 0500 "$src" "$stage"; test "$(shasum -a 256 "$stage" | awk '{print $1}')" = "$expected" || exit 70; codesign --verify --strict --deep "$stage"
if launchctl print "$label" >/dev/null 2>&1; then launchctl bootout "$label"; fi
if test -f "$base/service-lasso-host-runner"; then mv "$base/service-lasso-host-runner" "$backup"; fi
mv "$stage" "$base/service-lasso-host-runner"; install -o root -g wheel -m 0644 "$(dirname "$0")/com.service-lasso.host-runner.plist.in" "$plist"
if ! launchctl bootstrap system "$plist" || ! launchctl kickstart -k "$label" || ! launchctl print "$label" >/dev/null; then launchctl bootout "$label" >/dev/null 2>&1 || true; rm -f "$plist" "$base/service-lasso-host-runner"; test ! -f "$backup" || mv "$backup" "$base/service-lasso-host-runner"; exit 71; fi
rm -f "$backup"; trap - EXIT HUP INT TERM; echo "installed checksum=$actual; retain private receipt separately"
