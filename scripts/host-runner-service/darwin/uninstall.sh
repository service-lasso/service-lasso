#!/bin/sh
set -eu
test "$(id -u)" = 0 || { echo 'must run as root' >&2; exit 64; }
plist=/Library/LaunchDaemons/com.service-lasso.host-runner.plist; base=/usr/local/libexec/service-lasso; label=system/com.service-lasso.host-runner
test ! -L "$plist" && test ! -L "$base" && test ! -L "$base/service-lasso-host-runner" || exit 65
if launchctl print "$label" >/dev/null 2>&1; then launchctl bootout "$label" || exit 66; launchctl print "$label" >/dev/null 2>&1 && exit 66; fi
test ! -e "$plist" || rm -f "$plist" || exit 67
test ! -e "$base/service-lasso-host-runner" || rm -f "$base/service-lasso-host-runner" || exit 68
rmdir "$base" 2>/dev/null || true
echo 'unloaded and removed program files; state remains at /var/db/service-lasso/host-runner for owner receipt retention.'
