# Evilfish

Stockfish 19 analyzer and auto-mover for chess.com, shipped as a single Tampermonkey userscript
([`evilfish.user.js`](evilfish.user.js), v4.3.0) plus an optional local engine bridge ([`tools/bridge`](tools/bridge/evilfish-bridge.js)).

## Features

- **Local engine bridge (optional).** `npm run bridge` runs Stockfish 19 on this machine with many threads and a
  large hash (about 6 Mnps on 20 threads against about 0.5 Mnps for the in-page build). The userscript finds it by
  itself, reaches it with `GM_xmlhttpRequest` only, and then never downloads or starts the in-page engine. See
  [Local engine bridge](#local-engine-bridge).
- **Stockfish 19.0.1 in the page (WASM)** when no bridge is running. The lite build starts instantly; the full build (large net, single
  thread) downloads once in the background, is cached, then hot-swaps in. Builds are pinned and SHA-256 verified.
- **Arrows** for the top three lines (MultiPV 3), a threats overlay, and conditional premoves.
- **Opening theory.** An embedded offline book of engine-best moves for both colours (2054 positions, including
  gambits and sidelines) plus selectable repertoires per side. See [docs/OPENING-THEORY.md](docs/OPENING-THEORY.md).
- **Cloud evals** (lichess), **tablebase** lookups (lichess), and **pondering** on the opponent's likely replies.
- **Clock-aware time management**: exact clocks from the board's game object, increment learned from the PGN, a per-move
  budget (`moveBudget`) that survives long games at 1+0, overhead measured at run time. See
  [docs/TIME-MANAGEMENT.md](docs/TIME-MANAGEMENT.md).
- **Pacing** (Alt+D: off / natural / quick): automatic moves are held back to a modelled human think time that
  follows the clock, the kind of move (book, forced, recapture, capture or check, quiet), the phase, how close the
  candidates are and how good the position is, with log-normal noise and the odd long think. Engine time counts
  towards it.
- **Auto move** with four speeds: fast (300 ms), balanced (800 ms), deep (fixed depth, soft-stopped after 20 s)
  and auto (clock-aware).
- **Strength tiers** 100 / 80 / 70 / 60 / 45 / 30 / 20 %. See [docs/STRENGTH.md](docs/STRENGTH.md).
- **LEVEL mode** (play for a win): in level positions, prefer the practically-equal move that avoids repetition
  and keeps pieces on the board, instead of drifting into a draw. Off / focus / risky.
- **Human-like play** (opt-in, 80–20 % tiers): shallow look-ahead, a softened choice among several candidates,
  and an imperfect eye for hanging pieces.
- **Panel** that can be dragged and minimised; stealth mode hides the arrows and shows the best move on demand.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Create a new script, paste the contents of `evilfish.user.js`, and save.
3. Open any game on chess.com. The panel appears on the board.

The script talks to `unpkg.com` and GitHub releases (engine files), and to `lichess.org` /
`tablebase.lichess.ovh` (cloud evals and tablebase). See the `@connect` lines in the header.

## Hotkeys

All hotkeys are `Alt` + key.

| Key | Action |
|---|---|
| `A` | auto move on / off |
| `D` | pacing: off → natural → quick |
| `W` | LEVEL mode: off → focus → risky |
| `U` | human-like play on / off |
| `T` | cycle speed |
| `P` | cycle strength tier |
| `O` | threats overlay |
| `M` | conditional premoves |
| `X` | cancel the queued premove |
| `S` | stealth: hide arrows, peek at the best move |
| `N` | minimise the panel |
| `H` | hide the panel |
| `F` | force the side to play (white → black → auto) |
| `1` `2` `3` | show only that arrow rank |

## Settings

Stored with `GM_setValue`; legacy `localStorage` values are read once so settings survive upgrades. The key
prefix is kept from earlier versions.

| Key | Meaning | Default |
|---|---|---|
| `eni-speed` | speed index | 3 (auto) |
| `eni-accuracy` | strength tier index | 0 (100 %) |
| `eni-opening`, `eni-favorite-openings` | repertoire choice per side | first |
| `eni-fight` | LEVEL mode: 0 off, 1 focus, 2 risky | 1 |
| `eni-human` | human-like play | 0 (off) |
| `eni-pace` | pacing index: 0 off, 1 natural, 2 quick | 1 |
| `eni-bridge` | bridge address | `http://127.0.0.1:8765` |
| `eni-bridge-on` | look for a bridge at all | 1 |
| `eni-full-engine` | download the full engine (skipped when the device reports under 4 GB of memory) | 1 (on) |
| `eni-ui` | panel position and minimised state | — |
| `eni-debug` | console logging | 0 |

## Local engine bridge

The in-page build is single-thread WASM. The bridge runs the multi-thread build (or a native `stockfish` if one is on
`PATH` or given with `--engine`) outside the browser and serves it on `127.0.0.1`:

```
npm install
npm run bridge                         # 12 threads, 256 MB hash by default (a session is about 1.2 GB resident; 1 GB of hash made it 2.1 GB and swapped)
node tools/bridge/evilfish-bridge.js --threads 16 --hash 512 --syzygy /path/to/syzygy   # a native engine may use more hash
```

Add `127.0.0.1` to the script's `@connect` list (already there) and allow the connection when Tampermonkey asks.
With the bridge up the panel reads `engine local 12t`. If the bridge starts after the page, the script finds it
within 20 s and swaps it in; if it dies, the in-page engine takes over. Starting it by hand is only for trying it out. To have it
running whenever you are logged in, install the service once:

```
tools/bridge/install-service.sh          # a systemd --user unit: starts at login, restarts if it dies
tools/bridge/install-service.sh remove
```

Idle it costs about 20 MB and no CPU; an engine process only exists while a chess.com tab with the script is open.

For the best result install the native engine once (no root; the download is checked against GitHub's published SHA-256):

```
npm run engine:native            # official Stockfish 19 -> ~/.local/share/evilfish/stockfish
systemctl --user restart evilfish-bridge
```

The bridge then uses it by itself: about 2.3x the nodes per second of the WASM build, a 0.3 s start instead of 4-5 s, about half
the memory, and hash sizes above 1 GB (`EF_HASH`, `--hash`). Without it the WASM build is used.

Measured on a 24-thread laptop (`npm run bench`; the figures below are the WASM engine, the native ones are in the changelog): 1 thread 0.46 Mnps, 4: 1.7, 8: 3.1, **12: 4.2**, 16: 4.9, 24: 5.2, so 12
threads (the default) is the knee. A bridge round trip is about 1 ms and a 50 ms search overshoots by about 3 ms. Start-up
is about 1.7 s plus 0.23 s per thread, which is why a reloaded page takes over the running engine instead of starting one.

Tampermonkey runs one `GM_xmlhttpRequest` at a time for the whole browser, across tabs. The client is built around that: a
poll is only made while a response is expected and is held 1.5 s at most (a poll that was held 20 s used to delay every
other request, in every tab, by up to 20 s). See the 4.3.6 changelog.

The bridge only listens on loopback, rejects any request without the custom header `X-Evilfish: 1` (so a web page
cannot call it: that header forces a CORS preflight, which the bridge refuses) and any foreign `Host` header, passes
only a whitelist of UCI commands, and owns `Threads`, `Hash` and `SyzygyPath` itself.

## Development

```
npm install
npm test               # unit and property tests (no network)
npm run test:network   # cloud-eval handling against live lichess data
```

Developed and tested on Node 24. `npm install` fetches `chess.js` and the same Stockfish 19.0.1 build the script uses.

The tests load the real userscript in a `vm` with stubbed browser globals (`test/harness.js`). Setting
`window.__EF_TEST` makes the script expose its internals as `window.__evilfish.T`; nothing is exposed otherwise.

| Test | Covers |
|---|---|
| `helpers.test.js` | FEN validation, move inference, history consistency, attack detection, against `chess.js` |
| `openings.test.js` | every repertoire line is legal; the script's book index matches `chess.js` |
| `theory-book.test.js` | every theory entry round-trips through the packed format and is legal |
| `hanging.test.js` | the hanging-piece detector used by human-like play, against `chess.js` |
| `human.test.js` | human-like job parameters, the candidate picker, tier plumbing |
| `tiers.test.js` | the exact engine options each strength tier sends |
| `behaviour.test.js` | two-ply board inference against `chess.js`, the pacing model, the serialized cloud queue, premove gating, human-like context |
| `bridge.test.js` | the bridge server (access control, command whitelist, long poll) and the userscript's client against a real engine |
| `cloud-eval.test.js` | (network) cloud-eval castling normalisation, PV legality, score sign |

### Layout

```
evilfish.user.js     the userscript
data/                theory book, validated repertoire lines and their report
test/                harness and tests
tools/bridge/        the local engine bridge and its systemd unit
tools/               theory-book builders, engine-vs-engine calibration, sweep scripts
docs/                architecture, strength calibration, opening theory
```

The tools need the engine from `node_modules` (installed by `npm install`) and are run from the repository root,
for example `node tools/reftest2.js '<cfgA>' '<cfgB>' 30 0 label`. Calibration jobs are CPU-heavy; the `tools/run_*.sh`
scripts launch many in parallel.

## Status

Verified: the unit and property tests above, seven timed games against chess.com's 3200 engine bot (1+0, 3+2, 10+0; six
wins, one time loss that led to the 4.3.1 time-management rewrite, see [docs/TIME-MANAGEMENT.md](docs/TIME-MANAGEMENT.md)),
a strength match of the bridge engine against the in-page engine (+120 Elo at equal time per move), a live bot game on chess.com with the bridge engine (arrows, mid-search
arrows, pacing, ponder hits, auto move through the board API), the engine option strings for every tier, the strength ordering of
both ladders in engine-vs-engine matches, and the human-like mode end to end in a live game.

Verified under the real Tampermonkey 5.5.1 (separate profile): the script loads and reads the board's game object, reaches the
bridge, plays a guest bot game with no engine recoveries, and gets real lichess cloud evals (depth 50-60).

Not verified: whether human-like play *feels* human (only its strength is measured), the low-clock branch under real
Tampermonkey (it was exercised live through the injection harness: 1+0 games down to 16 s), and LEVEL mode against strong
online engines.

## License

[MIT](LICENSE)
