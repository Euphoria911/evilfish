# Changelog

## 4.3.6

Found by running the script under the real Tampermonkey 5.5.1 (MV3, Chromium 157) in a separate profile, which the earlier
`GM_xmlhttpRequest` shim could not show.

- **Tampermonkey runs one `GM_xmlhttpRequest` at a time for the whole browser, across tabs.** The bridge client held a 20 s
  poll open, so every other request in every tab (another tab's poll, this tab's commands) waited behind it: a command
  arrived exactly one hold time late, the 2.5 s `stop` watchdog fired, and the engine was thrown away and restarted (two to
  five times a minute). New protocol (`POST /x`): one request in flight per tab, carrying the commands and returning the
  output; a poll only while a response is expected (uciok, readyok, one bestmove per `go`), held 1.5 s at most; a ping every
  20 s when idle; a poll in flight is aborted when there is a command to send. 110 s of real play now: 17 moves, no
  recoveries, with a second chess.com tab open.
- **Fixed: `parseInfo` threw on an `info ... pv` line with no moves** (real engine output). Under the old Worker path the
  exception was silent; the new pipe also reports handler errors and keeps going, instead of dropping the lines that follow.
- **Bridge memory and start-up.** A session with a 1 GB hash was 2.1 GB resident; with a browser open on a 16 GB laptop that
  meant swapping, a 6 s engine start and slow `stop` answers. Default hash is now 256 MB (about 1.3 GB per session); the
  WASM engine cannot use more than 1024 MB (asking for 2048 made it hang silently, so it is clamped). Start-up scales with
  threads (about 1.7 s + 0.23 s per thread, `tools/bench.js`).
- **Session reuse.** A reloaded page sends the id of its old session (`sessionStorage`) and takes over the running engine
  (`POST /session?adopt=ID`): no start-up, no extra process. Sessions untouched for 60 s can be taken over by anyone, and
  are killed after 90 s. `MAX_SESSIONS` 2.
- **`ucinewgame` is sent when a new game is detected** (it costs about 0.5 s inside the engine, independent of the hash),
  not in front of the first search.
- **Ponder:** the last step runs 8 s, not until stopped (it kept 12 threads at 100 % while the opponent thought);
  top-up of a stored answer only at full strength; bridge `stop` grace 10 s (replacing the engine costs a process).
- `tools/bridge/install-service.sh`: a `systemd --user` service so the bridge starts at login (`npm run bridge:install`).
- `tools/bench.js`: nodes per second by thread count, `ucinewgame` cost by hash size, bridge round trip.
- Tests: the GM shim in `bridge.test.js` now behaves like Tampermonkey (one request at a time, abortable); regression tests
  for a command behind an idle poll, a second tab behind a running search, adoption, ping, poll hold, `parseInfo`;
  `cloud-live.test.js` (network) runs the script's cloud path against the real lichess API.

## 4.3.2 - 4.3.5

Intermediate builds of the above while the cause was being found (single request protocol, handler-error isolation).

## 4.3.1

Found by playing timed games against chess.com's 3200 engine bot (Komodo): at 1+0 the script lost on time from a
winning position (+5). Every move took 0.25-0.35 s even with 1-2 s left, because of a 260 ms pacing floor and a 250 ms
low-clock search cap; 28 moves from 8.7 s do not fit in that.

- **Exact clocks.** Read from the board's own clock objects (about 100 ms resolution, both players) instead of the DOM,
  which only shows whole seconds above ten. The DOM stays as the fallback.
- **Increment learned** from the PGN's `%clk` / `%timestamp` comments (`learnIncrement`).
- **`moveBudget(clock, increment, plies)`** replaces the clock/35 rule: the share of the remaining clock this move may use
  (a long game is assumed once the clock is short), plus 70 % of the increment, never more than 12 % of the clock, never
  below 30 ms, minus the measured round-trip overhead (an exponential average of how far searches overshoot their limit).
- **Every speed obeys the clock.** "Fast" and "balanced" are capped by it; "deep" gets a time limit when there is a clock.
- **No focus passes, extensions or surprise extensions** with under 45 s left.
- **Pacing can no longer cost the game:** capped at 3 % of the clock (+40 ms), and off under 3 s.
- Cloud evals are skipped under 90 s of clock (the local engine never waits for the network).
- Fixed: increment learning failed on chess.com's line-wrapped PGN clock comments (found live in a 3+2 game).
- Bridge: sessions nobody polls (a reloaded page) are reclaimed after 4 s when the limit is reached, and expire after 45 s.
- `tools/strength_match.js`: engine-vs-engine matches with real clocks, an increment, simulated per-move overhead and
  the 'old' / 'new' time policies; results in `results/`.
- Tests: budget monotonicity and bounds, a scramble that must survive 28 moves from 8.7 s, API clock reading, increment
  learning, job behaviour at every speed (`behaviour.test.js`); the harness can inject a fake board with a game object.

## 4.3.0

- **Local engine bridge** (`tools/bridge/evilfish-bridge.js`, `npm run bridge`): a multi-thread (or native) Stockfish
  on this machine, reached with `GM_xmlhttpRequest` only. About 12x the nodes per second of the in-page build. The
  script probes for it at start and every 20 s afterwards and swaps it in; when it is there the in-page engine is
  never downloaded or started. If the bridge dies the in-page engine takes over.
- **Pacing** (`Alt+D`, off / natural / quick, default natural): automatic moves and premoves are held back to a
  modelled human think time (clock, kind of move, phase, closeness of the candidates, evaluation, log-normal noise).
  Book, theory, forced, cached-cloud, ponder-stored and premoved answers used to be instant.
- **Fixed: mid-search arrows were never drawn.** `showSearchPreview` set the candidate list but the renderer required
  the final position marker, so arrows only appeared when the search ended (up to 20 s on "deep").
- **Fixed: premoves played with AUTO off.** Queued premoves (recaptures, forced mates) are now played only with AUTO on.
- **Cloud evals: one request at a time**, the awaited position first, warm-ups for predicted replies dropped when
  stale (lichess asks API users for this; the parallel requests could trigger a 429 that disabled the tier for 60 s).
- **Ponder: a short ponder pass no longer weakens a hit.** If the stored answer was searched for less than a fresh
  search would get, it is shown as tentative and the search continues for the missing time (the table is warm).
- **No fixed depth cap at full strength with a time budget** (depth 22 cut long searches short, and the last ponder
  step never kept deepening). Fixed depth stays for the weaker tiers and the "deep" speed.
- **Tablebase:** only moves in the same category as the best one are listed, so an alternative that throws the win
  away is no longer labelled "TB win".
- **Board reading (DOM fallback):** a board two plies ahead (throttled tab, premove plus reply between polls) is
  explained by `inferMoves` instead of resetting the move history; `inferMove` now only tries the changed squares.
- **Arrows** are drawn in a fixed 800x800 viewBox that the browser scales, so they stay right when the layout
  changes without a window resize.
- **Human-like play:** the chance of a slip rises with a short clock and stays raised for a few plies after a slip.
- Engine start-up: no more duplicate full-engine upgrades (and the orphaned worker they could leave behind).
- `eni-debug` read from a legacy `localStorage` value `"0"` no longer switches debug logging on.
- Tests: `behaviour.test.js`, `bridge.test.js`; `human.test.js` follows the depth change.

## 4.2.1

- **Strength ladder re-tuned.** The 80 / 70 / 60 % tiers used Stockfish's `UCI_Elo` scale and the 45 / 30 / 20 %
  tiers its `Skill Level` scale, and the two do not line up: 60 % played far weaker than 20 %, and 45 % was about
  as strong as 80 %. Each tier now sends engine settings measured in engine-vs-engine matches, giving an ordered
  ladder with roughly even steps. Menu labels are unchanged.
- `TIERS` gains a `uci` field: the `UCI_Elo` actually sent to the engine. The `elo` field is now only the label.
- 80 / 70 / 60 % play stronger than before, 45 % slightly weaker (and faster); 30 / 20 % and the human-like mode
  are unchanged.
- Tests: `tiers.test.js` checks the exact options each tier sends.

## 4.2.0

- **Human-like play** (opt-in; chip in the panel, `Alt+U`) for the 80–20 % tiers: a shallow search, several
  candidate lines, a softmax choice with a bias towards natural moves (captures, promotions, castling, checks),
  a chance to overlook a hanging piece, and an occasional slip. Parameters per tier are in the `HUMAN` table.
- Tablebase and pondering are skipped in human-like mode.
- Calibration tools (`selfplay_h.js`, `reftest.js`) and tests (`hanging`, `human`).

## 4.1.0

- **Opening theory book**: 2054 engine-best positions for both colours, gambits and sidelines included, embedded
  in the script; repertoire lines validated against deep evaluations.
- **Panel**: draggable and minimisable.
- **Pondering** in staged passes with growing time per reply.
- **LEVEL mode** (play for a win): in level positions, choose the practically-equal move that avoids repetition
  and keeps pieces on the board; clear advantages are always converted and worse positions never gambled with.
  A focus pass gives level positions a second, equally long look. Tolerance widened from 12 to 20 cp.

## 4.0.0

- Rewritten core on **Stockfish 19.0.1**: pinned, SHA-256-verified builds; lite engine first, full engine
  downloaded in the background and hot-swapped; engine cache.
- Settings store (`GM_getValue` / `GM_setValue`); legacy `localStorage` values are read once so settings survive.
- Chess helpers: board and FEN handling, move inference, history consistency, attack detection.
- Board and clock reading rewritten and hardened.
- New: lichess cloud evals and pondering.
- Offline test harness.

## 3.29

Starting point of this repository.
