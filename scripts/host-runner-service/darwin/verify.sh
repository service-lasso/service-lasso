#!/bin/sh
set -eu
test "$(id -u)" = 0 || { echo 'must run as root' >&2; exit 64; }
plist=/Library/LaunchDaemons/com.service-lasso.host-runner.plist
test "$(stat -f '%u:%g:%Lp' "$plist")" = '0:0:644'
test "$(stat -f '%u:%g:%Lp' /usr/local/libexec/service-lasso)" = '0:0:700'
test "$(stat -f '%u:%g:%Lp' /var/db/service-lasso/host-runner)" = '0:0:700'
test "$(stat -f '%u:%g:%Lp' /usr/local/libexec/service-lasso/service-lasso-host-runner)" = '0:0:500'
launchctl print system/com.service-lasso.host-runner
echo 'Owner must separately inspect the private receipt: primary audit token, PID/birth/parent/code identity, held FDs, expiry and close revocation.'
