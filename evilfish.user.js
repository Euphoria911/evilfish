// ==UserScript==
// @name         Evilfish
// @namespace    https://chess.com
// @version      3.29
// @description  Stockfish 19 analysis with saved White and Black opening books, seven strength tiers, legal move checks, arrows, and automatic mate and capture premoves
// @match        https://www.chess.com/game/*
// @match        https://www.chess.com/play/*
// @match        https://www.chess.com/analysis*
// @grant        GM_xmlhttpRequest
// @connect      cdn.jsdelivr.net
// @connect      unpkg.com
// @connect      tablebase.lichess.ovh
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ── CONFIG ────────────────────────────────────────────────────────────────
  const MULTI_PV    = 3;
  const ENGINE_BASE = 'https://unpkg.com/stockfish@19.0.0/bin/stockfish-19-lite-single';
  const ENGINE_JS_URL = ENGINE_BASE + '.js';
  const ENGINE_WASM_URL = ENGINE_BASE + '.wasm';
  const AUTO_MOVE_KEY = 'KeyA';   // Alt+A

  const COL_RANKS = [
    'rgba(0,  220, 80,  0.90)',
    'rgba(255,200, 0,   0.84)',
    'rgba(255,110, 30,  0.80)',
  ];
  const PRE_MOVE_COLOR = 'rgba(30, 144, 255, 0.82)';
  const THREAT_COLOR = 'rgba(255, 55, 85, 0.9)';

  const DELAY_MIN = 0;
  const DELAY_MAX = 0;
  const SPEEDS = [
    { name: 'fast', movetime: 300 },
    { name: 'balanced', movetime: 800 },
    { name: 'deep', movetime: 0 }
  ];
  let speedIdx = 1;
  try {
    const stored = localStorage.getItem('eni-speed');
    const saved = Number(stored);
    if (stored !== null && Number.isInteger(saved) && saved >= 0 && saved < SPEEDS.length)
      speedIdx = saved;
  } catch (e) {}

  const TIERS = [
    { acc: 100, mode: 'max',   depth: 18, elo: null                },
    { acc:  80, mode: 'elo',   depth: 12, elo: 1700                },
    { acc:  70, mode: 'elo',   depth: 12, elo: 1500                },
    { acc:  60, mode: 'elo',   depth: 12, elo: 1350                },
    { acc:  45, mode: 'skill', depth:  6, elo:  900, skill: 4      },
    { acc:  30, mode: 'skill', depth:  4, elo:  700, skill: 1      },
    { acc:  20, mode: 'skill', depth:  2, elo:  500, skill: 0      },
  ];
  let accuracyIdx = 0;
  try {
    const stored = localStorage.getItem('eni-accuracy');
    const saved = Number(stored);
    if (stored !== null && Number.isInteger(saved) && saved >= 0 && saved < TIERS.length)
      accuracyIdx = saved;
  } catch (e) {}

  const OPENINGS = [
    { name: "Engine", side: null, lines: [] },
    { name: "Italian Game (White)", side: "w", lines: ["e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3 d7d6","e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d4 e5d4 e1g1 f8c5 e4e5 d7d5 e5f6 d5c4 f1e1 c8e6 f3g5 d8d5 b1c3 d5f5 g2g4 f5g6 c3e4 c5b6","e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 d8e7 d2d4 c5b6 e1g1 d7d6 a2a4 a7a6 h2h3 g8f6 f1e1","e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3 d7d6 e1g1 e8g8 f1e1 a7a6 c4b3 c5a7 h2h3","e2e4 e7e5 g1f3 b8c6 f1c4 f8e7 d2d4 e5d4 c2c3 g8f6 e4e5 f6e4","e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 d7d6 d2d4 e5d4 c3d4 c5b6","e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d4 e5d4 e1g1 f8c5 e4e5 f6g4 c2c3"] },
    { name: "Ruy Lopez (White)", side: "w", lines: ["e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7","e2e4 e7e5 g1f3 b8c6 f1b5 g8f6 e1g1 f6e4 d2d4 f8e7 d1e2 e4d6 b5c6 b7c6 d4e5 d6b7 b1c3 e8g8 f1e1 b7c5 f3d4 c5e6 c1e3 e6d4","e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f6e4 d2d4 b7b5 a4b3 d7d5 d4e5 c8e6 d1e2 f8e7 f1d1 e8g8 c2c4 b5c4 b3c4 d8d7","e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 d7d6 c2c3 c6a5 b3c2 c7c5 d2d4 d8c7 b1d2 e8g8 d2f1 c8g4","e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 e8g8 c2c3 d7d5 e4d5 f6d5 f3e5 c6e5 e1e5 c7c6 d2d4 e7d6","e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 b7b5 a4b3 d7d6 f3g5 d6d5 e4d5 c6d4 f1e1 f8c5 e1e5 e8f8","e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 d7d6 a4c6 b7c6 d2d4 f6e4 f1e1 f7f5 d4e5 d6d5 b1c3","e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 d7d6 e1g1 c8d7 c2c3 g8f6 d2d4 f8e7 b1d2 e8g8 f1e1 d7e8","e2e4 e7e5 g1f3 b8c6 f1b5 g7g6 d2d4 e5d4 f3d4 f8g7 c1e3 g8e7 b1c3 e8g8 d1d2 d7d5","e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 d7d6 c2c3 e8g8 h2h3 c8b7 d2d4 f8e8 b1d2 e7f8 a2a3 h7h6"] },
    { name: "Queen's Gambit (White)", side: "w", lines: ["d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7","d2d4 d7d5 c2c4 d5c4 g1f3 g8f6 e2e3 e7e6 f1c4 c7c5 e1g1 a7a6 d1e2 b7b5 c4b3 b8c6 f1d1 c5c4 b3c2 c6b4 b1c3 b4c2 e2c2 c8b7","d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7 e2e3 e8g8 g1f3 h7h6 g5h4 f6e4 h4e7 d8e7 d1c2 e4f6 f1d3 d5c4 d3c4 c7c5 e1g1 b8c6","d2d4 d7d5 c2c4 e7e6 b1c3 f8e7 g1f3 g8f6 c1g5 h7h6 g5h4 e8g8 e2e3 b7b6 c4d5 f6d5 h4e7 d8e7 c3d5 e6d5 a1c1 c8e6","d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7 e2e3 e8g8 g1f3 b8d7 a1c1 c7c6 f1d3 d5c4 d3c4 f6d5 g5e7 d8e7 e1g1 d5c3 c1c3 e6e5","d2d4 d7d5 c2c4 e7e5 d4e5 d5d4 g1f3 b8c6 b1d2 c8g4 h2h3 g4f3 d2f3 f8b4 c1d2 d8e7","d2d4 d7d5 c2c4 b8c6 c4d5 d8d5 e2e3 e7e5 b1c3 f8b4 c1d2 b4c3 d2c3 e5d4 g1e2","d2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 e7e6 c1g5 b8d7 e2e3 d8a5 f3d2 f8b4 d1c2","d2d4 d7d5 c2c4 d5c4 g1f3 e7e6 e2e3 g8f6 f1c4 f8e7 e1g1 e8g8 b1c3 a7a6 a2a4 c7c5","d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 c7c5 g1f3 c5d4 f3d4 e6e5 d4b5 a7a6 d1a4","d2d4 d7d5 c2c4 e7e6 b1c3 c7c6 g1f3 d5c4 a2a4 f8b4 e2e3 b7b5 c1d2 a7a5","d2d4 d7d5 c2c4 e7e6 b1c3 c7c5 c4d5 e6d5 g1f3 b8c6 c1g5 f8e7 g5e7 g8e7"] },
    { name: "London System (White)", side: "w", lines: ["d2d4 d7d5 g1f3 g8f6 c1f4 e7e6 e2e3 f8d6","d2d4 d7d5 g1f3 g8f6 c1f4 c7c5 e2e3 b8c6 b1d2 e7e6 c2c3"] },
    { name: "Sicilian Defense (Black)", side: "b", lines: ["e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6","e2e4 c7c5 b1c3 d7d6 f2f4 b8c6 g1f3 g7g6 d2d4 c5d4 f3d4 f8g7 c1e3 g8f6 f1e2 e8g8 d4b3 c8e6 e1g1 c6a5 f4f5 e6c4 b3a5 c4e2","e2e4 c7c5 d2d4 c5d4 c2c3 d4c3 b1c3 b8c6 f1c4 e7e6 g1f3 d7d6 e1g1 a7a6 d1e2 b7b5 c4b3 a8a7","e2e4 c7c5 c2c3 d7d5 e4d5 d8d5 d2d4 c5d4 c3d4 b8c6 g1f3 c8g4 b1c3 g4f3 g2f3 d5d4 d1d4 c6d4","e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1g5 b8d7 f1c4 d8a5 d1d2 e7e6 e1c1 b7b5 c4b3 c8b7 h1e1 d7c5 e4e5","e2e4 c7c5 g1f3 d7d6 c2c3 g8f6 f1e2 b8c6 d2d4 c5d4 c3d4 f6e4 d4d5 d8a5 b1c3 e4c3 b2c3","e2e4 c7c5 g1f3 d7d6 f1b5 b8c6 e1g1 c8d7 c2c3 g8f6 f1e1 a7a6 b5c6 d7c6 d2d4 c6e4 c1g5","e2e4 c7c5 b2b4 c5b4 a2a3 d7d5 e4d5 d8d5 g1f3 e7e5 c1b2 b8c6 c2c4 d5e6","e2e4 c7c5 f2f4 b8c6 g1f3 g7g6 f1b5 f8g7 b5c6 b7c6 e1g1 d7d6 d2d3 g8f6","e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3 e7e6 g2g4 e6e5 d4f5 g7g6 g4g5","e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 f2f4 e7e6 f1e2 d8c7 e1g1 b8c6","e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 f1e2 e7e5 d4b3 f8e7 e1g1 c8e6"] },
    { name: "Caro-Kann Defense (Black)", side: "b", lines: ["e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5","e2e4 c7c6 d2d4 d7d5 b1d2 d5e4 d2e4 c8f5 e4g3 f5g6 h2h4 h7h6 g1f3 b8d7 h4h5 g6h7 f1d3 h7d3 d1d3 e7e6 c1d2 g8f6 e1c1 f8e7","e2e4 c7c6 d2d4 d7d5 e4d5 c6d5 c2c4 b8c6 b1c3 g8f6 g1f3 e7e6 c4d5 e6d5 f1b5 f8d6 c1g5 e8g8 e1g1","e2e4 c7c6 d2d3 d7d5 b1d2 g7g6 g1f3 f8g7 g2g3 e7e5 f1g2 g8e7 e1g1 e8g8 b2b4","e2e4 c7c6 d2d4 d7d5 e4e5 c8f5 b1c3 e7e6 g2g4 f5g6 g1e2 c6c5 h2h4","e2e4 c7c6 d2d4 d7d5 f2f3 d5e4 f3e4 e7e5 g1f3 e5d4 f1c4","e2e4 c7c6 g1f3 d7d5 d2d3 d5e4 d3e4 d8d1 e1d1","e2e4 c7c6 c2c4 d7d5 e4d5 c6d5 c4d5 g8f6","e2e4 c7c6 b1c3 d7d5 g1f3 c8g4 h2h3 g4f3","e2e4 c7c6 d2d4 d7d5 b1d2 d5e4 d2e4 c8f5 e4g5 f5g6 g1f3 h7h6 g5e6"] },
    { name: "French Defense (Black)", side: "b", lines: ["e2e4 e7e6 d2d4 d7d5 b1c3 f8b4","e2e4 e7e6 d2d4 d7d5 b1d2 c7c5 e4d5 d8d5 g1f3 c5d4 f1c4 d5d6 e1g1 g8f6 d2b3 b8c6 b3d4 c6d4 f3d4 a7a6","e2e4 e7e6 d2d4 d7d5 b1c3 f8b4 e4e5 c7c5 a2a3 b4c3 b2c3 g8e7 d1g4 d8c7 g4g7 h8g8 g7h7 c5d4 g1e2","e2e4 e7e6 d2d4 d7d5 e4e5 c7c5 c2c3 b8c6 g1f3 d8b6 f1d3 c5d4 c3d4 c8d7 e1g1 c6d4 f3g5","e2e4 e7e6 d2d4 d7d5 b1c3 f8b4 g1e2 d5e4 a2a3 b4e7 c3e4 g8f6 e2g3 e8g8 f1e2 b8c6","e2e4 e7e6 d2d4 d7d5 b1c3 f8b4 e4e5 c7c5 a2a3 b4c3 b2c3 g8e7 a3a4 b8c6 g1f3 d8a5 d1d2 c8d7","e2e4 e7e6 d2d4 d7d5 b1c3 f8b4 c1d2 d5e4 d1g4 g8f6 g4g7 h8g8 g7h6","e2e4 e7e6 d2d4 d7d5 e4d5 e6d5 b1c3 g8f6 c1g5 b8c6","e2e4 e7e6 d2d3 d7d5 b1d2 g8f6 g1f3 b8c6 f1e2","e2e4 e7e6 d2d4 d7d5 b1c3 f8b4 e4d5 e6d5 f1d3 g8e7 d1h5"] },
    { name: "Scandinavian Defense (Black)", side: "b", lines: ["e2e4 d7d5 e4d5 d8d5 b1c3 d5a5 d2d4 g8f6","e2e4 d7d5 e4d5 d8d5 b1c3 d5a5 d2d4 g8f6 g1f3 c8f5 f3e5 c7c6 g2g4"] },
    { name: "King's Indian Defense (Black)", side: "b", lines: ["d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6","d2d4 g8f6 c2c4 g7g6 g1f3 f8g7 g2g3 e8g8 f1g2 d7d6 e1g1 b8c6 b1c3 a7a6 d4d5 c6a5 f3d2 c7c5 d1c2 a8b8 b2b3 b7b5 c1b2 b5c4","d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 f2f3 e8g8 c1e3 e7e5 d4d5 f6h5 d1d2 d8h4 g2g3 h5g3 d2f2 g3f1 f2h4 f1e3 e1e2 e3c4","d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8 f1e2 e7e5 e1g1 b8c6 d4d5 c6e7 f3e1 f6d7 c1e3 f7f5 f2f3 f5f4 e3f2 g6g5","d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 g1f3 d7d6 g2g3 e8g8 f1g2 b8d7 e1g1 e7e5 e2e4 f8e8 h2h3 e5d4 f3d4 d7c5 f1e1 a7a5","d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 f2f4 e8g8 f1e2 c7c5 d4d5 e7e6 d5e6 f7e6 g2g4 b8c6 h2h4","d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8 f1e2 e7e5 d4d5 b8d7 c1g5 h7h6 g5h4 g6g5 h4g3 f6h5 h2h4","d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 f2f4 e8g8 g1f3 c7c5 d4d5 e7e6 f1e2 e6d5 e4e5","d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 f2f3 e8g8 c1g5 c7c5 d4d5 e7e6 d1d2 e6d5 c3d5","d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 f1e2 e8g8 c1g5 b8a6 d1d2 c7c6"] },
    { name: "King's Gambit (White)", side: "w", lines: ["e2e4 e7e5 f2f4 e5f4 g1f3 g7g5 h2h4 g5g4 f3e5 g8f6 d2d4 d7d6","e2e4 e7e5 f2f4 d7d5 e4d5 e5e4 d2d3 g8f6 d3e4 f6e4 g1f3 f8c5 d1e2 c5f2 e1d1 d8d5 f3d2","e2e4 e7e5 f2f4 f8c5 g1f3 d7d6 c2c3 f7f5 f4e5 d6e5 d2d4 e5d4 f1c4","e2e4 e7e5 f2f4 e5f4 g1f3 d7d5 e4d5 g8f6 f1b5 c7c6 d5c6 b7c6 b5c4 f6d5","e2e4 e7e5 f2f4 e5f4 g1f3 f8e7 f1c4 e7h4 g2g3 f4g3 e1g1 g3h2 g1h1","e2e4 e7e5 f2f4 e5f4 g1f3 h7h6 f1c4 d7d6 d2d4 g7g5 h2h4 f8g7 d1d3","e2e4 e7e5 f2f4 f7f5 e4f5 e5f4 d1h5 g7g6 f5g6 d8e7 e1d1","e2e4 e7e5 f2f4 e5f4 g1f3 g7g5 h2h4 g5g4 f3e5 d7d5 d2d4 g8f6 c1f4 f6e4 b1d2","e2e4 e7e5 f2f4 e5f4 g1f3 g7g5 h2h4 g5g4 f3e5 h7h5 f1c4 h8h7 d2d4 f8h6 b1c3","e2e4 e7e5 f2f4 d8f6 b1c3 f6f4 g1f3 f8b4 f1c4","e2e4 e7e5 f2f4 e5f4 g1f3 g7g5 h2h4 g5g4 f3e5 d8e7 d2d4 f7f5 f1c4","e2e4 e7e5 f2f4 f8c5 g1f3 d7d6 c2c3 c8g4 f4e5 d6e5 d1a4","e2e4 e7e5 f2f4 e5f4 g1f3 d7d6 d2d4 g8f6 f1d3","e2e4 e7e5 f2f4 e5f4 g1f3 g8f6 e4e5 f6h5 g2g4","e2e4 e7e5 f2f4 b8c6 g1f3 g7g5 f4g5 h7h6","e2e4 e7e5 f2f4 d7d5 e4d5 e5e4 d2d3 g8f6 d3e4 f6e4 g1f3 f8c5 d1e2 c8f5 g2g4 e8g8","e2e4 e7e5 f2f4 d7d5 e4d5 c7c6 d5c6 f8c5","e2e4 e7e5 f2f4 e5f4 g1f3 b8c6 f1c4 g7g5","e2e4 e7e5 f2f4 d8h4 g2g3 h4e7","e2e4 e7e5 f2f4 f7f6 f4e5 b8c6"] },
    { name: "Danish Gambit (White)", side: "w", lines: ["e2e4 e7e5 d2d4 e5d4 c2c3 d4c3 f1c4 c3b2 c1b2 g8f6 b1c3 f8b4 g1e2 e8g8 e1g1 d7d6"] },
    { name: "Evans Gambit (White)", side: "w", lines: ["e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4 c5b4 c2c3 b4a5 d2d4 e5d4 e1g1 d7d6 c3d4 a5b6 b1c3 g8f6","e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4 c5b6 b4b5 c6a5 f3e5 g8h6 d2d4 d7d6 c1h6 d6e5 h6g7 h8g8 c4f7 e8f7 g7e5 d8g5 b1d2","e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4 c5b4 c2c3 b4c5 d2d4 e5d4 e1g1 d7d6 c3d4 c5b6 b1c3 c8g4 d1a4 g4d7 a4b3 c6a5 c4f7 e8f8","e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4 c5b4 c2c3 b4a5 d2d4 d7d6 d1b3 d8d7 d4e5 d6e5 e1g1 a5b6 c1a3 c6a5 f3e5","e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4 c5b4 c2c3 b4a5 d2d4 e5d4 e1g1 d4c3 d1b3 d8f6 e4e5 f6g6 b1c3 g8e7 c1a3","e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4 c5b6 b4b5 c6a5 f3e5 d8g5 d1f3 g5e5 f3f7 e8d8 c1b2","e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4 c5b4 c2c3 b4c5 d2d4 e5d4 e1g1 d7d6 c3d4 c5b6 b1c3 c6a5 c1g5 f7f6 g5e3","e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4 c5b4 c2c3 b4e7 d2d4 c6a5"] },
    { name: "Smith-Morra Gambit (White)", side: "w", lines: ["e2e4 c7c5 d2d4 c5d4 c2c3 d4c3 b1c3 b8c6 f1c4 e7e6 g1f3 d7d6 e1g1 a7a6 d1e2 b7b5 c4b3","e2e4 c7c5 d2d4 c5d4 c2c3 d4c3 b1c3 e7e6 g1f3 d7d6 f1c4 a7a6 e1g1 f8e7 d1e2 g8f6","e2e4 c7c5 d2d4 c5d4 c2c3 d4c3 b1c3 d7d6 g1f3 e7e6 f1c4 g8f6 e1g1 a7a6","e2e4 c7c5 d2d4 c5d4 c2c3 d4d3 c3c4"] },
    { name: "Scotch Gambit (White)", side: "w", lines: ["e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f1c4 g8f6 e1g1 f8c5 e4e5 d7d5 e5f6 d5c4 f1e1 c8e6","e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f1c4 g8f6 e1g1 f8c5 e4e5 d7d5 e5f6 d5c4 f1e1 c8e6 f3g5 d8d5 b1c3 d5f5 c3e4","e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f1c4 g8f6 e1g1 f6e4 f1e1 d7d5 b1c3","e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f1c4 f8c5 e1g1 d7d6 c2c3 c8g4"] },
    { name: "Vienna Gambit (White)", side: "w", lines: ["e2e4 e7e5 b1c3 g8f6 f2f4 d7d5 f4e5 f6e4 g1f3 c8g4 d1e2"] },
    { name: "Blackmar-Diemer Gambit (White)", side: "w", lines: ["d2d4 d7d5 e2e4 d5e4 b1c3 g8f6 f2f3 e4f3 g1f3 e7e6 c1g5 f8e7 f1d3 b8c6 e1g1","d2d4 d7d5 e2e4 d5e4 b1c3 g8f6 f2f3 e4f3 g1f3 g7g6 f1c4 f8g7 e1g1 e8g8 g1h1","d2d4 d7d5 e2e4 d5e4 b1c3 g8f6 f2f3 e4f3 g1f3 c8g4 h2h3 g4f3 d1f3 c7c6 f3f2","d2d4 d7d5 e2e4 d5e4 b1c3 g8f6 f2f3 e4f3 g1f3 c8f5 f3e5 e7e6 g2g4 f5e4","d2d4 d7d5 e2e4 d5e4 b1c3 g8f6 f2f3 e4f3 g1f3 e7e6 c1g5 f8e7 f1d3 b8c6 e1g1 c6d4 g1h1","d2d4 d7d5 e2e4 d5e4 b1c3 g8f6 f2f3 e7e6 f3e4"] },
    { name: "Budapest Gambit (Black)", side: "b", lines: ["d2d4 g8f6 c2c4 e7e5 d4e5 f6g4 c1f4 b8c6 g1f3 f8b4 b1d2 d8e7 e2e3 g4e5 f3e5 c6e5","d2d4 g8f6 c2c4 e7e5 d4e5 f6g4 e2e4 g4e5"] },
    { name: "Albin Countergambit (Black)", side: "b", lines: ["d2d4 d7d5 c2c4 e7e5 d4e5 d5d4 g1f3 b8c6 b1d2 c8g4 h2h3 g4f3 d2f3 f8b4 c1d2 d8e7","d2d4 d7d5 c2c4 e7e5 d4e5 d5d4 e2e3 f8b4 c1d2 d4e3","d2d4 d7d5 c2c4 e7e5 d4e5 d5d4 g1f3 b8c6 g2g3 c8e6"] },
    { name: "Benko Gambit (Black)", side: "b", lines: ["d2d4 g8f6 c2c4 c7c5 d4d5 b7b5 c4b5 a7a6 b5a6 g7g6 b1c3 c8a6 e2e4 d7d6 g1f3 f8g7","d2d4 g8f6 c2c4 c7c5 d4d5 b7b5 c4b5 a7a6 b1c3 a6b5 e2e4 b5b4 c3b5 d7d6 f1c4","d2d4 g8f6 c2c4 c7c5 d4d5 b7b5 c4b5 a7a6 b5a6 g7g6 b1c3 c8a6 g2g3 d7d6 f1g2 f8g7 g1f3","d2d4 g8f6 c2c4 c7c5 d4d5 b7b5 c4b5 a7a6 b5a6 g7g6 b1c3 c8a6 g1f3 d7d6 e2e4"] }
  ];
  let openingIdx = 0;
  try {
    const saved = Number(localStorage.getItem('eni-opening'));
    if (Number.isInteger(saved) && saved >= 0 && saved < OPENINGS.length) openingIdx = saved;
  } catch (e) {}
  const favoriteOpenings = { w: null, b: null };
  try {
    const saved = JSON.parse(localStorage.getItem('eni-favorite-openings') || '{}');
    for (const side of ['w', 'b']) {
      if (OPENINGS.some(opening => opening.side === side && opening.name === saved[side]))
        favoriteOpenings[side] = saved[side];
    }
  } catch (e) {}

  // ── STATE ─────────────────────────────────────────────────────────────────
  let engine      = null;
  let engineReady = false;
  let lastFEN     = '';
  let svgLayer    = null;
  let panel       = null;
  let debounce    = null;
  let humanTimer  = null;
  let previewTimer = null;
  let previewShown = false;
  let enabled     = true;
  let autoMoveEnabled = false;
  let stealthMode = false;
  let peekTimer   = null;
  let forcedSide  = null;
  let showPreMove = true;
  let queuedPreMove = '';
  let pendingPreMove = null;
  let nativeQueuedPreMove = false;
  let showThreats = true;
  let tablebase = null;
  const tablebaseCache = new Map();
  let configuredMultiPV = 0;
  let lastAutoMoveKey = '';
  let searchFEN = '';
  let top3FEN = '';
  let engineBlobURLs = [];
  let engineSearching = false;
  let stopRequested = false;
  let engineTimeout = null;
  let restartTimer = null;
  let pendingAnalysisFEN = null;
  let strengthDirty = false;
  let workerRestarts = 0;
  let bookActiveFEN = '';
  let lastPlayerSide = null;
  let displayedOpeningSide = null;

  let top3        = [];
  let workingPV   = {};
  let lastEval    = 0;
  let displayRank = -1;

  function dbg(msg) { console.log('[Evilfish]', msg); }

  const PIECE_MAP = {
    wp:'P', wr:'R', wn:'N', wb:'B', wq:'Q', wk:'K',
    bp:'p', br:'r', bn:'n', bb:'b', bq:'q', bk:'k'
  };
  const START_PLACEMENT = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
  let trackedCastling = { placement: '', rights: '-' };

  // ── DOM ───────────────────────────────────────────────────────────────────
  function getBoard() {
    return (
      document.querySelector('wc-chess-board')           ||
      document.querySelector('chess-board')              ||
      document.querySelector('.board-layout-chessboard') ||
      document.querySelector('.board-board')             ||
      document.querySelector('.board')
    );
  }

  function isFlipped() {
    const b = getBoard();
    if (!b) return false;
    if (b.hasAttribute('flipped') || b.classList.contains('flipped')) return true;
    const orient = b.getAttribute('board-orientation');
    if (orient === 'black') return true;
    if (orient === 'white') return false;
    try {
      const allTexts = Array.from(document.querySelectorAll('svg text, [class*="coordinate"] span, [class*="rank"] span'));
      const rankTexts = allTexts.map(t => t.textContent.trim()).filter(t => /^[1-8]$/.test(t));
      if (rankTexts.length >= 4) {
        if (rankTexts[0] === '1') return true;
        if (rankTexts[0] === '8') return false;
      }
      const fileTexts = allTexts.map(t => t.textContent.trim()).filter(t => /^[a-h]$/.test(t));
      if (fileTexts.length >= 4) {
        if (fileTexts[0] === 'h') return true;
        if (fileTexts[0] === 'a') return false;
      }
    } catch (e) {}
    return false;
  }

  // ── FEN EXTRACTION ────────────────────────────────────────────────────────
  function isValidFEN(fen) {
    if (!fen) return false;
    const parts = fen.trim().split(/\s+/);
    const placement = parts[0];
    if (parts[1] !== 'w' && parts[1] !== 'b') return false;
    if (!/^(-|[KQkq]{1,4})$/.test(parts[2] || '')) return false;
    if (!/^(-|[a-h][36])$/.test(parts[3] || '')) return false;
    if (!/^\d+$/.test(parts[4] || '') || !/^[1-9]\d*$/.test(parts[5] || '')) return false;
    const ranks = placement.split('/');
    if (ranks.length !== 8) return false;
    if (ranks.some(rank => !/^[prnbqkPRNBQK1-8]+$/.test(rank) ||
        [...rank].reduce((n, ch) => n + (/\d/.test(ch) ? +ch : 1), 0) !== 8)) return false;
    if (/[Pp]/.test(ranks[0]) || /[Pp]/.test(ranks[7])) return false;
    if ((placement.match(/K/g) || []).length !== 1) return false;
    if ((placement.match(/k/g) || []).length !== 1) return false;
    if ((placement.match(/[P]/g) || []).length > 8 ||
        (placement.match(/[p]/g) || []).length > 8) return false;
    if ((placement.match(/[A-Z]/g) || []).length > 16 ||
        (placement.match(/[a-z]/g) || []).length > 16) return false;
    if (legalCastlingRights(placement, parts[2]) !== parts[2]) return false;
    if (parts[3] !== '-') {
      const pieces = boardFromPlacement(placement);
      const ep = parts[3];
      const pawnSquare = ep[0] + (parts[1] === 'w' ? '5' : '4');
      if (+ep[1] !== (parts[1] === 'w' ? 6 : 3) || pieces[ep] ||
          pieces[pawnSquare] !== (parts[1] === 'w' ? 'p' : 'P')) return false;
    }
    return true;
  }

  function boardFromPlacement(placement) {
    const pieces = {};
    placement.split('/').forEach((row, i) => {
      let file = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) file += +ch;
        else pieces[String.fromCharCode(97 + file++) + (8 - i)] = ch;
      }
    });
    return pieces;
  }

  function plausibleMove(fen, move) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) return false;
    const [placement, side, rights, ep] = fen.split(' ');
    const pieces = boardFromPlacement(placement);
    const from = move.slice(0, 2), to = move.slice(2, 4);
    const piece = pieces[from], target = pieces[to];
    if (!piece || (piece === piece.toUpperCase()) !== (side === 'w')) return false;
    if (target && (target === target.toUpperCase()) === (side === 'w')) return false;
    const df = to.charCodeAt(0) - from.charCodeAt(0);
    const dr = +to[1] - +from[1];
    const distance = Math.max(Math.abs(df), Math.abs(dr));
    const pathClear = () => {
      for (let step = 1; step < distance; step++) {
        const square = String.fromCharCode(from.charCodeAt(0) + Math.sign(df) * step) +
                       (+from[1] + Math.sign(dr) * step);
        if (pieces[square]) return false;
      }
      return true;
    };
    if (piece.toLowerCase() !== 'p' && move[4]) return false;
    switch (piece.toLowerCase()) {
      case 'n': return (Math.abs(df) === 1 && Math.abs(dr) === 2) ||
                       (Math.abs(df) === 2 && Math.abs(dr) === 1);
      case 'b': return Math.abs(df) === Math.abs(dr) && distance > 0 && pathClear();
      case 'r': return ((df === 0) !== (dr === 0)) && pathClear();
      case 'q': return (Math.abs(df) === Math.abs(dr) || df === 0 || dr === 0) &&
                       distance > 0 && pathClear();
      case 'k': {
        if (distance === 1) return true;
        const home = side === 'w' ? 'e1' : 'e8';
        const castle = side === 'w' ? (to === 'g1' ? 'K' : to === 'c1' ? 'Q' : '')
                                    : (to === 'g8' ? 'k' : to === 'c8' ? 'q' : '');
        return from === home && !!castle && rights.includes(castle) && pathClear();
      }
      case 'p': {
        const direction = side === 'w' ? 1 : -1;
        const lastRank = side === 'w' ? 8 : 1;
        if ((+to[1] === lastRank) !== !!move[4]) return false;
        if (df === 0 && !target) {
          if (dr === direction) return true;
          if (dr === 2 * direction && +from[1] === (side === 'w' ? 2 : 7))
            return !pieces[from[0] + (+from[1] + direction)];
        }
        return Math.abs(df) === 1 && dr === direction &&
               (!!target || (to === ep && !target));
      }
      default: return false;
    }
  }

  function legalCastlingRights(placement, rights) {
    const pieces = boardFromPlacement(placement);
    const homes = {
      K: pieces.e1 === 'K' && pieces.h1 === 'R',
      Q: pieces.e1 === 'K' && pieces.a1 === 'R',
      k: pieces.e8 === 'k' && pieces.h8 === 'r',
      q: pieces.e8 === 'k' && pieces.a8 === 'r'
    };
    return [...'KQkq'].filter(ch => rights.includes(ch) && homes[ch]).join('') || '-';
  }

  function siteFENFor(placement) {
    const board = getBoard();
    const candidates = [];
    try { candidates.push(board?.game?.getFEN?.()); } catch (e) {}
    for (let el = board, n = 0; el && n < 4; el = el.parentElement, n++) {
      candidates.push(el.getAttribute('fen'), el.getAttribute('data-fen'));
    }
    try {
      const key = Object.keys(board).find(k => k.startsWith('__reactFiber') ||
                                                 k.startsWith('__reactInternalInstance'));
      for (let fiber = key && board[key], n = 0; fiber && n < 80; fiber = fiber.return, n++) {
        const props = fiber.memoizedProps || fiber.pendingProps || {};
        candidates.push(props.fen, props.position);
      }
    } catch (e) {}
    for (const raw of candidates) {
      if (typeof raw !== 'string') continue;
      const parts = raw.trim().split(/\s+/);
      if (parts[0] !== placement || !['w', 'b'].includes(parts[1])) continue;
      const rights = legalCastlingRights(placement, parts[2] || '-');
      const ep = /^(-|[a-h][36])$/.test(parts[3] || '') ? parts[3] : '-';
      const side = forcedSide || parts[1];
      const fen = `${placement} ${side} ${rights} ${side === parts[1] ? ep : '-'} ${parts[4] || 0} ${parts[5] || 1}`;
      if (isValidFEN(fen)) return fen;
    }
    return null;
  }

  function fallbackCastlingRights(placement) {
    if (placement === START_PLACEMENT && trackedCastling.placement !== START_PLACEMENT)
      trackedCastling.rights = 'KQkq';
    if (trackedCastling.placement && trackedCastling.placement !== placement) {
      const before = boardFromPlacement(trackedCastling.placement);
      const after = boardFromPlacement(placement);
      const homes = { K: ['e1', 'K', 'h1', 'R'], Q: ['e1', 'K', 'a1', 'R'],
                      k: ['e8', 'k', 'h8', 'r'], q: ['e8', 'k', 'a8', 'r'] };
      for (const [right, [kingSquare, king, rookSquare, rook]] of Object.entries(homes)) {
        if ((before[kingSquare] === king && after[kingSquare] !== king) ||
            (before[rookSquare] === rook && after[rookSquare] !== rook))
          trackedCastling.rights = trackedCastling.rights.replace(right, '');
      }
    }
    trackedCastling.rights = legalCastlingRights(placement, trackedCastling.rights);
    trackedCastling.placement = placement;
    return trackedCastling.rights;
  }

  function buildFEN() {
    const board = getBoard();
    if (!board) return null;
    for (const sel of ['.promotion-window', 'wc-promotion-window', '[class*="promotion-window"]']) {
      for (const d of document.querySelectorAll(sel)) {
        if (d.offsetParent !== null && d.getBoundingClientRect().width > 0) return null;
      }
    }
    const grid      = Array.from({ length: 8 }, () => Array(8).fill(null));
    const boardRect = board.getBoundingClientRect();
    const cellSize  = boardRect.width / 8;
    const flip      = isFlipped();

    let pieceEls = board.querySelectorAll('.piece[class*="square-"]');
    if (!pieceEls.length) pieceEls = board.querySelectorAll('[class*="piece"],[class*="Piece"]');

    pieceEls.forEach(el => {
      if (el.closest && el.closest('.promotion-window, [class*="promotion-piece"]')) return;
      const cls = el.getAttribute('class') || '';
      if (/promotion/i.test(cls)) return;
      let code = null, file = -1, rank = -1;
      cls.split(' ').forEach(c => {
        if (PIECE_MAP[c]) code = PIECE_MAP[c];
        const m = c.match(/^square-(\d)(\d)$/);
        if (m) { file = +m[1] - 1; rank = +m[2] - 1; }
      });
      if (code !== null && (file < 0 || rank < 0) && cellSize > 0) {
        const r  = el.getBoundingClientRect();
        const cx = r.left - boardRect.left + r.width  / 2;
        const cy = r.top  - boardRect.top  + r.height / 2;
        const col = Math.floor(cx / cellSize);
        const row = Math.floor(cy / cellSize);
        if (col >= 0 && col < 8 && row >= 0 && row < 8) {
          file = flip ? 7 - col : col;
          rank = flip ? row     : 7 - row;
        }
      }
      if (code !== null && file >= 0 && rank >= 0 && file < 8 && rank < 8)
        grid[7 - rank][file] = code;
    });

    let placement = '';
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = grid[r][f];
        if (p) { if (empty) placement += empty; placement += p; empty = 0; }
        else    empty++;
      }
      if (empty) placement += empty;
      if (r < 7) placement += '/';
    }
    const siteFEN = siteFENFor(placement);
    if (siteFEN) {
      trackedCastling = { placement, rights: siteFEN.split(' ')[2] };
      return siteFEN;
    }
    return `${placement} ${detectSide()} ${fallbackCastlingRights(placement)} - 0 1`;
  }

  function sideFromLastMove() {
    const board = getBoard();
    if (!board) return null;
    for (const h of board.querySelectorAll('.highlight[class*="square-"]')) {
      const sq = (h.getAttribute('class') || '').match(/square-(\d\d)/);
      if (!sq) continue;
      const piece = board.querySelector(`.piece.square-${sq[1]}`);
      if (!piece) continue;
      const m = (piece.getAttribute('class') || '').match(/\b([wb])[prnbqk]\b/);
      if (m) return m[1] === 'w' ? 'b' : 'w';
    }
    return null;
  }

  function detectSide() {
    if (forcedSide) return forcedSide;
    try {
      const game = getBoard()?.game;
      const turn = game?.getTurn?.();
      if (turn === 1 || turn === 'white' || turn === 'w') return 'w';
      if (turn === 2 || turn === 'black' || turn === 'b') return 'b';
    } catch (e) {}
    const lm = sideFromLastMove();
    if (lm) return lm;
    for (const el of document.querySelectorAll('[fen],[data-fen]')) {
      const fen = el.getAttribute('fen') || el.getAttribute('data-fen') || '';
      const parts = fen.trim().split(' ');
      if (parts[1] === 'w' || parts[1] === 'b') return parts[1];
    }
    try {
      const boardEl = getBoard();
      if (boardEl) {
        const fk = Object.keys(boardEl).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
        if (fk) {
          let fiber = boardEl[fk];
          for (let i = 0; i < 80 && fiber; i++) {
            const props = fiber.memoizedProps || fiber.pendingProps || {};
            const fen = props.fen || props.position || '';
            if (typeof fen === 'string') {
              const p = fen.trim().split(' ');
              if (p[1] === 'w' || p[1] === 'b') return p[1];
            }
            fiber = fiber.return;
          }
        }
      }
    } catch(e) {}
    for (const el of document.querySelectorAll('[class*="clock"]')) {
      const active = el.classList.contains('clock-player-turn') || el.classList.contains('active') || el.getAttribute('active') === 'true';
      if (active) {
        const bottom = el.getBoundingClientRect().top > window.innerHeight * 0.5;
        return (bottom !== isFlipped()) ? 'w' : 'b';
      }
    }
    const plies = document.querySelectorAll('[data-ply]');
    if (plies.length) {
      const max = Math.max(...Array.from(plies).map(e => +(e.dataset.ply) || 0));
      return max % 2 === 0 ? 'w' : 'b';
    }
    try {
      const nd = window.__NEXT_DATA__?.props?.pageProps;
      if (nd?.game?.fen) {
        const p = nd.game.fen.split(' ');
        if (p[1] === 'w' || p[1] === 'b') return p[1];
      }
    } catch(e) {}
    const notation = document.querySelectorAll('.notranslate, [translate="no"]');
    if (notation.length > 0) return notation.length % 2 === 0 ? 'w' : 'b';
    const hlSels = ['[class*="selected"]','[class*="active-move"]','[class*="current-move"]','[aria-selected="true"]','[class*="node-highlight"]','[class*="move-highlight"]'];
    for (const sel of hlSels) {
      const els = Array.from(document.querySelectorAll(sel));
      if (!els.length) continue;
      const last = els[els.length - 1];
      const idx  = Array.from(last.parentElement?.children || []).indexOf(last);
      if (idx === 0) return 'b';
      if (idx >= 1)  return 'w';
    }
    return 'w';
  }

  // ── ENGINE ────────────────────────────────────────────────────────────────
  function fetchEngineAsset(url, responseType) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url, responseType, timeout: 45000,
        onload(res) {
          if (res.status !== 200) return reject(new Error(`HTTP ${res.status}: ${url}`));
          resolve(responseType === 'arraybuffer' ? res.response : res.responseText);
        },
        onerror: () => reject(new Error(`Fetch failed: ${url}`)),
        ontimeout: () => reject(new Error(`Timeout: ${url}`))
      });
    });
  }

  function armEngineTimeout(worker, ms, phase) {
    clearTimeout(engineTimeout);
    engineTimeout = setTimeout(() => {
      if (engine === worker) recoverEngine(`${phase} timed out`);
    }, ms);
  }

  function recoverEngine(reason) {
    dbg(`recovering engine: ${reason}`);
    clearTimeout(engineTimeout);
    engineTimeout = null;
    try { engine?.terminate(); } catch (e) {}
    engine = null;
    configuredMultiPV = 0;
    engineReady = false;
    engineSearching = false;
    stopRequested = false;
    pendingAnalysisFEN = null;
    workingPV = {};
    top3 = [];
    top3FEN = '';
    bookActiveFEN = '';
    clearArrows();
    setStatus('Recovering engine…', '#ffa500');
    clearTimeout(restartTimer);
    const delay = Math.min(500 * 2 ** Math.min(workerRestarts++, 5), 15000);
    restartTimer = setTimeout(startEngineWorker, delay);
  }

  function startEngineWorker() {
    try {
      const worker = new Worker(engineBlobURLs[0] + '#' + encodeURIComponent(engineBlobURLs[1]));
      engine = worker;
      configuredMultiPV = 0;
      engineReady = false;
      engineSearching = false;
      stopRequested = false;
      pendingAnalysisFEN = null;
      workingPV = {};
      clearTimeout(previewTimer);
      previewTimer = null;
      previewShown = false;
      worker.onmessage = event => {
        if (engine === worker) onEngineMsg(event);
      };
      worker.onerror = event => {
        if (engine !== worker) return;
        recoverEngine(`worker error: ${event.message} at ${event.filename}:${event.lineno}`);
      };
      worker.postMessage('uci');
      armEngineTimeout(worker, 15000, 'UCI startup');
    } catch (e) {
      recoverEngine('worker start failed: ' + e);
    }
  }

  async function bootEngine() {
    if (typeof GM_xmlhttpRequest === 'undefined') {
      setStatus('Grant missing ✗', '#ff5555'); return;
    }
    setStatus('Fetching Stockfish 19…', '#888');
    try {
      const [script, wasm] = await Promise.all([
        fetchEngineAsset(ENGINE_JS_URL, 'text'),
        fetchEngineAsset(ENGINE_WASM_URL, 'arraybuffer')
      ]);
      const bytes = new Uint8Array(wasm);
      if (!script || bytes.length < 4 || bytes[0] !== 0 || bytes[1] !== 97 ||
          bytes[2] !== 115 || bytes[3] !== 109) throw new Error('Invalid engine assets');
      const scriptURL = URL.createObjectURL(new Blob([script], { type: 'application/javascript' }));
      const wasmURL = URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
      engineBlobURLs.push(scriptURL, wasmURL);
      startEngineWorker();
    } catch (e) {
      dbg('engine boot failed: ' + e);
      setStatus('Engine fetch failed; retrying…', '#ffa500');
      clearTimeout(restartTimer);
      restartTimer = setTimeout(bootEngine, 10000);
    }
  }

  function applyStrength() {
    if (!engine) return;
    const t = TIERS[accuracyIdx];
    if (t.mode === 'max') {
      engine.postMessage('setoption name UCI_LimitStrength value false');
      engine.postMessage('setoption name Skill Level value 20');
    } else if (t.mode === 'elo') {
      engine.postMessage('setoption name Skill Level value 20');
      engine.postMessage('setoption name UCI_LimitStrength value true');
      engine.postMessage(`setoption name UCI_Elo value ${t.elo}`);
    } else {
      engine.postMessage('setoption name UCI_LimitStrength value false');
      engine.postMessage(`setoption name Skill Level value ${t.skill}`);
    }
  }

  function parseScore(line, mpvN) {
    const scoreM = line.match(/score (cp|mate) (-?\d+)/);
    if (!scoreM) return;
    if (!workingPV[mpvN]) workingPV[mpvN] = {};
    const raw  = +scoreM[2];
    workingPV[mpvN].scoreRaw = raw;
    workingPV[mpvN].mateScore = scoreM[1] === 'mate' ? raw : null;
    workingPV[mpvN].scoreBounded = /\b(?:lowerbound|upperbound)\b/.test(line);
    workingPV[mpvN].score    = scoreM[1] === 'mate'
      ? `M${raw}`
      : `${raw > 0 ? '+' : ''}${(raw / 100).toFixed(2)}`;
  }

  function parsePV(line, mpvN) {
    const pvM = line.match(/ pv (.+)/);
    if (!pvM) return;
    if (!workingPV[mpvN]) workingPV[mpvN] = {};
    const moves = pvM[1].trim().split(' ');
    workingPV[mpvN].move = moves[0];
    workingPV[mpvN].pv   = moves;
  }

  function showSearchPreview() {
    previewTimer = null;
    if (!enabled || !engineSearching || stopRequested || previewShown ||
        searchFEN !== lastFEN || bookActiveFEN) return;
    const entries = Array.from({ length: MULTI_PV }, (_, k) => workingPV[k + 1])
      .filter(entry => entry && plausibleMove(searchFEN, entry.move));
    if (!entries.length) return;
    top3 = entries.map(entry => ({ ...entry, score: `${entry.score || '?'}~` }));
    previewShown = true;
    renderAllArrows();
    updatePanel();
  }

  function onEngineMsg({ data: line }) {
    if (line === 'uciok') {
      armEngineTimeout(engine, 15000, 'UCI ready');
      engine.postMessage('setoption name Hash value 128');
      configuredMultiPV = desiredMultiPV();
      engine.postMessage(`setoption name MultiPV value ${configuredMultiPV}`);
      applyStrength();
      engine.postMessage('isready');
      return;
    }
    if (line === 'readyok') {
      clearTimeout(engineTimeout);
      engineTimeout = null;
      dbg('Engine live ✓');
      engineReady = true;
      if (strengthDirty) {
        applyStrength();
        strengthDirty = false;
      }
      lastFEN = '';
      setStatus('Engine ready ✓', '#00c864');
      onBoardChange();
      return;
    }

    const mpvM = line.match(/multipv (\d+)/);
    const mpvN = mpvM ? +mpvM[1] : 1;

    parseScore(line, mpvN);
    parsePV(line,    mpvN);
    const depth = +(line.match(/^info depth (\d+)/)?.[1] || 0);
    if (depth >= Math.min(8, TIERS[accuracyIdx].depth) && / pv /.test(line) &&
        !previewShown && !previewTimer && engineSearching && !stopRequested &&
        searchFEN === lastFEN && !bookActiveFEN)
      previewTimer = setTimeout(showSearchPreview, 50);

    if (/^bestmove/.test(line)) {
      clearTimeout(engineTimeout);
      engineTimeout = null;
      clearTimeout(previewTimer);
      previewTimer = null;
      const wasStopped = stopRequested;
      engineSearching = false;
      stopRequested = false;
      if (wasStopped) {
        workingPV = {};
        const nextFEN = pendingAnalysisFEN;
        pendingAnalysisFEN = null;
        if (nextFEN && enabled && nextFEN === lastFEN && !bookActiveFEN)
          startEngineSearch(nextFEN);
        return;
      }
      if (bookActiveFEN === lastFEN || searchFEN !== lastFEN) {
        workingPV = {};
        return;
      }
      top3 = Array.from({ length: MULTI_PV }, (_, k) => workingPV[k + 1])
        .filter(entry => entry && plausibleMove(searchFEN, entry.move));
      const chosen = line.match(/^bestmove ([a-h][1-8][a-h][1-8][qrbn]?)/)?.[1];
      if (chosen && plausibleMove(searchFEN, chosen)) {
        const index = top3.findIndex(entry => entry.move === chosen);
        if (index > 0) top3.unshift(top3.splice(index, 1)[0]);
        else if (index < 0) top3.unshift({ move: chosen, pv: [chosen], score: '?' });
      }
      top3 = top3.slice(0, MULTI_PV);
      top3FEN = searchFEN;
      workingPV = {};
      workerRestarts = 0;
      dbg(`top3: ${top3.map(t => t.move).join(' | ')}`);

      if (top3[0]) {
        const newEval  = top3[0].scoreRaw || 0;
        const swing    = Math.abs(newEval - lastEval);
        lastEval       = newEval;

        if (enabled) scheduleHumanReveal(swing);
        updatePanel();
        try { queueDetectedPreMove(); }
        catch (e) { dbg(`auto premove error: ${e}`); }
        try { playAutoMove(); }
        catch (e) { dbg(`auto move error: ${e}`); }
      } else {
        clearArrows();
        updatePanel();
      }
    }
  }

  // ── HUMAN DELAY ───────────────────────────────────────────────────────────
  function humanDelay(swing) {
    return Math.round(DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN));
  }

  function pickRank() {
    return displayRank >= 0 ? Math.min(displayRank, top3.length - 1) : 0;
  }

  function scheduleHumanReveal(swing) {
    clearTimeout(humanTimer);
    const delay = humanDelay(swing);
    dbg(`human delay: ${delay}ms`);
    if (!delay) {
      if (enabled && !stealthMode && top3.length) renderAllArrows();
      updatePanel();
      return;
    }
    clearArrows();
    humanTimer = setTimeout(() => {
      if (!enabled || !top3.length) return;
      if (stealthMode) return;
      renderAllArrows();
      updatePanel();
    }, delay);
  }

  function desiredMultiPV() {
    const clock = document.querySelector('.clock-player-turn .clock-time, .clock-player-turn [class*="time"], .clock.active .clock-time');
    const match = clock?.textContent?.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    const seconds = match ? (match[3] ? (+match[1] * 3600 + +match[2] * 60 + +match[3])
                                      : (+match[1] * 60 + +match[2])) : Infinity;
    return SPEEDS[speedIdx].name === 'fast' || seconds <= 25 ? 1 : MULTI_PV;
  }

  function lookupTablebase(fen) {
    const fields = fen.split(' ');
    const count = (fields[0]?.match(/[prnbqkPRNBQK]/g) || []).length;
    if (count < 2 || count > 7 || fields[2] !== '-') {
      tablebase = null;
      return;
    }
    const cached = tablebaseCache.get(fen);
    if (cached) {
      tablebase = { fen, data: cached };
      return;
    }
    if (tablebase?.fen === fen && tablebase.loading) return;
    tablebase = { fen, loading: true };
    GM_xmlhttpRequest({
      method: 'GET',
      url: 'https://tablebase.lichess.ovh/standard?fen=' + encodeURIComponent(fen),
      timeout: 7000,
      onload(response) {
        if (lastFEN !== fen) return;
        try {
          if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
          const data = JSON.parse(response.responseText);
          if (!data.category || !Array.isArray(data.moves)) throw new Error('invalid tablebase response');
          tablebaseCache.set(fen, data);
          if (tablebaseCache.size > 100) tablebaseCache.delete(tablebaseCache.keys().next().value);
          tablebase = { fen, data };
        } catch (error) {
          tablebase = { fen, error: true };
          dbg('tablebase: ' + error);
        }
        updatePanel();
      },
      onerror() { if (lastFEN === fen) { tablebase = { fen, error: true }; updatePanel(); } },
      ontimeout() { if (lastFEN === fen) { tablebase = { fen, error: true }; updatePanel(); } }
    });
  }

  function analyze(fen) {
    dbg(`→ ${fen.slice(0, 60)}`);
    clearTimeout(humanTimer);
    clearTimeout(previewTimer);
    previewTimer = null;
    previewShown = false;
    clearArrows();
    lookupTablebase(fen);
    const bookEntry = openingMoveFor(fen);
    if (bookEntry && plausibleMove(fen, bookEntry.move)) {
      pendingAnalysisFEN = null;
      if (engine && engineSearching && !stopRequested) {
        stopRequested = true;
        engine.postMessage('stop');
        armEngineTimeout(engine, 4000, 'engine stop');
      }
      bookActiveFEN = fen;
      top3 = [{ move: bookEntry.move, pv: [bookEntry.move], score: `book ${bookEntry.ply + 1}/${bookEntry.total}` }];
      top3FEN = fen;
      scheduleHumanReveal(0);
      updatePanel();
      playAutoMove();
      return;
    }
    bookActiveFEN = '';
    top3 = [];
    top3FEN = '';
    updatePanel();
    if (!engineReady || !engine) return;
    if (engineSearching) {
      pendingAnalysisFEN = fen;
      if (!stopRequested) {
        stopRequested = true;
        engine.postMessage('stop');
        armEngineTimeout(engine, 4000, 'engine stop');
      }
      return;
    }
    startEngineSearch(fen);
  }

  function startEngineSearch(fen) {
    if (!engineReady || !engine) return;
    searchFEN = fen;
    workingPV = {};
    previewShown = false;
    if (strengthDirty) {
      applyStrength();
      strengthDirty = false;
    }
    const multiPV = desiredMultiPV();
    if (configuredMultiPV !== multiPV) {
      engine.postMessage(`setoption name MultiPV value ${multiPV}`);
      configuredMultiPV = multiPV;
    }
    engine.postMessage(`position fen ${fen}`);
    const speed = SPEEDS[speedIdx];
    const opponentTurn = fen.split(' ')[1] !== (isFlipped() ? 'b' : 'w');
    const depth = opponentTurn ? Math.max(6, TIERS[accuracyIdx].depth) : TIERS[accuracyIdx].depth;
    engine.postMessage(`go depth ${depth}` +
      (speed.movetime ? ` movetime ${speed.movetime}` : ''));
    engineSearching = true;
    armEngineTimeout(engine, speed.movetime ? Math.max(6000, speed.movetime * 6) : 45000, 'engine search');
    updatePanel();
  }

  // ── SVG ARROWS ────────────────────────────────────────────────────────────
  function ensureSVG() {
    const board = getBoard();
    if (!board) return null;
    if (svgLayer?.isConnected) return svgLayer;

    let el = board;
    for (let i = 0; i < 10 && el && el !== document.body; i++) {
      const ov = getComputedStyle(el).overflow;
      if (ov === 'hidden' || ov === 'clip') el.style.overflow = 'visible';
      el = el.parentElement;
    }

    svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    Object.assign(svgLayer.style, {
      position: 'absolute', inset: '0',
      width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: '2147483647',
      overflow: 'visible'
    });
    if (getComputedStyle(board).position === 'static') board.style.position = 'relative';
    board.appendChild(svgLayer);
    return svgLayer;
  }

  function getBoardGeo() {
    const board = getBoard();
    if (!board) return null;
    return { ox: 0, oy: 0, cell: board.getBoundingClientRect().width / 8 };
  }

  function sqCenter(sq, geo) {
    const fi   = sq.charCodeAt(0) - 97;
    const ri   = +sq[1] - 1;
    const flip = isFlipped();
    const col  = flip ? 7 - fi : fi;
    const row  = flip ? ri     : 7 - ri;
    return {
      x: geo.ox + col * geo.cell + geo.cell / 2,
      y: geo.oy + row * geo.cell + geo.cell / 2
    };
  }

  function drawArrow(svg, from, to, color, opacity, geo) {
    const a    = sqCenter(from, geo);
    const b    = sqCenter(to,   geo);
    const cell = geo.cell;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len  = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const vx = -uy,      vy = ux;
    const shaft = cell * 0.155;
    const head  = cell * 0.295;
    const aLen  = cell * 0.38;
    const inset = cell * 0.26;
    const sx = a.x + ux * inset, sy = a.y + uy * inset;
    const hx = b.x - ux * aLen,  hy = b.y - uy * aLen;
    const pts = [
      [sx + vx*shaft, sy + vy*shaft],
      [hx + vx*shaft, hy + vy*shaft],
      [hx + vx*head,  hy + vy*head ],
      [b.x,           b.y           ],
      [hx - vx*head,  hy - vy*head ],
      [hx - vx*shaft, hy - vy*shaft],
      [sx - vx*shaft, sy - vy*shaft],
    ].map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', pts);
    poly.setAttribute('fill', color);
    poly.style.opacity = String(opacity);
    svg.appendChild(poly);
  }

  function fenBoard() {
    return boardFromPlacement(lastFEN.split(' ')[0]);
  }

  function applyMove(b, mv) {
    const from = mv.slice(0, 2), to = mv.slice(2, 4);
    const p = b[from];
    if (!p) return;
    delete b[from];
    if (/[kK]/.test(p) && Math.abs(to.charCodeAt(0) - from.charCodeAt(0)) === 2) {
      const kingSide = to[0] > from[0];
      const rf = (kingSide ? 'h' : 'a') + from[1];
      const rt = (kingSide ? 'f' : 'd') + from[1];
      if (b[rf]) { b[rt] = b[rf]; delete b[rf]; }
    }
    if (/[pP]/.test(p) && from[0] !== to[0] && !b[to]) delete b[to[0] + from[1]];
    b[to] = mv[4] ? (p === 'P' ? mv[4].toUpperCase() : mv[4]) : p;
  }

  function placementFromBoard(pieces) {
    const rows = [];
    for (let rank = 8; rank >= 1; rank--) {
      let row = '', empty = 0;
      for (let file = 0; file < 8; file++) {
        const piece = pieces[String.fromCharCode(97 + file) + rank];
        if (piece) {
          if (empty) row += empty;
          row += piece;
          empty = 0;
        } else empty++;
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return rows.join('/');
  }

  const openingIndexes = new Map();

  function openingKey(fen) {
    return fen.split(' ').slice(0, 3).join(' ');
  }

  function buildOpeningIndex(opening) {
    const index = new Map();
    index.positions = new Set();
    index.ends = new Set();
    for (const line of opening.lines) {
      const moves = line.split(' ');
      const pieces = boardFromPlacement(START_PLACEMENT);
      let rights = 'KQkq';
      for (let ply = 0; ply < moves.length; ply++) {
        const move = moves[ply];
        const side = ply % 2 ? 'b' : 'w';
        const placement = placementFromBoard(pieces);
        index.positions.add(`${placement} ${side} ${rights || '-'}`);
        if (side === opening.side) {
          const key = `${placement} ${side} ${rights || '-'}`;
          if (!index.has(key)) index.set(key, { move, ply, total: moves.length });
        }
        const from = move.slice(0, 2), to = move.slice(2, 4);
        const piece = pieces[from];
        if (piece === 'K') rights = rights.replace(/[KQ]/g, '');
        if (piece === 'k') rights = rights.replace(/[kq]/g, '');
        if (from === 'a1' || to === 'a1') rights = rights.replace('Q', '');
        if (from === 'h1' || to === 'h1') rights = rights.replace('K', '');
        if (from === 'a8' || to === 'a8') rights = rights.replace('q', '');
        if (from === 'h8' || to === 'h8') rights = rights.replace('k', '');
        applyMove(pieces, move);
        rights = legalCastlingRights(placementFromBoard(pieces), rights);
        if (rights === '-') rights = '';
      }
      const finalKey = `${placementFromBoard(pieces)} ${moves.length % 2 ? 'b' : 'w'} ${rights || '-'}`;
      index.positions.add(finalKey);
      index.ends.add(finalKey);
    }
    return index;
  }

  function getPlayerSide() {
    let side = null;
    try { side = getBoard()?.game?.getPlayingAs?.(); } catch (e) {}
    if (side === 1 || side === 'w' || side === 'white') return 'w';
    if (side === 2 || side === 'b' || side === 'black') return 'b';
    return isFlipped() ? 'b' : 'w';
  }

  function favoriteIndexForSide(side) {
    return OPENINGS.findIndex(opening =>
      opening.side === side && opening.name === favoriteOpenings[side]);
  }

  function activeOpeningIndex() {
    const side = getPlayerSide();
    const favoriteIdx = favoriteIndexForSide(side);
    if (favoriteIdx >= 0) return favoriteIdx;
    return OPENINGS[openingIdx].side === side ? openingIdx : 0;
  }

  function openingMoveFor(fen) {
    const index = activeOpeningIndex();
    const opening = OPENINGS[index];
    if (!opening.side || fen.split(' ')[1] !== opening.side) return null;
    if (!openingIndexes.has(index))
      openingIndexes.set(index, buildOpeningIndex(opening));
    return openingIndexes.get(index).get(openingKey(fen)) || null;
  }

  function openingStatus(fen) {
    const index = activeOpeningIndex();
    if (!index) return 'engine';
    const opening = OPENINGS[index];
    if (!openingIndexes.has(index)) openingIndexes.set(index, buildOpeningIndex(opening));
    const book = openingIndexes.get(index);
    const key = openingKey(fen);
    if (book.has(key)) return 'in saved line';
    if (book.ends.has(key)) return 'line ended · engine';
    if (book.positions.has(key)) return 'in saved line · waiting';
    return fen.split(' ')[1] === getPlayerSide()
      ? 'opponent deviated · engine' : 'line deviated · engine';
  }

  function preMoveFor(entry, myTurn) {
    const [m0, m1, m2] = entry.pv;
    if (!m0 || !m1 || m0.length < 4 || m1.length < 4) return null;
    if (myTurn) return null;
    const d0 = m0.slice(2, 4), d1 = m1.slice(2, 4);
    return fenBoard()[d0] && d1 === d0 ? m1 : null;
  }

  function opponentThreat() {
    if (top3FEN !== lastFEN || !top3[0]?.pv?.length) return null;
    const myTurn = lastFEN.split(' ')[1] === getPlayerSide();
    const move = top3[0].pv[myTurn ? 1 : 0];
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) return null;
    const pieces = fenBoard();
    if (myTurn) applyMove(pieces, top3[0].pv[0]);
    const from = move.slice(0, 2), to = move.slice(2, 4);
    const mover = pieces[from];
    if (!mover || (mover === mover.toUpperCase()) === (getPlayerSide() === 'w')) return null;
    let target = to;
    if (!pieces[target] && /[pP]/.test(mover) && from[0] !== to[0]) target = to[0] + from[1];
    const victim = pieces[target];
    if (!victim || (victim === victim.toUpperCase()) !== (getPlayerSide() === 'w')) target = null;
    return { move, target, after: myTurn };
  }

  function matePreMoveFor(entry, myTurn) {
    if (myTurn || !entry?.pv || entry.scoreBounded ||
        !Number.isInteger(entry.mateScore) || entry.mateScore > -1 || entry.mateScore < -3)
      return null;
    const [opponentMove, reply] = entry.pv;
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(opponentMove) ||
        !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(reply)) return null;
    const piece = fenBoard()[reply.slice(0, 2)];
    const side = lastFEN.split(' ')[1];
    if (!piece || (piece === piece.toUpperCase()) === (side === 'w')) return null;
    return reply;
  }

  function queueDetectedPreMove() {
    if (!enabled || !lastFEN) return;
    const currentFEN = buildFEN();
    if (!currentFEN || currentFEN.split(' ')[0] !== lastFEN.split(' ')[0]) return;
    const fen = lastFEN;
    const myTurn = fen.split(' ')[1] === (isFlipped() ? 'b' : 'w');
    const mateMove = matePreMoveFor(top3[0], myTurn);
    const move = mateMove || top3.map(entry => entry?.pv && preMoveFor(entry, myTurn)).find(Boolean);
    if (!move || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) return;
    const key = fen + '|' + move;
    if (queuedPreMove === key) return;
    pendingPreMove = { fen, move, kind: mateMove ? 'mate' : 'recapture' };
    dbg((move[4] ? 'armed promotion reply: ' : 'armed premove: ') + move);
    queuedPreMove = key;
    updatePanel();
    if (!move[4]) clickBoardMove(move, fen, 'premove').then(ok => {
      if (ok && pendingPreMove?.fen === fen && pendingPreMove.move === move)
        nativeQueuedPreMove = true;
      updatePanel();
    });
  }

  function cancelQueuedPreMove() {
    const hadPending = !!pendingPreMove || nativeQueuedPreMove;
    pendingPreMove = null;
    queuedPreMove = '';
    if (nativeQueuedPreMove) {
      try {
        const premoves = getBoard()?.game?.premoves;
        if (premoves?.getQueue?.().length) premoves.cancel();
      } catch (error) { dbg('premove cancel failed: ' + error); }
    }
    nativeQueuedPreMove = false;
    if (hadPending) updatePanel();
  }

  async function clickBoardMove(move, fen, label) {
    if (move[4]) return false;
    const board = getBoard();
    if (!board) return false;
    const rect = board.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const flip = isFlipped();
    const placement = fen.split(' ')[0];

    function squareCenter(square) {
      const file = square.charCodeAt(0) - 97;
      const rank = Number(square[1]) - 1;
      return {
        x: rect.left + (flip ? 7 - file : file) * rect.width / 8 + rect.width / 16,
        y: rect.top + (flip ? rank : 7 - rank) * rect.width / 8 + rect.width / 16
      };
    }

    function clickSquare(square) {
      const point = squareCenter(square);
      const target = document.elementFromPoint(point.x, point.y);
      if (!target || !board.contains(target)) return false;
      const options = {
        bubbles: true, cancelable: true, composed: true,
        clientX: point.x, clientY: point.y, button: 0,
        pointerId: 1, pointerType: 'mouse', isPrimary: true, detail: 1
      };
      if (typeof PointerEvent === 'function') {
        try { target.dispatchEvent(new PointerEvent('pointerdown', { ...options, buttons: 1 })); }
        catch (e) { dbg('pointerdown unavailable: ' + e); }
      }
      target.dispatchEvent(new MouseEvent('mousedown', { ...options, buttons: 1 }));
      if (typeof PointerEvent === 'function') {
        try { target.dispatchEvent(new PointerEvent('pointerup', { ...options, buttons: 0 })); }
        catch (e) { dbg('pointerup unavailable: ' + e); }
      }
      target.dispatchEvent(new MouseEvent('mouseup', { ...options, buttons: 0 }));
      target.dispatchEvent(new MouseEvent('click', { ...options, buttons: 0 }));
      return true;
    }

    try {
      if (!clickSquare(move.slice(0, 2))) return false;
      await new Promise(resolve => setTimeout(resolve, 50));
      if (!enabled || (label === 'auto move' && !autoMoveEnabled) || getBoard() !== board ||
          (label === 'premove' && pendingPreMove?.move !== move) ||
          buildFEN()?.split(' ')[0] !== placement) return false;
      if (!clickSquare(move.slice(2, 4))) return false;
      dbg(label + ' sent to board: ' + move);
      return true;
    } catch (e) { dbg('board ' + label + ' click failed: ' + e); return false; }
  }

  function playAutoMove() {
    if (!enabled || !autoMoveEnabled || !lastFEN || top3FEN !== lastFEN) return;
    const move = top3[0]?.move;
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) return;
    const board = getBoard();
    if (!board) return;
    const game = board.game;
    const normalizeSide = side => side === 1 || side === 'white' ? 'w'
                               : side === 2 || side === 'black' ? 'b' : side;
    const playerSide = normalizeSide(game?.getPlayingAs?.()) || (isFlipped() ? 'b' : 'w');
    const turn = normalizeSide(game?.getTurn?.()) || lastFEN.split(' ')[1];
    if (turn !== playerSide) return;
    const currentFEN = buildFEN();
    if (!currentFEN || currentFEN.split(' ')[0] !== lastFEN.split(' ')[0]) return;
    const pieces = fenBoard();
    const from = move.slice(0, 2), to = move.slice(2, 4);
    const sourcePiece = pieces[from], targetPiece = pieces[to];
    const playerIsWhite = playerSide === 'w';
    if (!sourcePiece ||
        (sourcePiece === sourcePiece.toUpperCase()) !== playerIsWhite ||
        (targetPiece && (targetPiece === targetPiece.toUpperCase()) === playerIsWhite)) return;
    const key = lastFEN + '|' + move;
    if (lastAutoMoveKey === key) return;

    if (typeof game?.getLegalMoves === 'function' && typeof game.move === 'function') {
      try {
        const legal = game.getLegalMoves().find(m => m.from === from && m.to === to &&
          (move[4] ? m.promotion === move[4] : !m.promotion));
        if (!legal) return;
        const payload = { ...legal, animate: false, userGenerated: true };
        if (move[4]) payload.promotion = move[4];
        lastAutoMoveKey = key;
        const result = game.move(payload);
        if (result?.type === 'Error' || result?.error) {
          lastAutoMoveKey = '';
          if (move[4]) return;
          throw new Error('Board rejected move');
        }
        dbg('auto move played: ' + move);
        return;
      } catch (e) { dbg('board API auto move failed: ' + e); }
    }

    if (move[4]) return;
    lastAutoMoveKey = key;
    clickBoardMove(move, lastFEN, 'auto move').then(ok => {
      if (!ok && lastAutoMoveKey === key) lastAutoMoveKey = '';
    });
  }

  function playPendingPreMove() {
    const pending = pendingPreMove;
    if (!enabled || !pending || !lastFEN) return false;
    if (lastFEN.split(' ')[0] === pending.fen.split(' ')[0]) return false;

    const board = getBoard();
    if (!board) return false;
    const game = board.game;
    const normalizeSide = side => side === 1 || side === 'white' ? 'w'
                               : side === 2 || side === 'black' ? 'b' : side;
    const playerSide = normalizeSide(game?.getPlayingAs?.()) || (isFlipped() ? 'b' : 'w');
    const turn = normalizeSide(game?.getTurn?.()) || lastFEN.split(' ')[1];
    if (turn !== playerSide) return false;

    const move = pending.move;
    const from = move.slice(0, 2);
    const to = move.slice(2, 4);
    const pieces = fenBoard();
    const sourcePiece = pieces[from];
    const targetPiece = pieces[to];
    const playerIsWhite = playerSide === 'w';
    pendingPreMove = null;
    nativeQueuedPreMove = false;
    if (!sourcePiece || (pending.kind !== 'mate' && !targetPiece) ||
        (sourcePiece === sourcePiece.toUpperCase()) !== playerIsWhite ||
        (targetPiece && (targetPiece === targetPiece.toUpperCase()) === playerIsWhite) ||
        !plausibleMove(lastFEN, move)) return false;

    if (typeof game?.getLegalMoves === 'function' && typeof game.move === 'function') {
      try {
        const legal = game.getLegalMoves().find(m => m.from === from && m.to === to &&
          (move[4] ? m.promotion === move[4] : !m.promotion));
        if (!legal) return false;
        const payload = { ...legal, animate: false, userGenerated: true };
        if (move[4]) payload.promotion = move[4];
        const result = game.move(payload);
        if (result?.type === 'Error' || result?.error) return false;
        queuedPreMove = lastFEN + '|' + move;
        dbg('played premove: ' + move);
        return true;
      } catch (e) { queuedPreMove = ''; dbg('board API move failed: ' + e); }
    }

    if (move[4]) return false;
    const source = board.querySelector(
      '.piece.square-' + (from.charCodeAt(0) - 96) + from[1]
    );
    const rect = board.getBoundingClientRect();
    if (!source || !rect.width) return false;
    const flip = isFlipped();
    const position = lastFEN.split(' ')[0];

    function squareCenter(square) {
      const file = square.charCodeAt(0) - 97;
      const rank = Number(square[1]) - 1;
      return {
        x: rect.left + (flip ? 7 - file : file) * rect.width / 8 + rect.width / 16,
        y: rect.top + (flip ? rank : 7 - rank) * rect.width / 8 + rect.width / 16
      };
    }

    const start = squareCenter(from);
    const end = squareCenter(to);
    const options = {
      bubbles: true, cancelable: true, composed: true,
      button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true
    };
    queuedPreMove = lastFEN + '|' + move;
    source.dispatchEvent(new PointerEvent('pointerdown',
      { ...options, clientX: start.x, clientY: start.y, buttons: 1 }));
    source.dispatchEvent(new MouseEvent('mousedown',
      { ...options, clientX: start.x, clientY: start.y, buttons: 1 }));
    setTimeout(() => {
      if (!enabled || getBoard() !== board ||
          buildFEN()?.split(' ')[0] !== position) return;
      const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      for (const point of [middle, end]) {
        source.dispatchEvent(new PointerEvent('pointermove',
          { ...options, clientX: point.x, clientY: point.y, buttons: 1 }));
        source.dispatchEvent(new MouseEvent('mousemove',
          { ...options, clientX: point.x, clientY: point.y, buttons: 1 }));
      }
      const hit = document.elementFromPoint(end.x, end.y);
      const target = hit && board.contains(hit) ? hit : board;
      target.dispatchEvent(new PointerEvent('pointerup',
        { ...options, clientX: end.x, clientY: end.y, buttons: 0 }));
      target.dispatchEvent(new MouseEvent('mouseup',
        { ...options, clientX: end.x, clientY: end.y, buttons: 0 }));
      dbg('played premove: ' + move);
    }, 30);
    return true;
  }
  function renderAllArrows() {
    if (stealthMode) return;
    const svg = ensureSVG();
    if (!svg || !top3.length) return;
    clearArrows();
    const geo = getBoardGeo();
    if (!geo?.cell) return;

    const locked = displayRank >= 0 && displayRank < top3.length;

    top3.forEach((entry, i) => {
      if (i >= COL_RANKS.length) return;
      if (!entry?.move || entry.move.length < 4) return;
      if (locked && i !== displayRank) return;
      const opacity = locked ? 1.0 : (i === 0 ? 1.0 : i === 1 ? 0.62 : 0.45);
      drawArrow(svg, entry.move.slice(0,2), entry.move.slice(2,4), COL_RANKS[i], opacity, geo);
    });

    if (showThreats) {
      const threat = opponentThreat();
      if (threat) {
        if (threat.after)
          drawArrow(svg, threat.move.slice(0, 2), threat.move.slice(2, 4), THREAT_COLOR, 0.6, geo);
        if (threat.target) {
          const center = sqCenter(threat.target, geo);
          const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          ring.setAttribute('cx', center.x);
          ring.setAttribute('cy', center.y);
          ring.setAttribute('r', geo.cell * 0.36);
          ring.setAttribute('fill', 'none');
          ring.setAttribute('stroke', THREAT_COLOR);
          ring.setAttribute('stroke-width', Math.max(3, geo.cell * 0.06));
          svg.appendChild(ring);
        }
      }
    }

    if (showPreMove) {
      const myTurn = (lastFEN.split(' ')[1] || 'w') === (isFlipped() ? 'b' : 'w');
      const seen = new Set();
      top3.forEach((entry, index) => {
        const pm = index === 0 ? matePreMoveFor(entry, myTurn) || preMoveFor(entry, myTurn)
                               : preMoveFor(entry, myTurn);
        if (!pm || seen.has(pm)) return;
        seen.add(pm);
        drawArrow(svg, pm.slice(0,2), pm.slice(2,4), PRE_MOVE_COLOR, 0.78, geo);
      });
    }
  }

  function peekBestMove() {
    clearTimeout(peekTimer);
    clearArrows();
    const entry = top3[displayRank >= 0 ? displayRank : 0];
    if (!entry?.move || entry.move.length < 4) return;
    const svg = ensureSVG();
    const geo = getBoardGeo();
    if (!svg || !geo?.cell) return;
    const rank = displayRank >= 0 ? displayRank : 0;
    drawArrow(svg, entry.move.slice(0,2), entry.move.slice(2,4), COL_RANKS[rank], 1.0, geo);
    peekTimer = setTimeout(() => clearArrows(), 1200);
  }

  function clearArrows() {
    svgLayer?.querySelectorAll('polygon, circle').forEach(p => p.remove());
  }

  // ── PANEL ─────────────────────────────────────────────────────────────────
  function ensurePanel() {
    if (panel?.isConnected) return panel;
    panel = document.createElement('div');
    panel.id = 'evilfish-panel';
    Object.assign(panel.style, {
      position: 'fixed', bottom: '18px', right: '18px',
      background: 'rgba(8,8,12,0.96)', color: '#d8d8e8',
      fontFamily: '"Consolas","Courier New",monospace',
      fontSize: '12px', lineHeight: '1.9',
      padding: '10px 14px', borderRadius: '9px',
      border: '1px solid rgba(0,200,100,0.35)',
      zIndex: '9999', minWidth: '220px',
      width: '340px', maxWidth: 'calc(100vw - 36px)', boxSizing: 'border-box', overflowWrap: 'anywhere',
      boxShadow: '0 4px 24px rgba(0,0,0,0.7)',
      userSelect: 'none', cursor: 'pointer'
    });
    panel.title = 'Click: analyzer; Alt+A: auto move; Alt+T: speed';
    panel.addEventListener('click', e => {
      if (e.target.closest('#evilfish-cancel-premove')) {
        cancelQueuedPreMove();
        return;
      }
      if (e.target.closest('#evilfish-heart')) {
        const opening = OPENINGS[openingIdx];
        if (!opening.side) return;
        const removing = favoriteOpenings[opening.side] === opening.name;
        favoriteOpenings[opening.side] = removing ? null : opening.name;
        if (removing) openingIdx = 0;
        try {
          localStorage.setItem('eni-favorite-openings', JSON.stringify(favoriteOpenings));
          if (removing) localStorage.setItem('eni-opening', '0');
        }
        catch (error) {}
        if (lastFEN && enabled) analyze(lastFEN);
        updatePanel();
        return;
      }
      if (!e.target.closest('#evilfish-opening, label')) toggleEnabled();
    });
    panel.addEventListener('change', e => {
      if (e.target.id !== 'evilfish-opening') return;
      openingIdx = Number(e.target.value);
      try { localStorage.setItem('eni-opening', String(openingIdx)); } catch (error) {}
      if (lastFEN && enabled) analyze(lastFEN);
      updatePanel();
    });
    panel.innerHTML = `<span style="color:#00c864;font-weight:bold">Evilfish</span> booting…`;
    document.body.appendChild(panel);
    return panel;
  }

  function setStatus(msg, color = '#666') {
    const el = ensurePanel();
    el.innerHTML = `<span style="color:#00c864;font-weight:bold">Evilfish</span> <span style="color:${color}">${msg}</span>`;
  }

  function rankLabel(i) {
    const symbols = ['①', '②', '③'];
    const entry   = top3[i];
    if (!entry) return '';
    const locked  = displayRank === i;
    const col     = COL_RANKS[i].replace(/rgba/, 'rgba').replace(/0\.\d+\)/, '1)');
    const style   = `color:${col};${locked ? 'font-weight:bold;text-decoration:underline' : ''}`;
    const promotion = /^[a-h][1-8][a-h][1-8][qrbn]$/.test(entry.move)
      ? `=${entry.move[4].toUpperCase()}` : '';
    const move = promotion ? entry.move.slice(0, 4) + promotion : entry.move;
    return `<span style="${style}">${symbols[i]}</span> ${move.padEnd(6)} <span style="color:#aaa">${entry.score || '?'}</span>`;
  }

  function updatePanel() {
    const playerSide = getPlayerSide();
    if (getBoard() && playerSide !== displayedOpeningSide) {
      displayedOpeningSide = playerSide;
      const favoriteIdx = favoriteIndexForSide(playerSide);
      if (favoriteIdx >= 0) openingIdx = favoriteIdx;
      else if (OPENINGS[openingIdx].side !== playerSide) openingIdx = 0;
    }
    const t = TIERS[accuracyIdx];
    const acc = t.acc;
    const strengthLabel = t.elo === null ? 'max str'
                        : t.mode === 'skill' ? `~${t.elo} Elo`
                        : `${t.elo} Elo`;
    const turn = lastFEN.split(' ')[1] === 'b' ? 'b to move' : 'w to move';
    const sideLabel = `${forcedSide ? (forcedSide === 'w' ? '♔' : '♚') + ' forced' : 'auto'} · ${turn}`;
    const modeStr  = !enabled ? `<span style="color:#ff5555">OFF</span>`
                    : stealthMode ? `<span style="color:#ffa500">STEALTH</span>`
                    : `<span style="color:#00c864">ON</span>`;
    const autoStr = `<span style="color:${autoMoveEnabled ? '#00c864' : '#666'}">AUTO ${autoMoveEnabled ? 'ON' : 'OFF'}</span>`;
    const rows     = [0,1,2].map(rankLabel).filter(Boolean).join('<br>');
    const emptyState = !engineReady ? 'engine starting…'
                     : engineSearching ? 'analyzing…'
                     : top3FEN === lastFEN && lastFEN ? 'no move available'
                     : 'waiting for board…';
    const opening = OPENINGS[openingIdx];
    const activeOpening = OPENINGS[activeOpeningIndex()];
    const openingSide = opening.side === 'w' ? 'White' : opening.side === 'b' ? 'Black' : 'Any side';
    const hearted = opening.side && favoriteOpenings[opening.side] === opening.name;
    const savedWhite = favoriteOpenings.w?.replace(/ \(White\)$/, '') || 'none';
    const savedBlack = favoriteOpenings.b?.replace(/ \(Black\)$/, '') || 'none';
    const premove = pendingPreMove;
    const premoveMove = premove?.move ? premove.move.slice(0, 4) +
      (premove.move[4] ? '=' + premove.move[4].toUpperCase() : '') : '';
    const premoveLine = premove
      ? `<span style="color:#1e90ff">queued ${premove.kind}: ${premoveMove}</span> <button id="evilfish-cancel-premove" title="Cancel queued premove (Alt+X)" style="background:#202838;color:#cbd5e1;border:1px solid #526276;border-radius:4px;cursor:pointer;font:inherit">cancel</button><br>`
      : '';
    const threat = showThreats ? opponentThreat() : null;
    const threatLine = threat
      ? `<span style="color:#ff7187">threat: ${threat.move}${threat.target ? ` takes ${threat.target}` : ''}${threat.after ? ' after best move' : ''}</span><br>`
      : '';
    const tb = tablebase?.fen === lastFEN ? tablebase : null;
    const tbLine = tb?.data
      ? `<span style="color:#b89dff">tablebase: ${tb.data.category}${tb.data.moves[0]?.uci ? ` · best ${tb.data.moves[0].uci}` : ''}</span><br>`
      : tb?.loading ? '<span style="color:#888">tablebase: loading…</span><br>'
      : tb?.error ? '<span style="color:#888">tablebase: unavailable</span><br>' : '';
    const openingOptions = OPENINGS.map((entry, index) => {
      const side = entry.side === 'w' ? 'White' : entry.side === 'b' ? 'Black' : 'Any side';
      const name = entry.name.replace(/ \((White|Black)\)$/, '');
      return `<option value="${index}"${index === openingIdx ? ' selected' : ''}>${side} · ${name}</option>`;
    }).join('');
    ensurePanel().innerHTML = `
      <span style="color:#00c864;font-weight:bold">Evilfish</span> · ${modeStr} · ${autoStr} · ${sideLabel}<br>
      <span style="color:#555">────────────────────</span><br>
      ${rows || `<span style="color:#888">${emptyState}</span>`}<br>
      ${premoveLine}${threatLine}${tbLine}
      <span style="color:#555">────────────────────</span><br>
      <label style="color:#888">opening (${openingSide}): <select id="evilfish-opening" style="background:#16161e;color:#d8d8e8;border:1px solid #555;border-radius:4px;font:inherit;max-width:185px;cursor:pointer">${openingOptions}</select></label>
      <button id="evilfish-heart" title="${opening.side ? `Save ${openingSide} opening` : 'Select a White or Black opening'}" style="background:none;border:0;color:${hearted ? '#ff5577' : '#888'};font:20px Arial;vertical-align:middle;cursor:pointer;padding:0 3px">${hearted ? '&hearts;' : '&#9825;'}</button><br>
      <span style="color:#888">saved: W ${savedWhite} · B ${savedBlack}<br>playing: ${activeOpening.name}<br>book: ${lastFEN ? openingStatus(lastFEN) : 'waiting'}</span><br>
      <span style="color:#666">${strengthLabel} (${acc}%) · T:${SPEEDS[speedIdx].name}/PV${configuredMultiPV || desiredMultiPV()}<br>A:auto · X:cancel · O:threats ${showThreats ? 'on' : 'off'}<br>F·H·M·P·S · 1·2·3</span> <span style="color:${showPreMove ? '#1e90ff' : '#555'}">${showPreMove ? '⇒pre' : '⇒off'}</span>
    `;
  }

  function toggleEnabled() {
    if (stealthMode) {
      stealthMode = false;
      clearTimeout(peekTimer);
      clearArrows();
      if (enabled && lastFEN) analyze(lastFEN);
      updatePanel();
      return;
    }
    enabled = !enabled;
    if (!enabled) { clearArrows(); clearTimeout(humanTimer); }
    else if (lastFEN) analyze(lastFEN);
    updatePanel();
  }

  // ── OBSERVER ──────────────────────────────────────────────────────────────
  function onBoardChange() {
    if (debounce) return;
    debounce = setTimeout(() => {
      debounce = null;
      const fen = buildFEN();
      if (!fen) return;
      // Queued premove highlights can change detectSide() without moving a piece.
      if (queuedPreMove.startsWith(lastFEN + '|') &&
          fen.split(' ')[0] === lastFEN.split(' ')[0]) return;
      const playerSide = getPlayerSide();
      if (fen === lastFEN) {
        if (playerSide !== lastPlayerSide) {
          lastPlayerSide = playerSide;
          if (enabled) analyze(fen);
          else updatePanel();
        } else if (!playPendingPreMove() && enabled && engineReady &&
                   !engineSearching && !bookActiveFEN && top3FEN !== fen)
          analyze(fen);
        return;
      }
      if (!isValidFEN(fen)) { dbg(`skip invalid FEN: ${fen.slice(0,60)}`); return; }
      queuedPreMove = '';
      nativeQueuedPreMove = false;
      lastFEN = fen;
      lastPlayerSide = playerSide;
      if (playPendingPreMove()) return;
      if (enabled) analyze(fen);
    }, 120);
  }

  let observedBoard = null;
  let boardObserver = null;

  function attachObserver() {
    const board = getBoard();
    if (!board) { setTimeout(attachObserver, 1000); return; }
    if (board === observedBoard) return;

    boardObserver?.disconnect();
    observedBoard = board;
    boardObserver = new MutationObserver(onBoardChange);
    boardObserver.observe(board, { childList: true, subtree: true, attributes: true });
    onBoardChange();
  }

  function startPolling() {
    setInterval(() => {
      attachObserver();
      if (enabled) onBoardChange();
    }, 600);
  }

  // ── KEYBOARD ──────────────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (!e.altKey) return;

    if (e.code === AUTO_MOVE_KEY) {
      e.preventDefault();
      if (e.repeat) return;
      autoMoveEnabled = !autoMoveEnabled;
      dbg('auto move ' + (autoMoveEnabled ? 'on' : 'off'));
      updatePanel();
      if (autoMoveEnabled) playAutoMove();
    }
    if (e.code === 'KeyF') {
      e.preventDefault();
      forcedSide = forcedSide === null ? 'w' : forcedSide === 'w' ? 'b' : null;
      lastFEN = ''; onBoardChange();
    }
    if (e.code === 'KeyH') {
      e.preventDefault();
      if (panel?.isConnected)
        panel.style.display = panel.style.display === 'none' ? '' : 'none';
    }
    if (e.code === 'KeyP') {
      e.preventDefault();
      accuracyIdx = (accuracyIdx + 1) % TIERS.length;
      try { localStorage.setItem('eni-accuracy', String(accuracyIdx)); } catch (error) {}
      const t = TIERS[accuracyIdx];
      const desc = t.mode === 'max' ? 'uncapped'
                 : t.mode === 'elo' ? `Elo ${t.elo}`
                 : `Skill ${t.skill} / depth ${t.depth} (~${t.elo} Elo)`;
      dbg(`Accuracy: ${t.acc}% → ${desc}`);
      if (engine) {
        strengthDirty = true;
        lastFEN = '';
        onBoardChange();
      }
      updatePanel();
    }
    if (e.code === 'KeyT') {
      e.preventDefault();
      if (e.repeat) return;
      speedIdx = (speedIdx + 1) % SPEEDS.length;
      try { localStorage.setItem('eni-speed', String(speedIdx)); } catch (error) {}
      dbg('speed: ' + SPEEDS[speedIdx].name);
      if (enabled && lastFEN) analyze(lastFEN);
      updatePanel();
    }
    if (e.code === 'KeyX') {
      e.preventDefault();
      cancelQueuedPreMove();
    }
    if (e.code === 'KeyO') {
      e.preventDefault();
      if (e.repeat) return;
      showThreats = !showThreats;
      renderAllArrows();
      updatePanel();
    }
    if (e.code === 'KeyS') {
      e.preventDefault();
      if (!enabled) return;
      if (!stealthMode) {
        stealthMode = true;
        clearArrows();
        updatePanel();
      }
      peekBestMove();
    }
    if (e.code === 'Digit1') {
      e.preventDefault();
      displayRank = displayRank === 0 ? -1 : 0;
      renderAllArrows(); updatePanel();
    }
    if (e.code === 'Digit2') {
      e.preventDefault();
      displayRank = displayRank === 1 ? -1 : 1;
      renderAllArrows(); updatePanel();
    }
    if (e.code === 'Digit3') {
      e.preventDefault();
      displayRank = displayRank === 2 ? -1 : 2;
      renderAllArrows(); updatePanel();
    }
    if (e.code === 'KeyM') {
      e.preventDefault();
      showPreMove = !showPreMove;
      renderAllArrows(); updatePanel();
    }
  });

  // ── MOBILE ROTATION / VIEWPORT RESIZE ───────────────────────────────────
  // onBoardChange() dedupes on FEN identity, so a rotation or layout shift
  // (no board state change) never reaches renderAllArrows(). Redraw the
  // existing top3 at the new geometry directly, no engine re-query needed.
  window.addEventListener('orientationchange', () => setTimeout(renderAllArrows, 150));
  window.addEventListener('resize', () => renderAllArrows());

  // ── BOOT ──────────────────────────────────────────────────────────────────
  ensurePanel();
  dbg('Evilfish v3.29 loaded ✓');
  bootEngine();
  attachObserver();
  startPolling();

})();
