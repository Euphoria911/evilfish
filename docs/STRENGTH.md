# Strength tiers

## The ladder (normal play)

The menu shows each tier as `<accuracy> · <name>` (for example `80% · 1700 Elo`). Since v4.2.1 the Elo in the
label is **only a name**; the engine is configured from the `uci` / `skill` fields of `TIERS`.

| Tier | Engine setting | Search depth | Stronger than the tier below by (Elo) |
|---|---|---|---|
| 100 % | full strength, `UCI_LimitStrength false` | 22 | — |
| 80 % | `UCI_Elo 2200` | 12 | ≈ +134 over 70 % |
| 70 % | `UCI_Elo 2000` | 12 | ≈ +147 over 60 % |
| 60 % | `UCI_Elo 1700` | 12 | ≈ +223 over 45 % |
| 45 % | `Skill Level 2` | 4 | ≈ +161 over 30 % |
| 30 % | `Skill Level 1` | 4 | ≈ +232 over 20 % |
| 20 % | `Skill Level 0` | 2 | — |

### Why it was changed

Stockfish weakens play in two different ways and the scales do not meet. `UCI_Elo` limits strength on a
1320–3190 scale; `Skill Level` (0–20) makes the engine pick its move from a search of depth `1 + int(level)`. The
old ladder mixed them: 80 / 70 / 60 % used `UCI_Elo` 1700 / 1500 / 1350 and 45 / 30 / 20 % used `Skill Level`
4 / 1 / 0, so 60 % played far weaker than 20 % and 45 % was about as strong as 80 %. The tiers also fell on
uneven steps.

### How it was calibrated

Engine-vs-engine matches in Node using the same Stockfish 19.0.1 single-thread build as the script:

- openings taken from the script's own repertoire lines (4–8 plies), colours alternating;
- each tier configured exactly as the script configures it;
- Elo difference from the score: `−400 · log10(1/score − 1)`.

Direct matches against one reference tier were preferred to chaining adjacent gaps, which accumulates error.

Match sizes were 60 games per pair, except 60 % over 45 % (30 games). **A sample of 30–60 games carries roughly
±100 Elo of noise**, so the *ordering* is reliable and the exact gaps are not.

Reproduce a single pairing:

```
node tools/reftest2.js '{"mode":"elo","elo":1700,"depth":12}' '{"mode":"skill","skill":2,"depth":4}' 30 0 label
```

`mode:"elo"` configs use the `UCI_Elo` value in `elo`. `tools/run_ladder1.sh` – `run_ladder3.sh` are the sweeps
used to choose the shipped values.

## Human-like play (opt-in)

For the 80–20 % tiers the engine can instead play like a person (`Alt+U`, or the HUMAN chip). It searches
shallowly, considers `k` candidate lines, and picks among them with a softmax over adjusted scores:

- `d` look-ahead depth, `k` candidates considered,
- `T` softness of the choice, in centipawns (higher = more random),
- `pb` chance of a slip: any reasonable candidate (within 400 cp of the best) is played,
- `notice` chance that the move is checked for leaving a piece en prise; if noticed, 85 cp per pawn of loss
  is deducted from that candidate,
- small bonuses for captures (+25), promotions (+60), castling (+35) and checks (+10).

| Tier | d | k | T | pb | notice | Strength vs the former 45 % config (Elo, ±100) |
|---|---|---|---|---|---|---|
| 80 % | 5 | 5 | 55 | 0.012 | 0.97 | ≈ equal |
| 70 % | 4 | 5 | 80 | 0.020 | 0.93 | ≈ −150 |
| 60 % | 4 | 6 | 95 | 0.030 | 0.90 | ≈ −220 |
| 45 % | 3 | 6 | 85 | 0.035 | 0.85 | ≈ −270 |
| 30 % | 3 | 7 | 105 | 0.050 | 0.75 | ≈ −400 |
| 20 % | 2 | 7 | 130 | 0.080 | 0.60 | ≈ −550 |

The reference "former 45 % config" is `Skill Level 4` at depth 6, the pre-4.2.1 ladder; the 30 % and 20 % rows
were calibrated against the former 30 % config (`Skill Level 1`, depth 4). `tools/selfplay_h.js` still carries
those reference configs. The 100 % tier is never humanised. Tablebase and pondering are off in this mode.

The ordering of the human ladder was verified at 60 games per tier. What is **not** measured is whether the play
feels human; only strength is.

Reproduce one tier: `REF=4 OFF=3 node tools/selfplay_h.js <tier 1..6> 30 label` (tier 1 = 80 %). Environment
overrides `D`, `K`, `TABS`, `TSCALE`, `PB`, `NOTICE`, `P` (JSON) change the parameters for sweeps.
