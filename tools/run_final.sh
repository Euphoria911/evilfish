#!/bin/bash
# final verification of the shipped table: tiers 1-5 vs the 45% engine tier, tier 6 vs the 30% engine tier; 2 x 30 games each
cd "$(dirname "$0")"
for t in 1 2 3 4 5 6; do
  REF=4; [ $t = 6 ] && REF=5
  for off in 3 4; do
    REF=$REF OFF=$off node selfplay_h.js $t 30 final > "cal_final_t${t}_${off}.log" 2>&1 &
  done
done
wait
echo final done
