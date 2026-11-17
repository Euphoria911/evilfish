# Architecture

`evilfish.user.js` is one IIFE, split into banner-commented sections. This is the map; function names are
searchable in the file.

| Section | What it does |
|---|---|
| CONFIG | version, hotkey, pinned engine builds and hashes, speeds, `TIERS` |
| STORE | settings via `GM_getValue` / `GM_setValue`; legacy `localStorage` values are read once |
| STATE | mutable runtime state and the persisted settings (`eni-*` keys) |
| CHESS HELPERS | board ↔ FEN conversion, `applyMove`, `stepFEN`, `inferMove`, `historyConsistent`, attack detection |
| DOM | board, side, flip and clock reading (`getGame`, `getBoard`, `readMyClockMs`, `domPlacement`) |
| POSITION SOURCES | turns the page's game state (or, as a fallback, the DOM) into a validated position |
| ENGINE ASSETS | downloads the pinned engine files, verifies SHA-256, caches them |
| ENGINE | worker lifecycle, search jobs, watchdog, lite → full hot swap, result handling |
| HUMAN-LIKE PLAY | `HUMAN` table, hanging-piece detector, `humanPick` |
| PLAY FOR A WIN | LEVEL mode: `pickFighting`, focus pass |
| PONDER | searches the opponent's likely replies in staged passes while they think |
| TABLEBASE | lichess tablebase lookups for small endgames |
| CLOUD EVAL | lichess cloud evals, used at full strength only |
| ANALYSIS | assembles the candidate list shown and played |
| PREMOVES | conditional premoves |
| MOVE EXECUTION | plays the move through the game API; DOM fallback tries a drag, then two clicks, and confirms the position changed |
| OPENING BOOK / THEORY BOOK | repertoire lines per side; the packed engine-best theory book |
| THREATS / SVG ARROWS | threat overlay and arrow rendering |
| PANEL | UI, drag and minimise, actions shared with the hotkeys |
| OBSERVER / KEYBOARD / BOOT | DOM fallback observer, `Alt+` hotkeys, startup |

## Move pipeline

1. **Position.** The board's game state is read and validated (`historyConsistent`, `isValidFEN`); a position that
   cannot be explained by the move history is rejected rather than guessed.
2. **Source of the move** (`analyze`), in order:
   - the repertoire book (`openingMoveFor`), then the theory book on your own turn (`theoryMoveFor`) — neither is
     used by the `skill` tiers;
   - a cloud eval, when eligible (100 % tier only);
   - otherwise a local engine job.

   For small endgames a tablebase answer is reconciled with the engine's list (`onTablebase`,
   `reconcileTablebase`); this is skipped in human-like mode.
3. **Engine job** (`makeJob`). Time budget comes from the speed setting and the clock; MultiPV and depth from the
   strength tier (`applyStrength` sends the UCI options). Human-like mode replaces the job with a shallow,
   multi-candidate one.
4. **Result handling** (`handleResult`). The candidate list is built (`buildList`); then, depending on settings,
   `humanPick` reorders it (human-like), or LEVEL mode swaps in a non-drawish equal move after a focus pass.
5. **Finalise.** Arrows are drawn, premoves are queued, and with auto move on the move is played.

While it is the opponent's turn the engine ponders their likely replies (`runPonder`) and keeps the results, so a
predicted reply can be answered from them. Pondering is off in human-like mode.

## Engine

Pinned Stockfish 19.0.1 builds from unpkg (GitHub releases as a mirror), verified against SHA-256 values in
`ENGINE_FILES`. The lite build starts immediately; the full single-thread build (large net) downloads once in the
background, is cached (`evilfish-engine-v1`), and is hot-swapped in. Multi-threaded builds are not used: they need
cross-origin isolation, which chess.com does not provide. A watchdog treats an engine that does not answer
`stop` within `STOP_GRACE` (2.5 s) as dead.

## Test hooks

Defining `window.__EF_TEST` before the script runs makes it publish `window.__evilfish` with the internals the
tests use (`T`: `handleResult`, `buildList`, `applyStrength`, `humanPick`, `HUMAN`, …). Without it nothing is
exposed. `test/harness.js` sets this up in a `vm` with stubbed browser globals.
