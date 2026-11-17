#!/bin/bash
cd "$(dirname "$0")"
cand() { # tag tier off json
  REF=5 OFF=$3 P="$4" node selfplay_h.js $2 30 "$1" > "r4_$1_$3.log" 2>&1 &
}
for off in 5 6; do
  cand h5 5 $off '{}'
  cand h6a 6 $off '{"d":2,"k":7,"T":130,"pb":0.08,"notice":0.6}'
  cand h6b 6 $off '{"d":2,"k":8,"T":170,"pb":0.10,"notice":0.55}'
done
wait
echo r4 done
