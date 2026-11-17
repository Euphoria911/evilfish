// ==UserScript==
// @name         Evilfish
// @namespace    https://chess.com
// @version      4.0.0
// @description  Stockfish 19 for chess.com: event-driven board sync, history-aware search, progressive full-strength engine, opening books, tablebase, arrows, conditional premoves, auto move
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
  const VERSION       = '4.0.0';
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
    const el = document.querySelector('.clock-component.clock-bottom, .clock-bottom, [class*="clock-bottom"]');
    return el && el.offsetParent !== null ? parseClock(el) : null;
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
      job: null, next: null, stopMode: null, pv: {}, hist: [], t0: 0, hitTimer: null, ponderResult: null,
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
    if (speed.name === 'fast' || lowTime || (meTurn && autoMoveEnabled)) multiPV = 1;
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
      extendFactor: speed.name === 'fast' ? 0.5 : 0.7,
      allowExtend: maxTier && meTurn && budget > 0 && speed.name !== 'deep' && !lowTime && !opts.ponder
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
      E.ponderResult = { fen: job.fen, list };
      dbg(`ponder done (${E.kind}) for ${job.fen.slice(0, 40)}…`);
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
  function startPonder(st, list) {
    const E = eng;
    if (!enabled || !E || !E.ready || st.over || !st.atEnd) return;
    if (st.mode && st.mode !== 'playing') return;
    if (turnOf(st.fen) === mySide()) return;
    const reply = list[0]?.pv?.[0];
    if (!reply || !RE_MOVE.test(reply)) return;
    const futureFEN = stepFEN(st.fen, reply);
    if (!futureFEN || !isValidFEN(futureFEN)) return;
    const fst = { fen: futureFEN, startFEN: st.startFEN, moves: st.moves.concat(reply), atEnd: true, over: false,
                  mode: st.mode, playingAs: st.playingAs, source: 'ponder', variant: 'chess' };
    if (cloudEligible(fst)) {
      // warm the cloud cache for the two most likely replies so the answer is instant whichever one is played
      if (!cloud.cache.has(futureFEN)) lookupCloud(futureFEN);
      const second = list[1]?.pv?.[0];
      const secondFEN = second && RE_MOVE.test(second) ? stepFEN(st.fen, second) : null;
      if (secondFEN && isValidFEN(secondFEN) && !cloud.cache.has(secondFEN)) lookupCloud(secondFEN);
    }
    if (openingMoveFor(futureFEN)) return;                 // the book will answer instantly
    E.ponderResult = null;
    requestSearch(makeJob(fst, { ponder: true }));
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
    lookupTablebase(st.fen);
    tbActiveFEN = '';
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
    if (E && E.ponderResult) {
      const pr = E.ponderResult;
      E.ponderResult = null;
      if (pr.fen === st.fen && pr.list.length) {
        dbg('ponder hit (finished)');
        top3 = pr.list;
        top3FEN = st.fen;
        finalize(st);
        return;
      }
    }
    updatePanel();
    if (!E || !E.ready) return;
    if (E.job && E.job.ponder && E.job.fen === st.fen && E.state === 'searching') { ponderHit(E, st); return; }
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
  const THEORY_DATA = /*THEORY_BEGIN*/''/*THEORY_END*/;

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
  // Built once; updates touch text only, so an open <select> or a click in progress is never torn down.
  const BTN = 'background:#202838;color:#cbd5e1;border:1px solid #526276;border-radius:4px;cursor:pointer;font:inherit;padding:0 6px';

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
      boxShadow: '0 4px 24px rgba(0,0,0,0.7)', userSelect: 'none'
    });
    panel.title = 'Alt+A auto move · Alt+T speed · Alt+P strength · Alt+X cancel premoves · Alt+H hide';
    const rule = '<span style="color:#555">────────────────────</span>';
    const openingOptions = OPENINGS.map((entry, index) => {
      const side = entry.side === 'w' ? 'White' : entry.side === 'b' ? 'Black' : 'Any side';
      const name = entry.name.replace(/ \((White|Black)\)$/, '');
      return `<option value="${index}">${esc(side)} · ${esc(name)}</option>`;
    }).join('');
    panel.innerHTML = `
      <div><span style="color:#00c864;font-weight:bold">Evilfish</span> <button id="evilfish-toggle" style="${BTN}"></button> <span id="ef-auto"></span> · <span id="ef-side" style="color:#aaa"></span></div>
      <div>${rule}</div>
      <div id="ef-rows"></div>
      <div id="ef-extra"></div>
      <div>${rule}</div>
      <div><label style="color:#888"><span id="ef-open-label">opening</span>: <select id="evilfish-opening" style="background:#16161e;color:#d8d8e8;border:1px solid #555;border-radius:4px;font:inherit;max-width:185px;cursor:pointer">${openingOptions}</select></label>
      <button id="evilfish-heart" style="background:none;border:0;font:20px Arial;vertical-align:middle;cursor:pointer;padding:0 3px"></button></div>
      <div id="ef-meta" style="color:#888"></div>
      <div id="ef-foot" style="color:#666"></div>`;
    ui = {
      toggle: panel.querySelector('#evilfish-toggle'), auto: panel.querySelector('#ef-auto'),
      side: panel.querySelector('#ef-side'), rows: panel.querySelector('#ef-rows'),
      extra: panel.querySelector('#ef-extra'), select: panel.querySelector('#evilfish-opening'),
      heart: panel.querySelector('#evilfish-heart'), label: panel.querySelector('#ef-open-label'),
      meta: panel.querySelector('#ef-meta'), foot: panel.querySelector('#ef-foot')
    };
    panel.addEventListener('click', e => {
      if (e.target.closest('#evilfish-toggle')) { toggleEnabled(); return; }
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

  function rankLabel(i) {
    const symbols = ['①', '②', '③'];
    const entry   = top3[i];
    if (!entry) return '';
    const locked  = displayRank === i;
    const col     = COL_RANKS[i].replace(/0\.\d+\)/, '1)');
    const style   = `color:${col};${locked ? 'font-weight:bold;text-decoration:underline' : ''}`;
    return `<span style="${style}">${symbols[i]}</span> ${esc(fmtMove(entry.move))} <span style="color:#aaa">${esc(fmtScore(entry))}</span>`;
  }

  function updatePanel() {
    if (!panel?.isConnected && !ensurePanel()) return;
    const t = TIERS[accuracyIdx];
    const strengthLabel = t.elo === null ? 'max str'
                        : t.mode === 'skill' ? `~${t.elo} Elo`
                        : `${t.elo} Elo`;
    const fen = pos?.fen || lastFEN;
    const turn = fen ? (turnOf(fen) === 'b' ? 'b to move' : 'w to move') : 'no board';
    const me = pos ? mySide() : null;
    ui.side.textContent = `${forcedSide ? (forcedSide === 'w' ? '♔' : '♚') + ' forced' : me ? (me === 'w' ? 'white' : 'black') : 'auto'} · ${turn}${pos ? ' · ' + pos.source : ''}`;
    ui.toggle.textContent = !enabled ? 'OFF' : stealthMode ? 'STEALTH' : 'ON';
    ui.toggle.style.color = !enabled ? '#ff5555' : stealthMode ? '#ffa500' : '#00c864';
    ui.auto.textContent = `AUTO ${autoMoveEnabled ? 'ON' : 'OFF'}`;
    ui.auto.style.color = autoMoveEnabled ? '#00c864' : '#666';

    const E = eng;
    const searching = !!E?.job;
    const emptyState = pos?.over ? 'game over'
                     : !E || !E.ready ? (engineStatus || 'engine starting…')
                     : searching ? 'analyzing…'
                     : top3FEN === lastFEN && lastFEN ? 'no move available'
                     : 'waiting for board…';
    const rows = [0, 1, 2].map(rankLabel).filter(Boolean).join('<br>');
    ui.rows.innerHTML = rows || `<span style="color:#888">${esc(emptyState)}</span>`;

    const extra = [];
    if (pendingPreMoves.length && showPreMove) {
      const p = pendingPreMoves[0];
      extra.push(`<span style="color:#1e90ff">queued ${esc(p.kind)}: ${esc(fmtMove(p.move))}${pendingPreMoves.length > 1 ? ' +' + (pendingPreMoves.length - 1) : ''}</span> <button id="evilfish-cancel-premove" title="Cancel queued premoves (Alt+X)" style="${BTN}">cancel</button>`);
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
    ui.meta.innerHTML = `saved: W ${esc(savedWhite)} · B ${esc(savedBlack)}<br>playing: ${esc(OPENINGS[activeOpeningIndex()].name)}<br>book: ${lastFEN ? esc(openingStatus(lastFEN)) : 'waiting'}` +
      (currentOpening ? `<br><span style="color:#9ab">theory: ${esc(currentOpening)}</span>` : '');
    let engineLabel = E ? E.kind : '…';
    if (E && E.kind === 'lite' && /^full engine/.test(engineStatus)) engineLabel += ' → ' + engineStatus.replace(/^full engine:? ?/, 'full ');
    ui.foot.innerHTML = `${esc(strengthLabel)} (${t.acc}%) · T:${esc(SPEEDS[speedIdx].name)}/PV${E?.multiPV || MULTI_PV} · ${esc(engineLabel)}<br>A:auto · X:cancel · O:threats ${showThreats ? 'on' : 'off'}<br>F·H·M·P·S · 1·2·3 <span style="color:${showPreMove ? '#1e90ff' : '#555'}">${showPreMove ? '⇒pre' : '⇒off'}</span>`;
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
    if (e.repeat) { if (/^(KeyA|KeyF|KeyH|KeyP|KeyT|KeyX|KeyO|KeyS|KeyM|Digit[123])$/.test(e.code)) e.preventDefault(); return; }

    if (e.code === AUTO_MOVE_KEY) {
      e.preventDefault();
      autoMoveEnabled = !autoMoveEnabled;
      dbg('auto move ' + (autoMoveEnabled ? 'on' : 'off'));
      if (pos && enabled) analyze(pos); else updatePanel();   // PV count depends on auto move
    }
    if (e.code === 'KeyF') {
      e.preventDefault();
      forcedSide = forcedSide === null ? 'w' : forcedSide === 'w' ? 'b' : null;
      pos = null; lastFEN = '';
      syncPosition('forced side');
    }
    if (e.code === 'KeyH') {
      e.preventDefault();
      if (panel?.isConnected) panel.style.display = panel.style.display === 'none' ? '' : 'none';
    }
    if (e.code === 'KeyP') {
      e.preventDefault();
      accuracyIdx = (accuracyIdx + 1) % TIERS.length;
      store.set('eni-accuracy', accuracyIdx);
      const t2 = TIERS[accuracyIdx];
      dbg(`Accuracy: ${t2.acc}% → ${t2.mode} ${t2.elo || t2.skill || ''}`);
      if (eng) eng.strengthDirty = true;
      if (upgrade) upgrade.strengthDirty = true;
      if (pos && enabled) analyze(pos); else updatePanel();
    }
    if (e.code === 'KeyT') {
      e.preventDefault();
      speedIdx = (speedIdx + 1) % SPEEDS.length;
      store.set('eni-speed', speedIdx);
      dbg('speed: ' + SPEEDS[speedIdx].name);
      if (pos && enabled) analyze(pos); else updatePanel();
    }
    if (e.code === 'KeyX') { e.preventDefault(); cancelQueuedPreMove(); }
    if (e.code === 'KeyO') {
      e.preventDefault();
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
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
      e.preventDefault();
      const rank = +e.code.slice(-1) - 1;
      displayRank = displayRank === rank ? -1 : rank;
      renderAllArrows(); updatePanel();
    }
    if (e.code === 'KeyM') {
      e.preventDefault();
      showPreMove = !showPreMove;
      if (!showPreMove) pendingPreMoves = [];
      else if (pos && top3FEN === pos.fen) derivePreMoves(pos);
      renderAllArrows(); updatePanel();
    }
  }, true);

  window.addEventListener('orientationchange', () => setTimeout(renderAllArrows, 150));
  window.addEventListener('resize', () => renderAllArrows());

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
