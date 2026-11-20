# Time management

## What went wrong (4.3.0)

In a live 1+0 game against chess.com's 3200 engine bot the script lost on time from a winning position (+5). The clock
log showed every move taking 0.25-0.35 s, even with 1-2 s left. Two floors caused it: pacing never waited less than
260 ms, and the low-clock search was never shorter than 120-250 ms. 28 moves from 8.7 s do not fit in 0.3 s each, and an
engine bot replies instantly, so the game is long.

## The policy (4.3.1)

- **Exact clocks.** `game.clocks[1|2].get().currentTime` (white / black, about 100 ms resolution). The DOM only shows
  whole seconds above ten and stays as the fallback.
- **Increment** from the PGN's `%clk` and `%timestamp` comments: for each of my moves, `inc = clk - (previous clk - spent)`;
  the median of the last four, rounded to 100 ms, below 300 ms counts as zero.
- **`moveBudget(left, inc, plies)`**
  - moves still to play: 40 once the clock is under a minute, otherwise `max(20, 45 - 0.3 * plies)`;
  - reserve `min(1500, 300 + 0.02 * left)`, share `(left - reserve) / movesToGo + 0.7 * inc`;
  - at most 12 % of the clock (+ half the increment) and 8 s, at least 30 ms, minus the measured overhead.
- **Overhead** is an exponential average of how far searches that ran to their limit overshoot it (bridge round trip,
  page): 8-46 ms in the live games.
- **Every speed obeys the clock.** "Fast" and "balanced" are capped by the budget; "deep" gets 2.5x the budget when there
  is a clock.
- **No focus pass, extension or surprise extension** below 45 s; cloud evals are skipped below 90 s (the local engine is
  as good and never waits for the network).
- **Pacing** (the human think time) is capped at 3 % of the clock + 40 ms and off under 3 s.

| clock left (ply 40, 25 ms overhead) | budget |
|---|---|
| 600 s | 7975 ms (the 8 s cap) |
| 300 s | 7975 ms |
| 180 s, +2 s increment | 6784 ms |
| 60 s | 1748 ms |
| 30 s | 703 ms |
| 20 s | 458 ms |
| 8 s | 164 ms |
| 4 s | 66 ms |
| 2 s | 30 ms (the floor) |

The budget is an upper limit: the early stop (a settled best move over the last iterations) ends easy moves sooner, and
book, theory, forced and ponder-stored moves cost almost nothing, so the games above finished with 16-293 s on the clock.
The cap is a judgment call, not an optimum: at about 5 Mnps each doubling of time is worth a few tens of Elo, which is
why it stops at 8 s.

(`moveBudget` is exposed to the tests; `tools/strength_match.js --a '{"policy":"new"}'` plays it against the old rule.)

## Measured

Live, against Komodo 3200 ("Максимум") on chess.com, the bridge engine at 12 threads, auto move on, pacing natural:

| game | build | control | result | clock left | notes |
|---|---|---|---|---|---|
| 1 | 4.3.0 | 1+0, started with 21 s (injection delay) | **loss on time** | 0 s | +5 for most of the game; 0.25-0.35 s per move even at 1 s |
| 2 | 4.3.0 | 1+0 | win, mate, 49 plies | 34 s | |
| 3 | 4.3.1 | 1+0 | win, mate, 119 plies | 16 s | 60 moves, 0.78 s average, 0.34 s under 20 s |
| 4 | 4.3.1 | 1+0 | win, mate, 111 plies | 18 s | |
| 5 | 4.3.1 | 3+2 | win, mate, 97 plies | 86 s | |
| 6 | 4.3.1 | 3+2 | win, mate, 127 plies | 75 s | increment learned: 2000 ms |
| 7 | 4.3.1 | 10+0 | win, mate, 97 plies | 293 s | 6.4 s average per move, 15 live ponder hits |

Raw clock/move logs are in `results/live/`. Seven games is a small sample; it shows the time loss is gone and the engine
is comfortably above this bot, not an Elo figure.

Engine-vs-engine (`tools/strength_match.js`, results in `results/`):

- **Bridge vs in-page engine, equal 300 ms per move** (7 threads vs the single-thread full build): 11 wins, 18 draws,
  1 loss over 30 games = **+120 Elo** (95 %: +49 to +203). Drawish adjudication compresses the gap, so this is a floor.
- **New vs old time policy at 1+0**, 4 threads each, 40 ms overhead each, 24 games: 2 wins, 22 draws, 0 losses
  (+29 Elo, 95 %: -9 to +68), no flags on either side. Most games were adjudicated drawn before any scramble, so this
  match cannot show the long-game flagging; the live game and the scramble unit test do.

## Budget vs Stockfish's own time manager (`go wtime btime winc binc`)

`tools/strength_match.js`, 1+0, 4 threads each, 40 ms simulated overhead each, two batches of 36 games
(`results/m3_*`, `results/m3b_*`; the first was partly disturbed by other CPU load):

| batch | budget wins | draws | native wins | Elo (budget - native), 95 % |
|---|---|---|---|---|
| 1 | 0 | 34 | 2 | -19 (-46 to +7) |
| 2 | 2 | 33 | 1 (budget flagged 0, native flagged 1) | +10 (-23 to +42) |
| both | 2 | 67 | 3 | about -5 |

No difference can be shown at this sample size; both are drawish at one second per move. The budget stays: it works from the
exact clock and the learned increment, and nothing in the data says the native manager is better. Average time per move was
852-927 ms (budget) against 980-1061 ms (native).
