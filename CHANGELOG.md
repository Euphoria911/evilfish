# Changelog

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
