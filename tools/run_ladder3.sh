#!/bin/bash
cd "$(dirname "$0")"
C3='{"mode":"elo","elo":1700,"depth":12}'
C5='{"mode":"skill","skill":1,"depth":4}'
for c in "2 5" "3 4" "2 4"; do set -- $c
  K="{\"mode\":\"skill\",\"skill\":$1,\"depth\":$2}"
  for off in 21 22; do
    node reftest2.js "$K" "$C5" 30 $off "v30_s$1d$2" > "lad3_v30_s$1d$2_$off.log" 2>&1 &
  done
  node reftest2.js "$C3" "$K" 30 23 "v60_s$1d$2" > "lad3_v60_s$1d$2.log" 2>&1 &
done
wait; echo ladder3 done
