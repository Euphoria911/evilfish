#!/bin/bash
cd "$(dirname "$0")"
cand() { # tag tier ref json
  REF=$3 OFF=2 P="$4" node selfplay_h.js $2 30 "$1" > "r3_$1.log" 2>&1 &
}
cand h3a 3 4 '{"d":4,"k":6,"T":95,"pb":0.03,"notice":0.9}'
cand h3b 3 4 '{"d":4,"k":6,"T":110,"pb":0.035,"notice":0.9}'
cand h4a 4 4 '{"d":3,"k":6,"T":75,"pb":0.03,"notice":0.85}'
cand h4b 4 4 '{"d":3,"k":6,"T":90,"pb":0.035,"notice":0.85}'
cand h5a 5 4 '{"d":3,"k":7,"T":95,"pb":0.05,"notice":0.75}'
cand h5b 5 4 '{"d":3,"k":7,"T":110,"pb":0.05,"notice":0.75}'
cand h6a 6 5 '{"d":2,"k":6,"T":40,"pb":0.03,"notice":0.8}'
cand h6b 6 5 '{"d":2,"k":7,"T":80,"pb":0.05,"notice":0.7}'
wait
echo r3 done
