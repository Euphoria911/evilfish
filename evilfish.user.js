// ==UserScript==
// @name         Evilfish
// @namespace    https://chess.com
// @version      4.1.0
// @description  Stockfish 19 for chess.com: engine-best opening theory (both colours, gambits and sidelines), your repertoires, cloud evals, pondering, event-driven board sync, tablebase, arrows, conditional premoves, auto move
// @match        https://www.chess.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      unpkg.com
// @connect      github.com
// @connect      objects.githubusercontent.com
// @connect      release-assets.githubusercontent.com
// @connect      tablebase.lichess.ovh
// @connect      lichess.org
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // ── CONFIG ────────────────────────────────────────────────────────────────
  const VERSION       = '4.1.0';
  const MULTI_PV      = 3;
  const AUTO_MOVE_KEY = 'KeyA';   // Alt+A
  const START_FEN     = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const START_PLACEMENT = START_FEN.split(' ')[0];
  const RE_MOVE       = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

  // Engine builds are pinned and SHA-256 verified. "lite" starts instantly; "full" (large net, single
  // thread) downloads once in the background, is cached, then hot-swaps in. Multi-threaded builds need
  // cross-origin isolation, which chess.com does not provide.
  const ENGINE_VERSION = '19.0.1';
  const ENGINE_HOSTS = [
    `https://unpkg.com/stockfish@${ENGINE_VERSION}/`,
    `https://github.com/nmrugg/stockfish.js/releases/download/v${ENGINE_VERSION}/`
  ];
  const ENGINE_FILES = {
    lite: {
      js:   { name: 'stockfish-19-lite-single.js',   path: 'bin/stockfish-19-lite-single.js',   sha256: 'ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a' },
      wasm: { name: 'stockfish-19-lite-single.wasm', path: 'bin/stockfish-19-lite-single.wasm', sha256: 'ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de' }
    },
    full: {
      js:   { name: 'stockfish-19-single.js',        path: 'bin/stockfish-19-single.js',        sha256: '8071dee87312f74805a859de933e1a1ef465579ab1a51fbd597388cdce9d444d' },
      wasm: { name: 'stockfish-19-single.wasm',      path: 'bin/stockfish-19-single.wasm',      sha256: '991bede2f253ebb08ff01fcc48270f4b9c8e66b12d5bd5f8d6f52eb3e3b3a740' }
    }
  };
  const ENGINE_CACHE = 'evilfish-engine-v1';
  const STOP_GRACE   = 2500;    // ms an engine gets to answer "stop" before it is considered dead

  const COL_RANKS = [
    'rgba(0,  220, 80,  0.90)',
    'rgba(255,200, 0,   0.84)',
    'rgba(255,110, 30,  0.80)',
  ];
  const PRE_MOVE_COLOR = 'rgba(30, 144, 255, 0.82)';
  const THREAT_COLOR = 'rgba(255, 55, 85, 0.9)';

  const SPEEDS = [
    { name: 'fast',     movetime: 300 },
    { name: 'balanced', movetime: 800 },
    { name: 'deep',     movetime: 0   },   // fixed depth, soft-stopped after 20 s
    { name: 'auto',     movetime: -1  }    // clock-aware
  ];
  const TIERS = [
    { acc: 100, mode: 'max',   depth: 22, elo: null                },
    { acc:  80, mode: 'elo',   depth: 12, elo: 1700                },
    { acc:  70, mode: 'elo',   depth: 12, elo: 1500                },
    { acc:  60, mode: 'elo',   depth: 12, elo: 1350                },
    { acc:  45, mode: 'skill', depth:  6, elo:  900, skill: 4      },
    { acc:  30, mode: 'skill', depth:  4, elo:  700, skill: 1      },
    { acc:  20, mode: 'skill', depth:  2, elo:  500, skill: 0      },
  ];

  const OPENINGS = [
    { name: "Engine", side: null, lines: [] },
    { name: "Italian Game (White)", side: "w", lines: ["e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d4 e5d4 e1g1 f8c5 e4e5 d7d5 e5f6 d5c4 f1e1 c8e6 f3g5 d8d5 b1c3 d5f5","e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 d8e7 d2d4 c5b6 e1g1 d7d6 a2a4 a7a6 h2h3 g8f6 f1e1","e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3 d7d6 e1g1 e8g8 f1e1 a7a6 c4b3 c5a7 h2h3","e2e4 e7e5 g1f3 b8c6 f1c4 f8e7 d2d4 e5d4 c2c3 g8f6 e4e5 f6e4","e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 d7d6 d2d4 e5d4 c3d4 c5b6","e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d4 e5d4 e1g1 f8c5 e4e5 f6g4 c2c3"] },
    { name: "Ruy Lopez (White)", side: "w", lines: ["e2e4 e7e5 g1f3 b8c6 f1b5 g8f6 e1g1 f6e4 d2d4 f8e7 d1e2 e4d6 b5c6 b7c6 d4e5 d6b7 b1c3 e8g8 f1e1 b7c5 f3d4 c5e6 c1e3 e6d4","e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f6e4 d2d4 b7b5 a4b3 d7d5 d4e5 c8e6 d1e2 f8e7 f1d1 e8g8 c2c4 b5c4 b3c4 d8d7","e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 d7d6 c2c3 c6a5 b3c2 c7c5 d2d4 d8c7 b1d2 e8g8","e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 e8g8 c2c3 d7d5 e4d5 f6d5 f3e5 c6e5 e1e5 c7c6 d2d4 e7d6","e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 b7b5 a4b3 d7d6 f3g5 d6d5 e4d5 c6d4 f1e1 f8c5 e1e5 e8f8","e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 d7d6 a4c6 b7c6 d2d4 f6e4 f1e1 f7f5 d4e5 d6d5 b1c3","e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 d7d6 e1g1 c8d7 c2c3 g8f6 d2d4 f8e7 b1d2 e8g8 f1e1 d7e8","e2e4 e7e5 g1f3 b8c6 f1b5 g7g6 d2d4 e5d4 f3d4 f8g7 c1e3 g8e7 b1c3 e8g8 d1d2 d7d5","e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 d7d6 c2c3 e8g8 h2h3 c8b7 d2d4 f8e8 b1d2 e7f8 a2a3 h7h6"] },
    { name: "Queen's Gambit (White)", side: "w", lines: ["d2d4 d7d5 c2c4 d5c4 g1f3 g8f6 e2e3 e7e6 f1c4 c7c5 e1g1 a7a6 d1e2 b7b5 c4b3 b8c6 f1d1 c5c4 b3c2 c6b4 b1c3 b4c2 e2c2 c8b7","d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7 e2e3 e8g8 g1f3 h7h6 g5h4 f6e4 h4e7 d8e7 d1c2 e4f6 f1d3 d5c4 d3c4 c7c5 e1g1 b8c6","d2d4 d7d5 c2c4 e7e6 b1c3 f8e7 g1f3 g8f6 c1g5 h7h6 g5h4 e8g8 e2e3 b7b6 c4d5 f6d5 h4e7 d8e7 c3d5 e6d5 a1c1 c8e6","d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7 e2e3 e8g8 g1f3 b8d7 a1c1 c7c6 f1d3 d5c4 d3c4 f6d5 g5e7 d8e7 e1g1 d5c3 c1c3 e6e5","d2d4 d7d5 c2c4 e7e5 d4e5 d5d4 g1f3 b8c6 b1d2 c8g4 h2h3 g4f3 d2f3 f8b4 c1d2 d8e7","d2d4 d7d5 c2c4 b8c6 c4d5 d8d5 e2e3 e7e5 b1c3 f8b4 c1d2 b4c3 d2c3 e5d4 g1e2","d2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 e7e6 c1g5 b8d7 e2e3 d8a5 f3d2 f8b4 d1c2","d2d4 d7d5 c2c4 d5c4 g1f3 e7e6 e2e3 g8f6 f1c4 f8e7 e1g1 e8g8 b1c3 a7a6 a2a4 c7c5","d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 c7c5 g1f3 c5d4 f3d4 e6e5 d4b5 a7a6 d1a4","d2d4 d7d5 c2c4 e7e6 b1c3 c7c6 g1f3 d5c4 a2a4 f8b4 e2e3 b7b5 c1d2 a7a5","d2d4 d7d5 c2c4 e7e6 b1c3 c7c5 c4d5 e6d5 g1f3 b8c6 c1g5 f8e7 g5e7 g8e7"] },
    { name: "London System (White)", side: "w", lines: ["d2d4 d7d5 g1f3 g8f6 c1f4 e7e6 e2e3 f8d6","d2d4 d7d5 g1f3 g8f6 c1f4 c7c5 e2e3 b8c6 b1d2 e7e6 c2c3"] },
    { name: "Sicilian Defense (Black)", side: "b", lines: ["e2e4 c7c5 b1c3 d7d6 f2f4 b8c6 g1f3 g7g6 d2d4 c5d4 f3d4 f8g7 c1e3 g8f6 f1e2 e8g8 d4b3 c8e6 e1g1 c6a5 f4f5 e6c4 b3a5 c4e2","e2e4 c7c5 d2d4 c5d4 c2c3 d4c3 b1c3 b8c6 f1c4 e7e6 g1f3 d7d6 e1g1 a7a6 d1e2 b7b5 c4b3","e2e4 c7c5 c2c3 d7d5 e4d5 d8d5 d2d4 c5d4 c3d4 b8c6 g1f3 c8g4 b1c3 g4f3 g2f3 d5d4 d1d4 c6d4","e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1g5 b8d7 f1c4 d8a5 d1d2 e7e6 e1c1 b7b5 c4b3 c8b7 h1e1 d7c5 e4e5","e2e4 c7c5 g1f3 d7d6 c2c3 g8f6 f1e2 b8c6 d2d4 c5d4 c3d4 f6e4 d4d5 d8a5 b1c3 e4c3 b2c3","e2e4 c7c5 g1f3 d7d6 f1b5 b8c6 e1g1 c8d7 c2c3 g8f6 f1e1 a7a6 b5c6 d7c6 d2d4 c6e4 c1g5","e2e4 c7c5 b2b4 c5b4 a2a3 d7d5 e4d5 d8d5 g1f3 e7e5 c1b2 b8c6 c2c4 d5e6","e2e4 c7c5 f2f4 b8c6 g1f3 g7g6 f1b5 f8g7 b5c6 b7c6 e1g1 d7d6 d2d3 g8f6","e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3 e7e6 g2g4 e6e5 d4f5 g7g6 g4g5","e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 f2f4 e7e6 f1e2 d8c7 e1g1 b8c6","e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 f1e2 e7e5 d4b3 f8e7 e1g1 c8e6"] },
    { name: "Caro-Kann Defense (Black)", side: "b", lines: ["e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5","e2e4 c7c6 d2d4 d7d5 b1d2 d5e4 d2e4 c8f5 e4g3 f5g6 h2h4 h7h6 g1f3 b8d7 h4h5 g6h7 f1d3 h7d3 d1d3 e7e6 c1d2 g8f6 e1c1 f8e7","e2e4 c7c6 d2d4 d7d5 e4d5 c6d5 c2c4 b8c6 b1c3 g8f6 g1f3 e7e6 c4d5 e6d5 f1b5 f8d6 c1g5 e8g8 e1g1","e2e4 c7c6 d2d3 d7d5 b1d2 g7g6 g1f3 f8g7 g2g3 e7e5 f1g2 g8e7 e1g1 e8g8 b2b4","e2e4 c7c6 d2d4 d7d5 e4e5 c8f5 b1c3 e7e6 g2g4 f5g6 g1e2 c6c5 h2h4","e2e4 c7c6 d2d4 d7d5 f2f3 d5e4 f3e4 e7e5 g1f3 e5d4 f1c4","e2e4 c7c6 g1f3 d7d5 d2d3 d5e4 d3e4 d8d1 e1d1","e2e4 c7c6 c2c4 d7d5 e4d5 c6d5 c4d5 g8f6","e2e4 c7c6 b1c3 d7d5 g1f3 c8g4 h2h3 g4f3","e2e4 c7c6 d2d4 d7d5 b1d2 d5e4 d2e4 c8f5 e4g5 f5g6 g1f3 h7h6 g5e6"] },
    { name: "French Defense (Black)", side: "b", lines: ["e2e4 e7e6 d2d4 d7d5 b1d2 c7c5 e4d5 d8d5 g1f3 c5d4 f1c4 d5d6 e1g1 g8f6 d2b3 b8c6 b3d4 c6d4 f3d4 a7a6","e2e4 e7e6 d2d4 d7d5 b1c3 f8b4 e4e5 c7c5 a2a3 b4c3 b2c3 g8e7 d1g4 d8c7 g4g7 h8g8 g7h7 c5d4 g1e2","e2e4 e7e6 d2d4 d7d5 e4e5 c7c5 c2c3 b8c6 g1f3 d8b6 f1d3 c5d4 c3d4 c8d7 e1g1 c6d4 f3g5","e2e4 e7e6 d2d4 d7d5 b1c3 f8b4 g1e2 d5e4 a2a3 b4e7 c3e4 g8f6 e2g3 e8g8 f1e2 b8c6","e2e4 e7e6 d2d4 d7d5 b1c3 f8b4 e4e5 c7c5 a2a3 b4c3 b2c3 g8e7 a3a4 b8c6 g1f3 d8a5 d1d2 c8d7","e2e4 e7e6 d2d4 d7d5 b1c3 f8b4 c1d2 d5e4 d1g4 g8f6 g4g7 h8g8 g7h6","e2e4 e7e6 d2d4 d7d5 e4d5 e6d5 b1c3 g8f6 c1g5 b8c6","e2e4 e7e6 d2d3 d7d5 b1d2 g8f6 g1f3 b8c6 f1e2","e2e4 e7e6 d2d4 d7d5 b1c3 f8b4 e4d5 e6d5 f1d3 g8e7 d1h5"] },
    { name: "Scandinavian Defense (Black)", side: "b", lines: ["e2e4 d7d5 e4d5 d8d5 b1c3 d5a5 d2d4 g8f6 g1f3 c8f5 f3e5 c7c6 g2g4"] },
    { name: "King's Indian Defense (Black)", side: "b", lines: ["d2d4 g8f6 c2c4 g7g6 g1f3 f8g7 g2g3 e8g8 f1g2 d7d6 e1g1 b8c6 b1c3 a7a6 d4d5 c6a5 f3d2 c7c5 d1c2 a8b8 b2b3 b7b5 c1b2 b5c4","d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 f2f3 e8g8 c1e3 e7e5 d4d5 f6h5 d1d2 d8h4 g2g3 h5g3 d2f2 g3f1 f2h4 f1e3 e1e2 e3c4","d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8 f1e2 e7e5 e1g1 b8c6 d4d5 c6e7 f3e1 f6d7 c1e3 f7f5 f2f3 f5f4 e3f2 g6g5","d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 g1f3 d7d6 g2g3 e8g8 f1g2 b8d7 e1g1 e7e5 e2e4 f8e8 h2h3 e5d4 f3d4 d7c5 f1e1 a7a5","d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 f2f4 e8g8 f1e2 c7c5 d4d5 e7e6 d5e6 f7e6 g2g4 b8c6 h2h4","d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8 f1e2 e7e5 d4d5 b8d7 c1g5 h7h6 g5h4 g6g5 h4g3 f6h5 h2h4","d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 f2f4 e8g8 g1f3 c7c5 d4d5 e7e6 f1e2 e6d5 e4e5","d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 f2f3 e8g8 c1g5 c7c5 d4d5 e7e6 d1d2 e6d5 c3d5","d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 f1e2 e8g8 c1g5 b8a6 d1d2 c7c6"] },
    { name: "King's Gambit (White)", side: "w", lines: ["e2e4 e7e5 f2f4 e5f4 g1f3 g7g5 h2h4 g5g4 f3e5 g8f6 d2d4 d7d6","e2e4 e7e5 f2f4 d7d5 e4d5 e5e4 d2d3 g8f6 d3e4 f6e4 g1f3 f8c5 d1e2 c5f2 e1d1 d8d5 f3d2","e2e4 e7e5 f2f4 f8c5 g1f3 d7d6 c2c3 f7f5 f4e5 d6e5 d2d4 e5d4 f1c4","e2e4 e7e5 f2f4 e5f4 g1f3 d7d5 e4d5 g8f6 f1b5 c7c6 d5c6 b7c6 b5c4 f6d5","e2e4 e7e5 f2f4 e5f4 g1f3 f8e7 f1c4 e7h4","e2e4 e7e5 f2f4 e5f4 g1f3 h7h6 f1c4 d7d6 d2d4 g7g5 h2h4 f8g7 d1d3","e2e4 e7e5 f2f4 f7f5 e4f5 e5f4 d1h5 g7g6 f5g6 d8e7 e1d1","e2e4 e7e5 f2f4 e5f4 g1f3 g7g5 h2h4 g5g4 f3e5 d7d5 d2d4 g8f6 c1f4 f6e4 b1d2","e2e4 e7e5 f2f4 e5f4 g1f3 g7g5 h2h4 g5g4 f3e5 h7h5 f1c4 h8h7 d2d4 f8h6 b1c3","e2e4 e7e5 f2f4 d8f6 b1c3 f6f4 g1f3 f8b4 f1c4","e2e4 e7e5 f2f4 e5f4 g1f3 g7g5 h2h4 g5g4 f3e5 d8e7 d2d4 f7f5 f1c4","e2e4 e7e5 f2f4 f8c5 g1f3 d7d6 c2c3 c8g4 f4e5 d6e5 d1a4","e2e4 e7e5 f2f4 e5f4 g1f3 d7d6 d2d4 g8f6 f1d3","e2e4 e7e5 f2f4 e5f4 g1f3 g8f6 e4e5 f6h5","e2e4 e7e5 f2f4 b8c6 g1f3 g7g5 f4g5 h7h6","e2e4 e7e5 f2f4 d7d5 e4d5 e5e4 d2d3 g8f6 d3e4 f6e4 g1f3 f8c5 d1e2 c8f5","e2e4 e7e5 f2f4 d7d5 e4d5 c7c6 d5c6 f8c5","e2e4 e7e5 f2f4 e5f4 g1f3 b8c6","e2e4 e7e5 f2f4 d8h4 g2g3 h4e7","e2e4 e7e5 f2f4 f7f6 f4e5 b8c6"] },
    { name: "Danish Gambit (White)", side: "w", lines: ["e2e4 e7e5 d2d4 e5d4 c2c3 d4c3 f1c4 c3b2 c1b2 g8f6 b1c3 f8b4 g1e2 e8g8 e1g1 d7d6"] },
    { name: "Evans Gambit (White)", side: "w", lines: ["e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4 c5b4 c2c3 b4a5 d2d4 e5d4 e1g1 d7d6 c3d4 a5b6 b1c3 g8f6","e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4 c5b6 b4b5 c6a5 f3e5 g8h6","e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4 c5b4 c2c3 b4c5 d2d4 e5d4 e1g1 d7d6 c3d4 c5b6 b1c3 c8g4 d1a4 g4d7 a4b3 c6a5 c4f7 e8f8","e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4 c5b4 c2c3 b4a5 d2d4 d7d6 d1b3 d8d7 d4e5 d6e5 e1g1 a5b6 c1a3 c6a5 f3e5","e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4 c5b4 c2c3 b4a5 d2d4 e5d4 e1g1 d4c3 d1b3 d8f6 e4e5 f6g6 b1c3 g8e7 c1a3","e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4 c5b6 b4b5 c6a5 f3e5 d8g5 d1f3 g5e5 f3f7 e8d8 c1b2","e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4 c5b4 c2c3 b4c5 d2d4 e5d4 e1g1 d7d6 c3d4 c5b6 b1c3 c6a5 c1g5 f7f6 g5e3","e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4 c5b4 c2c3 b4e7 d2d4 c6a5"] },
    { name: "Smith-Morra Gambit (White)", side: "w", lines: ["e2e4 c7c5 d2d4 c5d4 c2c3 d4c3 b1c3 b8c6 f1c4 e7e6 g1f3 d7d6 e1g1 a7a6 d1e2 b7b5 c4b3","e2e4 c7c5 d2d4 c5d4 c2c3 d4c3 b1c3 e7e6 g1f3 d7d6 f1c4 a7a6 e1g1 f8e7 d1e2 g8f6","e2e4 c7c5 d2d4 c5d4 c2c3 d4c3 b1c3 d7d6 g1f3 e7e6 f1c4 g8f6 e1g1 a7a6","e2e4 c7c5 d2d4 c5d4 c2c3 d4d3 c3c4"] },
    { name: "Scotch Gambit (White)", side: "w", lines: ["e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f1c4 g8f6 e1g1 f8c5 e4e5 d7d5 e5f6 d5c4 f1e1 c8e6 f3g5 d8d5 b1c3 d5f5 c3e4","e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f1c4 g8f6 e1g1 f6e4 f1e1 d7d5 b1c3","e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f1c4 f8c5 e1g1 d7d6 c2c3 c8g4"] },
    { name: "Vienna Gambit (White)", side: "w", lines: ["e2e4 e7e5 b1c3 g8f6 f2f4 d7d5 f4e5 f6e4 g1f3 c8g4 d1e2"] },
    { name: "Blackmar-Diemer Gambit (White)", side: "w", lines: ["d2d4 d7d5 e2e4 d5e4 b1c3 g8f6 f2f3 e4f3 g1f3 e7e6 c1g5 f8e7 f1d3 b8c6","d2d4 d7d5 e2e4 d5e4 b1c3 g8f6 f2f3 e4f3 g1f3 g7g6 f1c4 f8g7 e1g1 e8g8 g1h1","d2d4 d7d5 e2e4 d5e4 b1c3 g8f6 f2f3 e4f3 g1f3 c8g4 h2h3 g4f3 d1f3 c7c6 f3f2","d2d4 d7d5 e2e4 d5e4 b1c3 g8f6 f2f3 e4f3 g1f3 c8f5 f3e5 e7e6 g2g4 f5e4","d2d4 d7d5 e2e4 d5e4 b1c3 g8f6 f2f3 e7e6 f3e4"] },
    { name: "Budapest Gambit (Black)", side: "b", lines: ["d2d4 g8f6 c2c4 e7e5 d4e5 f6g4 c1f4 b8c6 g1f3 f8b4 b1d2 d8e7 e2e3 g4e5 f3e5 c6e5","d2d4 g8f6 c2c4 e7e5 d4e5 f6g4 e2e4 g4e5"] },
    { name: "Albin Countergambit (Black)", side: "b", lines: ["d2d4 d7d5 c2c4 e7e5 d4e5 d5d4 g1f3 b8c6 b1d2 c8g4 h2h3 g4f3 d2f3 f8b4 c1d2 d8e7","d2d4 d7d5 c2c4 e7e5 d4e5 d5d4 e2e3 f8b4 c1d2 d4e3","d2d4 d7d5 c2c4 e7e5 d4e5 d5d4 g1f3 b8c6 g2g3 c8e6"] },
    { name: "Benko Gambit (Black)", side: "b", lines: ["d2d4 g8f6 c2c4 c7c5 d4d5 b7b5 c4b5 a7a6 b5a6 g7g6 b1c3 c8a6 e2e4 d7d6 g1f3 f8g7","d2d4 g8f6 c2c4 c7c5 d4d5 b7b5 c4b5 a7a6 b1c3 a6b5 e2e4 b5b4 c3b5 d7d6 f1c4","d2d4 g8f6 c2c4 c7c5 d4d5 b7b5 c4b5 a7a6 b5a6 g7g6 b1c3 c8a6 g2g3 d7d6 f1g2 f8g7 g1f3","d2d4 g8f6 c2c4 c7c5 d4d5 b7b5 c4b5 a7a6 b5a6 g7g6 b1c3 c8a6 g1f3 d7d6 e2e4"] }
  ];

  // ── STORE ─────────────────────────────────────────────────────────────────
  // GM storage when granted; legacy localStorage values are still read once so settings survive upgrade.
  const store = {
    get(key, fallback) {
      try {
        if (typeof GM_getValue === 'function') {
          const v = GM_getValue(key);
          if (v !== undefined && v !== null) return v;
        }
      } catch (e) {}
      try {
        const raw = localStorage.getItem(key);
        if (raw !== null) return raw;
      } catch (e) {}
      return fallback;
    },
    set(key, value) {
      try { if (typeof GM_setValue === 'function') { GM_setValue(key, value); return; } } catch (e) {}
      try { localStorage.setItem(key, String(value)); } catch (e) {}
    }
  };
  const storedIndex = (key, length, fallback) => {
    const raw = store.get(key, null);
    if (raw === null || raw === '') return fallback;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n < length ? n : fallback;
  };

  const TEST = typeof window.__EF_TEST !== 'undefined';
  const DEBUG = TEST || !!store.get('eni-debug', 0);
  function dbg(msg) { if (DEBUG) console.log('[Evilfish]', msg); }
  const safe = (fn, fallback = null) => { try { return fn(); } catch (e) { return fallback; } };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let speedIdx    = storedIndex('eni-speed', SPEEDS.length, 3);
  let accuracyIdx = storedIndex('eni-accuracy', TIERS.length, 0);
  let openingIdx  = storedIndex('eni-opening', OPENINGS.length, 0);
  const favoriteOpenings = { w: null, b: null };
  safe(() => {
    const raw = store.get('eni-favorite-openings', '{}');
    const saved = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
    for (const side of ['w', 'b']) {
      if (OPENINGS.some(o => o.side === side && o.name === saved[side])) favoriteOpenings[side] = saved[side];
    }
  });

  // ── STATE ─────────────────────────────────────────────────────────────────
  let eng         = null;     // active engine record
  let upgrade     = null;     // engine record being warmed up for hot swap
  const assets    = {};       // kind -> { script, wasm } blob URLs
  let bootStarted = false;
  let workerRestarts = 0;
  let restartTimer   = null;
  let engineStatus   = '';

  let pos         = null;     // current position {fen,startFEN,moves,atEnd,over,mode,playingAs,source,sig}
  let lastFEN     = '';
  let syncing = false, syncAgain = false, syncQueued = false;
  const hookedGames = new WeakSet();
  let domTrack    = { startFEN: '', moves: [], fen: '' };

  let svgLayer    = null;
  let panel       = null;
  let ui          = {};
  let renderedFlip = null;
  let enabled     = true;
  let autoMoveEnabled = false;
  let stealthMode = false;
  let peekTimer   = null;
  let forcedSide  = null;
  let showPreMove = true;
  let showThreats = true;
  let displayRank = -1;
  let displayedOpeningSide = null;
  let currentOpening = '';

  let top3        = [];
  let top3FEN     = '';
  let bookActiveFEN = '';
  let tbActiveFEN = '';
  let pendingPreMoves = [];
  let lastAutoMoveKey = '';
  let domFails    = { key: '', n: 0 };
  let previewTimer = null;
  let previewShown = false;
  let tablebase   = null;
  const tablebaseCache = new Map();

  const PIECE_MAP = {
    wp:'P', wr:'R', wn:'N', wb:'B', wq:'Q', wk:'K',
    bp:'p', br:'r', bn:'n', bb:'b', bq:'q', bk:'k'
  };

  // ── CHESS HELPERS ─────────────────────────────────────────────────────────
  const sideOf = v => v === 1 || v === 'white' || v === 'w' ? 'w'
                    : v === 2 || v === 'black' || v === 'b' ? 'b' : null;
  const isWhitePiece = ch => ch === ch.toUpperCase();
  const turnOf = fen => fen.split(' ')[1];

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

  function squareAttacked(pieces, square, by) {
    const f = square.charCodeAt(0) - 97, r = +square[1] - 1;
    const at = (df, dr) => {
      const nf = f + df, nr = r + dr;
      if (nf < 0 || nf > 7 || nr < 0 || nr > 7) return null;
      return pieces[String.fromCharCode(97 + nf) + (nr + 1)] || '';
    };
    const W = by === 'w';
    const pawn = W ? 'P' : 'p', knight = W ? 'N' : 'n', king = W ? 'K' : 'k';
    const bishop = W ? 'B' : 'b', rook = W ? 'R' : 'r', queen = W ? 'Q' : 'q';
    for (const df of [-1, 1]) if (at(df, W ? -1 : 1) === pawn) return true;
    for (const [df, dr] of [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]])
      if (at(df, dr) === knight) return true;
    for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++)
      if ((df || dr) && at(df, dr) === king) return true;
    for (const [df, dr, a, b] of [[1,1,bishop,queen],[1,-1,bishop,queen],[-1,1,bishop,queen],[-1,-1,bishop,queen],
                                  [1,0,rook,queen],[-1,0,rook,queen],[0,1,rook,queen],[0,-1,rook,queen]]) {
      for (let k = 1; k < 8; k++) {
        const p = at(df * k, dr * k);
        if (p === null) break;
        if (p) { if (p === a || p === b) return true; break; }
      }
    }
    return false;
  }

  function kingAttackedBy(placement, kingSide, by) {
    const pieces = boardFromPlacement(placement);
    const king = kingSide === 'w' ? 'K' : 'k';
    const square = Object.keys(pieces).find(sq => pieces[sq] === king);
    return !!square && squareAttacked(pieces, square, by);
  }

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
    // the side that just moved cannot have left its own king attacked
    const mover = parts[1] === 'w' ? 'b' : 'w';
    if (kingAttackedBy(placement, mover, parts[1])) return false;
    return true;
  }

  function plausibleMove(fen, move) {
    if (!RE_MOVE.test(move)) return false;
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

  // Full FEN after `move`: castling rights, en passant, clocks and side to move all advance correctly.
  function stepFEN(fen, move) {
    const [placement, side, rights, , half, full] = fen.split(' ');
    const pieces = boardFromPlacement(placement);
    const from = move.slice(0, 2), to = move.slice(2, 4);
    const piece = pieces[from];
    if (!piece) return null;
    const isPawn = /[pP]/.test(piece);
    const capture = !!pieces[to] || (isPawn && from[0] !== to[0]);
    let r = rights === '-' ? '' : rights;
    if (piece === 'K') r = r.replace(/[KQ]/g, '');
    if (piece === 'k') r = r.replace(/[kq]/g, '');
    if (from === 'a1' || to === 'a1') r = r.replace('Q', '');
    if (from === 'h1' || to === 'h1') r = r.replace('K', '');
    if (from === 'a8' || to === 'a8') r = r.replace('q', '');
    if (from === 'h8' || to === 'h8') r = r.replace('k', '');
    applyMove(pieces, move);
    const np = placementFromBoard(pieces);
    const ep = isPawn && Math.abs(+to[1] - +from[1]) === 2 ? from[0] + (+from[1] + +to[1]) / 2 : '-';
    const nh = isPawn || capture ? 0 : (+half || 0) + 1;
    const nf = (+full || 1) + (side === 'b' ? 1 : 0);
    return `${np} ${side === 'w' ? 'b' : 'w'} ${legalCastlingRights(np, r)} ${ep} ${nh} ${nf}`;
  }

  // The move (from `fen`) whose result has exactly `target` placement, or null.
  function inferMove(fen, target) {
    const [placement, side] = fen.split(' ');
    const pieces = boardFromPlacement(placement);
    for (const from of Object.keys(pieces)) {
      const piece = pieces[from];
      if (isWhitePiece(piece) !== (side === 'w')) continue;
      for (let f = 0; f < 8; f++) for (let rank = 1; rank <= 8; rank++) {
        const to = String.fromCharCode(97 + f) + rank;
        if (to === from) continue;
        const promo = /[pP]/.test(piece) && (rank === 8 || rank === 1) ? ['q', 'r', 'b', 'n'] : [''];
        for (const p of promo) {
          const mv = from + to + p;
          if (!plausibleMove(fen, mv)) continue;
          const copy = Object.assign({}, pieces);
          applyMove(copy, mv);
          if (placementFromBoard(copy) === target) return mv;
        }
      }
    }
    return null;
  }

  // Does startFEN + moves reproduce fen (placement, side, castling)? Guards the engine's move list.
  function historyConsistent(startFEN, moves, fen) {
    let cur = startFEN;
    for (const m of moves) {
      cur = stepFEN(cur, m);
      if (!cur) return false;
    }
    return cur.split(' ').slice(0, 3).join(' ') === fen.split(' ').slice(0, 3).join(' ');
  }

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

  function getGame() {
    if (TEST && window.__EF_NO_API) return null;          // test hook: exercise the DOM fallback only
    const g = getBoard()?.game;
    return g && typeof g.getFEN === 'function' ? g : null;
  }

  function isFlipped() {
    const b = getBoard();
    if (!b) return false;
    if (b.hasAttribute('flipped') || b.classList.contains('flipped')) return true;
    const orient = b.getAttribute('board-orientation');
    if (orient === 'black') return true;
    if (orient === 'white') return false;
    const game = getGame();
    const flipped = safe(() => game?.getOptions?.().flipped);
    if (flipped === true) return true;
    if (flipped === false) return false;
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

  function mySide() {
    if (pos?.playingAs) return pos.playingAs;
    const g = getGame();
    return sideOf(safe(() => g?.getPlayingAs?.())) || (isFlipped() ? 'b' : 'w');
  }

  // Clock of the side to move / my clock, in ms (DOM only; null when there is no clock).
  function parseClock(el) {
    const match = el?.textContent?.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d))?/);
    if (!match) return null;
    const secs = match[3] ? (+match[1] * 3600 + +match[2] * 60 + +match[3]) : (+match[1] * 60 + +match[2]);
    return secs * 1000 + (match[4] ? +match[4] * 100 : 0);
  }
  function readMyClockMs() {
    // the player at the bottom of the board is always me, whichever way the board is turned
    let el = document.querySelector('.clock-component.clock-bottom, .clock-bottom, [class*="clock-bottom"]');
    if (!el) {
      // other layouts (bot games, newer pages): the lower of the two clocks is mine
      const clocks = Array.from(document.querySelectorAll('.move-time-content, .clock-time-monospace'))
        .filter(c => c.offsetParent !== null && parseClock(c) !== null);
      if (clocks.length >= 2) el = clocks.reduce((a, b) => b.getBoundingClientRect().top > a.getBoundingClientRect().top ? b : a);
    }
    const ms = el && el.offsetParent !== null ? parseClock(el) : null;
    return ms !== null && ms > 0 ? ms : null;          // 0:00 means no live clock (finished game, review)
  }

  function domPlacement() {
    const board = getBoard();
    if (!board) return null;
    for (const sel of ['.promotion-window', 'wc-promotion-window', '[class*="promotion-window"]']) {
      for (const d of document.querySelectorAll(sel)) {
        if (d.offsetParent !== null && d.getBoundingClientRect().width > 0) return null;
      }
    }
    const boardRect = board.getBoundingClientRect();
    const cellSize  = boardRect.width / 8;
    const flip      = isFlipped();
    const squares   = {};
    let conflict = false;

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
      if (code !== null && file >= 0 && rank >= 0 && file < 8 && rank < 8) {
        const sq = String.fromCharCode(97 + file) + (rank + 1);
        // a captured piece can linger in the DOM until its animation ends: two different pieces on one
        // square means the DOM is mid-transition, so wait rather than guess
        if (squares[sq] && squares[sq] !== code) conflict = true;
        squares[sq] = code;
      }
    });
    return conflict ? null : placementFromBoard(squares);
  }

  function siteFENFor(placement) {
    const board = getBoard();
    const candidates = [];
    try { candidates.push(board?.game?.getFEN?.()); } catch (e) {}
    for (let el = board, n = 0; el && n < 4; el = el.parentElement, n++) {
      candidates.push(el.getAttribute('fen'), el.getAttribute('data-fen'));
    }
    for (const raw of candidates) {
      if (typeof raw !== 'string') continue;
      const parts = raw.trim().split(/\s+/);
      if (parts[0] !== placement || !['w', 'b'].includes(parts[1])) continue;
      const rights = legalCastlingRights(placement, parts[2] || '-');
      const ep = /^(-|[a-h][36])$/.test(parts[3] || '') ? parts[3] : '-';
      const fen = `${placement} ${parts[1]} ${rights} ${ep} ${parts[4] || 0} ${parts[5] || 1}`;
      if (isValidFEN(fen)) return fen;
    }
    return null;
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
    const game = getGame();
    const turn = sideOf(safe(() => game?.getTurn?.()));
    if (turn) return turn;
    const lm = sideFromLastMove();
    if (lm) return lm;
    for (const el of document.querySelectorAll('[fen],[data-fen]')) {
      const parts = (el.getAttribute('fen') || el.getAttribute('data-fen') || '').trim().split(' ');
      if (parts[1] === 'w' || parts[1] === 'b') return parts[1];
    }
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
    const notation = document.querySelectorAll('.notranslate, [translate="no"]');
    if (notation.length > 0) return notation.length % 2 === 0 ? 'w' : 'b';
    return 'w';
  }

  // First look at a position with no site FEN: heuristics for turn, castling assumed wherever king and rook
  // still sit on their home squares, then sanity-checked so the side not to move is never left in check.
  function fallbackStartFEN(placement) {
    const known = siteFENFor(placement);
    if (known) return known;
    let side = detectSide();
    if (kingAttackedBy(placement, side === 'w' ? 'b' : 'w', side)) side = side === 'w' ? 'b' : 'w';
    const rights = placement === START_PLACEMENT ? 'KQkq' : legalCastlingRights(placement, 'KQkq');
    return `${placement} ${side} ${rights} - 0 1`;
  }

  // ── POSITION SOURCES ──────────────────────────────────────────────────────
  // Primary: the board's own game object (exact FEN, full move list, events). Fallback: the DOM, with the
  // move chain inferred from consecutive placements so en passant, castling and clocks stay correct.
  const promoOf = m => m.promotion || (/=([QRBN])/.exec(m.san || '')?.[1] || '').toLowerCase();
  const uciOf = m => m.from + m.to + promoOf(m);

  function readFromGame(g) {
    const fen = safe(() => g.getFEN());
    if (typeof fen !== 'string' || !fen) return null;
    const variant = safe(() => g.getVariant?.(), 'chess') || 'chess';
    let line = safe(() => g.getCurrentFullLine?.(), []) || [];
    if (!Array.isArray(line)) line = [];
    let idx = -1;
    for (let i = line.length - 1; i >= 0; i--) if (line[i] && line[i].fen === fen) { idx = i; break; }
    let startFEN = line.length ? (line[0].beforeFen || START_FEN) : fen;
    let moves = idx >= 0 ? line.slice(0, idx + 1).map(uciOf) : [];
    if (idx < 0 && fen !== startFEN) { startFEN = fen; moves = []; }
    if (idx < 0 && line.length === 0) startFEN = fen;
    const mode = safe(() => g.getMode?.()?.name, '') || '';
    return {
      fen, startFEN, moves, variant, mode,
      atEnd: safe(() => g.isAtEndOfLine ? !!g.isAtEndOfLine() : true, true),
      over: !!safe(() => g.isGameOver(), false),
      playingAs: sideOf(safe(() => g.getPlayingAs?.())),
      source: 'api'
    };
  }

  function readFromDOM() {
    const placement = domPlacement();
    if (!placement) return null;
    let fen = null;
    if (domTrack.fen) {
      if (domTrack.fen.split(' ')[0] === placement) fen = domTrack.fen;
      else {
        const mv = inferMove(domTrack.fen, placement);
        if (mv) {
          fen = stepFEN(domTrack.fen, mv);
          domTrack.moves.push(mv);
          domTrack.fen = fen;
        }
      }
    }
    if (!fen) {
      fen = fallbackStartFEN(placement);
      domTrack = { startFEN: fen, moves: [], fen };
    }
    return {
      fen, startFEN: domTrack.startFEN, moves: domTrack.moves.slice(), variant: 'chess', mode: '',
      atEnd: true, over: false, playingAs: isFlipped() ? 'b' : 'w', source: 'dom'
    };
  }

  const GAME_EVENTS = ['Move', 'MoveBackward', 'MoveForward', 'Load', 'CreateGame', 'SetPlayingAs', 'Undo',
                       'SelectNode', 'Reload', 'ResetToMainLine', 'GameResigned', 'ModeChanged', 'AddMove',
                       'SelectLineStart', 'SelectLineEnd'];
  function hookGame(g) {
    if (hookedGames.has(g)) return;
    hookedGames.add(g);
    if (typeof g.on !== 'function') return;
    for (const type of GAME_EVENTS) safe(() => g.on(type, () => schedule(type)));
    // chess.com names the opening for us as the game goes along
    safe(() => g.on('UpdateECO', e => {
      const d = (e && e.data) || e;
      if (d && typeof d.n === 'string' && d.n !== currentOpening) { currentOpening = d.n; updatePanel(); }
    }));
    dbg('hooked game events');
  }

  function schedule(reason) {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(() => { syncQueued = false; syncPosition(reason); });
  }

  function withForcedSide(st) {
    const [placement, , rights] = st.fen.split(' ');
    const fen = `${placement} ${forcedSide} ${rights} - 0 1`;
    return Object.assign({}, st, { fen, startFEN: fen, moves: [], playingAs: st.playingAs });
  }

  function syncPosition(reason) {
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    try {
      const g = getGame();
      let st = null;
      if (g) { hookGame(g); st = readFromGame(g); }
      if (!st) st = readFromDOM();
      if (st) applyState(st, reason);
    } catch (e) {
      dbg('sync error: ' + (e && e.stack || e));
    } finally {
      syncing = false;
      if (syncAgain) { syncAgain = false; schedule('again'); }
    }
  }

  const isPrefix = (a, b) => a.length <= b.length && a.every((m, i) => m === b[i]);

  function applyState(st, reason) {
    if (st.variant !== 'chess') {
      if (!pos || pos.variant !== st.variant) {
        pos = st; lastFEN = '';
        cancelSearch(); top3 = []; top3FEN = ''; clearArrows();
        engineStatus = `variant "${st.variant}" unsupported`;
        updatePanel();
      }
      return;
    }
    if (forcedSide && turnOf(st.fen) !== forcedSide) st = withForcedSide(st);
    if (st.source === 'dom' && !isValidFEN(st.fen)) { dbg('skip invalid FEN: ' + st.fen.slice(0, 60)); return; }
    st.sig = [st.fen, st.playingAs, st.over, st.atEnd, st.mode, st.moves.length].join('|');
    if (pos && pos.sig === st.sig) return;

    const prev = pos;
    pos = st;
    lastFEN = st.fen;
    engineStatus = engineStatus.startsWith('variant') ? '' : engineStatus;

    const sameGame = prev && prev.startFEN === st.startFEN &&
                     (isPrefix(prev.moves, st.moves) || isPrefix(st.moves, prev.moves));
    if (!sameGame) {
      pendingPreMoves = [];
      currentOpening = '';
      if (eng) eng.newGame = true;
    }
    lastAutoMoveKey = '';
    dbg(`position (${st.source}/${reason}): ${st.fen} [${st.moves.length} plies]`);

    syncOpeningToSide();
    if (st.over) {
      cancelSearch();
      top3 = []; top3FEN = ''; bookActiveFEN = ''; tbActiveFEN = ''; pendingPreMoves = [];
      clearArrows();
      updatePanel();
      return;
    }
    if (playPendingPreMove(st)) return;
    pendingPreMoves = [];
    if (enabled) analyze(st); else updatePanel();
  }

  // ── ENGINE ASSETS ─────────────────────────────────────────────────────────
  async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  }

  function gmFetch(url, onProgress) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') return reject(new Error('GM_xmlhttpRequest unavailable'));
      GM_xmlhttpRequest({
        method: 'GET', url, responseType: 'arraybuffer', timeout: 180000,
        onprogress: e => { if (onProgress && e.lengthComputable) onProgress(e.loaded, e.total); },
        onload(res) {
          if (res.status !== 200) return reject(new Error(`HTTP ${res.status}: ${url}`));
          resolve(res.response);
        },
        onerror: () => reject(new Error(`Fetch failed: ${url}`)),
        ontimeout: () => reject(new Error(`Timeout: ${url}`))
      });
    });
  }

  async function streamFetch(url, onProgress) {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    const total = +res.headers.get('x-content-length') || +res.headers.get('content-length') || 0;
    if (!res.body || !res.body.getReader) return res.arrayBuffer();
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      if (onProgress) onProgress(loaded, total);
    }
    const out = new Uint8Array(loaded);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out.buffer;
  }

  async function downloadVerified(file, onProgress) {
    let lastError = null;
    for (const host of ENGINE_HOSTS) {
      for (const fetcher of [streamFetch, gmFetch]) {
        try {
          const buffer = await fetcher(host + file.path, onProgress);
          if (await sha256Hex(buffer) === file.sha256) return buffer;
          lastError = new Error(`checksum mismatch: ${host}${file.path}`);
        } catch (e) { lastError = e; }
      }
    }
    throw lastError || new Error('download failed');
  }

  async function engineAsset(file, onProgress) {
    const key = `https://evilfish.invalid/${ENGINE_VERSION}/${file.name}`;
    let cache = null;
    try { cache = typeof caches !== 'undefined' ? await caches.open(ENGINE_CACHE) : null; } catch (e) {}
    if (cache) {
      try {
        const hit = await cache.match(key);
        if (hit) {
          const buffer = await hit.arrayBuffer();
          if (await sha256Hex(buffer) === file.sha256) return buffer;
          await cache.delete(key);
        }
      } catch (e) {}
    }
    const buffer = await downloadVerified(file, onProgress);
    if (cache) {
      try { await cache.put(key, new Response(buffer.slice(0), { headers: { 'content-type': 'application/octet-stream' } })); }
      catch (e) { dbg('engine cache write failed: ' + e); }
    }
    return buffer;
  }

  async function loadEngineAssets(kind, onProgress) {
    if (assets[kind]) return assets[kind];
    const files = ENGINE_FILES[kind];
    const [js, wasm] = await Promise.all([engineAsset(files.js), engineAsset(files.wasm, onProgress)]);
    assets[kind] = {
      script: URL.createObjectURL(new Blob([js], { type: 'application/javascript' })),
      wasm: URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }))
    };
    return assets[kind];
  }

  // ── ENGINE ────────────────────────────────────────────────────────────────
  // state: starting -> idle <-> searching <-> stopping
  function send(E, cmd) { try { E.worker.postMessage(cmd); } catch (e) { dbg('send failed: ' + e); } }

  function armWatchdog(E, ms) {
    clearTimeout(E.timer);
    E.timer = setTimeout(() => {
      if (E.dead) return;
      if (E.state === 'searching') {
        // soft: ask the engine to wrap up and keep its answer
        E.stopMode = 'accept';
        E.state = 'stopping';
        send(E, 'stop');
        armWatchdog(E, STOP_GRACE);
      } else recoverEngine(E, `${E.state} timed out`);
    }, ms);
  }

  function killEngine(E) {
    if (!E) return;
    E.dead = true;
    clearTimeout(E.timer);
    safe(() => E.worker.terminate());
  }

  function recoverEngine(E, reason) {
    dbg(`recovering engine (${E.kind}): ${reason}`);
    killEngine(E);
    if (E === upgrade) { upgrade = null; engineStatus = 'full engine failed; staying on lite'; updatePanel(); return; }
    if (E !== eng) return;
    eng = null;
    top3 = []; top3FEN = '';
    clearArrows();
    engineStatus = 'recovering engine…';
    updatePanel();
    clearTimeout(restartTimer);
    const delay = Math.min(500 * 2 ** Math.min(workerRestarts++, 5), 15000);
    // come back on the same engine when its files are already cached; give up on "full" after repeated crashes
    const kind = E.kind === 'full' && assets.full && workerRestarts <= 2 ? 'full' : 'lite';
    restartTimer = setTimeout(() => startWorker(kind, 'active').catch(e => dbg('restart failed: ' + e)), delay);
  }

  async function startWorker(kind, role) {
    const urls = await loadEngineAssets(kind);
    const E = {
      kind, worker: null, state: 'starting', ready: false, dead: false, timer: null,
      job: null, next: null, stopMode: null, pv: {}, hist: [], t0: 0, hitTimer: null, ponderResults: new Map(), ponderQueue: [], ponderIdx: 0, ponderPlan: [], ponderBase: "",
      multiPV: 0, newGame: true, strengthDirty: true
    };
    E.worker = new Worker(urls.script + '#' + encodeURIComponent(urls.wasm));
    E.worker.onmessage = ev => { if (!E.dead) onEngineMsg(E, ev.data); };
    E.worker.onerror = ev => { if (!E.dead) recoverEngine(E, `worker error: ${ev.message} at ${ev.filename}:${ev.lineno}`); };
    if (kind === 'full' && role !== 'active') upgrade = E; else eng = E;
    send(E, 'uci');
    armWatchdog(E, kind === 'full' ? 90000 : 40000);
    return E;
  }

  async function bootEngine() {
    if (typeof crypto === 'undefined' || !crypto.subtle) { engineStatus = 'needs a secure context'; updatePanel(); return; }
    engineStatus = 'loading engine…';
    updatePanel();
    try {
      await startWorker('lite');
    } catch (e) {
      dbg('engine boot failed: ' + e);
      engineStatus = 'engine fetch failed; retrying…';
      updatePanel();
      setTimeout(bootEngine, 10000);
    }
  }

  async function upgradeEngine() {
    if (!store.get('eni-full-engine', 1) || (navigator.deviceMemory && navigator.deviceMemory < 4)) return;
    try {
      engineStatus = 'full engine: downloading…';
      let lastPct = -1;
      const files = ENGINE_FILES.full;
      const onProgress = (loaded, total) => {
        const pct = total ? Math.floor(100 * loaded / total) : Math.floor(loaded / 1e6);
        if (pct !== lastPct) { lastPct = pct; engineStatus = total ? `full engine: ${pct}%` : `full engine: ${pct} MB`; updatePanel(); }
      };
      if (!assets.full) {
        const [js, wasm] = await Promise.all([engineAsset(files.js), engineAsset(files.wasm, onProgress)]);
        assets.full = {
          script: URL.createObjectURL(new Blob([js], { type: 'application/javascript' })),
          wasm: URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }))
        };
      }
      engineStatus = 'full engine: starting…';
      updatePanel();
      await startWorker('full');
    } catch (e) {
      dbg('full engine unavailable: ' + e);
      engineStatus = 'full engine unavailable; using lite';
      updatePanel();
    }
  }

  function applyStrength(E) {
    const t = TIERS[accuracyIdx];
    if (t.mode === 'max') {
      send(E, 'setoption name UCI_LimitStrength value false');
      send(E, 'setoption name Skill Level value 20');
    } else if (t.mode === 'elo') {
      send(E, 'setoption name Skill Level value 20');
      send(E, 'setoption name UCI_LimitStrength value true');
      send(E, `setoption name UCI_Elo value ${t.elo}`);
    } else {
      send(E, 'setoption name UCI_LimitStrength value false');
      send(E, `setoption name Skill Level value ${t.skill}`);
    }
    E.strengthDirty = false;
  }

  function parseInfo(E, line) {
    if (!/^info /.test(line) || !/ pv /.test(line) || !/ score /.test(line)) return null;
    // aspiration-window bound lines carry truncated PVs; keep the last exact line instead
    if (/ (lowerbound|upperbound)\b/.test(line)) return null;
    const mpv = +(line.match(/ multipv (\d+)/)?.[1] || 1);
    const score = line.match(/ score (cp|mate) (-?\d+)/);
    const pv = line.match(/ pv (.+)$/)[1].trim().split(' ');
    const wdl = line.match(/ wdl (\d+) (\d+) (\d+)/);
    const depth = +(line.match(/^info depth (\d+)/)?.[1] || 0);
    E.pv[mpv] = {
      move: pv[0], pv, depth,
      scoreRaw: score[1] === 'cp' ? +score[2] : null,
      mateScore: score[1] === 'mate' ? +score[2] : null,
      wdl: wdl ? [+wdl[1], +wdl[2], +wdl[3]] : null
    };
    if (mpv === 1) {
      const v = +score[2];
      E.hist.push({ depth, move: pv[0], cp: score[1] === 'cp' ? v : (v > 0 ? 10000 - v : -10000 - v) });
      if (E.hist.length > 40) E.hist.shift();
    }
    return depth;
  }

  // Stop a search early when it has clearly settled: same best move and a flat score over the last depths.
  // Only for full-strength searches with a time budget; weaker tiers keep their depth limits untouched.
  function maybeEarlyStop(E) {
    const job = E.job;
    if (!job || !job.earlyStop || job.ponder || E.state !== 'searching' || !(job.movetime > 0)) return;
    const h = E.hist.slice(-4);
    if (h.length < 4 || h[3].depth < 14) return;
    if (performance.now() - E.t0 < job.movetime * 0.4) return;
    if (!h.every(x => x.move === h[0].move)) return;
    const cps = h.map(x => x.cp);
    if (Math.max(...cps) - Math.min(...cps) > 12) return;
    E.stopMode = 'accept';
    E.state = 'stopping';
    send(E, 'stop');
    armWatchdog(E, STOP_GRACE);
  }

  // Unsettled search (best move still changing, or score still falling): worth a bit more time.
  function unsettled(hist) {
    const h = hist.slice(-4);
    if (h.length < 3) return false;
    if (new Set(h.map(x => x.move)).size > 1) return true;
    const cps = h.map(x => x.cp);
    return Math.max(...cps) - Math.min(...cps) >= 40;
  }

  function onEngineMsg(E, line) {
    if (typeof line !== 'string') return;
    if (TEST) { (E.log = E.log || []).push(line.slice(0, 160)); if (E.log.length > 80) E.log.shift(); }
    if (line === 'uciok') {
      armWatchdog(E, E.kind === 'full' ? 90000 : 40000);
      send(E, `setoption name Hash value ${E.kind === 'full' ? 128 : 64}`);
      send(E, 'setoption name UCI_ShowWDL value true');
      send(E, `setoption name MultiPV value ${MULTI_PV}`);
      E.multiPV = MULTI_PV;
      applyStrength(E);
      send(E, 'isready');
      return;
    }
    if (line === 'readyok') {
      clearTimeout(E.timer);
      E.timer = null;
      E.ready = true;
      E.state = 'idle';
      dbg(`engine live (${E.kind})`);
      if (E === upgrade) {
        const old = eng;
        eng = E; upgrade = null;
        killEngine(old);
        engineStatus = 'full engine ✓';
        workerRestarts = 0;
        if (pos && enabled && !pos.over) analyze(pos);
        else updatePanel();
        return;
      }
      engineStatus = E.kind === 'full' ? 'full engine ✓' : 'engine ready ✓';
      if (!upgrade && E.kind === 'lite' && workerRestarts < 3) setTimeout(upgradeEngine, 1500);
      if (pos && enabled && !pos.over) analyze(pos); else updatePanel();
      return;
    }
    if (E !== eng) return;

    const depth = parseInfo(E, line);
    if (depth !== null && E.job && depth >= Math.min(8, TIERS[accuracyIdx].depth) &&
        !previewShown && !previewTimer && E.state === 'searching' && E.job.fen === pos?.fen && !bookActiveFEN && !tbActiveFEN)
      previewTimer = setTimeout(showSearchPreview, 50);
    if (depth !== null) maybeEarlyStop(E);

    if (/^bestmove/.test(line)) {
      clearTimeout(E.timer);
      clearTimeout(E.hitTimer);
      E.timer = null;
      clearTimeout(previewTimer);
      previewTimer = null;
      const job = E.job;
      const accept = E.stopMode !== 'supersede';
      E.job = null;
      E.stopMode = null;
      E.state = 'idle';
      if (accept && job && !E.next) handleResult(E, job, line);
      E.pv = {};
      if (E.next) runNext(E);
    }
  }

  function showSearchPreview() {
    previewTimer = null;
    const E = eng;
    if (!enabled || !E?.job || previewShown || E.state !== 'searching' || E.job.fen !== pos?.fen || bookActiveFEN || tbActiveFEN) return;
    const entries = Array.from({ length: MULTI_PV }, (_, k) => E.pv[k + 1])
      .filter(entry => entry && plausibleMove(E.job.fen, entry.move));
    if (!entries.length) return;
    const side = turnOf(E.job.fen);
    top3 = entries.map(entry => Object.assign({}, entry, { side, tentative: true }));
    previewShown = true;
    renderAllArrows();
    updatePanel();
  }

  function requestSearch(job) {
    const E = eng;
    if (!E || !E.ready) return;
    E.next = job;
    if (E.state === 'idle') { runNext(E); return; }
    if (E.state === 'searching') {
      E.stopMode = 'supersede';
      E.state = 'stopping';
      send(E, 'stop');
      armWatchdog(E, STOP_GRACE);
    }
  }

  function cancelSearch() {
    const E = eng;
    if (!E) return;
    E.next = null;
    if (E.state === 'searching') {
      E.stopMode = 'supersede';
      E.state = 'stopping';
      send(E, 'stop');
      armWatchdog(E, STOP_GRACE);
    }
  }

  function runNext(E) {
    const job = E.next;
    E.next = null;
    if (!job) return;
    E.job = job;
    E.state = 'searching';
    E.pv = {};
    E.hist = [];
    E.t0 = performance.now();
    clearTimeout(E.hitTimer);
    previewShown = false;
    if (E.strengthDirty) applyStrength(E);
    if (E.newGame) { send(E, 'ucinewgame'); E.newGame = false; }
    if (E.multiPV !== job.multiPV) {
      send(E, `setoption name MultiPV value ${job.multiPV}`);
      E.multiPV = job.multiPV;
    }
    send(E, job.position);
    send(E, `go depth ${job.depth}` + (job.movetime > 0 ? ` movetime ${job.movetime}` : ''));
    armWatchdog(E, job.movetime > 0 ? job.movetime * 2 + 3000 : (job.ponder ? 40000 : 20000));
    updatePanel();
  }

  function autoMovetime(clockMs) {
    if (clockMs === null) return 800;
    if (clockMs < 8000) return 120;
    if (clockMs < 20000) return 250;
    return Math.max(300, Math.min(6000, Math.round(clockMs / 35)));
  }

  function makeJob(st, opts = {}) {
    const side = turnOf(st.fen);
    const meTurn = side === mySide();
    const tier = TIERS[accuracyIdx];
    const speed = SPEEDS[speedIdx];
    const clockMs = readMyClockMs();
    const lowTime = clockMs !== null && clockMs <= 25000;
    let movetime = speed.movetime < 0 ? autoMovetime(clockMs) : speed.movetime;
    if (lowTime && movetime !== 0) movetime = Math.min(movetime, 250);
    if (!meTurn && movetime > 1200) movetime = 1200;      // opponent's clock is ticking; this only predicts
    let multiPV = MULTI_PV;
    if ((speed.name === 'fast' && meTurn) || lowTime || (meTurn && autoMoveEnabled)) multiPV = 1;
    const depth = meTurn ? tier.depth : Math.max(6, tier.depth);
    const useMoves = st.moves.length && historyConsistent(st.startFEN, st.moves, st.fen);
    if (st.moves.length && !useMoves) dbg('move history inconsistent with FEN; searching from FEN only');
    const position = useMoves ? `position fen ${st.startFEN} moves ${st.moves.join(' ')}` : `position fen ${st.fen}`;
    const maxTier = tier.mode === 'max';
    const budget = movetime;                               // what a fresh search of this position would get
    if (opts.ponder) movetime = 0;                         // speculative: runs until the opponent moves
    return {
      st, fen: st.fen, position, multiPV, depth, movetime, budget,
      ponder: !!opts.ponder, extended: false,
      earlyStop: maxTier && budget > 0 && speed.name !== 'deep',
      extendFactor: 0.7,
      allowExtend: maxTier && meTurn && budget > 0 && speed.name !== 'fast' && speed.name !== 'deep' && !lowTime && !opts.ponder
    };
  }

  function buildList(E, job, line) {
    const fen = job.fen;
    const side = turnOf(fen);
    let list = Array.from({ length: MULTI_PV }, (_, k) => E.pv[k + 1])
      .filter(entry => entry && plausibleMove(fen, entry.move));
    const chosen = line.match(/^bestmove ([a-h][1-8][a-h][1-8][qrbn]?)/)?.[1];
    if (chosen && plausibleMove(fen, chosen)) {
      const index = list.findIndex(entry => entry.move === chosen);
      if (index > 0) list.unshift(list.splice(index, 1)[0]);
      else if (index < 0) list.unshift({ move: chosen, pv: [chosen], scoreRaw: null, mateScore: null, wdl: null, label: '?' });
    }
    list = list.slice(0, MULTI_PV).map(entry => Object.assign({}, entry, { side, tentative: false }));
    return reconcileTablebase(fen, list);
  }

  function handleResult(E, job, line) {
    const list = buildList(E, job, line);
    if (job.ponder) {                       // finished before the opponent moved: keep it for the hit
      E.ponderResults.set(job.fen, list);
      dbg(`ponder done (${E.kind}) for ${job.fen.slice(0, 40)}…`);
      if (job.ponderBase && job.ponderBase === E.ponderBase) { E.ponderIdx++; runPonder(E); }
      return;
    }
    if (!pos || job.fen !== pos.fen) return;
    if (job.allowExtend && !job.extended && list.length && unsettled(E.hist)) {
      dbg('search unsettled; extending');
      requestSearch(Object.assign({}, job, { movetime: Math.round(job.budget * job.extendFactor), extended: true, allowExtend: false, earlyStop: false }));
      return;
    }
    top3 = list;
    top3FEN = job.fen;
    workerRestarts = 0;
    dbg(`result ${E.kind}: ${list.map(t => t.move).join(' | ')}${job.hit ? ' (ponder hit)' : ''}`);
    finalize(job.st);
    if (list.length) startPonder(job.st, list);
  }

  // ── PONDER ────────────────────────────────────────────────────────────────
  // While the opponent thinks, search the position after their most likely reply. If they play it, that search
  // is already deep when the move arrives; if not, it is simply replaced.
  // Up to three likely replies, most likely first. Every reply gets a short search straight away (a quick opponent
  // still finds all of them covered), then longer passes, and finally the first reply runs until it is stopped.
  const PONDER_PASSES = [[1000, 800, 600], [4000, 2500, 1500]];   // ms per reply in each pass

  function startPonder(st, list) {
    const E = eng;
    if (!enabled || !E || !E.ready || st.over || !st.atEnd) return;
    if (st.mode && st.mode !== 'playing') return;
    if (turnOf(st.fen) === mySide()) return;
    const cands = [];
    for (const entry of list.slice(0, 3)) {
      const reply = entry?.pv?.[0];
      if (!reply || !RE_MOVE.test(reply) || cands.some(c => c.reply === reply)) continue;
      const futureFEN = stepFEN(st.fen, reply);
      if (!futureFEN || !isValidFEN(futureFEN)) continue;
      cands.push({ reply, futureFEN, st: { fen: futureFEN, startFEN: st.startFEN, moves: st.moves.concat(reply), atEnd: true,
                   over: false, mode: st.mode, playingAs: st.playingAs, source: 'ponder', variant: 'chess' } });
    }
    if (cands.length && cloudEligible(cands[0].st)) {
      // warm the cloud cache for the two most likely replies so the answer is instant whichever one is played
      for (const c of cands.slice(0, 2)) if (!cloud.cache.has(c.futureFEN)) lookupCloud(c.futureFEN);
    }
    // replies the book / theory already answers need no search
    const useful = cands.filter(c => !openingMoveFor(c.futureFEN) && !theoryMoveFor(c.futureFEN));
    E.ponderQueue = useful;
    E.ponderBase = st.fen;
    E.ponderIdx = 0;
    E.ponderPlan = [];
    for (const pass of PONDER_PASSES) useful.forEach((c, i) => E.ponderPlan.push([i, pass[i] || pass[pass.length - 1]]));
    E.ponderPlan.push([0, 0]);                              // then keep deepening the most likely reply
    E.ponderResults = new Map();
    if (useful.length) runPonder(E);
  }

  function runPonder(E) {
    if (!E || E.dead || !pos || pos.fen !== E.ponderBase || !E.ponderQueue.length) return;
    const step = E.ponderPlan[E.ponderIdx];
    if (!step) return;                                     // the whole plan has run
    const job = makeJob(E.ponderQueue[step[0]].st, { ponder: true });
    job.movetime = step[1];
    job.ponderBase = E.ponderBase;
    requestSearch(job);
  }

  function stopSearch(E, mode) {
    E.stopMode = mode;
    E.state = 'stopping';
    send(E, 'stop');
    armWatchdog(E, STOP_GRACE);
  }

  // The opponent played the predicted move while the speculative search is still running: turn it into the real
  // search, give it the time a fresh search would have had (it has already used some), then take its answer.
  function ponderHit(E, st) {
    const fresh = makeJob(st);
    const live = E.job;
    live.ponder = false; live.hit = true; live.st = st;
    live.movetime = fresh.budget; live.budget = fresh.budget; live.earlyStop = fresh.earlyStop; live.allowExtend = false;
    const elapsed = performance.now() - E.t0;
    dbg(`ponder hit after ${Math.round(elapsed)} ms`);
    clearTimeout(E.hitTimer);
    if (fresh.budget > 0) {
      if (elapsed >= fresh.budget) stopSearch(E, 'accept');
      else E.hitTimer = setTimeout(() => { if (E.job === live && E.state === 'searching') stopSearch(E, 'accept'); }, fresh.budget - elapsed);
    } else armWatchdog(E, 20000);
    updatePanel();
  }

  function finalize(st) {
    if (!st || !pos || st.fen !== pos.fen) return;
    if (top3[0]) {
      derivePreMoves(st);
      renderAllArrows();
      updatePanel();
      playAutoMove();
    } else {
      pendingPreMoves = [];
      clearArrows();
      updatePanel();
    }
  }

  // ── TABLEBASE ─────────────────────────────────────────────────────────────
  function lookupTablebase(fen) {
    const fields = fen.split(' ');
    const count = (fields[0]?.match(/[prnbqkPRNBQK]/g) || []).length;
    if (count < 2 || count > 7 || fields[2] !== '-') { tablebase = null; return; }
    const cached = tablebaseCache.get(fen);
    if (cached) { tablebase = { fen, data: cached }; onTablebase(fen); return; }
    if (tablebase?.fen === fen && tablebase.loading) return;
    tablebase = { fen, loading: true };
    if (typeof GM_xmlhttpRequest !== 'function') { tablebase = { fen, error: true }; return; }
    GM_xmlhttpRequest({
      method: 'GET',
      url: 'https://tablebase.lichess.ovh/standard?fen=' + encodeURIComponent(fen),
      timeout: 7000,
      onload(response) {
        try {
          if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
          const data = JSON.parse(response.responseText);
          if (!data.category || !Array.isArray(data.moves)) throw new Error('invalid tablebase response');
          tablebaseCache.set(fen, data);
          if (tablebaseCache.size > 100) tablebaseCache.delete(tablebaseCache.keys().next().value);
          if (lastFEN === fen) { tablebase = { fen, data }; onTablebase(fen); }
        } catch (error) {
          if (lastFEN === fen) { tablebase = { fen, error: true }; updatePanel(); }
          dbg('tablebase: ' + error);
        }
      },
      onerror() { if (lastFEN === fen) { tablebase = { fen, error: true }; updatePanel(); } },
      ontimeout() { if (lastFEN === fen) { tablebase = { fen, error: true }; updatePanel(); } }
    });
  }

  const TB_DECISIVE = new Set(['win', 'loss', 'cursed-win', 'blessed-loss']);
  function tbLabel(data, move) {
    const c = data.category === 'blessed-loss' ? 'draw*' : data.category === 'cursed-win' ? 'draw*' : data.category;
    const dtz = move?.dtz;
    return `TB ${c}${Number.isInteger(dtz) ? ' dtz ' + Math.abs(dtz) : ''}`;
  }

  // Decisive tablebase positions: the tablebase's move list replaces the engine's. Drawn ones keep the engine's
  // choice but drop any move that throws the draw away.
  function onTablebase(fen) {
    if (!pos || pos.fen !== fen || !enabled || pos.over) return;
    const data = tablebase?.data;
    if (!data || !data.moves.length) return;
    if (TB_DECISIVE.has(data.category)) {
      const side = turnOf(fen);
      const entries = data.moves.slice(0, MULTI_PV)
        .filter(m => plausibleMove(fen, m.uci))
        .map(m => ({ move: m.uci, pv: [m.uci], scoreRaw: null, mateScore: null, wdl: null, label: tbLabel(data, m), side, tentative: false, tb: true }));
      if (!entries.length) return;
      cancelSearch();
      tbActiveFEN = fen;
      top3 = entries;
      top3FEN = fen;
      finalize(pos);
    } else if (top3FEN === fen && top3.length && !top3[0].tb) {
      const reconciled = reconcileTablebase(fen, top3);
      if (reconciled !== top3) { top3 = reconciled; finalize(pos); } else updatePanel();
    } else updatePanel();
  }

  function reconcileTablebase(fen, list) {
    const data = tablebase?.fen === fen ? tablebase.data : null;
    if (!data || TB_DECISIVE.has(data.category) || data.category !== 'draw') return list;
    const keeps = new Set(data.moves.filter(m => m.category === 'draw').map(m => m.uci));
    const kept = list.filter(entry => keeps.has(entry.move));
    if (kept.length) return kept.length === list.length ? list : kept;
    const side = turnOf(fen);
    return data.moves.filter(m => m.category === 'draw' && plausibleMove(fen, m.uci)).slice(0, MULTI_PV)
      .map(m => ({ move: m.uci, pv: [m.uci], scoreRaw: 0, mateScore: null, wdl: null, label: 'TB draw', side, tentative: false, tb: true }));
  }

  // ── CLOUD EVAL (full-strength tier only) ──────────────────────────────────
  // Lichess' cloud database holds very deep evaluations (typically depth 35-60) for most opening and common
  // middlegame positions. Weaker tiers never use it, so their strength stays exactly what the tier says.
  const cloud = { cache: new Map(), pending: new Map(), blockedUntil: 0, timer: null };

  function cloudEligible(st) {
    if (TIERS[accuracyIdx].mode !== 'max' || st.moves.length > 70 || Date.now() < cloud.blockedUntil) return false;
    if (typeof GM_xmlhttpRequest !== 'function') return false;
    const clock = readMyClockMs();
    return clock === null || clock > 15000;
  }

  function lookupCloud(fen, onDone) {
    const cached = cloud.cache.get(fen);
    if (cached !== undefined) { if (onDone) safe(() => onDone(cached)); return; }
    const waiting = cloud.pending.get(fen);
    if (waiting) { if (onDone) waiting.cbs.push(onDone); return; }
    const rec = { t: performance.now(), cbs: onDone ? [onDone] : [] };
    cloud.pending.set(fen, rec);
    const finish = (value, blockMs) => {
      cloud.pending.delete(fen);
      if (value !== undefined) {
        cloud.cache.set(fen, value);
        if (cloud.cache.size > 300) cloud.cache.delete(cloud.cache.keys().next().value);
      }
      if (blockMs) cloud.blockedUntil = Date.now() + blockMs;
      for (const cb of rec.cbs) safe(() => cb(value));
    };
    GM_xmlhttpRequest({
      method: 'GET',
      url: 'https://lichess.org/api/cloud-eval?multiPv=3&fen=' + encodeURIComponent(fen),
      headers: { Accept: 'application/json' },
      timeout: 2500,
      onload(res) {
        if (res.status === 200) {
          try {
            const data = JSON.parse(res.responseText);
            finish(data && Array.isArray(data.pvs) && data.pvs.length ? data : null);
          } catch (e) { finish(null); }
        } else if (res.status === 404) finish(null);
        else if (res.status === 429) finish(undefined, 60000);
        else finish(undefined, 15000);
      },
      onerror() { finish(undefined, 15000); },
      ontimeout() { finish(undefined, 5000); }
    });
  }

  // Lichess writes castling as king-takes-rook (e1h1); chess.com and the rest of this script use e1g1.
  function normalizeCastlingPV(fen, moves) {
    const board = boardFromPlacement(fen.split(' ')[0]);
    const out = [];
    for (const m of moves) {
      let mv = m;
      const from = m.slice(0, 2), to = m.slice(2, 4);
      const p = board[from], t = board[to];
      if (p && /[kK]/.test(p) && t && /[rR]/.test(t) && isWhitePiece(p) === isWhitePiece(t))
        mv = from + (to[0] > from[0] ? 'g' : 'c') + from[1];
      out.push(mv);
      applyMove(board, mv);
    }
    return out;
  }

  function cloudEntries(fen, data) {
    const side = turnOf(fen);
    const sign = side === 'w' ? 1 : -1;                      // cloud scores are from White's point of view
    return data.pvs.slice(0, MULTI_PV).map(p => {
      const pv = normalizeCastlingPV(fen, String(p.moves || '').trim().split(/\s+/).filter(Boolean));
      if (!pv.length || !plausibleMove(fen, pv[0])) return null;
      return {
        move: pv[0], pv, depth: data.depth, src: 'cloud', side, tentative: false, wdl: null,
        scoreRaw: Number.isInteger(p.cp) ? p.cp * sign : null,
        mateScore: Number.isInteger(p.mate) ? p.mate * sign : null
      };
    }).filter(Boolean);
  }

  function useCloud(st, data) {
    if (!data || !(data.depth >= 28) || !pos || pos.fen !== st.fen) return false;
    if (bookActiveFEN === st.fen || tbActiveFEN === st.fen) return false;
    const entries = cloudEntries(st.fen, data);
    if (!entries.length) return false;
    if (top3FEN === st.fen && top3[0]?.src === 'cloud') return true;
    cancelSearch();
    top3 = entries;
    top3FEN = st.fen;
    dbg(`cloud d${data.depth}: ${entries.map(t => t.move).join(' | ')}`);
    finalize(st);
    startPonder(st, entries);
    return true;
  }

  // Auto move waits briefly for an in-flight cloud answer (never past 550 ms from the start of the position).
  function cloudWait() {
    const rec = pos && cloud.pending.get(pos.fen);
    if (!rec || top3[0]?.src === 'cloud') return 0;
    const grace = SPEEDS[speedIdx].name === 'fast' ? 300 : 550;
    return Math.max(0, grace - (performance.now() - rec.t));
  }

  // ── ANALYSIS ──────────────────────────────────────────────────────────────
  function analyze(st) {
    clearTimeout(previewTimer);
    previewTimer = null;
    previewShown = false;
    clearArrows();
    tbActiveFEN = '';
    lookupTablebase(st.fen);                       // a cached decisive position is answered right here
    if (tbActiveFEN === st.fen) return;
    const side = turnOf(st.fen);
    const book = openingMoveFor(st.fen);
    if (book && plausibleMove(st.fen, book.move)) {
      cancelSearch();
      bookActiveFEN = st.fen;
      top3 = [{ move: book.move, pv: [book.move], scoreRaw: null, mateScore: null, wdl: null,
                label: `book ${book.ply + 1}/${book.total}`, side, tentative: false }];
      top3FEN = st.fen;
      finalize(st);
      return;
    }
    const theoryMove = side === mySide() ? theoryMoveFor(st.fen) : null;
    if (theoryMove) {
      cancelSearch();
      bookActiveFEN = st.fen;
      top3 = [{ move: theoryMove, pv: [theoryMove], scoreRaw: null, mateScore: null, wdl: null,
                label: 'theory', side, tentative: false }];
      top3FEN = st.fen;
      finalize(st);
      return;
    }
    bookActiveFEN = '';
    top3 = [];
    top3FEN = '';
    pendingPreMoves = [];

    // a single legal move needs no search
    if (st.source === 'api' && side === mySide() && st.atEnd) {
      const g = getGame();
      const legal = safe(() => g?.getLegalMoves?.());
      if (Array.isArray(legal) && legal.length === 1) {
        const m = legal[0];
        const move = m.from + m.to + promoOf(m);
        if (RE_MOVE.test(move)) {
          cancelSearch();
          top3 = [{ move, pv: [move], scoreRaw: null, mateScore: null, wdl: null, label: 'forced', side, tentative: false }];
          top3FEN = st.fen;
          finalize(st);
          return;
        }
      }
    }
    // full-strength tier: a deep cloud evaluation (instant when prefetched) beats a few hundred ms of local search
    if (cloudEligible(st)) {
      const cached = cloud.cache.get(st.fen);
      if (cached) { if (useCloud(st, cached)) return; }
      else if (cached === undefined) lookupCloud(st.fen, data => {
        if (!pos || pos.fen !== st.fen || !enabled) return;
        if (!(data && useCloud(pos, data))) playAutoMove();
      });
    }
    const E = eng;
    let liveHit = false;
    if (E) {
      const stored = E.ponderResults.get(st.fen);
      liveHit = !!(E.job && E.job.ponder && E.job.fen === st.fen && E.state === 'searching');
      const rank = E.ponderQueue.findIndex(c => c.futureFEN === st.fen);
      if (E.ponderQueue.length) dbg(rank >= 0 ? `ponder rank ${rank + 1} of ${E.ponderQueue.length} played` : `ponder miss (${E.ponderQueue.length} queued)`);
      // whatever happens next, the queue built for the previous position is stale
      E.ponderQueue = []; E.ponderBase = ''; E.ponderResults = new Map();
      if (stored && stored.length) {                       // the opponent played a reply that was already searched
        cancelSearch();
        dbg('ponder hit (finished)');
        top3 = stored;
        top3FEN = st.fen;
        finalize(st);
        return;
      }
    }
    updatePanel();
    if (!E || !E.ready) return;
    if (liveHit) { ponderHit(E, st); return; }
    requestSearch(makeJob(st));
  }

  function ensureAnalysis() {
    if (!enabled || !pos || pos.over || !eng || !eng.ready) return;
    if (eng.state === 'idle' && !eng.next && top3FEN !== pos.fen && !tbActiveFEN) analyze(pos);
  }

  // ── PREMOVES (conditional) ────────────────────────────────────────────────
  // While the opponent is on move, remember my reply to each predicted capture / forced mate together with the
  // exact position it applies to. It only fires if the opponent actually reaches that position.
  function derivePreMoves(st) {
    pendingPreMoves = [];
    const side = turnOf(st.fen);
    const me = mySide();
    if (!showPreMove || side === me || !st.atEnd) return;
    const board = boardFromPlacement(st.fen.split(' ')[0]);
    const seen = new Set();
    top3.forEach((entry, i) => {
      const [m0, m1] = entry.pv || [];
      if (!m0 || !m1 || !RE_MOVE.test(m0) || !RE_MOVE.test(m1)) return;
      const mate = i === 0 && !entry.scoreBounded && Number.isInteger(entry.mateScore) &&
                   entry.mateScore >= -3 && entry.mateScore <= -1;
      const recapture = !!board[m0.slice(2, 4)] && m1.slice(2, 4) === m0.slice(2, 4);
      if (!mate && !recapture) return;
      const after = Object.assign({}, board);
      applyMove(after, m0);
      const piece = after[m1.slice(0, 2)];
      if (!piece || isWhitePiece(piece) !== (me === 'w')) return;
      const expect = placementFromBoard(after);
      const key = expect + m1;
      if (seen.has(key)) return;
      seen.add(key);
      pendingPreMoves.push({ kind: mate ? 'mate' : 'recapture', move: m1, expect, fen: st.fen, oppMove: m0 });
    });
  }

  function playPendingPreMove(st) {
    if (!enabled || !pendingPreMoves.length) return false;
    const placement = st.fen.split(' ')[0];
    const hit = pendingPreMoves.find(p => p.expect === placement);
    pendingPreMoves = [];
    if (!hit || !canAct(st) || !plausibleMove(st.fen, hit.move)) return false;
    const how = executeMove(hit.move, st, 'premove');
    const key = st.fen + '|' + hit.move;
    if (how && typeof how.then === 'function') {
      lastAutoMoveKey = key;
      how.then(ok => { if (!ok && lastAutoMoveKey === key) lastAutoMoveKey = ''; });
      return true;
    }
    if (how) { lastAutoMoveKey = key; dbg(`premove (${hit.kind}) played via ${how}: ${hit.move}`); }
    return !!how;
  }

  function cancelQueuedPreMove() {
    if (!pendingPreMoves.length) return;
    pendingPreMoves = [];
    renderAllArrows();
    updatePanel();
  }

  // ── MOVE EXECUTION ────────────────────────────────────────────────────────
  function canAct(st) {
    if (!enabled || !st || st.over || !st.atEnd) return false;
    if (st.mode && st.mode !== 'playing') return false;
    const me = st.playingAs;
    return !!me && turnOf(st.fen) === me;
  }

  function playAutoMove() {
    if (!autoMoveEnabled || !pos || top3FEN !== pos.fen || !canAct(pos)) return;
    const move = top3[0]?.move;
    if (!RE_MOVE.test(move || '') || !plausibleMove(pos.fen, move)) return;
    const key = pos.fen + '|' + move;
    if (lastAutoMoveKey === key) return;
    const wait = cloudWait();
    if (wait > 0) {                       // a deeper cloud answer is about to arrive
      clearTimeout(cloud.timer);
      cloud.timer = setTimeout(playAutoMove, wait + 5);
      return;
    }
    lastAutoMoveKey = key;
    const how = executeMove(move, pos, 'auto move');
    if (how && typeof how.then === 'function') {
      // DOM fallback: allow a couple of retries if the board did not move (overlay, drag/click mismatch...)
      how.then(ok => {
        if (ok) return;
        domFails = domFails.key === key ? { key, n: domFails.n + 1 } : { key, n: 1 };
        if (domFails.n < 3 && lastAutoMoveKey === key) lastAutoMoveKey = '';
      });
      return;
    }
    if (!how && lastAutoMoveKey === key) lastAutoMoveKey = '';
    else dbg(`auto move played via ${how}: ${move}`);
  }

  function executeMove(move, st, label) {
    const from = move.slice(0, 2), to = move.slice(2, 4);
    const game = getGame();
    if (game && typeof game.getLegalMoves === 'function' && typeof game.move === 'function') {
      // never act on a stale position: the board's live position must still be the one analysed
      const liveFEN = safe(() => game.getFEN());
      if (liveFEN && liveFEN.split(' ')[0] !== st.fen.split(' ')[0]) return false;
      try {
        const legal = game.getLegalMoves().find(m => m.from === from && m.to === to &&
          (move[4] ? promoOf(m) === move[4] : !promoOf(m)));
        if (!legal) return false;
        const payload = Object.assign({}, legal, { animate: false, userGenerated: true });
        if (move[4]) payload.promotion = move[4];
        const result = game.move(payload);
        if (result && (result.type === 'Error' || result.error)) return false;
        return 'api';
      } catch (e) {
        dbg(`board API ${label} failed: ${e}`);
        // a listener can throw after the move was already made; never click a second time in that case
        const after = safe(() => game.getFEN());
        if (after && after.split(' ')[0] !== st.fen.split(' ')[0]) return 'api';
      }
    }
    return clickMove(move, st, label);     // DOM fallback is asynchronous: resolves true once the board moved
  }

  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  // DOM fallback: the board may be set to drag-only or click-only, so try a drag first and confirm the position
  // changed before falling back to two clicks.
  async function clickMove(move, st, label) {
    const board = getBoard();
    if (!board) return false;
    const rect = board.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const flip = isFlipped();
    const placement = st.fen.split(' ')[0];
    const from = move.slice(0, 2), to = move.slice(2, 4);
    const base = { bubbles: true, cancelable: true, composed: true, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };

    function squareCenter(square) {
      const file = square.charCodeAt(0) - 97;
      const rank = Number(square[1]) - 1;
      return {
        x: rect.left + (flip ? 7 - file : file) * rect.width / 8 + rect.width / 16,
        y: rect.top + (flip ? rank : 7 - rank) * rect.width / 8 + rect.width / 16
      };
    }
    const fire = (target, type, pt, buttons) => target.dispatchEvent(
      type.startsWith('pointer') && typeof PointerEvent === 'function'
        ? new PointerEvent(type, Object.assign({}, base, { clientX: pt.x, clientY: pt.y, buttons }))
        : new MouseEvent(type, Object.assign({}, base, { clientX: pt.x, clientY: pt.y, buttons, detail: 1 })));
    const moved = () => domPlacement() !== placement;
    async function waitMoved(ms) {
      for (let waited = 0; waited < ms; waited += 20) { if (moved()) return true; await pause(20); }
      return moved();
    }
    const stale = () => !enabled || getBoard() !== board;

    async function drag() {
      const source = board.querySelector('.piece.square-' + (from.charCodeAt(0) - 96) + from[1]);
      if (!source) { dbg('dom move: source piece not found'); return false; }
      const a = squareCenter(from), b = squareCenter(to);
      fire(source, 'pointerdown', a, 1);
      fire(source, 'mousedown', a, 1);
      await pause(20);
      if (stale()) return false;
      for (const pt of [{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, b]) {
        fire(source, 'pointermove', pt, 1);
        fire(source, 'mousemove', pt, 1);
      }
      const hit = document.elementFromPoint(b.x, b.y);
      const target = hit && board.contains(hit) ? hit : board;
      fire(target, 'pointerup', b, 0);
      fire(target, 'mouseup', b, 0);
      return true;
    }
    function clickAt(pt) {
      const hit = document.elementFromPoint(pt.x, pt.y);
      const target = hit && board.contains(hit) ? hit : board;    // coordinates decide the square, not the element
      fire(target, 'pointerdown', pt, 1); fire(target, 'mousedown', pt, 1);
      fire(target, 'pointerup', pt, 0);   fire(target, 'mouseup', pt, 0);
      fire(target, 'click', pt, 0);
      return true;
    }
    async function pickPromotion() {
      const color = turnOf(st.fen);
      for (let i = 0; i < 30; i++) {
        await pause(25);
        const choice = document.querySelector(`.promotion-window .${color}${move[4]}, .promotion-piece.${color}${move[4]}`);
        if (!choice) continue;
        const r = choice.getBoundingClientRect();
        const pt = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        const hit = choice;                       // click the picker piece itself, not whatever sits at that point
        fire(hit, 'pointerdown', pt, 1); fire(hit, 'mousedown', pt, 1);
        fire(hit, 'pointerup', pt, 0);   fire(hit, 'mouseup', pt, 0); fire(hit, 'click', pt, 0);
        return true;
      }
      return false;
    }

    try {
      let how = '';
      if (await drag()) {
        if (move[4]) { if (!(await pickPromotion())) dbg('promotion picker not found after drag'); }
        if (await waitMoved(250)) how = 'drag';
      }
      if (!how && !stale() && !document.querySelector('.promotion-window')) {
        if (!clickAt(squareCenter(from))) return false;
        await pause(30);
        if (stale() || domPlacement() !== placement) return false;
        if (!clickAt(squareCenter(to))) return false;
        if (move[4]) await pickPromotion();
        if (await waitMoved(250)) how = 'click';
      }
      dbg(`${label} via ${how || 'dom (unconfirmed)'}: ${move}`);
      return !!how;
    } catch (e) { dbg(`board ${label} dom move failed: ${e}`); return false; }
  }

  // ── OPENING BOOK ──────────────────────────────────────────────────────────
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

  function favoriteIndexForSide(side) {
    return OPENINGS.findIndex(opening =>
      opening.side === side && opening.name === favoriteOpenings[side]);
  }

  function activeOpeningIndex() {
    const side = mySide();
    const favoriteIdx = favoriteIndexForSide(side);
    if (favoriteIdx >= 0) return favoriteIdx;
    return OPENINGS[openingIdx].side === side ? openingIdx : 0;
  }

  // When the side I play changes, select that side's saved opening. A selection for the other side is left alone.
  function syncOpeningToSide() {
    const side = mySide();
    if (!getBoard() || side === displayedOpeningSide) return;
    displayedOpeningSide = side;
    const favoriteIdx = favoriteIndexForSide(side);
    if (favoriteIdx >= 0) openingIdx = favoriteIdx;
  }

  function openingMoveFor(fen) {
    const index = activeOpeningIndex();
    const opening = OPENINGS[index];
    if (!opening.side || turnOf(fen) !== opening.side) return null;
    if (!openingIndexes.has(index)) openingIndexes.set(index, buildOpeningIndex(opening));
    return openingIndexes.get(index).get(openingKey(fen)) || null;
  }

  function openingStatus(fen) {
    const index = activeOpeningIndex();
    if (!index) {
      return theory.size && turnOf(fen) === mySide() && TIERS[accuracyIdx].mode !== 'skill' &&
             theory.has(hashKey(openingKey(fen))) ? 'theory' : 'engine';
    }
    const opening = OPENINGS[index];
    if (!openingIndexes.has(index)) openingIndexes.set(index, buildOpeningIndex(opening));
    const book = openingIndexes.get(index);
    const key = openingKey(fen);
    if (book.has(key)) return 'in saved line';
    if (theory.size && turnOf(fen) === mySide() && TIERS[accuracyIdx].mode !== 'skill' && theory.has(hashKey(key))) return 'theory';
    if (book.ends.has(key)) return 'line ended · engine';
    if (book.positions.has(key)) return 'in saved line · waiting';
    return turnOf(fen) === mySide() ? 'opponent deviated · engine' : 'line deviated · engine';
  }

  // ── THEORY BOOK ───────────────────────────────────────────────────────────
  // Generated offline: the engine-best move (lichess cloud evals, depth 35-75) in the positions players actually
  // reach, for both colours, including the common gambits and sidelines. One 16-character record per position:
  // 11 base-36 characters of a 53-bit hash of "placement side castling", then the move padded with "_".
  // Used by every tier except the beginner "skill" tiers (a 45%/30%/20% player is not supposed to know theory).
  const THEORY_DATA = /*THEORY_BEGIN*/'01u9rnj12qme2e4_15kof3o79gag1f3_0ttjb8k50tbg1f3_1ly5n5i7w76f1c4_0fvwycrith1d2d4_07cx99vesfid2d4_06uf8u1ip9hf3d4_080ls675x4xe4d5_1zm0egwg8xuc2c3_0h2nzvw3f31d2d4_1c6ucbyopxte4e5_14yv4bw0f42e4e5_1klw7yy0i9ld2d4_05lutc4sjx2f3d4_15sjxopj77hc2c3_1nf3ky7ljcwd2d3_03j5aqb8obrb1c3_1507izwzzvsb1c3_02htjwet0akg1f3_0luhrx6mrrfg1f3_1zti8kn2u7cd2d4_0x7o2txaeg5d2d4_1ztwg8n1ca8f1e2_2d32jnhnfihc3d4_175282xxtpjc1d2_175p8eisfl7d2d4_168he6toh51c1g5_09zmz2a20z3f3e5_20bvnlk1kmhe1g1_0imsbbsn477f3d4_11nkbgdgbnlf3d4_0ln8gv3v25jf2f4_1n71jmvvxk7b1d2_0msxbc5t5m0d4b5_0ik0itx9adva2a3_13oybwup5t7d2d4_0le20hj0osod2d4_06v4e4wezrrd2d4_1ltn2bmffglc3d4_24qpkbn83nad2d4_0nzhpapqremg1f3_24fnv38nwerb1c3_136ggq0w6x0c2c3_2ad935j1znic2c3_1uwvfz6g90cf3d4_0khnh8hy46nc2c4_1fvar7ie7cyd1f3_252l0x5ns17b1c3_0omaa1aonquc1e3_2fwu32rrjgda2a3_136x9h0m3rpe5f3_25yyz12rzgod2d4_1k68l41tbe0e1g1_1q1qj9ug8epd2d4_0zqsocntek0c1e3_0g98utsreyxe5c6_1ul9ttog7y6d2d3_2dyzhgobpqrb5a3_1uc2w1cwjv3f1e2_0z43eqlecf6f2f3_0ciq2y7ojihb1c3_0mgo7pm9ld2c2c3_1u3v15u57blc2c4_1aain2ind9ae1g1_277xlxyfboge1g1_1cg5v3njnbyd2b4_2abixm01i69c4f7_25qclmz93a1e1g1_2cyaqqkl5y1b1c3_1bzffogj37vc2c3_0fy8uwep584d2d4_0zcx1824sk1d1b3_1opvyrqgwhbf1d3_1k4hp5ec6oxe1g1_1bwhp6is7h1b1c3_13le7ptpwiqf1e2_2cffpoglal6e4d5_0ccezo56ixxe1g1_14n60m6lzbld2d4_2g2g40duyljb1c3_2833w7rwlsdf3d4_1ichyvpr6m9c2c3_24dsmi0allgd4b5_1i34u9xu90nd1d2_1dyhpjqqjjnf1e1_2amdhhsg6p5b1c3_0oax2zngoklf3e5_113zsfahl4dg1f3_04te250tp9rc2c3_0wq5d614j6kc1d2_13awnrbexd1e1c1_0r9o65u3wb6c1g5_09wm9j10ztod4d5_19lk0tv252pg1f3_06wj02ak6udc2c3_23z1xg02oatb1c3_1346gwqkdaic1f4_2b0kifu3clrd1d4_26bzzonvg8le4d5_08jygvtoamqe1c1_1ijpmypgrs6f1c4_1lipaornwjib5a3_26ohy0kgrdud4e5_12yak5t78frf1d3_04dedxbvvzmf3e5_2dz2k97pe50b1c3_0pvic1jhkhsf3d4_27imwkv53itc3d4_1v9k5xgmda1c2c4_0sc6rd7zimvc3d4_05o6hw5v4m2b5d6_1fthd6nvi1wd1d6_0idtzfly28cd4d5_059jcez7in5b1c3_1sq7jy5pwbhd1d2_1dhz4o3lz5pg1f3_27hzatjij9xa2a3_1luqrm2q106c3d4_0cvs7df91k4b1c3_0itsu8v6vlyd1e2_1s02wvuay0vc3d4_0zxxlwkdawlb1a3_1k6ddmugf4cf1e2_0g38dlal9uwc3d5_0yenocnlefme1g1_0ax30tgc6p9e4d5_1ppsqztifj6c4b5_0etav08awacg1f3_24zwh7lzx0pc2c3_1ovxmrn93qhe1g1_124nbzpnio2g1f3_06dkm4hju1hc3d5_21i3hkpc359b2b4_0uygr8gacw8e1g1_25u50r0lqk0f3d4_1ahtui4m87ud3d4_29qr1gphetkd1f3_1ejcykqk40qf2f4_1ku5jynd8gxg1f3_0muiracfvkcf1d3_1rzbszvjs5if2f3_0w71kry8yzyg5f6_1708ffskjo8f3b3_0w5jbb744icd4c5_1bm42vloorpb2b4_0nor0cphhbic2c3_1blkn82nxyng2g4_29baqqaab3qg2g4_1par1l2m8uac1g5_126gjsm38qkh2h3_0jao1mrvpk8e4e5_05p4b7v2lj7c4d3_0w8whtf5w85h2h3_1942fuleuj5e1g1_0pmn12anr76e1g1_1gshet9jbidg1f3_0qhb3u19aopd5c6_15b9v370087c3d4_045az8gtwxid4f5_1j50k3i6hlqc2c4_06f29sngdmse1g1_1qkysllrmrkh2h3_1b4l5w172ljg1f3_1052m6ymwqpg1f3_0n8khpjmkhic2c4_090etoajg14f1e2_108oxd7xzn9g1f3_2g24vhlozkrd2d3_25fb7nr3ihja1c1_0h3vbcbchtbb1c3_0qzg4e3nj92b1d2_1twhtlp4zd4c2c4_24bxu19weoec3d4_10ems2iq9kie1g1_0nzesok40emh2h3_203ktehgz00d4b3_2410l469rd0b1c3_022lhfaciije1g1_2fy6luy35j4c1e3_0hzc4t963qed2d4_152gyi0pejag1f3_0fv0o1y9raih2h3_23r1w5hztcsb2b4_21q0qlacwetc1e3_1h3yp9j0vxrc1g5_0p9ft4dxme5d2d4_113e4smdcuub1d2_2g36zi5n1r4b2b4_1s3c694xh95b4b5_1dw7swzej7ja2a4_1p67mq1y98nb1c3_0ez6lld2nh3g1f3_0p0a9mo5zmje1g1_1baf1lf3ycvf1e2_0puyngkje7eb1c3_0bq1ogfdzttb1c3_00e3c13qv90b4b5_0a0rzf9odyhc1e3_18xfmzsfr7mg5f6_267xupjlnhpe1g1_03m4bv2v633b1c3_14asdv1fj2pd4c6_14pr60bsf16e1g1_0saealzl02cc2c3_0yb2nk2vxjxe4e5_1qvfmd0bha3d4d5_0181uwxxlxzf1d3_08qplqg8vkhb2b4_0h51o1xswyob1c3_0lwm9tjjlt2b1c3_01zf04322u4d1d4_19k69obfoy8c3e4_1re7yll4zmfe1g1_12qkh7ygf6jd4d5_1zc5ugqaahch2h3_087up6h1y7cd1e2_07qbatdu95dd2d4_0vfvlw8ntr3b1d2_13fbudhs4mye4d5_11t98j19e1lf1c4_2dd9y1lzsp2d4c6_0cdn1k71p17b1c3_1qskka6sd17d4c6_1do4r71hc8le5f3_0uu3017af09d6d1_2dnnvd9nbaye3d4_24zhb0foqacc3a4_0w4dif8jrg3g2g4_2fffc0t38q6d1d2_20wcx5xbjpjc2c4_1rh98yoquvif3e5_19bgkmwfh25b1d2_1oamwkp0x3gc2c4_0i8dta09wk7c4f7_11e3ypzd5v9g5f6_2c1cd2ugstub3b4_0a5ds527idcc4f7_0kbrivf4pabb2c3_0tyqyembgufc3d5_12znctedyo0e1g1_1c2wo6pnlzwf1e2_1d6otimb099e4d5_1wib5350s77d6d1_12jhn9oirdkf3e5_0lm21bzqkivf3e5_00q87p8d9ije4f5_2d11wrqff6ye3d4_1vlbjq5ak1sd4f3_0hguvejh0tab1c3_0wh3w7rl1e7e4d5_0gi8y96v44vd2d4_173bzjs0hnef1c4_0dtedgvikawc3d4_1xw7ugkjyfac1e3_25kaqmw7gltf1e1_15roz0xqougd1f3_08mm8543e6va2a4_1p21xdm9epqe1g1_1ys6k24w0hub1c3_1lrnd5xk97ke1g1_10j9m5ib71ef3h4_24m8gcy4767b3b4_24qi3hwe879a2a3_2bjcjdmgsj9g4g5_204zys8sw27d1d2_2du106ddbzaa3c2_0aruf0387hac3d4_1ghqbizsymne4d5_0mq339eti1jg1f3_11smlunviezf1e1_1kicwa6acbua1b1_21ivkxutlvsc4e2_23ga8b69zt4e4e5_01u8uckblrbh2h3_1f7q1w13lykb1c3_2b5cfk83jdkf3e5_12tyakotveka1c1_0v66hrzombac2c4_22ypivudpt7c1e3_0h5xjg01rltf1b5_0e4ks6rxfaia4a5_1gvs76r1wgnc1e3_1l3dijw7gq1d2d4_1y416ggy4ske5e6_1qm55g3e421d1d2_1mtavwbuaoda2a3_12fnz32p673d1h5_0tk5ff5cpemg2g4_1zo7zlbhwlnf1d3_0n32b8f44xcd2d4_1uz6krz2b39d1f3_1ch0v5cbi3nc2c3_0g48sgl4vg1b1c3_06pt1nq7oy8e4e5_0carfisl0jgh2h3_0rdjjckchw7c3d4_0vlwafkjixbf1d3_0j0jfr99ltja3c2_0or9r2rc3hed2b4_2a0lilbyhgie4e5_01mowwvmh2gf1e2_036pp8b1txhg2g4_2bzy4k2jk54b1c3_1h43atued9de1g1_2c0q1ld36hoe4e5_12iejgxp92ad4c5_1kg2sn8jq3ad4c6_2dx2wdbm6tkb5a4_09fgio1ruimg5h4_17xmc0iwyb4d1f3_12mx6vzlmrdd4c5_1f2e2g38ayhf1c4_2105nide2vmg1f3_0kqchu51javg1e2_2cb3br2cteef1e2_27xtw2ra5moa1c1_1yyoyw6j85ie1g1_2e8d2paz50wf1d3_1xcd37dbbo3g4g5_00x6unn93y6f4f5_1g0plr20oycg5f6_26odvknfeqid5c6_0d1jdkokzyvb1c3_1n7p8107ckpb1c3_26j5dzf65d5g2g4_24q1sqezl2ad4e5_0d7qms7rt6ma2a4_00n73jdm716b3b4_16b5yhf5mb5d5e6_0wohr4rwagfe2e4_0m529ch6mg2g1f3_28dvida3sd5g1f3_19sdr28ucz9b1c3_1nfznbyeoope1g1_25xt1krildna3c4_1lf31bguns2a2a4_0o8shef3ouxh2h3_2dwufu9ra84g1f3_2g92anm7gqtf1d3_1wdckpbtjjcc1e3_10uyazmx9jtd2d4_130qx277sy0a3c2_0afxdl5t26ae4e5_0nnsjy9i2ztf1e2_0y8llyo7neka2a4_1qlk8yxp98qc2c3_1zu9k2eebmzf2f4_12g4a9a53lff1c4_20a6dlfmb6mf1c4_183hdk6z4zpe1g1_0sgi8wgaattc1g5_29p6xn7iadmb2c3_0pkaem0nqf2f1e2_19xm5w14dvtb1c3_1tbkx28g2adf1c4_139vbqhemn5d4d5_202vqctvebgg2g4_23cdj33yzehb1c3_0qw85ksipwxb1c3_158pezcr7s4f1d3_0dtxlru71xeb1c3_279b9d4tu0xh2h3_01mpndkyvmdh2h3_1ll4j986ayee1c1_14ct9j3uv9ja4a5_0jxbx37f4aac4c5_24t81rh06inb1d2_2gbevbn6z8oe4d5_2df9zwznxb1g1f3_1b1c60x85d1d3c4_17g4aed7pepc2c3_26i6wghzefhb2b4_18mzy9ia03gf3d2_01pfqbodiswe1g1_1wq4v3x17wgg2g3_0tckjot7fgmc4b3_0fh1rivmxfqe1c1_0u9js1qyz94e3d4_1o9ytz67v29g1f3_0123gkneby8f4e5_16mihfrhxfkf3d4_13b8ikwnepzd4d5_1w966vmdlhnb1c3_0dali0dc99gb1c3_1pdnthdbdz1c1e3_0om2nlmxwwca1c1_0blknb5o21ab1c3_238etq946aub1c3_0xz7znq2flyf1d3_11zthxfv2oab1d2_0ghzz5iwz0yb2c3_0g2oj2xv61ne1g1_1l2uvn9cln5e4e5_0zdzcb07tkwd4e5_28gcqw9c12id1d4_14ywi1n1ad2h2h3_237mill3r2lb1c3_119fdfwmhtub1c3_2gbx8ur36y0g1f3_1gj9l0b7iwgd4b5_0rucpe42exda3c4_19qn35w71mse2f3_14yob4unkjhf3f4_1phip1paau5c3d5_14ek63k0yctc1d2_01w0liher7dc3d4_0hmgxglh89cf1e2_1cd8fer9fc9d2d4_2ddr7l6o96hg2g4_1y5kqj5z1cfh3h4_26a0utvswqbc1g5_1gzzk1vwjo4e4e5_03tvud3p45vb1c3_0a2ws1l35emd1g4_09ltg63zs8bb1c3_0kv6xss9s68b2b4_09bhgrae37cc3d4_13qo8xadjddc3e4_1qqsszxo2vee5d6_0xiyiatzx5le1g1_0gfrhyji5oic2c4_1i579m055i0e4e5_0u6m0s5ptrkb2b4_1233byeqzp9b1c3_2czfmhf06kea2a4_0rk8s71w7ith5c5_0438hzh74y4f1b5_1k2zt53vqy9b4b5_0x7mw5hw4qtg4d1_1sq7f2mkiezb2b4_1qv69g3gzzje4e5_10x8u9udiele1g1_1s5a19qq56kd4e5_21dzv9xfqrjb1c3_1b6blhu7dsfe1g1_0advi60bd0pd4e5_292pzfcdognc2c4_0nrsljhsspwb1d2_01ksj5wppjxd1d2_165h8l4bieic1g5_0npfsb5dyp4c1e3_2fpa6ql1ei6a3c2_01hdvl9nxw0e1g1_0sbf7byem88f3d4_0vgp7jsext4d1c2_1dr9pn9x6b7d2d4_1c2756k1hzyc3a4_1xh97qoa0x1f1d3_0jtl0ydf288e4e5_27s53bfimvtc4e6_1durulyecyeb2b4_0koxa8yulo0d2d4_1j5k3fy4oc3c2c4_1gakxuvq562a2a4_2e4afkre5pyd3d4_0kbqfc1m122e1c1_1t9zi72po5zd3e4_10b0t7eb2rpc3d4_0hi2jhhwvjqf1b5_12zd60mx8f5c3e4_287ktgetderd4d5_13fu0py9lded1d2_2d2vbcwsfumg5f6_1k2j5800eg4f3g5_1sk897nunb4f1c4_11yx6h2xxhza1b1_0x812oeon26b1c3_19p41vfcsgzf3g3_0qkylvv7o0ac1b1_12egavtpm22c2c4_0eljge9x7wqh2h3_08bhi0prpdcf1e2_134whn2ime0b1c3_0efe5huqzw3c2c3_1j2yihsuwjdc1e3_1nlcc4kzvvbc2c3_0at7vnh09ugd2d3_260e0ju3wb0f3e5_0eibe4w6okhf1e1_1kxidfsx0kob3b4_16u2qy08ycld4b5_0hbge5oign3b1c3_29tinozjiijg5h4_0xdcf9qhn7kf1d3_1fz90mc3zahe1g1_113h9sfp1ied4d5_1eq5agsl4eob1a3_12xpq1735eyd4c6_1j8faay7k0bf1e1_0dajl471qgce1g1_12docv83rohd2d4_27u6pefr4s8g2g4_0ddmvmezwbkb2b4_1hsuicvwx2kh3h4_0s0zecrbzw3c3d4_0ajyacupqq4d1f3_02pdok4ivlte1f2_066yu6gbky1e1c1_273rhywvf9va2a4_0ds8imc1yzxa2a4_1ft92xg239de1g1_1g48f8bcla6c6b7_0c7hwjy5vvxf1e1_1omjccclvxvd4c5_0dryyzzld1df1b5_0q4xpm7oepqc1b2_1j9y1vetmged1b3_22xcck6det2f1d3_00xwmjtmhned4c6_278ozusnlxqe1c1_16yv5rv9htmc2c3_0vv3jmxnp0ef3d4_0y1mp3ngp5ce4e5_0cwit6b3ozwe4d5_1a4rejufhpqb1c3_0gk1hw3ctr7a2a3_0b8mtjyfxieb2b4_01t7j747lzph2h3_1kpqs6ko5dqd1c2_0wa94trma6sd1b3_2fsb25pqkakc2c4_1puzkdr6rbrd2d4_1b9s76i4ruad4c5_0qve3v0bqr3d4g7_02dzi5kmslqd4g7_0e3hg12khldg2g4_00bgp8941p0b2b4_1gxokubm9tjf1d3_20ps6jwvc7tf2f3_08nqlhoz32hf3h3_1v6tb4rjvgxd2d4_26koomld81yc1d2_0ttgoecgxild4c5_0dttz161x57d4c5_1uc8kic9gnrc1g5_0bg5c4d03btc1g5_1237kmsm8n6f1b5_0onuk8xynsab1c3_0g4ybm13b6rc1e3_0zhxojnjkq6f1d3_13smau28bf6b4e7_276vh1w7tyxe1g1_0yi7kij9qjff3d4_0xjshddugqeg7h8_1j5ja2refnyf3d3_0pgez3tkya5e2d3_0wxvwomhs60c3d4_187g8mufry0c1e3_293zoaniz2ja3c2_1jvlve5ligzb1c3_0mzkh4uuajyh2h3_26b63mkz2q3f3e5_1hnxk6wz544f1e1_2dgj5qk1cimc1e3_1x0mm7l8f8oe5f3_294e8s0ujwad4d5_1ovut5ss6b7f1b5_1nv7cwmo7ndd5e7_1xh8o65z7t9e2d3_05tdxvaetzfd4d5_19qvf36yv6nd1e2_28oxktzfz0ma2a3_02fi9itnutja1a4_2d15z3bhodcd2d4_1507mjab1atd4e6_1627ne4utw3d4c5_1p6j7613gdaf1e2_1829yhojzsvf2f4_0fu42yj7pubh2h3_21f75fp0a3nc3d4_29svg2icl3ue4e5_17ppsupb2v3e4f5_1hqhty5h7ddd2d4_0xaih3e342cd2d4_0om9lu0n9s6d2d4_09gbkxjkobhd2d4_1oo2rf8bkhag1f3_1vuifhzxubud4b5_173t20p9fzuf4g5_07grsh61npob1d2_1p8isde1n14d4d5_0whan0l4ah8e1g1_0torttldaisf3d4_0jhwchkmv7yc1e3_1lnl4q5eoffh3e6_1ft12v2wur9d1f3_0qhnjc83aszd4d5_0ljztn27oixf1e1_2ap6x24xbi5d1e2_1fc99qrev4id3e4_1c6devn2ofbh2h3_06lm27f5l38c3d5_2f3rjwlk6nue5g6_17cote6k2vcf1b5_20tot1u1thgd4b3_0bcxfqqt722f1d3_1rvq78s3ljdh4g5_1yl0uv0lh72b1c3_0uzr3n4a8anc1e3_0r1zm0sies7g5h4_1gg6n1h12voc3d5_0vn0bb4nbz5e5c4_2b2f64k8vpmf2f4_0kb3f17djzpa2a3_1joo7s2qhjgh2h3_179salldi58c1f4_013ku264jvvb1d2_1x15dqenmbrd1b3_18nv1jxvg29d4d5_19w5aegay3lg2g4_1gsmk0ywyvlf1e1_235tj1xiu52d4d5_0nrfesse7ave1g1_12pci1pfm2sc1e3_0pgavr75gltf2f4_1cx456ohsdhb1c3_1sevteh0t05g2g4_0nyt363bmw9f2f3_18t3hxog6nnc1e3_1s8ms0r97x6f1d3_10r7gs3sft4d4e5_195ztt0xvnke1g1_26kshsgth8ib1d2_0ct0mp1849kd2b3_1q1xdo50a4ya1c1_11c8sv5178ch2h4_0xbhjpwkmdne1g1_1qw7nwfmx1pg1f3_10zjreauji0c1e3_1omsc741n28f7b3_02rkvbbnrhfe5f6_296ix3rwtczf1c4_0i2xiz6bzfwc1b2_0mvoeyddvhzf4e5_191blfkdcfge3d4_26756c7qfjoe1g1_1j6ttcpus9nf2f4_0gr2fzpc27ue1g1_2g3okzsksdqc2c3_24jstw3h8qbc2c3_1y6amxhna6rd4d5_1cr9eetnek0d1a4_1j1wexkyfffh2h3_1dny43jcc34e3a7_17mwivhk7amf3e5_06g54depi6uc2c4_1r9yhvxjn89d1d6_043ol87c30cf3e3_1kpwin35rwre1g1_0khn2sqdqavd4c6_12tuz4t71fmd3e2_2ci8u3xr49qd4c5_0nsegtsv2vmf2f3_1hgekzcljj6h3g4_1qc8x428qs9h1g1_0xtwrcsovtmh2h3_1kya40dp87sc1g5_1na4pza33nnf1e1_1g9mf5pezqhg2g4_07p19mjosric1b1_003bmnoeztif3e5_014run8qxgqf1e1_2dwbf1szc5gh2h4_063subx2rtvc1d2_1gukte8e82wa3c2_1lrhh4xykkkg1f3_1llgdnmwdv4b1c3_10561e0ka4ad3e2_1bizbihd4bjb4a4_1oe345mygotc4e6_0wsbx16tth7h2h3_1iuqg8nz8o1f3e5_1btj5di31fof2f4_051qbvanmv1e1g1_1t1ix2zd0a4a2a3_07zy7n705d3c3b5_21039lpaqdrd4f5_1lkgg84m1j7f1e1_24e0fmjlvm0f2f3_0jh6cr1i8o3c3c4_03k8erqvcrbd1d3_0472kp8k7ced4c5_1zxmziv0ishc4f7_1ymbgth0243c3d4_13v94gl15avb1c3_1gmu97voxqnc2c4_0ieo10gln69d1d4_01gbhptpviah2h3_13yl8b6jb6eb4b5_20cxkjjyrqrd1h5_072zv17oavig2g3_15l26p2bxqse5c4_0vdguwnwxtbf2f4_0wuopzir9g7g2g4_1g3xuzvjasbc2e3_0yvccjtmmz8c4b3_054zuo2qrtne1g1_1yktec7xm8ad1f3_0vtgjshltrug5f6_01scmvragqud2d3_08egzjtxhv5e3d2_12mznizsb1ye2g4_1uh6we3q91rh5c5_1ejmjos45wyg5f6_1p6uhq9usreb1c3_0hpcqu3hb22b2c3_1s49w3dqm4vg7h8_0u9x0zm821oe2d3_0tylheldvk9f3e5_0myvuy6h8ogg5e6_0579a31boy1c3a4_1o1j2b1cqt9b1c3_1eb5lntz90lf2f4_1d09szi9i9mf1e1_0wustlfuwy6b1c3_1kx83swdk2lc1e3_205l0ztwcqlf1e1_189jb10ebqxd2e4_2cuy5dil0qdc1h6_0cp3tqeto0nb1c3_0zxiu761zjwb1c3_20us2afejhug1f3_0357yfw745xe1g1_135cjby3jeod2d4_01rltm00m8xf1d3_1qnkgegmmvvd4d5_23prckrwa6ac1f4_0s44lptef4vc2c3_1losysuonhee1e2_10qprody8uqb1c3_23mw4s2obt8c1d2_0p6l8jnjmrpc1b2_0eki8i3taamc1e3_0rcwderdvsme1g1_223dfo5t7h3b1c3_23ze5umq5gub1c3_041utaakjgee1c1_15u2l65p00yd4b3_22a72n4mz9rc2c4_24eiam275jbc1b1_0lw6xldbnhxa2a3_20m1bqpppznf1b5_1atd95dyisdb1c3_1n5ga03fkqmd4d5_0wdfgzibtrjb1d2_1v80h80j7woh2h3_1gzltzkxelpc4e2_1yn2mnamlfff1c4_0d05trcu5w4d1d8_2cpfdwgg44yd1f3_1rg7voorqdyg2g4_2c63dd353f0e4e5_1zg4elawlcpd1f3_26ekcme0lsec3d5_0d4enfvis7xh2h3_1laul7sw842e4e5_2g4zxx60luoc2c3_16hls57kaiah3h4_21nfpppjxmaf2f4_0326jo41d6oc1e3_118w78hcsv2b1c3_08owznzv4ahc4b3_18zpon7yj4zb1d2_1p2cv42gqsme1g1_1d54415l9l8d4e5_1k0kgma6hmxa1c1_0ny80pin91tf2f4_0zssk0gih5bf1e2_022v6kesk0id3d4_1p3en0kl743f3e5_1a1pwmdiq0dg1e2_0vp3i1d5q3ff3b3_2865ctp7lvkb3b4_1btyxd5axhnd2d4_0032da2awjug4g5_0b5ku4u7hqtb2b4_1tceabuul0uf1d3_03s5hgn2psvf3h4_0wb5pcbtnmic3b5_2cuf7f20zw7a2a4_1sx8busclgyd4f4_2e2twqz3r9xf4e5_23wp24ravz2c1e3_1sbia1fj1wbc4e2_15qp5jaqro5d4c5_217aumd9f76b1d2_13lnzj3hrftg2g3_218sxq9raspb1d2_13c4w5xe89ic1e3_2bvkudjerdsf3g3_071cdjpb869f1b5_0k1x7epud5od2d3_0myd8r69jnfc4b5_0y9alyxfot7b1c3_16i9m33mk51d4c4_0jsjftxiuvqc1g5_0jaj7jc96enc4c5_1s1moea7hfcc3c4_1ru9aprl4cie5f7_1vc6qjbfp0fd1d4_1g5mjlscaebc1e3_2dvh27zjjmfd5d3_1chqvth5mwcf1e1_0u3iz2xsfihb1c3_10bpsxflom6c3d5_0vj2o9zkqafh2h4_2bzncma1r5zg2g4_1ekbl475samf1e2_225xekyp0swc1g5_1xvefbnr9v2d1f3_1agx1ly839qd3d4_030btr9b2mzd4d2_0t83qqcpp8se1g1_0d2jhjwzvbuc4f7_1pify69lyqrb5d7_1hk2s5jret9b1c3_0dkyfu3s7bab2b3_2a4p6x0licoe4d5_2bk7ccd7agld4e6_11pz0tt015ef1e1_1erpj5u5ijtg2g4_0n6l78dmk3fb1c3_0d1hqhjhuo2f3e5_2dctech8kjuf1c4_291xhf7mc8ya4a5_031tqsahdbsc1e3_0nf82nde4byc1d2_249zcd1wxazf1d3_1ky8hct8ydcc2c4_29u1zeeiizoe1g1_1e1d2kdpil6c3a4_0ipuuen0y7hc2c4_0r8qjd2oi4ud2d4_1dwatbgpidnd1g4_2fu5sj7oqgpa3c4_1bbehggmg8pc3d4_162kqm0k6s4e1c1_0ppvobeg0t2e4d5_04wabbdqhc8c1e3_0bjnlgt9ljlf1d3_09ixqc5pgfqc1b2_16qeucxxyh9g2g3_185apuaic6lf1e1_24287oymu47b1c3_0slxxty0lwgd4e5_1bmkhjmch9pc4d3_0ekw8emzuxzc3d5_03nizayhz2lb2b4_0p3863aykw8h2h3_0qavngdpwlsc3d4_14m0o3jeef1f1d3_0nugoc09m6ud1b3_2geiws9eifhd2d4_0uwxdctjywff1e1_08uxhep3bo9d4c6_0j245cpdcckd1e2_02md2j24shzg2g4_13km9ar73mlc1g5_24ga5hltiyqb1d2_1paml3fjrs9e3d4_2as20t8k3yqe1g1_17f0s5dnbf5b2b4_2237p9oktnfd1h5_09phnsf57u9g1f3_0qb666mrvvrh2h3_0iudtqiorvdb4b5_2560r8i6ol6d3e4_07psm7mjkxzb1c3_040vkaq3h34b1c3_1ya652aygjie5f3_0og3a519emzd5c7_1vzg4zeznfqd3d4_2dimpdyd4g4f1d3_16l4dtdgnizc4b3_00ru98h64ode1g1_0r21zhu0yfid1f3_0ar336c32jge3d4_2emlwfsukn2d1b3_2398pv9qcrug1f3_0i35tm32qoqd4d5_2al58bvfesrc1e3_1na3pvq369uh2h3_1wovk1tpjctd2b3_0oy0oed7a1if1e2_0adc7ubmhezb2b4_1ire4hr9nk6d3d4_0mcdynkxgznd3d4_0q5ym15n2crc2c3_05p5d2xqqwdc3d4_284wrq246flc3d5_0qz3jgewth3d5c6_2awj9kk15anb1c3_02mzm0otp0jf3e5_1z4sy2lmav2f2f4_1eodzrtsqz6b1c3_0dlhx4y6k4aa1b1_2142pn9oevgf1e2_1j6qx9q29age1g1_04vhbi8lv5vf3e5_158gjpbus6we4e5_02efrgcwx8af3h4_1h18w3ecwxpf1b5_1acqu0bow6ec3d4_0i1gpepqge8g2g4_1sn9wari5djd3e4_1sn5pv8hizoc1d2_1neg0erm8p8f2f4_0fyqs6qwehlb3b7_11hl42obrxzc4e3_0ai4oo9mq25f2f3_0yztqbo114pd1d2_0wnskcrrnh2f2f3_043kvpg1lkvb1c3_1j4gej72zqwd1d3_1q2m9ixjtkyb1c3_1c5d02672f0b1c3_0zzbxp7a4vmh2h4_04n2mgzaasef3f5_001t9w5wsuib1c3_1gx6celzfync1f4_12fob5jgxrdf1d3_0caj5asj5w1d1d8_29xrrrml5jnb1c3_1qpg1u6tfdwd1b3_219av50b7jmb1c3_03pmklgxnhmc3e4_296w97wq1z3e1g1_1x6dug7m6yph2h3_1e4rpkdlezed2d4_1p7xoatqoheb1d2_1wz9w5cdgipa1c1_1xmd5h4pifyf1b5_19zbykur8x1d1f3_16qa6uoixzdb1c3_0hzw2jdh8wvf1d3_0kbgth3w9a7c1e3_1utysv24j9nb1c3_0ocjyy8galid4c5_1988d44wchod1c2_0tg3to7k41qd2d4_1l7x051hp8oc1g5_0l04ni3hcbfd2e4_1soddip8v1aa1b1_0zeb5wfrzksf1d3_0jjyi8hnekfc1f4_1evrotgacmoa2a3_0fadvv3hkfxc1f4_21140xga6t9h2h3_1816lbjp19wd4e5_0winuv9vwznf1d3_08o5h243g1pb2b4_108jdljmmqwb1c3_1xfon4y1fh9d4c6_249bwbkm69gc1g5_19yj4nhqofgb1d2_1x6kh9xztgcd1b3_1mhoqgjrrchd2d4_0k5slzxmcp1h4h5_0jacj76x4glg1f3_1js6jlc490fa3b4_0tx3u5fq7zud2d4_27w8j63pc3ke4e5_1iol7elxpb6b5d6_1vk83emetp9c3d5_1vp6164pzkkg2g3_1pxzsi6cq9vf1d3_18hl1clbs30d1g4_0dh4aqvijodd1d6_0r6qgoqej5ac2c4_0rc59e9b2pob5d6_05qs57j6gend2d4_0vvb40ans63f1d3_23wb7cwlun3d1e2_0l6ktf16if3f1b5_0sznmqc7xuyb1c3_0lyn18d1wqqe1c1_2bmor9bwfx4d4c6_09d9lvfexr4f1d3_1unvtujf7tzd1d4_0732xecfyk3c4b5_0xd3v2dr9r9f1d3_14ncjq28tedc3d4_19662sbsqcse1g1_104c1p787gmd4e5_17olgiliwawc1e3_0nnpyr4zankb4b5_0ihhud2zf4pc1e3_2czo808iborf1d3_0rry7g0jxexd4c6_1in663s0tmpc2c4_0fesepg86pcc1g5_18m6j3h43rfd1e2_2d27sw0o1jxf3d4_0p9wqkd13wmd2d4_10yr3tm8n1rb1d2_1h57nldzb07f1e1_23r2e0tsxppc1e3_1hwpmsgffs5e1g1_0om2iwkjga2h5g6_1jusmmmafhsc1g5_1amfnmdz72og1f3_1hpboygzq91d2d4_1x2ceurfayyd1a4_2ghpvpax3gsb5c6_02wun0o485ne1g1_1wga0vyayruc1e3_1hxu9kqqri0c4e6_1iilyemwqbcc2c4_1xwjt9l8c5qd2d4_1c74fq8i16be1g1_0mmgukn2fwyb1c3_092pwo5kmheg3h4_0zessqi1vprg2g3_08jogh5x2gzf2f3_0oxf1smc2xje4d5_0kmpv5gro4qg1f3_0c9bvmihqerb1d2_04ociph13peg1f3_290xy0wnnsjc2c3_2bui2m85ipdf3h5_1iri4935le2e1g1_25045i9um3ee3d4_1prcx56wppvd4f5_1kkffxgg5zof1b5_0lgobu28uwre5e6_08bdmr6p4acf3e5_27vwrmy2i3de7e5_0w0hmh5pzq4b8c6_2a9k9e5qe3td7d5_22uqwrdalflf8c5_0prps0x5xe3e7e6_29imrkv12cua7a6_0hd514zt4dxg8f6_1cuhfh6d40he5d4_1vzqj96crgtg8f6_1nmx4btaaheg8f6_1ihu39v9slbe5f4_1fs4v8izh0fg8f6_1585qucknilg8f6_1lmx2x37kswg7g5_1br8z9x7m6tf8e7_277g0rlvu8xg8f6_1xfowz70l0vf8c5_01a59uzhqu8e7e5_0g2affx0mtig8f6_0dyimcw2sl7d7d5_2bff9ljh7t3e5d4_053ktr7s966b8c6_0e474fm6vwub7b5_093nr2yfzm9e8g8_0d31vzjjmmae7e6_26z169c6p2tg5g4_14om9ca3jsud7c6_1fmv8cvr25ig8f6_0g12bgm4axje5d4_102kw4oqzlig8f6_10lmotiqfd9g8f6_1a3vcez8od6f8c5_0isprppe2hef8e7_200vmqz51svd7d5_2b7d4bfs334f8e7_075kq392dc4g8f6_21q8yciy41zg8f6_1i39q28fdsbg8f6_1sfdm3bg98wd8f6_03g3yan5gudf6d5_1smalezskt6c5b4_1aa6j8yug6mb7c6_110pw6qyxz7d7d6_0xr61zclwhqg8f6_0ow24pupxhbb7b5_27t68e0zv6hf8c5_0e5ai1oh8heg8e7_1s2q76rj3h9d4c3_1asxs9p2mqff8d6_0u6228m17qrc6e5_09mvot4m2rlc7c6_2dhjf9fcnwig8f6_0ccbwjyderrg4f3_0lhq5ybu1zme6d5_12w3yep5fc9d7d5_24mt9b1ct5qg8f6_0atrka3kfhed8f6_0voutaivnurc3b2_1wxnoyo2u6yf8b4_1zf4zfhenj3e7e6_0heicx8dxnbf8c5_21k1b3avaazf6e4_07e8wml6nv9e8g8_0wlecdgoav3f8d6_0e5ugmu107jd7d6_1k54l8syi06e7e6_21dxhh3xkh5g5g4_29z9jq37ktif6e4_15nfmcgn279e7d6_0i0xlb6vb3he7e6_2fibyt2kzuud7d5_0cjr2wadx8id8h4_1uoou0v0pdbb8c6_1wt59lrbyaqf6e4_0jsj7uvq3ndb4c3_0cxris5cdsud7d5_2569n75g4tvf6e4_0exgb7iyxhvd8h4_1deiljbeu8kd7d6_07qdxdvyrlqg8f6_1ij9lpfacjjh7h6_0etnfnhpkabe8g8_2f1syn28nz8e6d5_0rmr2gtp1t6f6d5_1k48xyfxad3f8e7_21pc6ggr4zfh4h3_23cqip3asm4b8c6_0pwihdnk7tog8f6_1zjheehgkz2e7e6_14jpqwzfw39d5c3_2d8now71yiif8c5_1jarmg7jkchb8c6_0nf3k9jf5fdd7d5_164tn8yfjkeb4d2_22s9geobjpke5d4_1iz3ajxeytmb8c6_0xhxgswv1i9g8f6_14sbub9ykzbd8d5_19htrzj0gmee5d4_131v2q3juo7d7d5_0v3kdgunq5vf8b4_1iq2p627u0oc5d4_0hxs5lirspge5d4_0dq5dxz46mog8f6_2gmqftx2ue2f6e4_242uzy6rd51b7b6_1be8mmta0qid5d4_1z6xtyw3xarf8c5_1s92g8i9tqbe7e6_0hqw5pu4xtrd7d6_0gte187j2qgb8c6_0jxk60s3xejf6e4_0f5up163zprd7d6_26l5ll50bu3e8g8_01n9jq1t81cc6d4_1vc2gdw7wspf6d5_0b6ydudtc39f8e7_0hcceiuasltg8f6_0qgdevkaacgd7d6_00ob97jja68c7c6_0dvbzglx7wje8g8_0s4y47uhlcdc7c5_0qmqmjysvdug8f6_1l9p34efoqnd7d6_1bl2134na26g5g4_0ezbh3juu54e8g8_0n0s2lp9ej3d7d5_1s21q9te1cqd7d6_21uvc6a1171e5d4_0h3566wcptwe8g8_0rubwiu0ph3f8e7_0io1e8a3l2pc8f5_0hkdsh4pwcmc8d7_12tn107cuved7d6_24r0dpk968qe7e6_12is4004nkpb7c6_06ntgp1b7prd7d6_1yc10a16y9bc5b6_1rbfyxskds8d7d5_0v396x9dbrxb7b6_1t5rkb6lghsf6e4_0lowur92ckeb8c6_1wz4sj390zde5f4_23jv7zgj784c7c5_0ptaq2z99vaf7f6_0nvvw0y0u8nf8e7_18l2eeu0ht1c7c5_26tsz3qirhle8g8_1kt70ykugsgd4c3_1rxi86ptv2ie8g8_28k5hvrp5kle8g8_1fvc38252bce7e6_0x4dtp4vnwxg8f6_0q5n8tbnsewd7d5_1rk8meroe73d7d5_11qk4dhmy9ie8g8_0gl459631cyb7c6_29rtys4my00c5b4_2f95fm550trc7c6_1htx13a1q70h7h6_2gi668osmo8b7b5_17lxkdedq2vg8f6_0p75w4r8knfg8f6_256b0c28tu2g7g5_25ksgjijgmnb5b4_0kp38uuj4d9d5c4_0czs1lrb7izf6e4_1xxm58na0jdg8f6_1mrlzev2pgod8f6_2fnwyt92fubd8d5_13azrvevj58d8h4_0ngqdjzpef7d5h5_03djewm4w40h7h6_0498ayrt4ifd8h4_1x5dpcj585ub8c6_0d95zh45qfid7d5_1r97yojf5cbf8c5_099tfby55xgd7d6_1j3mxwvggszd8d4_183h3n81tmuc3f6_26freksnhkyd7d6_159r746xkvae8g8_29fxeb9ap68e8g8_1r5n79z0ck8d5c4_08fc5jp0096f8h6_0m96zwcnfsqc8b7_0an6x5l8xftc8e6_124q40xyuaoh7h6_25lwoekz4azf8d6_1gjpytfx7toe8f7_1dzh2sbk48ld7d5_0itc6f5k8ugh7h6_0o9lwa7nmane8g8_247kxuxiw1ef7e8_0o4i9npdhdsb7b5_2111cni4tofe8g8_0e8y82t5dxzh7h6_10dyu56p51pd7d6_2c5ljyxauu9h7h6_17rmwfedq8ce7e6_0wsjpun8ypsd7d5_14jqauwu6m0d7d6_1wra5qa3w0dc6e7_1rx19pxzause8f7_0o4t91ns2h6d7d6_0ci9a7filjmg8f6_0l6qfa3zchle5d4_1zmpfgc1otff6e4_0vd13byz3z2e8g8_1ftfme1bbkcd8h4_0gyrr5gokk3e8g8_18m9tbmey0me8f7_1nkvi15sysod7d5_0q5hcx65711d7d6_0lfhom16h1of6e5_1rn2c12qwlic8g4_1vr8dflghgxf6e4_0xyn12s3umrh7h6_152al4lmh9kf8d6_0rfgklkggywe7e6_282ms50ggmjf8e7_1okvkcbyk6kf7f6_1n3rqmlt471f8b4_284n3oypeotc7c6_0o2o4jefzzwb8c6_0chaospap9sc7c5_14b4srlf1ecd8d4_103wy1pihb7c8d7_1y62x05lsx4f7f6_1btnd6n14tse4d2_1ywwhp4z8peh4h6_1edyubw1t78c6d5_0lnwxzmasohf6g5_0z1g3aqthwie8g8_1fjcvnkk5mab7b5_0581r65wu6xf8c5_0u163kh59vog7g5_0s29m7aiuh3h7h6_28gqqbtaw24f8c5_08rhuwi9ravb8d7_0dpag6iwgsoe8g8_1hs2mq7k5o3e4c5_1l5jgl2euy7g8f6_14cic4p9zd5d8c7_1dl64rqhstkd7d6_0a084q192gbd5e4_0zqqkte3wayg8f6_0imq4ocaczwg8f6_25nz6rctzc6d7d6_0zvvvjk9qy3c3b2_003519o6pxkd5c4_1jnggz6fme8d7d6_03ienpydmmad7d6_2g26fjh2s2vc8g4_28q6htc73hpf8e7_1ygc9aqahqkf8b4_1oc2mht03s4f8b4_1oqp0ju2nrgh3h5_1qdjz1lh50wf6d5_1hkvsi68ok2e8g8_1dobtxgbh3ye5d4_234a2ivd4b8a7a6_1k08bql40y0f8c5_2b6w6yvfrn5f8b4_17ugd4vrckld4e4_0k9jkeitc1uc7c6_00815oern7rc7c5_2041gjdzjt7e8g8_2c7jou9co7jd7d6_09zwh9srhv6g8f6_216z7zji7cch7h6_1qhpwgm9bgfe8g8_067tgsuquc6e4f6_2aij7uj3oite8g8_29ycncgs8rld7d5_1sn9bgwz5hzd7d5_1bxui01o9usd7d5_18mew750g7dg7g5_1lt6ivu7x9lc8f5_2ga4wa5mt86e8g8_0ef1ub9x210d7d6_0e2rkqjp8tsd8e7_10v6n1vyhyxc8f5_1v1ygb79osff8c5_0fbc1z9ia5qe4e2_1thgcfv7e8fc8d7_27l5nv9d7zic5c4_0lfle6tcgnpd7d5_1ndko3mu6bdc8e6_13a4a52rzj2d6e5_2f4ll0k44hrd8d5_0ivrd9v3nvsf8d6_28i3f1mlcqbb7b5_1s5ljyefgfzg8f6_0h309wzie72e8f7_0m5b4c1h88mf6d5_25pkkbcjfdrg8f6_1qaq3glbcvpd7d5_1mjh86tjkgxd7d5_206vn9ofw63h7h6_1y8zzi9lmh5b8c6_1k97lr9ulv8c8e6_2afy0c4iyusc7c6_0mpzcze882oc8g4_0er3ft1wdvdf8e8_0fwhwluysstf8d6_10y7yizice5f8b4_0fkeh5978ivg8f6_2ayft4g2etca8a7_1k2rf30ve89e8f7_11n2u6gifrcc6d5_0pzt4txs09yf8d6_1jwasllgdxke5f5_0uciactcszod8e7_1ax5kf6fugte7c6_19eoq9jcsl6f8e7_0jn91gdx5sqc6a5_1gkfnk77ll2c6a5_22oep3q56pjd6c5_0b0ccvg212gg8f6_12dhv1d49tld7d5_206zol2vq4md8e7_293p1qlto18c6d4_06ta92ibol7d7c6_28zpe9pmgfpd7d6_13ahw5wm8rif4f3_1qf7h7zsr99g8f6_292f9695xl7g8h7_1niulsn6ur2f8b4_0n4ncg83hi3h7h6_0k5d4pv5gxqe4g5_1jx8dr36iwaf8d6_1mw736u4wbjf6c6_0mzds3n1a9ac6d4_1dwd6ppexa0d5c3_0bs7zcbzmj9d7c6_0cld27ut8kha7a5_23f5gnbap50f6d5_02esieafw43e8g8_2bvn94b1x66d5c4_001vn8hcv0dd8d3_27sw23754wne8g8_0psjvbb3yzyd7d5_0vz8aca1da7a7a6_24uxrqzpslah7h6_14rhkmadjqnc7c6_193maccxlpfb4c3_1ttkcslrfxyd7d6_2bg1e3gtuwnf6e4_20h9kdbgzxda7a6_25lmoo6j3uqd8b6_1ql747m3idvh7g8_28lsxc1qk6pd7d5_005xvbs1iahh7h6_2ds0fpv88tuf7f6_1t3zscju1c4c5d3_02c8r21u4fzc8b7_0xwns3nevt3b7b5_05lp6mj3cywh8g8_056h7t208hzf8c5_1yuaisnnuhxc6c5_0hjel4y59bjb8c6_1j7mhcz1u18c8g4_1mzx53dzts3e8f7_1asqptbclt2d7d5_1045n9h0z22d7d5_1swl0n4650tb8d7_0rpr90g8tz1e8g8_0sya914k5dae8g8_13k951l5ownh8e8_228z4nvw1pmc6e7_0629r12k748d7d6_1klee98pnvac7c6_1jwc54i2jdaf8c5_1vsumemohiie8g8_0qdqpo0erv1g8f6_0co702lc5u6f8d6_02uee1hzanfc7c5_043nmkb9if7c6d5_0e06nlobcjzg8f6_1wzt8d7bjxeb8a6_1aupxtb1y88d5e4_08v2nhpi0wzd7d6_2e0o254ap2jd7d6_17w0l5voh6pe8c8_0nkh6gbbwi2e8c8_0a2g8ahtd1te8g8_1m7k09r5dije7e6_0sdehucywtuc7d6_11sk9ey76buc5e3_07tbk3eu7jdc7c5_140886mtzdtd7c6_1cq9mvo49axf6h4_2g21n8kmtbjd8d6_1lt4585kk6tf8b4_0o80jpft1e6f8e7_1rrtrfi5h4ke8g8_1ynih4mzxnlf8e8_1c7gj7oud9ed5e4_18kykhzd0eea7a6_1n2l0vxoo58c7c5_1ai09qrgl80c8b7_0afp66yrqpse7e6_298t099snvwb8c6_1qyzg53smnmb8d7_0nbyk3c6qafd7d6_0pfvtkgokrtc5b6_250fviguucsf6d5_2fbr9l8j4rkg8f6_1xo9scosrxke8g8_0uiugiit1ikd8g5_0y62rl669txe5e4_03y7zaqp92ee8g8_1aeilrj012ke8e7_1i0qsg6j20gf7g8_0h1sr2i4lf7e4c5_0s0r38r142ph7h6_0xddcz055n1d7d5_0uil4wl2tzwe8g8_0z052zvn5yhe8g8_27rb4zmli7pe8g8_0zf8ne6y1ekb8c6_1nv2mde8ueif6d5_1a1m9y9elj2c6e7_0w9pe0jw3skf6e5_16554rsxj4hh7h6_2flzvz75pksb8c6_1ia98nv3pd0e8g8_1r77wqeyyj7h7h6_046aj23swpug8f6_0xermb4z4oth7h6_0kl65gfk6aig5g4_133zqpepgecf4g3_0j4b6jn8lf3e8g8_1wnn08s9r2zd7d5_1gqf23b146tg7g5_029b8x740y9c7c5_0ir3swu4cq0d5c4_0sim7npvwurd8c7_1pjz58oar3gd8d5_0u4gufe2ubxh7h6_0qj8itd2sfgc5e3_0mmvsv54j7id8e7_2387dpa9tshh4e4_0jk9fwxqvsdc7c5_0cllgssae6af6b2_27y0z6d8z61d8d3_09ltxcr3z0de5d4_1b2qcnbgl3rg5g4_10n4q1tr512c8e6_2gjmued2qdgc7c5_225qy3f6tlde8g8_18lesy2nak5c8f5_1bwir5i1hdvg5e4_28k078jmb9ad7d5_1271ayh607hd7d5_0b1j9quwf89d5d4_0kimmm5mpd8g8f6_1tuo0e7lskbf8e8_132snnmisvjh7h6_29zbeiysfvwc7c6_1okur4bnjh0e7d6_1mxkaavdc0wg8f6_28duae7fsyqh7h6_0j9g4zud2ecc8g4_0r6sb03ta25f8b4_02xiie8689ie7f6_0a8pdlf5e5od8e7_22dw3nmf4gof8b4_260yrxa6vivh7h6_17w2kptxt0le8g8_1uu4nf2vr95g8e7_0umw8sv1q7sd5d6_1ptfmiy6a9uf7f6_2ehjau4ypqee7d6_2avq2zke3g7c7c5_06wlcg3y5lpc7c5_27wqug6njr0f8d6_1etcotv3guah5d5_0nxem1mjl8fd8d5_2a01fc9xfgse7f6_29sg4h8xtljd5c4_0vxqdmsilo6d5c4_0p3rg2nosqmf8c5_16hq5h9t4awc8b7_1jh6fd8i2lee8d8_0zbesds7xkbf6d5_1s2dju4rl66e8g8_2dz7px8iyh3g8f6_0bd4pnwv3wyd7d5_14mbue7w3q2d7c6_1kbta2v9ougd7d5_1u6qs5a4zebd8f6_1zlvqzuqz96b8c6_1qj6opxcz32d8h4_0n5s5hhkp0vb8c6_0tgmnk2v8aod5e4_2a5hl7z8gbof8d6_0c60qebkqree8g8_0etx11ow82be4f6_1oyv7nng4b7g8f6_18k1jevos5eh4h3_01ju7hffhkuh7h6_0qhyys04gxhe8g8_1alacrz8v9lc8e6_1cmwjfuizwjd8e7_1dqmktwt5yhf4g3_0ahjsrnmh79d6g3_1eliqffynikd8b6_0zeqysness8d8f6_1w3fnhjtximg8f6_1x8ban98ox4b8c6_1j692il1fd0e4f3_07tpvuo66mvg4f3_0cdy0o3lv6ce8d8_10751as24ndg8e7_1xwwpo00id2c8f5_0n2gj7uhud3g7g5_1ic1omb54wvh6h5_0sesjrsnfnyd5e4_1n0nmiuwfo6g7g5_1bmwgnejx2tg8e7_0vyyrdjtk3me8c8_0t0bj1c9dd5c7c6_1e7yij8razee6d5_01eibtx0htth7h6_1i2hsztvflmf8e7_0bhdz93jxkwf7e6_15ieb76x4agd7d5_16hl1qtwb8vd7d6_0vhfveogfzag8f6_1mplxeg1ww2c5b6_1b0ujdieb60d7d5_0xffzhgpz4ae8g8_0jekylz52ofa7a6_0s01uzpda65d7d6_1o2hbcwf05rd7d6_16zhpaq0haxg4h5_22amj4pzpxvc6a5_17e4l0bg6w5f6e4_1d9yr0otghrh4g4_29a0ff6szlad7d6_1dw7egpixgxd7d5_174ps7ikxvjg4f3_0fc8pnfllyed7d6_04nw5p1o6c7b8c6_0wsga34bx2kh7h6_0orfejxuhpzf8e7_0ujzlu7vat6d7d6_1qiw4fw5jc9d7d5_0yosf19ob65e5d4_174b4qmpsqqd7d5_0cpkzwccue0a7a5_29te1jc9xbjg8f6_0gavma852aae5e4_1ktazlxjdeoe5e4_1iu8xrnmclgh8g8_05707s5lttxf8e7_2g4eec6e62nd7d6_0xy8daievf7c8d7_26bm4gtm0i9f8d6_23aau5btaknd8e7_0jl28jy7paza7a5_02spd5rwtjsd7d6_0x448krqik5d5e4_0waceckd72ag8f6_02z1off50v3d5e4_0t68t8zjijrd4e6_2engb1p762bc8d7_0lfqdr68obyf6g7_1uakyiodjpga7a6_1060rhv8cnnb8c6_2f41fqrkhu1d8d1_0h4izst0wxxh7h5_09u31c5zf2bc7c6_16gfsrst47qf7e8_0fo392ryztze8g8_25fyffuwyz8d8d5_0emny3ll5wld7d6_1n2k6rnkss5e8c8_1erayut0f6db7b5_05olsj7xs6jb8c6_0mv8okrcx4hg4f3_0uplgrsu6ydc8g4_19e07ym822zb7b5_073b8l2w3tqh8g8_0alru21jhpfc7c6_0zynfx7ugphf6d5_0n7b5tjoie5e8f7_1lk93alyk32e7e5_1cwy97y4pk3d7d5_1nlvu83ee6sd7d5_0blp2j9x6z5d7d5_0wf66qekv1yc7c6_2e98thipmjog4g3_0m7q13ur91ff6g4_1o5ttjenlxbb4d6_0i7m4zkuldwd7d6_0h0oqj9zm1vb8d7_1eqowmh2nnaf4f3_0numgdgp2ltb8d7_0rkjr3860aih7h6_0kz881eba3bg8f6_2c96gbdjcr7c8g4_07ht1u07fp9g7g5_1i1e0kbeebld5b6_0l6e6pga7ged8h4_0sy61hln0j1e8c8_07dx8qbu11zd6e5_15vcsfhld4wg8f6_1jrzkruz27je8g8_0kiv7b6537de5e4_0ak7ajbe4pif8g7_1lbgx7uywkff6e4_0xz8hwuazrbd5d6_0ryuafp30lwd6e5_1flr475lg1wc6d5_1htxgv20ur9b8c6_0ywf6bf3h36h8g8_164j30ju8dvf6g4_1vbfy9zilvag8f6_0uxma35km45c7c6_1hboby6gzyrh7h6_1skn7jk16y2h7h6_2a7qr1pxwfne8g8_0u0vj5iafhxe8g8_2duckyi7eyie8g8_02w35nbura5b8c6_1lj74pdutubd8g5_1jna0c0wry5e8g8_17xyjfth0sxf6h5_1bbds4ysj4gd4e2_08zohu6dz0dc7c6_0ti9zoiyh04c6c5_0rsptf9ntitc7c5_0e4kufedn77c8f5_1kz46csoolsg8f6_070idgr2jyfc5d6_201n19qvhc5h3f5_1i1ipyclal8c7c5_0io3rksg7wce8g8_19pco9yqm1jd7d5_1e8t4iax0tac5e3_0yccx06hqh1g3g2_0biy7skr4bkf6e4_1ppl8daqeajc6a5_0lp2hfixycrf8e7_0ob3yl1dqowd8h4_1wrb6xhs4die8g8_11ycvohd3fse4c3_17hhct69s73c8e6_284wo35b6zmb7c6_1aejqpelcz1c6e5_1ybch9qf7gfd5e4_154sz0in561d8d3_25wgfl2iuije5d4_0t0ojbwxjr0g7g5_1kq0fi2liigb8c6_0x0fn87zvrrb8c6_1orgugy14c9f8b4_1o519rsw7qoe5d4_0659swzdpivf8e8_21zojid0w4we8g8_0gm89vfv09he8g8_1qi5h6nsgauf8e8_0oo3vcnhu68c6e5_0qwn129rzmsd8d6_29gk7f6bz3ee4g5_1cgl91ixd0ig8e7_1v2wc2et7nif8d8_1k25urprunja5b3_0p5f5av8at4d7d5_0s8o0ut151pb8c6_1nzzvfu2male7d5_2fphsmtw71sf8d6_06hdh7t14cxg8e7_1g8iyshzoing2h1q0a2i1tdt8ajc5d4_1h2gkjmf9bcd7d6_0sw4msgsnw7e7e5_1iqfh6wwjlka7a6_29srx9plmlhd5c4_1u2go65uwtba7a6_0x608u6kteob8c6_17ngzrbu4v0e8g8_2ed1tte70t4f5d3_27oekx975nde8g8_0z4ald123idf8c5_27poub59j6ze7e6_01ya87k3hjcd8h4_0n9ct1hkz2zf6e4_0aj06semqx2h4h3_1myn8grr2q8d7d5_04j689un9e3f6e4_1s272cj1l3oe8g8_0j98ot9sqs5g7g5_28uezh7flg1b8c6_0teaq1zm3dbc6e5_0qrzlsb606kf8h6_2b3w3pxsctbd7c6_0rfbp2fatz3c7c5_0dm3rmq5600c8g4_1mbpovp4gf9h7h6_1lr11reyluof8e8_0w0u66kynfah3h5_0ccw3lche0rc5b6_13omf4rxjzqc5d4_1oau9fkjh2bc7c5_25q80oftd53d8c7_1fai7sp7d83e4c5_0fm536lgetfc6d4_1kmeg9e4dm2c7c5_0l9ex74io2nd4d3_0qdc9mz49gph7h6_0gltekieujzg5g4_17jdb1pg67ed7d6_1ww9xhj62pwe8g8_18mlte3g0ite6g4_0ntif277nloc7c5_0qv4r3sq8def8e7_1kawg43dpoja7e7_2bb2ibynek9e8c8_2bapuuec09fd7d6_2ge2tm0rbo7e6d5_0c6w6fi0tbwh7h6_0975atcne2bh7h6_09gfx77m0odd3g6_0hjdpn4200oe8c8_0am2z2uy6ixd5c3_1420br1upime8g8_1kykoy9dopme8d8_0dkwtp4y1oyd8h4_1gcjr4yxsolb7c6_2762ifqatm4f6d5_20hxfisz2xte5d4_299gfj3mn25g8f6_18ghwsmwlj8f6g6_189g4gxsct0b4c3_23yp3gb1x6sf5d3_29lvozfsxh3b8c6_20sf8nxlzw6b8d7_18bnoqng57uf8d6_0glmrkxxgg2e8g8_15bogqxeb37e4d2_24xrz186vm2c6c5_2e2r1ffw21zf8d6_09b4r0bvg3ac8b7_1xcztfkydpxh7h6_1by9g0uw6h3e8g8_0yjo2p7xbodc6e5_0iptfdm61awd8d1_16roxch1ayhe5d4_127o31xu5iwf6d5_27bdvbeo8grc5f2_1z4dvrgtnrte8g8_1g6w5dgoxy5d7d5_169b1kpfi38e5d4_0aql7a2ce62c6d4_07muh9jdgg6g4f2_16ggy2p04asf8b4_03u16w8hji0f8d6_0j7ktrialnxe4c5_0h109riwcgue7d5_165xsei9krrd7d5_16s380ddz3df8e7_1hn3i5r99jre8g8_1oeqd4ii450b8c6_0yh80nm5sebg7g6_1r7h5a8keseb4a5_16z9l7h4lbwd7d5_0ux0x73dr7qf8b4_0qwkb1vxd3ye7e6_1ft4cyn3vc1b8c6_10837jojynwa8e8_0zixt905uirf8e7_2a9omcur9o8c7c6_1wvdv373ft0c5f2_03faa04sktjg8e7_221u3hamz8lb7c6_1d4mim9ker4d8e7_174oxgq6j99c8d7_1ve9ula2xvxf4f3_1icv9wf1otng8f6_0cacldo32ivf8g7_0w6x9e3ha4ag8e7_0eo0skksi2dd8d5_0c0ew9qkeavd7d6_1pucq4ltohof5g6_0tdqaw4cjimc7c5_10n032m11l9f6e4_24msbzz1iu3c8f5_1d9as5qbz2vb8c6_16rxt043nc1e8c8_0ki8pmcfocgg5e4_1gncbuzixq1c5c4_0di0rfkbffke7c5_04kf7d9c9dqh7h6_24uwaxly1krc7c6_1s7ebc7m1pvf5e6_0w5dcsja9ouf8c5_1tdy13qh3krf8e7_0jl3uqph3adg8f6_23ax9jxricle8g8_0swtx0qauk8h7h6_1z48zk8vnjod7d5_1utn9z5mgl0h4c4_0ta88fh7jsgh6g5_1px88gwb4euh8g8_27i4s4dbvtvh7h6_1y09lxcw8sva5a4_06dil1qrf93e8g8_0t17iztjwryd5d4_0bi1nmlpgdhd6d5_1duepae890id8e7_2e4c3wfq68bb7a6_29y4ohaxpkcf8h6_0cplt1bubctd6g3_10jman3g9i9d7d5_2bakubjuiy3h7h6_0yk6jw4ngo1d8d4_0v9ii7ao283c8g4_0p8fd1khot9a7a5_20nxs9g0b3pc8f5_15g1b8iptujd8d4_0rtqsg0ocewb7b6_0057nrjegxoc6d4_1lwjq8k55kzc8f5_02cdtqwuzn5b8c6_18b7ii8fga5f6e7_04girqi590sf6e5_0zmdp5uux6bb8c6_0hotmg8fklbc8f5_12dlc7047mdb7c6_01w0gtkn9kec5b6_11dds6wyxlfe8g8_0nnw10x3cn5b8d7_1fgzt47wg65c7c6_0261f80dvyqc8f5_0c3rhrihdtjd7d5_0yux2ce1t26f8d6_10fv6nn35q3d5c4_0yms8f2ytxne8g8_11qc2dday54c5e3_1o7hoara7ncf8d6_2b6rehx9yc8c6a5_29b55hkmpird7d6_057b1y5kz6cd7d6_27j80hl1dodh7h6_0c3q3urpk7zd7d6_1ax8h0pxeaha7a6_0ic1kecy05nf8d6_1wfibb9mdjue7d5_1beohcz3kj3e8g8_2ehb0yblyg0d7d5_1wwsfw4ffshd8d3_26ad2ebbztbf8h6_14xf808frilb8c6_0gd5i5seebtf8h6_1hd20zdq2iwd7d5_22bckd7mxhfh4h3_0n05169wrxjc8b7_11jw8kfkzcye4d2_00pxnlx3zztc5b6_158frrhtxnoc8g4_1jgw2sce1bkb6e3_0x1l907fpowb8c6_13fr8vik0bgc8e6_1cg2y15i8m6g8e7_1wpl8kurwupb7b5_2ahngrsjmzjg7g5_113tjqcsg44g7g5_0xc002vqzcsc5b6_1oesyiicdlyd7d6_1intmud5364d7c6_0p9d991iqbbd7d6_0m7gamhelicb8c6_0r08nxaum3ce8g8_1qu7h7yg8v0a5b3_202s3rsx9dqh7h6_0ksg7f2bw95f8d6_1xpr16hnibbd7d5_26c52iypfztd7d5_22xh6n3e2ksg4f5_0rgteyeqwobd7d5_1l8hhb4cg9rh7h6_1uqk9s9fx0pd7d6_1voav5b5vjxe8g8_0djid4qlf8zf8b4_17ivye4h5z9g8f6_16tu0f5ro44b8c6_0kvkstxxuzcc6e5_0tngbbm1lkfe7g6_0y54eg17c4bd7d6_0xzhxlk82ooc8b7_1vcdx0mjoy0c8e6_08piqzvxsy5e8g8_1etf399dnd4f8f7_0lur1uk1rdvd3e2_1q25mn0b1xab7b6_29xoqsz3bowf8e8_22ytw3a2z7tc7c6_0sbqfebftosc5b4_1eidvteidc4h7h6_0ukhurhkg3ic5b4_0okd8lb8ah5c8b7_0x38t21vhveg8f6_0i1i0s6hgrkd3e2_2d35bvbnucwd7d5_0ivww2plmozc7c5_2fkskzq4qs2d7d6_28jzw56ml94d7d6_15tf2udyxcyc5b6_1bw88fx5bopd7d5_16ah66kagkrc7c5_28i011lcau4e7e6_1ja7bgqqvixh7h6_1y5zgob6024b7c6_0t29rpsv5afc7c6_2484spyn2aof6e4_21vidc4gvc9d8e7_0qo22o4y4s6b7b5_1mmecgw0srbe8e4_1wwwjhj8pxjb7c6_0u5p2gno58sd5f4_09i5chbzib0e8g8_26ul28glmhbc3b2_00bc40hdsaob8d7_2bkvp2x9av7h7h6_14s6off9ubtd7d6_1hg0tvo78y5a7a6_0sq4trwb5hqg8f6_2g8gjvg8v7sg8e7_027i99jkf8ne5e4_1ly9wu7yeyag8f6_1i9tsh00g4rf7f6_1g5wdntdthnc8b7_1kv1h8j6syse8g8_0vyr5122w02e8g8_1h3z91nsxo4a8d8_08dco892zs0e5d4_1xa6pd69opmd7d5_1o1paquk9r3c6e5_2bo3k0kvkacf4f3_2eedx2kfr7pb8c6_24dbwdxr9h2f7g8_0s8vyig55sjc5d4_0xn5yfv5q4oc7c6_10xt2ju52x8c8g4_1cysvatnd5ff6d7_0undqgsm97ld8e7_03l42skbw7ad5e4_0eggpb1srzge7e6_021q6j6gwruc6e5_1d0313iky0yb8c6_03kvx7bcccpc8e6_23s7a15zjz7g8e7_047riwf8buzg4f3_1u027lxolg8c8f5_16hetbq0dbbb8c6_26715728qkqd7d5_18ds9ualm50h7h6_1ewq5h4c9vbb8c6_0sz66wlyfthd7d5_1dtpbt35card7d5_0bwtj6ozey8e8g8_0aprafyocj9d7d6_10j4e156600c8e6_0ci45zxbndxf6e4_2f57e0zpjorf7g7_0mnuveqhva2d5c4_0cfm8u1qqmyc8b7_0bwvzb5lvnif8e8_0awqx11os2ed5f4_1tkffuaz1c4f6e4_1u7890ao1asb8c6_2e1088fisa8e6e5_29k4kkdomwve8g8_1g6h7ugjzd1c6d4_00rtxxvp5zkd6c5_19tbwej03epd8h4_0mpatqipe62g8f6_1h4gfy2faysd8d5_00w57y2bbh7f8c5_2bvgfp48we8d8d5_003xtubjfqcc5d7_1152av72joxe8g8_1zl3vnuk7qdd8d1_0g4j7pdytu4c8f5_084q9oal1wfc7c5_10iewg1olk2h7h6_174fy499xune5d4_1lwekra2pfuh8g8_1054fpmo3dwe7e5_1gcnfo2ou3qc8e6_0n2hfk3q1guf6e4_0fs9ghqwsfke6d5_0omlxq38vsgc5b6_0tvatjgvwekd8e7_1rdr48o4hm5b7b6_016mfxzmf70f6g4_1qhrb4uoyxld5e4_07av0uu87ydc6e5_08qeloy3acad7d6_0bqrqxopcfgc7c5_1mz6fpj7tdrh7h6_14wqtru17mwd4e6_10cvy5dqbeed5a5_12d7ro286ugd6f4_0getmdd2kcrb7b5_231alp3t7wne8g8_0hadd60l6a2e8g8_0y05cdyjy8uc6e5_13emcc043lif8c5_1hj1ogbe08nd8d5_19udq4soja4g4f3_27j3dt3o1rub8c6_0kkujzw26igb8c6_1xs7a6t12w0d7d6_1gl3gy5geute8f7_187sa2vk1jid7d5_0eszn3gtswnd7d5_0yuc7qd9tpbd8g5_0c87g0pm2yoa7e7_18c6jwgafhad4e6_2dhu8u9b21ba5b6_0cx7j1rnvdrd7d5_0jmx8ebavlhc6d5_2b3dad2cfyvc7c5_'/*THEORY_END*/;

  function cyrb53(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  const hashKey = key => cyrb53(key).toString(36).padStart(11, '0');

  const theory = new Map();
  for (let i = 0; i + 16 <= THEORY_DATA.length; i += 16)
    theory.set(THEORY_DATA.slice(i, i + 11), THEORY_DATA.slice(i + 11, i + 16).replace(/_+$/, ''));

  function theoryMoveFor(fen) {
    if (!theory.size || TIERS[accuracyIdx].mode === 'skill') return null;
    const move = theory.get(hashKey(openingKey(fen)));
    return move && plausibleMove(fen, move) ? move : null;
  }

  // ── THREATS ───────────────────────────────────────────────────────────────
  function fenBoard() { return boardFromPlacement(lastFEN.split(' ')[0]); }

  function opponentThreat() {
    if (!pos || top3FEN !== lastFEN || !top3[0]?.pv?.length) return null;
    const me = mySide();
    const myTurn = turnOf(lastFEN) === me;
    const move = top3[0].pv[myTurn ? 1 : 0];
    if (!move || !RE_MOVE.test(move)) return null;
    const pieces = fenBoard();
    if (myTurn) applyMove(pieces, top3[0].pv[0]);
    const from = move.slice(0, 2), to = move.slice(2, 4);
    const mover = pieces[from];
    if (!mover || isWhitePiece(mover) === (me === 'w')) return null;
    let target = to;
    if (!pieces[target] && /[pP]/.test(mover) && from[0] !== to[0]) target = to[0] + from[1];
    const victim = pieces[target];
    if (!victim || isWhitePiece(victim) !== (me === 'w')) target = null;
    return { move, target, after: myTurn };
  }

  // ── SVG ARROWS ────────────────────────────────────────────────────────────
  function ensureSVG() {
    const board = getBoard();
    if (!board) return null;
    if (svgLayer?.isConnected) return svgLayer;
    svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgLayer.id = 'evilfish-arrows';
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

  function renderAllArrows() {
    if (stealthMode) return;
    const svg = ensureSVG();
    if (!svg || !top3.length || top3FEN !== lastFEN) return;
    clearArrows();
    const geo = getBoardGeo();
    if (!geo?.cell) return;
    renderedFlip = isFlipped();

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
      const seen = new Set();
      for (const p of pendingPreMoves) {
        if (seen.has(p.move)) continue;
        seen.add(p.move);
        drawArrow(svg, p.move.slice(0,2), p.move.slice(2,4), PRE_MOVE_COLOR, 0.78, geo);
      }
    }
  }

  function peekBestMove() {
    clearTimeout(peekTimer);
    clearArrows();
    const entry = top3[displayRank >= 0 ? displayRank : 0];
    if (!entry?.move || entry.move.length < 4 || top3FEN !== lastFEN) return;
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
  // Built once and updated in place, so an open <select> or a click in progress is never torn down.
  // The header is a drag handle; the panel minimises to a one-line pill (best move + eval). The position is kept as
  // the distance from the nearest screen corner, so the panel stays where it was put when it grows or shrinks.
  const PANEL_CSS = `
#evilfish-panel{position:fixed;z-index:9999;width:322px;max-width:calc(100vw - 12px);box-sizing:border-box;background:rgba(10,11,16,.97);color:#d8d8e8;font:12px/1.6 Consolas,"Courier New",monospace;border:1px solid rgba(0,200,100,.38);border-radius:10px;box-shadow:0 6px 28px rgba(0,0,0,.72);user-select:none;overflow-wrap:anywhere}
#evilfish-panel *{box-sizing:border-box}
#evilfish-panel .ef-bar{display:flex;align-items:center;gap:8px;padding:6px 8px 6px 11px;cursor:grab;touch-action:none}
#evilfish-panel.ef-dragging{opacity:.92}
#evilfish-panel.ef-dragging .ef-bar{cursor:grabbing}
#evilfish-panel .ef-dot{width:9px;height:9px;border-radius:50%;background:#555;color:#555;flex:none;box-shadow:0 0 6px currentColor}
#evilfish-panel .ef-title{color:#00c864;font-weight:700}
#evilfish-panel .ef-grow{flex:1}
#evilfish-panel .ef-mini{flex:1;min-width:0;display:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#cbd5e1}
#evilfish-panel .ef-iconbtn{background:none;border:0;color:#8a93a3;font:700 16px/1 Arial,sans-serif;cursor:pointer;padding:1px 7px;border-radius:5px}
#evilfish-panel .ef-iconbtn:hover{background:#202838;color:#fff}
#evilfish-panel.ef-min{width:auto;max-width:300px}
#evilfish-panel.ef-min .ef-mini{display:block}
#evilfish-panel.ef-min .ef-grow,#evilfish-panel.ef-min .ef-body{display:none}
#evilfish-panel .ef-body{padding:0 12px 10px}
#evilfish-panel .ef-sub{color:#8a93a3;margin-bottom:3px}
#evilfish-panel .ef-evalbar{position:relative;height:14px;border-radius:7px;background:#3a1a20;overflow:hidden;margin:2px 0 6px}
#evilfish-panel .ef-evalbar i{position:absolute;left:0;top:0;bottom:0;width:50%;background:linear-gradient(90deg,#0a8f4d,#00c864);transition:width .25s}
#evilfish-panel .ef-evalbar b{position:absolute;inset:0;text-align:center;font-size:10px;line-height:14px;color:#fff;text-shadow:0 0 3px #000}
#evilfish-panel .ef-evalbar.ef-none{opacity:.3}
#evilfish-panel .ef-chips{display:flex;flex-wrap:wrap;gap:5px;margin:7px 0 6px}
#evilfish-panel .ef-btn{background:#1a2030;color:#8a93a3;border:1px solid #394456;border-radius:5px;font:inherit;font-size:11px;padding:1px 8px;cursor:pointer}
#evilfish-panel .ef-btn:hover{border-color:#6b7a92;color:#e2e8f0}
#evilfish-panel .ef-btn.on{color:#00c864;border-color:#00c864;background:#0f2a1d}
#evilfish-panel .ef-btn.off{color:#ff6b6b;border-color:#ff6b6b;background:#2a1215}
#evilfish-panel .ef-btn.warn{color:#ffa500;border-color:#ffa500;background:#2a2010}
#evilfish-panel .ef-btn.blue.on{color:#4aa3ff;border-color:#4aa3ff;background:#102034}
#evilfish-panel .ef-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:4px 0}
#evilfish-panel label{display:block;color:#8a93a3;font-size:11px}
#evilfish-panel .ef-sel{width:100%;background:#151a26;color:#d8d8e8;border:1px solid #394456;border-radius:5px;font:inherit;padding:2px 3px;cursor:pointer}
#evilfish-panel .ef-open{display:flex;align-items:flex-end;gap:4px;margin:4px 0}
#evilfish-panel .ef-open label{flex:1;min-width:0}
#evilfish-panel .ef-heart{background:none;border:0;font:20px/1.1 Arial,sans-serif;cursor:pointer;padding:0 3px}
#evilfish-panel .ef-dim{color:#8a93a3;font-size:11px;margin-top:3px}
#evilfish-panel .ef-dim2{color:#5d6675;font-size:10.5px;margin-top:3px}`;

  const uiState = { ax: 'right', ay: 'bottom', ox: 18, oy: 18, min: false };
  safe(() => {
    const raw = store.get('eni-ui', null);
    const saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (saved && typeof saved === 'object') {
      if (saved.ax === 'left' || saved.ax === 'right') uiState.ax = saved.ax;
      if (saved.ay === 'top' || saved.ay === 'bottom') uiState.ay = saved.ay;
      if (Number.isFinite(saved.ox)) uiState.ox = saved.ox;
      if (Number.isFinite(saved.oy)) uiState.oy = saved.oy;
      uiState.min = !!saved.min;
    }
  });
  const saveUI = () => store.set('eni-ui', JSON.stringify(uiState));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function placePanel() {
    if (!panel) return;
    const w = panel.offsetWidth || 322, h = panel.offsetHeight || 200;
    uiState.ox = clamp(uiState.ox, 0, Math.max(0, window.innerWidth - w));
    uiState.oy = clamp(uiState.oy, 0, Math.max(0, window.innerHeight - h));
    const s = panel.style;
    s.left   = uiState.ax === 'left'   ? uiState.ox + 'px' : 'auto';
    s.right  = uiState.ax === 'right'  ? uiState.ox + 'px' : 'auto';
    s.top    = uiState.ay === 'top'    ? uiState.oy + 'px' : 'auto';
    s.bottom = uiState.ay === 'bottom' ? uiState.oy + 'px' : 'auto';
  }

  function startDrag(e) {
    if (e.button !== 0 || e.target.closest('button, select, input, a')) return;
    const bar = e.currentTarget;
    const r = panel.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    try { bar.setPointerCapture(e.pointerId); } catch (err) {}
    panel.classList.add('ef-dragging');
    const move = ev => {
      const x = clamp(ev.clientX - dx, 0, Math.max(0, window.innerWidth - panel.offsetWidth));
      const y = clamp(ev.clientY - dy, 0, Math.max(0, window.innerHeight - panel.offsetHeight));
      Object.assign(panel.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
    };
    const up = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
      panel.classList.remove('ef-dragging');
      const r2 = panel.getBoundingClientRect();
      uiState.ax = r2.left + r2.width / 2 > window.innerWidth / 2 ? 'right' : 'left';
      uiState.ay = r2.top + r2.height / 2 > window.innerHeight / 2 ? 'bottom' : 'top';
      uiState.ox = uiState.ax === 'right' ? window.innerWidth - r2.right : r2.left;
      uiState.oy = uiState.ay === 'bottom' ? window.innerHeight - r2.bottom : r2.top;
      placePanel();
      saveUI();
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
    e.preventDefault();
  }

  function setMinimized(min) {
    uiState.min = !!min;
    if (panel) panel.classList.toggle('ef-min', uiState.min);
    saveUI();
    updatePanel();
    placePanel();
  }

  // actions shared by the panel controls and the hotkeys
  function toggleAuto() {
    autoMoveEnabled = !autoMoveEnabled;
    dbg('auto move ' + (autoMoveEnabled ? 'on' : 'off'));
    if (pos && enabled) analyze(pos); else updatePanel();          // the PV count depends on auto move
  }
  function setSpeed(i) {
    speedIdx = ((i % SPEEDS.length) + SPEEDS.length) % SPEEDS.length;
    store.set('eni-speed', speedIdx);
    dbg('speed: ' + SPEEDS[speedIdx].name);
    if (pos && enabled) analyze(pos); else updatePanel();
  }
  function setTier(i) {
    accuracyIdx = ((i % TIERS.length) + TIERS.length) % TIERS.length;
    store.set('eni-accuracy', accuracyIdx);
    if (eng) eng.strengthDirty = true;
    if (upgrade) upgrade.strengthDirty = true;
    if (pos && enabled) analyze(pos); else updatePanel();
  }
  function toggleThreats() { showThreats = !showThreats; renderAllArrows(); updatePanel(); }
  function togglePremove() {
    showPreMove = !showPreMove;
    if (!showPreMove) pendingPreMoves = [];
    else if (pos && top3FEN === pos.fen) derivePreMoves(pos);
    renderAllArrows();
    updatePanel();
  }
  function toggleHidden() { if (panel?.isConnected) panel.style.display = panel.style.display === 'none' ? '' : 'none'; }

  function ensurePanel() {
    if (panel?.isConnected) return panel;
    if (!document.getElementById('evilfish-style')) {
      const style = document.createElement('style');
      style.id = 'evilfish-style';
      style.textContent = PANEL_CSS;
      (document.head || document.documentElement).appendChild(style);
    }
    panel = document.createElement('div');
    panel.id = 'evilfish-panel';
    const openingOptions = OPENINGS.map((entry, index) => {
      const side = entry.side === 'w' ? 'White' : entry.side === 'b' ? 'Black' : 'Any side';
      const name = entry.name.replace(/ \((White|Black)\)$/, '');
      return `<option value="${index}">${esc(side)} · ${esc(name)}</option>`;
    }).join('');
    const speedOptions = SPEEDS.map((s, i) =>
      `<option value="${i}">${esc(s.name)}${s.movetime > 0 ? ' · ' + s.movetime + ' ms' : s.name === 'auto' ? ' · clock' : ' · depth'}</option>`).join('');
    const tierOptions = TIERS.map((t, i) =>
      `<option value="${i}">${t.acc}% · ${t.elo === null ? 'max' : (t.mode === 'skill' ? '~' : '') + t.elo + ' Elo'}</option>`).join('');
    panel.innerHTML = `
      <div class="ef-bar" id="ef-bar" title="Drag to move · double-click to minimise">
        <span class="ef-dot" id="ef-dot"></span><span class="ef-title">Evilfish</span>
        <span class="ef-mini" id="ef-mini"></span><span class="ef-grow"></span>
        <button class="ef-iconbtn" id="ef-min" title="Minimise (Alt+N)">–</button>
      </div>
      <div class="ef-body">
        <div class="ef-sub" id="ef-side"></div>
        <div class="ef-evalbar ef-none" id="ef-evalbar"><i id="ef-evalfill"></i><b id="ef-evaltext"></b></div>
        <div id="ef-rows"></div>
        <div id="ef-extra"></div>
        <div class="ef-chips">
          <button class="ef-btn" id="evilfish-toggle" title="Analyzer on / off (Alt+S: stealth)"></button>
          <button class="ef-btn" id="ef-auto" title="Auto move (Alt+A)">AUTO</button>
          <button class="ef-btn blue" id="ef-threats" title="Threat arrows (Alt+O)">THREATS</button>
          <button class="ef-btn blue" id="ef-pre" title="Premove arrows and automatic premoves (Alt+M)">PREMOVE</button>
        </div>
        <div class="ef-grid">
          <label>speed (Alt+T)<select class="ef-sel" id="ef-speed">${speedOptions}</select></label>
          <label>strength (Alt+P)<select class="ef-sel" id="ef-tier">${tierOptions}</select></label>
        </div>
        <div class="ef-open">
          <label><span id="ef-open-label">opening</span><select class="ef-sel" id="evilfish-opening">${openingOptions}</select></label>
          <button class="ef-heart" id="evilfish-heart"></button>
        </div>
        <div class="ef-dim" id="ef-meta"></div>
        <div class="ef-dim2" id="ef-foot"></div>
      </div>`;
    const q = id => panel.querySelector(id);
    ui = {
      bar: q('#ef-bar'), dot: q('#ef-dot'), mini: q('#ef-mini'), min: q('#ef-min'),
      toggle: q('#evilfish-toggle'), auto: q('#ef-auto'), threats: q('#ef-threats'), pre: q('#ef-pre'),
      side: q('#ef-side'), evalbar: q('#ef-evalbar'), evalfill: q('#ef-evalfill'), evaltext: q('#ef-evaltext'),
      rows: q('#ef-rows'), extra: q('#ef-extra'), speed: q('#ef-speed'), tier: q('#ef-tier'),
      select: q('#evilfish-opening'), heart: q('#evilfish-heart'), label: q('#ef-open-label'),
      meta: q('#ef-meta'), foot: q('#ef-foot')
    };
    panel.classList.toggle('ef-min', uiState.min);
    ui.bar.addEventListener('pointerdown', startDrag);
    ui.bar.addEventListener('dblclick', e => { if (!e.target.closest('button, select')) setMinimized(!uiState.min); });
    ui.min.addEventListener('click', () => setMinimized(!uiState.min));
    ui.toggle.addEventListener('click', toggleEnabled);
    ui.auto.addEventListener('click', toggleAuto);
    ui.threats.addEventListener('click', toggleThreats);
    ui.pre.addEventListener('click', togglePremove);
    ui.speed.addEventListener('change', () => setSpeed(Number(ui.speed.value)));
    ui.tier.addEventListener('change', () => setTier(Number(ui.tier.value)));
    panel.addEventListener('click', e => {
      if (e.target.closest('#evilfish-cancel-premove')) { cancelQueuedPreMove(); return; }
      if (e.target.closest('#evilfish-heart')) {
        const opening = OPENINGS[openingIdx];
        if (!opening.side) return;
        const removing = favoriteOpenings[opening.side] === opening.name;
        favoriteOpenings[opening.side] = removing ? null : opening.name;
        if (removing) openingIdx = 0;
        store.set('eni-favorite-openings', JSON.stringify(favoriteOpenings));
        if (removing) store.set('eni-opening', 0);
        if (pos && enabled) analyze(pos);
        updatePanel();
      }
    });
    ui.select.addEventListener('change', () => {
      openingIdx = Number(ui.select.value);
      store.set('eni-opening', openingIdx);
      if (pos && enabled) analyze(pos);
      updatePanel();
    });
    document.body.appendChild(panel);
    placePanel();
    return panel;
  }

  const fmtMove = m => m.length === 5 ? `${m.slice(0, 4)}=${m[4].toUpperCase()}` : m;

  // Scores are shown from my point of view: + is good for me whoever is on move.
  function fmtScore(entry) {
    if (entry.label) return entry.label;
    const sign = entry.side === mySide() ? 1 : -1;
    let text;
    if (Number.isInteger(entry.mateScore)) {
      const m = entry.mateScore * sign;
      text = (m > 0 ? 'M' : '-M') + Math.abs(m);
    } else if (Number.isInteger(entry.scoreRaw)) {
      const cp = entry.scoreRaw * sign;
      text = `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(2)}`;
    } else text = '?';
    if (entry.wdl && !Number.isInteger(entry.mateScore)) {
      const [w, d, l] = entry.wdl;
      const win = (sign > 0 ? w + d / 2 : l + d / 2) / 10;
      text += ` · ${win.toFixed(0)}%`;
    }
    if (entry.src === 'cloud') text += ` · cloud d${entry.depth}`;
    return text + (entry.tentative ? '~' : '');
  }

  // my winning chances in percent, or null when the entry carries no evaluation (book, theory, forced...)
  function winPercent(entry) {
    if (!entry || entry.label) return null;
    const sign = entry.side === mySide() ? 1 : -1;
    if (Number.isInteger(entry.mateScore)) return entry.mateScore * sign > 0 ? 100 : 0;
    if (entry.wdl) { const [w, d, l] = entry.wdl; return (sign > 0 ? w + d / 2 : l + d / 2) / 10; }
    if (Number.isInteger(entry.scoreRaw)) return 100 / (1 + Math.pow(10, -(entry.scoreRaw * sign) / 400));
    return null;
  }

  function rankLabel(i) {
    const symbols = ['①', '②', '③'];
    const entry   = top3[i];
    if (!entry) return '';
    const locked  = displayRank === i;
    const col     = COL_RANKS[i].replace(/0\.\d+\)/, '1)');
    const style   = `color:${col};${locked ? 'font-weight:bold;text-decoration:underline' : ''}`;
    return `<span style="${style}">${symbols[i]}</span> ${esc(fmtMove(entry.move))} <span style="color:#aaa">${esc(fmtScore(entry))}</span>`;
  }

  const setOn = (el, on) => el.classList.toggle('on', !!on);

  function updatePanel() {
    if (!panel?.isConnected && !ensurePanel()) return;
    const t = TIERS[accuracyIdx];
    const strengthLabel = t.elo === null ? 'max strength'
                        : t.mode === 'skill' ? `~${t.elo} Elo`
                        : `${t.elo} Elo`;
    const fen = pos?.fen || lastFEN;
    const turn = fen ? (turnOf(fen) === 'b' ? 'b to move' : 'w to move') : 'no board';
    const me = pos ? mySide() : null;
    ui.side.textContent = `${forcedSide ? (forcedSide === 'w' ? '♔' : '♚') + ' forced' : me ? (me === 'w' ? 'white' : 'black') : 'auto'} · ${turn}${pos ? ' · ' + pos.source : ''}`;

    const E = eng;
    const state = !enabled ? 'off' : stealthMode ? 'warn' : 'on';
    ui.toggle.textContent = !enabled ? 'OFF' : stealthMode ? 'STEALTH' : 'ON';
    ui.toggle.className = 'ef-btn ' + state;
    ui.dot.style.background = ui.dot.style.color = !enabled ? '#ff5555' : stealthMode ? '#ffa500' : (E && E.ready ? '#00c864' : '#7a8394');
    setOn(ui.auto, autoMoveEnabled);
    setOn(ui.threats, showThreats);
    setOn(ui.pre, showPreMove);
    ui.min.textContent = uiState.min ? '+' : '–';
    ui.min.title = uiState.min ? 'Expand (Alt+N)' : 'Minimise (Alt+N)';
    panel.classList.toggle('ef-min', uiState.min);
    if (document.activeElement !== ui.speed) ui.speed.value = String(speedIdx);
    if (document.activeElement !== ui.tier) ui.tier.value = String(accuracyIdx);

    const searching = !!E?.job;
    const emptyState = pos?.over ? 'game over'
                     : !enabled ? 'analyzer off'
                     : !E || !E.ready ? (engineStatus || 'engine starting…')
                     : searching ? 'analyzing…'
                     : top3FEN === lastFEN && lastFEN ? 'no move available'
                     : 'waiting for board…';
    const rows = [0, 1, 2].map(rankLabel).filter(Boolean).join('<br>');
    ui.rows.innerHTML = rows || `<span style="color:#888">${esc(emptyState)}</span>`;

    const best = top3[0] && top3FEN === lastFEN ? top3[0] : null;
    ui.mini.textContent = (autoMoveEnabled && enabled ? 'AUTO · ' : '') +
                          (best ? `${fmtMove(best.move)} ${fmtScore(best).split(' · ')[0]}` : emptyState);
    const win = winPercent(best);
    ui.evalbar.classList.toggle('ef-none', win === null);
    ui.evalfill.style.width = (win === null ? 50 : clamp(win, 2, 100)) + '%';
    ui.evaltext.textContent = win === null ? '' : `${win.toFixed(0)}% for me`;

    const extra = [];
    if (pendingPreMoves.length && showPreMove) {
      const p = pendingPreMoves[0];
      extra.push(`<span style="color:#1e90ff">queued ${esc(p.kind)}: ${esc(fmtMove(p.move))}${pendingPreMoves.length > 1 ? ' +' + (pendingPreMoves.length - 1) : ''}</span> <button class="ef-btn" id="evilfish-cancel-premove" title="Cancel queued premoves (Alt+X)">cancel</button>`);
    }
    const threat = showThreats ? opponentThreat() : null;
    if (threat) extra.push(`<span style="color:#ff7187">threat: ${esc(threat.move)}${threat.target ? ` takes ${esc(threat.target)}` : ''}${threat.after ? ' after best move' : ''}</span>`);
    const tb = tablebase?.fen === lastFEN ? tablebase : null;
    if (tb?.data) extra.push(`<span style="color:#b89dff">tablebase: ${esc(tb.data.category)}${tb.data.moves[0]?.uci ? ` · best ${esc(tb.data.moves[0].uci)}` : ''}</span>`);
    else if (tb?.loading) extra.push('<span style="color:#888">tablebase: loading…</span>');
    else if (tb?.error) extra.push('<span style="color:#888">tablebase: unavailable</span>');
    ui.extra.innerHTML = extra.join('<br>');

    const opening = OPENINGS[openingIdx];
    const openingSide = opening.side === 'w' ? 'White' : opening.side === 'b' ? 'Black' : 'Any side';
    ui.label.textContent = `opening (${openingSide})`;
    if (document.activeElement !== ui.select && ui.select.value !== String(openingIdx)) ui.select.value = String(openingIdx);
    const hearted = opening.side && favoriteOpenings[opening.side] === opening.name;
    ui.heart.innerHTML = hearted ? '&hearts;' : '&#9825;';
    ui.heart.style.color = hearted ? '#ff5577' : '#888';
    ui.heart.title = opening.side ? `Save ${openingSide} opening` : 'Select a White or Black opening';
    const savedWhite = favoriteOpenings.w?.replace(/ \(White\)$/, '') || 'none';
    const savedBlack = favoriteOpenings.b?.replace(/ \(Black\)$/, '') || 'none';
    ui.meta.innerHTML = `saved: W ${esc(savedWhite)} · B ${esc(savedBlack)}<br>playing: ${esc(OPENINGS[activeOpeningIndex()].name)} · book: ${lastFEN ? esc(openingStatus(lastFEN)) : 'waiting'}` +
      (currentOpening ? `<br><span style="color:#9ab">theory: ${esc(currentOpening)}</span>` : '');
    let engineLabel = E ? E.kind : '…';
    if (E && E.kind === 'lite' && /^full engine/.test(engineStatus)) engineLabel += ' → ' + engineStatus.replace(/^full engine:? ?/, 'full ');
    ui.foot.innerHTML = `${esc(strengthLabel)} · PV${E?.multiPV || MULTI_PV} · engine ${esc(engineLabel)}<br>Alt: A auto · T speed · P strength · O threats · M premoves · X cancel · S stealth · N minimise · H hide · F side · 1-3 arrow`;
  }

  function setStatus(msg) { engineStatus = msg; updatePanel(); }

  function toggleEnabled() {
    if (stealthMode) {
      stealthMode = false;
      clearTimeout(peekTimer);
      clearArrows();
      if (enabled && top3.length) renderAllArrows();
      updatePanel();
      return;
    }
    enabled = !enabled;
    if (!enabled) { clearArrows(); cancelSearch(); }
    else if (pos) analyze(pos);
    updatePanel();
  }

  // ── OBSERVER (DOM fallback only) ──────────────────────────────────────────
  let observedBoard = null;
  let boardObserver = null;

  function attachObserver(board) {
    if (getGame()) {
      if (boardObserver) { boardObserver.disconnect(); boardObserver = null; observedBoard = null; }
      return;
    }
    if (board === observedBoard) return;
    boardObserver?.disconnect();
    observedBoard = board;
    boardObserver = new MutationObserver(records => {
      if (records.every(r => svgLayer && svgLayer.contains(r.target))) return;
      schedule('dom');
    });
    boardObserver.observe(board, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  function tick() {
    const board = getBoard();
    if (!board) return;
    if (!bootStarted) { bootStarted = true; bootEngine(); }
    ensurePanel();
    attachObserver(board);
    syncPosition('poll');
    ensureAnalysis();
    if (top3.length && renderedFlip !== null && renderedFlip !== isFlipped()) renderAllArrows();
  }

  // ── KEYBOARD ──────────────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;           // AltGr arrives as Ctrl+Alt
    if (e.getModifierState && e.getModifierState('AltGraph')) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.repeat) { if (/^(KeyA|KeyF|KeyH|KeyN|KeyP|KeyT|KeyX|KeyO|KeyS|KeyM|Digit[123])$/.test(e.code)) e.preventDefault(); return; }

    switch (e.code) {
      case AUTO_MOVE_KEY: e.preventDefault(); toggleAuto(); break;
      case 'KeyF':
        e.preventDefault();
        forcedSide = forcedSide === null ? 'w' : forcedSide === 'w' ? 'b' : null;
        pos = null; lastFEN = '';
        syncPosition('forced side');
        break;
      case 'KeyH': e.preventDefault(); toggleHidden(); break;
      case 'KeyN': e.preventDefault(); setMinimized(!uiState.min); break;
      case 'KeyP': e.preventDefault(); setTier(accuracyIdx + 1); break;
      case 'KeyT': e.preventDefault(); setSpeed(speedIdx + 1); break;
      case 'KeyX': e.preventDefault(); cancelQueuedPreMove(); break;
      case 'KeyO': e.preventDefault(); toggleThreats(); break;
      case 'KeyM': e.preventDefault(); togglePremove(); break;
      case 'KeyS':
        e.preventDefault();
        if (!enabled) break;
        if (!stealthMode) {
          stealthMode = true;
          clearArrows();
          updatePanel();
        }
        peekBestMove();
        break;
      case 'Digit1': case 'Digit2': case 'Digit3': {
        e.preventDefault();
        const rank = +e.code.slice(-1) - 1;
        displayRank = displayRank === rank ? -1 : rank;
        renderAllArrows(); updatePanel();
        break;
      }
      default: break;
    }
  }, true);

  window.addEventListener('orientationchange', () => setTimeout(renderAllArrows, 150));
  window.addEventListener('resize', () => { renderAllArrows(); placePanel(); });

  // ── BOOT ──────────────────────────────────────────────────────────────────
  if (TEST) {
    window.__evilfish = {
      get pos() { return pos; }, get top3() { return top3; }, get eng() { return eng; }, get pending() { return pendingPreMoves; },
      get status() { return engineStatus; }, get lastAutoMoveKey() { return lastAutoMoveKey; },
      get settings() { return { enabled, autoMoveEnabled, speed: SPEEDS[speedIdx].name, tier: TIERS[accuracyIdx].acc }; },
      set autoMove(v) { autoMoveEnabled = !!v; if (pos && enabled) analyze(pos); },
      set speed(i) { speedIdx = i; }, set accuracy(i) { accuracyIdx = i; if (eng) eng.strengthDirty = true; },
      sync: () => syncPosition('test'), analyze: () => pos && analyze(pos),
      T: { isValidFEN, plausibleMove, applyMove, stepFEN, inferMove, historyConsistent, squareAttacked, kingAttackedBy,
           boardFromPlacement, placementFromBoard, legalCastlingRights, buildOpeningIndex, OPENINGS, makeJob, fmtScore,
           derivePreMoves, reconcileTablebase, onTablebase, setTablebase: t => { tablebase = t; }, readMyClockMs,
           normalizeCastlingPV, cloudEntries, cloud, useCloud, unsettled, startPonder, executeMove, clickMove, domPlacement,
           hashKey, theory, theoryMoveFor, openingKey }
    };
  }
  ensurePanel();
  updatePanel();
  dbg(`Evilfish v${VERSION} loaded ✓`);
  setInterval(tick, 600);
  tick();

})();
