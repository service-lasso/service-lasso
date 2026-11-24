#!/bin/sh
trap 'exit 0' TERM INT
printf 'started %s\n' "$$" > runtime/fixture-marker.txt
while :; do sleep 1; done
