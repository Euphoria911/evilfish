#!/bin/bash
# round 2: every human tier measured directly against the yardstick (tier 4: skill 4, depth 6)
cd "$(dirname "$0")"
TAG="${1:-r2}"
cand() { # tier json
  for off in 0 1; do
    REF=4 OFF=$off P="$2" node selfplay_h.js $1 30 "$TAG" > "cal_${TAG}_t${1}_${off}.log" 2>&1 &
  done
}
cand 1 '{"d":5,"k":5,"T":55,"pb":0.012,"notice":0.97}'
cand 2 '{"d":4,"k":5,"T":80,"pb":0.02,"notice":0.93}'
cand 3 '{"d":4,"k":6,"T":130,"pb":0.04,"notice":0.88}'
cand 4 '{"d":3,"k":6,"T":60,"pb":0.025,"notice":0.85}'
cand 5 '{"d":3,"k":7,"T":110,"pb":0.045,"notice":0.75}'
cand 6 '{"d":2,"k":7,"T":120,"pb":0.07,"notice":0.65}'
wait
echo "round 2 finished"
