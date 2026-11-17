# Evilfish

Stockfish 19 analyzer and auto-mover for chess.com, shipped as a single Tampermonkey userscript
([`evilfish.user.js`](evilfish.user.js), v4.2.1).

## Features

- **Stockfish 19.0.1 in the page (WASM).** The lite build starts instantly; the full build (large net, single
  thread) downloads once in the background, is cached, then hot-swaps in. Builds are pinned and SHA-256 verified.
- **Arrows** for the top three lines (MultiPV 3), a threats overlay, and conditional premoves.
- **Opening theory.** An embedded offline book of engine-best moves for both colours (2054 positions, including
  gambits and sidelines) plus selectable repertoires per side. See [docs/OPENING-THEORY.md](docs/OPENING-THEORY.md).
- **Cloud evals** (lichess), **tablebase** lookups (lichess), and **pondering** on the opponent's likely replies.
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
| `eni-full-engine` | download the full engine (skipped when the device reports under 4 GB of memory) | 1 (on) |
| `eni-ui` | panel position and minimised state | — |
| `eni-debug` | console logging | 0 |

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
| `cloud-eval.test.js` | (network) cloud-eval castling normalisation, PV legality, score sign |

### Layout

```
evilfish.user.js     the userscript
data/                theory book, validated repertoire lines and their report
test/                harness and tests
tools/               theory-book builders, engine-vs-engine calibration, sweep scripts
docs/                architecture, strength calibration, opening theory
```

The tools need the engine from `node_modules` (installed by `npm install`) and are run from the repository root,
for example `node tools/reftest2.js '<cfgA>' '<cfgB>' 30 0 label`. Calibration jobs are CPU-heavy; the `tools/run_*.sh`
scripts launch many in parallel.

## Status

Verified: the unit and property tests above, the engine option strings for every tier, the strength ordering of
both ladders in engine-vs-engine matches, and the human-like mode end to end in a live game.

Not verified: whether human-like play *feels* human (only its strength is measured), cloud evals and the
low-clock branch (clock ≤ 25 s) under Tampermonkey, and LEVEL mode against strong online engines.

## License

[MIT](LICENSE)
