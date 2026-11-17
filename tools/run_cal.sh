#!/bin/bash
# run_cal.sh <tag> : calibrate all six tiers, two processes each, 30 games per process
cd "$(dirname "$0")"
TAG="${1:-cal}"
for t in 1 2 3 4 5 6; do
  for off in 0 1; do
    OFF=$off node selfplay_h.js $t 30 "$TAG" > "cal_${TAG}_t${t}_${off}.log" 2>&1 &
  done
done
wait
echo "all calibration jobs finished"
