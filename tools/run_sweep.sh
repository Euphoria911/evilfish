#!/bin/bash
cd "$(dirname "$0")"
run() { # tier tag D T PB
  D=$3 TABS=$4 PB=$5 node selfplay_h.js $1 30 "$2" > "sw_$2.log" 2>&1 &
}
run 4 t4a 5 60 0.015
run 4 t4b 4 70 0.02
run 4 t4c 6 90 0.03
run 5 t5a 4 80 0.02
run 5 t5b 3 90 0.03
run 5 t5c 4 140 0.05
run 6 t6a 3 120 0.04
run 6 t6b 2 100 0.03
run 6 t6c 3 200 0.08
wait
echo "sweep done"
