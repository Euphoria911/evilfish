# Opening theory

Two layers, both embedded in the script:

- **Repertoire lines** (`OPENINGS`): named openings per side (19 with validated lines), each a set of move
  sequences. These decide which opening you play.
- **Theory book** (`THEORY_DATA`): 2054 positions, each with one engine-best move, for both colours across
  common openings, gambits and sidelines. It answers positions the repertoire does not cover and keeps the
  engine on theory against what the opponent actually plays.

The `skill` strength tiers (45 / 30 / 20 %) skip both books on purpose, so they play weaker, not book-perfect.

## Building the book

All commands run from the repository root, in this order. Output goes to `data/`.

1. **Crawl** — `node tools/crawl_theory.js [out] [callBudget]`

   Walks the likely opening positions for each colour, following what 1600–2200 rated players actually play
   (lichess explorer), most likely branches first, with common gambits and sidelines seeded explicitly. For every
   position it takes the best move from lichess cloud-eval (depth 35–75) and falls back to the local
   Stockfish when the cloud has no answer (`tools/cloudsrc.js`, `tools/localeval.js`). Sequential, paced and
   resumable; results are cached in `crawl_cache.json` (ignored by git).

2. **Validate repertoire lines** — `node tools/validate_lines.js`

   Checks every repertoire move against deep evaluations. Each opening keeps its defining moves (its *identity
   prefix*); after that a line is cut right before the first of your moves that is objectively unsound (default:
   more than 70 cp worse than the best move). Writes `data/lines_validated.json` and a per-opening
   `data/lines_report.txt`.

3. **Pack into the script** — `node tools/build_theory.js [theory.json] [lines.json] [target]`

   Hashes each position with the script's own hash (so the two can never disagree), packs the entries into the
   `THEORY_DATA` string and rewrites the validated repertoire lines in `OPENINGS`.

4. **Spot-check** — `node tools/check_theory.js [n]` compares a random sample of newly added entries against a
   3 s reference search. `WIDE` names the newly crawled book to sample from and `FIRST` the book it is compared
   to (default `data/theory_book.json`).

## Format

`data/theory_book.json` is an array of `[positionKey, uciMove]` where the key is the FEN without the move
counters (placement, side to move, castling rights), for example
`["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq", "e2e4"]`.

## Tests

- `test/openings.test.js` — every repertoire line is legal and every book position is in the script's index.
- `test/theory-book.test.js` — every entry round-trips through the packed format, is legal, and the report shows
  how much of the repertoire the book covers.
