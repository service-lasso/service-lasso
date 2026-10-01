#!/bin/sh
set -eu
test "$(id -u)" = 0 || { echo 'must run as root' >&2; exit 64; }
root=/usr/local/libexec/service-lasso
state=/var/db/service-lasso/host-runner
plist=/Library/LaunchDaemons/com.service-lasso.host-runner.plist
src=${1:?usage: install.sh /absolute/path/to/reviewed/service-lasso-host-runner}
case "$src" in /*) ;; *) exit 64;; esac
test -f "$src" && test ! -L "$src" || exit 65
install -d -o root -g wheel -m 0700 "$root" "$state"
install -o root -g wheel -m 0500 "$src" "$root/service-lasso-host-runner"
install -o root -g wheel -m 0644 "$(dirname "$0")/com.service-lasso.host-runner.plist.in" "$plist"
launchctl bootstrap system "$plist"
launchctl kickstart -k system/com.service-lasso.host-runner
echo "installed; retain launchctl print system/com.service-lasso.host-runner output with the private receipt"
