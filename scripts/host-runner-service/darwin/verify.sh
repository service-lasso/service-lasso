#!/bin/sh
set -eu
test "$(id -u)" = 0 || { echo 'must run as root' >&2; exit 64; }
state=/var/db/service-lasso/host-runner; test "${1:-}" = '--state-dir' && { state=${2:?missing state dir}; shift 2; }; test "$#" = 0 || exit 64
test "$state" = /var/db/service-lasso/host-runner || { echo 'state dir must be canonical owner path' >&2; exit 65; }
plist=/Library/LaunchDaemons/com.service-lasso.host-runner.plist; base=/usr/local/libexec/service-lasso
test "$(stat -f '%u:%g:%Lp' "$plist")" = '0:0:644'; test "$(stat -f '%u:%g:%Lp' "$base")" = '0:0:700'; test "$(stat -f '%u:%g:%Lp' "$state")" = '0:0:700'; test "$(stat -f '%u:%g:%Lp' "$state/jobs")" = '0:0:700'; test "$(stat -f '%u:%g:%Lp' "$base/service-lasso-host-runner")" = '0:0:500'
codesign --verify --strict --deep "$base/service-lasso-host-runner"; launchctl print system/com.service-lasso.host-runner >/dev/null; test -f "$state/private-receipt.log" && test "$(stat -f '%u:%g:%Lp' "$state/private-receipt.log")" = '0:0:600'; grep -q '^event=daemon-ready accepted=1 ' "$state/private-receipt.log"
echo 'host service readback passed; private receipt remains owner-only.'
