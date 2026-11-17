#!/bin/bash
cd "$(dirname "$0")"
C1='{"mode":"elo","elo":2200,"depth":12}'
C2='{"mode":"elo","elo":2000,"depth":12}'
C3='{"mode":"elo","elo":1700,"depth":12}'
C4='{"mode":"skill","skill":3,"depth":5}'
C5='{"mode":"skill","skill":1,"depth":4}'
C6='{"mode":"skill","skill":0,"depth":2}'
for off in 11 12; do
  node reftest2.js "$C1" "$C2" 30 $off "p12" > "lad2_p12_$off.log" 2>&1 &
  node reftest2.js "$C2" "$C3" 30 $off "p23" > "lad2_p23_$off.log" 2>&1 &
  node reftest2.js "$C3" "$C4" 30 $off "p34" > "lad2_p34_$off.log" 2>&1 &
  node reftest2.js "$C4" "$C5" 30 $off "p45" > "lad2_p45_$off.log" 2>&1 &
  node reftest2.js "$C5" "$C6" 30 $off "p56" > "lad2_p56_$off.log" 2>&1 &
done
wait; echo ladder2 done
