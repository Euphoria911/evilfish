#!/bin/bash
cd "$(dirname "$0")"
Y='{"mode":"skill","skill":4,"depth":6}'
for e in 1800 1900 2000 2100 2200 2300 2400 2600; do
  node reftest2.js "{\"mode\":\"elo\",\"elo\":$e,\"depth\":12}" "$Y" 30 7 "elo$e" > "lad1_elo$e.log" 2>&1 &
done
for c in "2 5" "3 5" "2 6" "1 6"; do set -- $c
  node reftest2.js "{\"mode\":\"skill\",\"skill\":$1,\"depth\":$2}" "$Y" 30 7 "sk$1d$2" > "lad1_sk$1d$2.log" 2>&1 &
done
wait; echo ladder1 done
