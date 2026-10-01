#!/bin/sh
set -eu
test "$(id -u)" = 0 || { echo 'must run as root' >&2; exit 64; }
plist=/Library/LaunchDaemons/com.service-lasso.host-runner.plist
launchctl bootout system/com.service-lasso.host-runner 2>/dev/null || true
rm -f "$plist" /usr/local/libexec/service-lasso/service-lasso-host-runner
rmdir /usr/local/libexec/service-lasso 2>/dev/null || true
echo 'state was intentionally retained at /var/db/service-lasso/host-runner for owner review; remove only after receipt retention.'
