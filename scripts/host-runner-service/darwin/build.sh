#!/bin/sh
set -eu
test "$(uname -s)" = Darwin || { echo 'Darwin only' >&2; exit 64; }
out=${1:?usage: build.sh /absolute/output/service-lasso-host-runner}
case "$out" in /*) ;; *) exit 64;; esac
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
xcrun clang -Wall -Wextra -Werror -fblocks -O2 "$root/service-lasso-host-runner.c" -o "$out" -framework Security -framework CoreFoundation -framework libproc
xcrun clang -Wall -Wextra -Werror -fblocks -O2 "$root/service-lasso-host-runner-client.c" -o "$out-client" -framework Security -framework CoreFoundation
codesign --force --options runtime --sign "${SERVICE_LASSO_HOST_RUNNER_SIGNING_IDENTITY:?set owner signing identity}" "$out"
codesign --force --options runtime --sign "${SERVICE_LASSO_HOST_RUNNER_SIGNING_IDENTITY:?set owner signing identity}" "$out-client"
shasum -a 256 "$out" | awk '{print $1 "  service-lasso-host-runner"}' > "$out.sha256"
shasum -a 256 "$out-client" | awk '{print $1 "  service-lasso-host-runner-client"}' > "$out-client.sha256"
source_sha=$(shasum -a 256 "$root/service-lasso-host-runner.c" | awk '{print $1}')
binary_sha=$(awk '{print $1}' "$out.sha256")
client_sha=$(shasum -a 256 "$out-client" | awk '{print $1}')
printf '{"protocol":"service-lasso.host-runner.v2","source_sha256":"%s","candidate_sha256":"%s","client_candidate_sha256":"%s","binary":"service-lasso-host-runner","client_binary":"service-lasso-host-runner-client"}\n' "$source_sha" "$binary_sha" "$client_sha" > "$out.provenance.json"
chmod 0500 "$out-client"
chmod 0600 "$out-client.sha256"
chmod 0500 "$out"; chmod 0600 "$out.sha256"
chmod 0600 "$out.provenance.json"
