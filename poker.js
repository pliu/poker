/* poker.js — pure, DOM-free Texas Hold'em: cards, hand evaluation,
   range-aware equity, and the betting state machine.
   Loaded as a plain <script> in the browser (global `Poker`) and eval'd
   directly by test/run_tests.js. No dependencies. */
var Poker = (function () {
"use strict";

var RANKS = ["2","3","4","5","6","7","8","9","T","J","Q","K","A"];
var SUITS = ["♠","♥","♦","♣"];      // s h d c
var SUIT_LETTER = ["s","h","d","c"];
var SUIT_RED = [false, true, true, false];
var CAT_NAMES = ["High Card","Pair","Two Pair","Three of a Kind","Straight",
                 "Flush","Full House","Four of a Kind","Straight Flush"];

/* ---------- rng (seedable, so tests are deterministic) ---------- */
function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
var defaultRng = Math.random;

/* ---------- cards ---------- */
function newDeck() {
  var d = [];
  for (var s = 0; s < 4; s++) for (var r = 2; r <= 14; r++) d.push({ r: r, s: s });
  return d;
}
function cardId(c) { return c.r * 4 + c.s; }
function cardStr(c) { return RANKS[c.r - 2] + SUITS[c.s]; }
function cardText(c) { return RANKS[c.r - 2] + SUIT_LETTER[c.s]; }
function cardsText(cs) { return cs.map(cardText).join(" "); }
function shuffle(a, rng) {
  rng = rng || defaultRng;
  for (var i = a.length - 1; i > 0; i--) {
    var j = (rng() * (i + 1)) | 0;
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* ---------- hand evaluation ----------
   Returns a comparable array: [category, tiebreak...]. Higher is better. */
function straightHigh(ranks) {
  var seen = new Array(15);
  for (var i = 0; i < ranks.length; i++) seen[ranks[i]] = true;
  var run = 0;
  for (var v = 14; v >= 2; v--) {
    if (seen[v]) { run++; if (run === 5) return v + 4; }
    else run = 0;
  }
  if (seen[14] && seen[5] && seen[4] && seen[3] && seen[2]) return 5; // wheel
  return 0;
}

function evaluate(cards) {
  var cnt = new Array(15).fill(0);
  var suitRanks = [[], [], [], []];
  var i, c;
  for (i = 0; i < cards.length; i++) {
    c = cards[i];
    cnt[c.r]++;
    suitRanks[c.s].push(c.r);
  }
  var flushSuit = -1;
  for (var s = 0; s < 4; s++) if (suitRanks[s].length >= 5) flushSuit = s;

  if (flushSuit >= 0) {
    var sfHigh = straightHigh(suitRanks[flushSuit]);
    if (sfHigh) return [8, sfHigh];
  }

  var quads = [], trips = [], pairs = [];
  for (var r = 14; r >= 2; r--) {
    if (cnt[r] === 4) quads.push(r);
    else if (cnt[r] === 3) trips.push(r);
    else if (cnt[r] === 2) pairs.push(r);
  }
  // kickers are always the highest *remaining* ranks, regardless of how many
  // copies of them are present.
  function kickers(exclude, n) {
    var out = [];
    for (var k = 14; k >= 2 && out.length < n; k--)
      if (cnt[k] && exclude.indexOf(k) < 0) out.push(k);
    return out;
  }

  if (quads.length) return [7, quads[0]].concat(kickers([quads[0]], 1));
  if (trips.length && (trips.length > 1 || pairs.length)) {
    var pairPart = trips.length > 1 ? Math.max(trips[1], pairs.length ? pairs[0] : 0)
                                    : pairs[0];
    return [6, trips[0], pairPart];
  }
  if (flushSuit >= 0)
    return [5].concat(suitRanks[flushSuit].slice().sort(function (a, b) { return b - a; }).slice(0, 5));
  var sh = straightHigh(cards.map(function (x) { return x.r; }));
  if (sh) return [4, sh];
  if (trips.length) return [3, trips[0]].concat(kickers([trips[0]], 2));
  if (pairs.length >= 2) return [2, pairs[0], pairs[1]].concat(kickers([pairs[0], pairs[1]], 1));
  if (pairs.length === 1) return [1, pairs[0]].concat(kickers([pairs[0]], 3));
  var all = [];
  for (var q = 14; q >= 2 && all.length < 5; q--) if (cnt[q]) all.push(q);
  return [0].concat(all.slice(0, 5));
}

function cmpEval(a, b) {
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) {
    var x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/* "Pair of Ts" means nothing to a beginner; "Pair of Tens" does. */
var RANK_WORD = ["Twos","Threes","Fours","Fives","Sixes","Sevens","Eights","Nines","Tens",
                 "Jacks","Queens","Kings","Aces"];
var RANK_ONE  = ["Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten",
                 "Jack","Queen","King","Ace"];
function rankPlural(r) { return RANK_WORD[r - 2]; }
function rankWord(r) { return RANK_ONE[r - 2]; }

function handName(e) {
  if (e[0] === 8) return e[1] === 14 ? "Royal Flush" : "Straight Flush, " + rankWord(e[1]) + " high";
  if (e[0] === 7) return "Four of a Kind, " + rankPlural(e[1]);
  if (e[0] === 6) return "Full House, " + rankPlural(e[1]) + " full of " + rankPlural(e[2]);
  if (e[0] === 5) return "Flush, " + rankWord(e[1]) + " high";
  if (e[0] === 4) return "Straight, " + rankWord(e[1]) + " high";
  if (e[0] === 3) return "Three of a Kind, " + rankPlural(e[1]);
  if (e[0] === 2) return "Two Pair, " + rankPlural(e[1]) + " and " + rankPlural(e[2]);
  if (e[0] === 1) return "Pair of " + rankPlural(e[1]);
  return rankWord(e[1]) + " High";
}
function catName(e) { return CAT_NAMES[e[0]]; }

var COMBO5 = [];
(function () {
  for (var a = 0; a < 7; a++) for (var b = a + 1; b < 7; b++) for (var c = b + 1; c < 7; c++)
    for (var d = c + 1; d < 7; d++) for (var e = d + 1; e < 7; e++) COMBO5.push([a, b, c, d, e]);
})();
function bestFive(cards) {
  if (cards.length <= 5) return cards.slice();
  var best = null, bestCombo = null;
  for (var i = 0; i < COMBO5.length; i++) {
    var idx = COMBO5[i];
    if (idx[4] >= cards.length) continue;
    var combo = [cards[idx[0]], cards[idx[1]], cards[idx[2]], cards[idx[3]], cards[idx[4]]];
    var sc = evaluate(combo);
    if (!best || cmpEval(sc, best) > 0) { best = sc; bestCombo = combo; }
  }
  return bestCombo;
}

/* ---------- preflop hand strength (169 hands, best -> worst) ---------- */
var HAND_ORDER = ("AA KK QQ JJ AKs AQs TT AKo AJs KQs 99 ATs AQo KJs 88 QJs KTs A9s AJo QTs " +
"KQo 77 JTs A8s K9s ATo A5s A7s QJo Q9s KJo 66 A6s A4s JTo J9s KTo A3s T9s QTo A2s 55 K8s " +
"Q8s J8s T8s K7s A9o 98s 44 K6s Q7s 97s A8o J7s 87s T7s K5s Q6s 33 K4s A7o 86s 76s Q5s J6s " +
"96s K3s 22 A5o T6s 65s A6o K2s Q4s 85s J5s 75s A4o Q3s 54s K9o T5s J4s 95s Q2s 64s A3o J3s " +
"74s 53s T4s A2o J2s 84s K8o 43s T3s Q9o 63s 94s T2s 52s K7o J9o T9o 73s 93s 42s 62s 32s 83s K6o " +
"T8o Q8o 92s K5o 82s J8o 98o 72s K4o T7o Q7o 87o K3o J7o K2o 97o Q6o T6o 86o 76o Q5o 96o J6o " +
"65o Q4o T5o 75o J5o Q3o 85o 54o T4o 95o Q2o J4o 64o 74o J3o 53o T3o 84o 43o J2o 94o T2o 63o " +
"52o 73o 93o 42o 83o 92o 62o 32o 82o 72o").split(/\s+/);

var HAND_RANK = {};
var HAND_CUM_PCT = {};
(function () {
  var combos = 0;
  for (var i = 0; i < HAND_ORDER.length; i++) {
    var code = HAND_ORDER[i];
    HAND_RANK[code] = i;
    combos += code.length === 2 ? 6 : code.charAt(2) === "s" ? 4 : 12;
    HAND_CUM_PCT[code] = combos / 1326;
  }
})();

function handCode(hole) {
  var a = hole[0], b = hole[1];
  var hi = Math.max(a.r, b.r), lo = Math.min(a.r, b.r);
  if (hi === lo) return RANKS[hi - 2] + RANKS[hi - 2];
  return RANKS[hi - 2] + RANKS[lo - 2] + (a.s === b.s ? "s" : "o");
}
/* Cumulative percentage of the 1,326 equally likely starting combinations.
   Hand classes are not equally likely: pairs have 6 combos, suited hands 4,
   and offsuit hands 12. */
function handPct(hole) {
  var p = HAND_CUM_PCT[handCode(hole)];
  return p === undefined ? 1 : p;
}
function codePct(code) {
  var p = HAND_CUM_PCT[code];
  return p === undefined ? 1 : p;
}

/* ---------- equity ----------
   oppRanges: array of range specs. A number is a maximum width (0.15 = top
   15%); an object {lo, hi} is a band; 1 (or {lo:0,hi:1}) means any two cards.

   Ranges are resolved into an explicit list of legal card-pairs once, then
   sampled uniformly. When several sampled holdings collide, the whole hidden
   assignment is retried so no player's range is silently narrowed by sampling
   order. Future board cards are dealt only after hidden hands are fixed. */
function bandOf(spec) {
  if (typeof spec === "number") return { lo: 0, hi: spec };
  if (!spec) return { lo: 0, hi: 1 };
  return { lo: spec.lo || 0, hi: spec.hi === undefined ? 1 : spec.hi };
}
/* Pairs of indices into `pool` whose hand code falls inside the band, packed
   as i*64+j. Returns null for "any two cards" (no filtering needed). */
function bandCombos(pool, spec, memo) {
  var b = bandOf(spec);
  if (b.lo <= 0 && b.hi >= 0.999) return null;
  var key = b.lo.toFixed(4) + ":" + b.hi.toFixed(4);
  if (memo && memo[key] !== undefined) return memo[key];
  var list = [];
  for (var i = 0; i < pool.length; i++) {
    for (var j = i + 1; j < pool.length; j++) {
      var p = handPct([pool[i], pool[j]]);
      if (p > b.lo && p <= b.hi) list.push(i * 64 + j);
    }
  }
  var out = list.length ? list : null;
  if (memo) memo[key] = out;
  return out;
}
function livePool(hole, board) {
  var dead = {};
  var all = hole.concat(board);
  for (var i = 0; i < all.length; i++) dead[cardId(all[i])] = 1;
  return newDeck().filter(function (c) { return !dead[cardId(c)]; });
}

/* A board model conditions a preflop range on what a player just did. A bettor
   is a weighted mix of the strongest current holdings and the weakest ones;
   a caller can be restricted to the strongest `boardTop` slice. */
function boardRange(base, opts) {
  opts = opts || {};
  return {
    base: base,
    boardTop: opts.boardTop,
    bluffPct: opts.bluffPct,
    valueTop: opts.valueTop,
    bluffBottom: opts.bluffBottom,
    checked: opts.checked,
    slowplayTop: opts.slowplayTop,
    slowplayPct: opts.slowplayPct,
    modelWhy: opts.modelWhy,
    isBoardModel: true
  };
}

function allPackedCombos(pool) {
  var out = [];
  for (var i = 0; i < pool.length; i++)
    for (var j = i + 1; j < pool.length; j++) out.push(i * 64 + j);
  return out;
}

function makeRangeSampler(pool, board, spec, memo) {
  if (!spec || !spec.isBoardModel) return { plain: bandCombos(pool, spec, memo) };
  var combos = bandCombos(pool, spec.base, memo) || allPackedCombos(pool);
  var scored = combos.map(function (packed) {
    var a = packed >> 6, b = packed & 63;
    return { packed: packed, score: evaluate([pool[a], pool[b]].concat(board)) };
  });
  scored.sort(function (a, b) { return cmpEval(b.score, a.score); });
  var ordered = scored.map(function (x) { return x.packed; });
  if (spec.bluffPct !== undefined && spec.bluffPct !== null) {
    var bluffPct = Math.max(0.01, Math.min(0.99, spec.bluffPct));
    // `bluffPct` is the composition of the hands that bet, not a partition of
    // the player's entire preflop range. Select a compact value slice and a
    // separate weak slice, then mix those two groups at the requested weight.
    var valueTop = Math.max(0.01, Math.min(0.95,
      spec.valueTop === undefined ? 0.28 : spec.valueTop));
    var bluffBottom = Math.max(0.01, Math.min(0.95,
      spec.bluffBottom === undefined ? valueTop * bluffPct / (1 - bluffPct) : spec.bluffBottom));
    var valueN = Math.max(1, Math.min(ordered.length - 1, Math.round(ordered.length * valueTop)));
    var bluffStart = Math.max(valueN, Math.min(ordered.length - 1,
      ordered.length - Math.round(ordered.length * bluffBottom)));
    return { groups: [
      { p: 1 - bluffPct, combos: ordered.slice(0, valueN) },
      { p: bluffPct, combos: ordered.slice(bluffStart) }
    ] };
  }
  if (spec.checked) {
    // A check is weighted toward medium and weak hands but cannot erase traps.
    // Keep a small, explicit slow-play component rather than treating every
    // checker as either completely capped or still holding an unchanged range.
    var slowTop = Math.max(0.03, Math.min(0.40,
      spec.slowplayTop === undefined ? 0.16 : spec.slowplayTop));
    var slowPct = Math.max(0.02, Math.min(0.40,
      spec.slowplayPct === undefined ? 0.12 : spec.slowplayPct));
    var slowN = Math.max(1, Math.min(ordered.length - 1, Math.round(ordered.length * slowTop)));
    return { groups: [
      { p: slowPct, combos: ordered.slice(0, slowN) },
      { p: 1 - slowPct, combos: ordered.slice(slowN) }
    ] };
  }
  var top = Math.max(0.01, Math.min(1, spec.boardTop === undefined ? 1 : spec.boardTop));
  var n = Math.max(1, Math.round(ordered.length * top));
  return { groups: [{ p: 1, combos: ordered.slice(0, n) }] };
}

/* Draw one holding from a range without looking at cards already assigned to
   other players. Callers reject the *whole deal* on a collision. Picking a
   board or another player's hand first and then choosing only from compatible
   holdings changes the distribution: cards common in a tight range become too
   likely to appear on the board. */
function sampleRange(pool, poolN, sampler, rng) {
  var a = -1, b = -1;
  if (sampler.groups) {
    var roll = rng(), acc = 0, group = sampler.groups[sampler.groups.length - 1];
    for (var gi = 0; gi < sampler.groups.length; gi++) {
      acc += sampler.groups[gi].p;
      if (roll <= acc) { group = sampler.groups[gi]; break; }
    }
    var choices = group.combos;
    if (!choices.length) return null;
    var packed = choices[(rng() * choices.length) | 0];
    return [packed >> 6, packed & 63];
  }
  var band = sampler.plain;
  if (!band) {
    a = (rng() * poolN) | 0;
    b = (rng() * (poolN - 1)) | 0;
    if (b >= a) b++;
  } else {
    if (!band.length) return null;
    var p = band[(rng() * band.length) | 0];
    a = p >> 6; b = p & 63;
  }
  return a < 0 || b < 0 ? null : [a, b];
}

function equity(hole, board, oppRanges, iters, rng) {
  rng = rng || defaultRng;
  iters = iters || 800;
  var pool = livePool(hole, board);
  var poolN = pool.length;
  var need = 5 - board.length;
  var nOpp = oppRanges.length;
  var memo = {};
  var samplers = oppRanges.map(function (r) { return makeRangeSampler(pool, board, r, memo); });

  var used = new Uint8Array(poolN);
  var runout = new Array(need);
  var oh = new Array(nOpp);
  var wins = 0, ties = 0, losses = 0, equitySum = 0, n = 0;
  var i, k, o, t;

  for (var it = 0; it < iters; it++) {
    var ok = false;
    // Range samples are independent until physical card overlap is known. On
    // overlap restart the assignment rather than silently narrowing whoever was
    // sampled later in the loop.
    for (var dealTry = 0; dealTry < 100 && !ok; dealTry++) {
      for (i = 0; i < poolN; i++) used[i] = 0;
      ok = true;
      for (o = 0; o < nOpp; o++) {
        var sampled = sampleRange(pool, poolN, samplers[o], rng);
        if (!sampled) { ok = false; break; }
        var a = sampled[0], b = sampled[1];
        if (used[a] || used[b]) { ok = false; break; }
        used[a] = 1; used[b] = 1;
        oh[o] = [pool[a], pool[b]];
      }
    }
    if (!ok) continue;

    // Only after every hidden hand is fixed do we deal the future board.
    for (k = 0; k < need; k++) {
      var idx = -1;
      for (t = 0; t < 60; t++) { idx = (rng() * poolN) | 0; if (!used[idx]) break; idx = -1; }
      if (idx < 0) { ok = false; break; }
      used[idx] = 1; runout[k] = pool[idx];
    }
    if (!ok) continue;

    var full = board.concat(runout);
    var mine = evaluate(hole.concat(full));
    var tiedWith = 0, beaten = false;
    for (o = 0; o < nOpp; o++) {
      var cmp = cmpEval(mine, evaluate(oh[o].concat(full)));
      if (cmp < 0) { beaten = true; break; }
      if (cmp === 0) tiedWith++;
    }
    if (beaten) losses++;
    else if (tiedWith) { ties++; equitySum += 1 / (tiedWith + 1); }
    else { wins++; equitySum += 1; }
    n++;
  }
  var d = n || 1;
  return { win: wins / d, tie: ties / d, lose: losses / d,
           equity: n ? equitySum / n : 0.5,
           tieEquity: n ? (equitySum - wins) / n : 0, iters: n };
}

/* Sample a random 2-card hand from `pool` inside a range band. Pass a
   precomputed `combos` list when sampling repeatedly — building it is the
   expensive part. */
function sampleFromRange(pool, band, rng, combos) {
  rng = rng || defaultRng;
  if (combos === undefined) combos = bandCombos(pool, band);
  if (!combos) {
    var a = (rng() * pool.length) | 0, b = (rng() * pool.length) | 0;
    if (a === b) b = (b + 1) % pool.length;
    return [pool[a], pool[b]];
  }
  var packed = combos[(rng() * combos.length) | 0];
  return [pool[packed >> 6], pool[packed & 63]];
}

/* Hero's equity against a *specific list* of opponent holdings, running the
   board out where cards are still to come. */
function equityVsHands(hole, board, hands, iters, rng) {
  rng = rng || defaultRng;
  if (!hands.length) return 0.5;
  var pool = livePool(hole, board);
  var poolN = pool.length;
  var need = 5 - board.length;
  var wins = 0, ties = 0, n = 0;
  for (var it = 0; it < iters; it++) {
    var vh = hands[(rng() * hands.length) | 0];
    var block = {};
    block[cardId(vh[0])] = 1; block[cardId(vh[1])] = 1;
    var runout = [];
    for (var t = 0; t < 200 && runout.length < need; t++) {
      var c = pool[(rng() * poolN) | 0];
      var id = cardId(c);
      if (block[id]) continue;
      block[id] = 1; runout.push(c);
    }
    if (runout.length < need) continue;
    var full = board.concat(runout);
    var cmp = cmpEval(evaluate(hole.concat(full)), evaluate(vh.concat(full)));
    if (cmp > 0) wins++; else if (cmp === 0) ties++;
    n++;
  }
  return n ? (wins + ties * 0.5) / n : 0.5;
}

/* Split an opponent's range by how strong each holding actually is *on this
   board* (not by preflop rank), then report hero's equity against the strong
   half and the weak half separately. This is what makes bluff-catching maths
   mean anything: a preflop-premium AK is air on 7-6-2. */
function splitRangeEquity(hole, board, band, topFraction, iters, rng, bottomFraction) {
  rng = rng || defaultRng;
  var pool = livePool(hole, board);
  var combos = bandCombos(pool, band);      // built once, sampled 300 times
  var samples = [];
  for (var i = 0; i < 300; i++) {
    var h = sampleFromRange(pool, band, rng, combos);
    if (h) samples.push({ h: h, sc: evaluate(h.concat(board)) });
  }
  if (samples.length < 16) return null;
  samples.sort(function (a, b) { return cmpEval(b.sc, a.sc); });
  var cut = Math.max(1, Math.min(samples.length - 1, Math.round(samples.length * topFraction)));
  var top = samples.slice(0, cut).map(function (x) { return x.h; });
  // The bluff slice may be narrower than all remaining hands, but it must never
  // overlap the value slice: the displayed weights are a real partition.
  var bcut = bottomFraction === undefined ? cut
           : Math.max(1, Math.min(samples.length - 1,
               samples.length - Math.round(samples.length * bottomFraction)));
  bcut = Math.max(cut, bcut);
  var bottom = samples.slice(bcut).map(function (x) { return x.h; });
  return {
    topEq: equityVsHands(hole, board, top, iters, rng),
    bottomEq: equityVsHands(hole, board, bottom, iters, rng),
    topName: top.length ? handName(evaluate(top[0].concat(board))) : null,
    bottomName: bottom.length ? handName(evaluate(bottom[bottom.length - 1].concat(board))) : null,
    n: samples.length
  };
}

/* ---------- draw / texture analysis ---------- */
function analyseHand(hole, board) {
  var all = hole.concat(board);
  var made = evaluate(all);
  var out = {
    made: made,
    madeName: handName(made),
    category: made[0],
    flushDraw: false, backdoorFlush: false, straightDraw: 0 /*0 none,1 gutshot,2 open*/,
    overcards: 0, outs: 0, usesBoardOnly: false, topPair: false, overPair: false,
    nutFlushDraw: false, drawText: []
  };
  if (board.length === 0) return out;

  // flush draws
  var suitCount = [0, 0, 0, 0], holeSuit = [0, 0, 0, 0];
  var i;
  for (i = 0; i < all.length; i++) suitCount[all[i].s]++;
  for (i = 0; i < hole.length; i++) holeSuit[hole[i].s]++;
  for (var s = 0; s < 4; s++) {
    if (suitCount[s] === 4 && holeSuit[s] >= 1 && board.length < 5) {
      out.flushDraw = true;
      var mineHi = 0;
      for (i = 0; i < hole.length; i++) if (hole[i].s === s) mineHi = Math.max(mineHi, hole[i].r);
      var boardHi = 0;
      for (i = 0; i < board.length; i++) if (board[i].s === s) boardHi = Math.max(boardHi, board[i].r);
      out.nutFlushDraw = mineHi === 14;
    }
    if (suitCount[s] === 3 && holeSuit[s] >= 1 && board.length === 3) out.backdoorFlush = true;
  }

  // straight draws: how many single cards complete a straight?
  if (board.length < 5 && made[0] < 4) {
    var have = {}, k;
    for (i = 0; i < all.length; i++) have[all[i].r] = true;
    var completing = 0;
    for (var r = 2; r <= 14; r++) {
      if (have[r]) continue;
      var test = Object.keys(have).map(Number).concat([r]);
      if (straightHigh(test)) completing++;
    }
    if (completing >= 2) out.straightDraw = 2;
    else if (completing === 1) out.straightDraw = 1;
    out.straightOuts = completing * 4;
  }

  // pair classification
  var boardRanks = board.map(function (c) { return c.r; }).sort(function (a, b) { return b - a; });
  var topBoard = boardRanks[0] || 0;
  if (hole[0].r === hole[1].r) out.overPair = hole[0].r > topBoard && made[0] === 1;
  out.topPair = made[0] === 1 && made[1] === topBoard && (hole[0].r === topBoard || hole[1].r === topBoard);
  out.overcards = hole.filter(function (c) { return c.r > topBoard; }).length;

  // is the best hand entirely on the board? (my hole cards are irrelevant)
  var boardOnly = board.length >= 5 ? evaluate(board) : null;
  out.usesBoardOnly = boardOnly ? cmpEval(made, boardOnly) === 0 : false;

  // outs estimate
  var outs = 0;
  if (out.flushDraw) outs += 9;
  if (out.straightDraw === 2) outs += out.straightOuts >= 8 ? 8 : out.straightOuts;
  else if (out.straightDraw === 1) outs += 4;
  if (out.flushDraw && out.straightDraw) outs -= 2; // overlap
  if (made[0] === 0 && out.overcards && !out.flushDraw && !out.straightDraw && board.length < 5)
    outs += out.overcards * 3;
  out.outs = Math.max(0, outs);

  var t = [];
  if (out.flushDraw) t.push(out.nutFlushDraw ? "nut flush draw" : "flush draw");
  if (out.straightDraw === 2) t.push("open-ended straight draw");
  else if (out.straightDraw === 1) t.push("gutshot");
  if (out.backdoorFlush) t.push("backdoor flush");
  if (!t.length && made[0] === 0 && out.overcards === 2) t.push("two overcards");
  out.drawText = t;
  return out;
}

/* Board texture: how connected/coordinated is it? Drives bluff and fold-equity math. */
function boardTexture(board) {
  if (!board.length) return { wet: 0, label: "—", paired: false, monotone: false, flushPossible: false, straightPossible: false, highCard: 0 };
  var ranks = board.map(function (c) { return c.r; }).sort(function (a, b) { return b - a; });
  var suits = [0, 0, 0, 0];
  board.forEach(function (c) { suits[c.s]++; });
  var maxSuit = Math.max.apply(null, suits);
  var paired = false;
  for (var i = 1; i < ranks.length; i++) if (ranks[i] === ranks[i - 1]) paired = true;
  var span = ranks[0] - ranks[ranks.length - 1];
  var connected = 0;
  for (var a = 0; a < ranks.length; a++)
    for (var b = a + 1; b < ranks.length; b++)
      if (Math.abs(ranks[a] - ranks[b]) <= 4 && ranks[a] !== ranks[b]) connected++;

  var wet = 0;
  if (maxSuit >= 3) wet += 0.35;
  else if (maxSuit === 2) wet += 0.12;
  if (connected >= 2) wet += 0.25;
  else if (connected === 1) wet += 0.1;
  if (span <= 4 && board.length >= 3) wet += 0.2;
  if (ranks[0] <= 9) wet += 0.05;      // low boards connect more ranges
  if (paired) wet -= 0.1;
  wet = Math.max(0, Math.min(1, wet));

  return {
    wet: wet,
    label: wet > 0.6 ? "very wet" : wet > 0.38 ? "wet" : wet > 0.2 ? "semi-dry" : "dry",
    paired: paired,
    monotone: maxSuit >= 3 && board.length >= 3,
    flushPossible: maxSuit >= 3,
    straightPossible: connected >= 2,
    highCard: ranks[0]
  };
}

/* ============================== GAME ============================== */
/* Structured events the UI replays with animation:
   blind | deal | action | street | showdown | pot | handEnd */

function Game(opts) {
  opts = opts || {};
  this.sb = opts.sb || 10;
  this.bb = opts.bb || 20;
  this.startStack = opts.startStack || 2000;
  this.rng = opts.rng || defaultRng;
  this.players = (opts.players || []).map(function (p, i) {
    return {
      id: i, name: p.name, isHuman: !!p.isHuman, persona: p.persona || null,
      chips: p.chips === undefined ? (opts.startStack || 2000) : p.chips,
      hole: [], folded: true, allIn: false, bet: 0, committed: 0,
      sittingOut: false, hasActed: false, raiseLocked: false,
      lastAction: null, streetActions: []
    };
  });
  this.button = opts.button === undefined ? 0 : opts.button;
  this.stage = "idle";
  this.board = [];
  this.deck = [];
  this.currentBet = 0;
  this.minRaise = this.bb;
  this.actionOn = null;
  this.events = [];
  this.handNo = 0;
  this.history = [];        // every action this hand, for the play-by-play
  this.pots = [];
  this.lastAggressor = null;
  this.handOver = true;
  this.preflopRaiser = null;
}

Game.prototype._emit = function (ev) { this.events.push(ev); return ev; };
Game.prototype.drainEvents = function () { var e = this.events; this.events = []; return e; };

Game.prototype.seated = function () { return this.players.filter(function (p) { return !p.sittingOut; }); };
Game.prototype.live = function () { return this.players.filter(function (p) { return !p.folded && !p.sittingOut; }); };
Game.prototype.canAct = function (p) { return !p.folded && !p.allIn && !p.sittingOut; };
Game.prototype.actors = function () { var g = this; return this.players.filter(function (p) { return g.canAct(p); }); };
Game.prototype.pot = function () {
  return this.players.reduce(function (t, p) { return t + p.committed; }, 0);
};
Game.prototype.toCall = function (p) { return Math.min(this.currentBet - p.bet, p.chips); };
/* Chips currently in pots this player can win after putting in `additional`.
   Contributions above that player's final commitment belong to side pots and
   must not make an all-in call look cheaper than it really is. The returned
   amount excludes the proposed additional chips themselves. */
Game.prototype.contestablePot = function (id, additional) {
  var p = this.players[id];
  if (!p) return 0;
  additional = Math.max(0, Math.min(additional || 0, p.chips));
  var finalCommit = p.committed + additional;
  return this.players.reduce(function (total, q) {
    if (q.id === id) return total + q.committed;
    return total + Math.min(q.committed, finalCommit);
  }, 0);
};

Game.prototype.nextSeated = function (from) { return this._nextSeated(from); };
Game.prototype._nextSeated = function (from) {
  var n = this.players.length, i = from;
  for (var k = 0; k < n; k++) {
    i = (i + 1) % n;
    if (!this.players[i].sittingOut) return i;
  }
  return from;
};

/* Position label relative to the button, counting only seated players. */
Game.prototype.positionOf = function (id) {
  var n = this.seated().length;
  var order = [], cur = this.button;      // order[0] is always the button seat
  for (var k = 0; k < n; k++) { order.push(cur); cur = this._nextSeated(cur); }
  var rel = order.indexOf(id);
  if (rel < 0) return "—";
  if (n === 2) return rel === 0 ? "Button (SB)" : "Big Blind";
  if (rel === 0) return "Button";
  if (rel === 1) return "Small Blind";
  if (rel === 2) return "Big Blind";
  if (rel === n - 1) return "Cutoff";
  if (rel === 3) return "Under the Gun";
  return "Middle Position";
};
Game.prototype.isLatePosition = function (id) {
  var pos = this.positionOf(id);
  return pos === "Button" || pos === "Cutoff" || pos === "Button (SB)";
};
/* How many players still get to act after this one, this street. */
Game.prototype.playersBehind = function (id) {
  var order = this._streetOrder();
  var i = order.indexOf(id);
  if (i < 0) return 0;
  return order.length - 1 - i;
};
Game.prototype._streetOrder = function () {
  var n = this.seated().length;   // seats, not players — see the dealing loop
  var start = this.stage === "preflop"
    ? this._nextSeated(this._nextSeated(this._nextSeated(this.button)))  // UTG
    : this._nextSeated(this.button);
  if (this.seated().length === 2)
    start = this.stage === "preflop" ? this.button : this._nextSeated(this.button);
  var out = [], cur = start;
  for (var k = 0; k < n; k++) {
    var p = this.players[cur];
    if (!p.sittingOut && !p.folded && !p.allIn) out.push(cur);
    cur = this._nextSeated(cur);
  }
  return out;
};

Game.prototype.startHand = function () {
  var self = this;
  this.handNo++;
  this.events = [];
  this.history = [];
  this.board = [];
  this.pots = [];
  this.stage = "preflop";
  this.handOver = false;
  this.lastAggressor = null;
  this.preflopRaiser = null;

  this.players.forEach(function (p) {
    p.sittingOut = p.chips <= 0;
    p.hole = []; p.folded = p.sittingOut; p.allIn = false;
    p.bet = 0; p.committed = 0; p.hasActed = false; p.raiseLocked = false;
    p.lastAction = null; p.streetActions = [];
    p.wentToShowdown = false; p.investedThisHand = 0;
  });
  var seated = this.seated();
  if (seated.length < 2) { this.stage = "idle"; this.handOver = true; this._emit({ type: "needPlayers" }); return this; }

  while (this.players[this.button].sittingOut) this.button = this._nextSeated(this.button);

  this.deck = shuffle(newDeck(), this.rng);
  this.currentBet = 0;
  this.minRaise = this.bb;

  var headsUp = seated.length === 2;
  var sbIdx = headsUp ? this.button : this._nextSeated(this.button);
  var bbIdx = this._nextSeated(sbIdx);

  // Deal first, starting left of the button. Loop over the number of *seated*
  // players, not the number of seats: _nextSeated skips anyone sitting out, so
  // looping players.length times deals a second card to the first seated player
  // for every empty seat.
  var start = this._nextSeated(this.button);
  var nSeated = seated.length;
  for (var round = 0; round < 2; round++) {
    var cur = start;
    for (var k = 0; k < nSeated; k++) {
      var p = this.players[cur];
      if (!p.sittingOut) p.hole.push(this.deck.pop());
      cur = this._nextSeated(cur);
    }
  }
  this._emit({ type: "deal", button: this.button, handNo: this.handNo,
               sb: sbIdx, bb: bbIdx, headsUp: headsUp });

  this._post(this.players[sbIdx], this.sb, "small blind");
  this._post(this.players[bbIdx], this.bb, "big blind");
  this.currentBet = this.bb;
  this.minRaise = this.bb;

  // blinds have "posted" but have not acted
  this.players.forEach(function (p) { p.hasActed = false; });
  this.actionOn = headsUp ? this.button : this._nextSeated(bbIdx);
  if (!this.canAct(this.players[this.actionOn])) this._settleIfNoActors();
  return this;
};

Game.prototype._post = function (p, amt, label) {
  amt = Math.min(amt, p.chips);
  p.chips -= amt; p.bet += amt; p.committed += amt; p.investedThisHand = (p.investedThisHand || 0) + amt;
  if (p.chips === 0) p.allIn = true;
  p.folded = false;
  this._emit({ type: "blind", player: p.id, name: p.name, amount: amt, label: label,
               allIn: p.allIn, pot: this.pot() });
  this.history.push({ street: "preflop", player: p.name, playerId: p.id,
                      action: "post " + label, amount: amt, pot: this.pot() });
  return amt;
};

Game.prototype.legal = function (id) {
  var p = this.players[id];
  if (!p || this.actionOn !== id || this.handOver) return null;
  var toCall = this.toCall(p);
  var maxTo = p.bet + p.chips;
  var minTo = Math.min(Math.max(this.currentBet + this.minRaise, this.bb), maxTo);
  return {
    toCall: toCall,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    canFold: true,
    canRaise: !p.raiseLocked && maxTo > this.currentBet,
    minRaiseTo: minTo,
    maxRaiseTo: maxTo,
    isAllInRaise: minTo >= maxTo,
    pot: this.pot(),
    contestablePot: this.contestablePot(id, toCall),
    currentBet: this.currentBet,
    verb: this.currentBet > 0 && toCall > 0 ? "raise" : (this.currentBet > 0 ? "raise" : "bet")
  };
};

/* Apply an action. action: "fold" | "check" | "call" | "raise" (with raiseTo).
   Advances the game to the next decision point, emitting events along the way. */
Game.prototype.act = function (id, action, raiseTo) {
  var p = this.players[id];
  if (this.handOver) throw new Error("hand is over");
  if (this.actionOn !== id) throw new Error("not " + (p ? p.name : id) + "'s turn");
  var toCall = this.toCall(p);
  var label, amount = 0, potBeforeAction = this.pot();

  if (action === "fold") {
    if (toCall === 0) { action = "check"; }   // never fold for free
    else { p.folded = true; label = "FOLD"; }
  }
  if (action === "check") {
    if (toCall > 0) throw new Error("cannot check facing a bet of " + toCall);
    label = "CHECK";
  } else if (action === "call") {
    if (toCall === 0) { action = "check"; label = "CHECK"; }
    else {
      amount = this._put(p, toCall);
      label = p.allIn ? "CALL " + amount + " (ALL-IN)" : "CALL " + amount;
    }
  } else if (action === "raise") {
    var lg = this.legal(id);
    if (!lg.canRaise) throw new Error("raising is not allowed here");
    var target = Math.min(raiseTo, lg.maxRaiseTo);
    if (target < lg.minRaiseTo && target < lg.maxRaiseTo)
      throw new Error("raise to " + target + " is below the minimum of " + lg.minRaiseTo);
    if (target <= this.currentBet && target < lg.maxRaiseTo)
      throw new Error("raise must exceed the current bet");
    var prevBet = this.currentBet;
    var isFullRaise = (target - prevBet) >= this.minRaise;
    amount = this._put(p, target - p.bet);
    var isBet = prevBet === 0;
    label = (isBet ? "BET " : "RAISE TO ") + target + (p.allIn ? " (ALL-IN)" : "");
    if (isFullRaise) this.minRaise = target - prevBet;
    this.currentBet = Math.max(this.currentBet, target);
    this.lastAggressor = p.id;
    if (this.stage === "preflop") this.preflopRaiser = p.id;

    // re-open the action
    var self = this;
    this.players.forEach(function (q) {
      if (q.id === p.id || !self.canAct(q)) return;
      q.hasActed = false;
      // an under-sized all-in does NOT give already-matched players a new raise right
      q.raiseLocked = !isFullRaise && q.bet >= prevBet && q.bet > 0 ? true : false;
    });
  } else if (action !== "fold") {
    throw new Error("unknown action " + action);
  }

  p.hasActed = true;
  p.lastAction = { action: action, label: label, amount: amount, street: this.stage,
                   potBefore: potBeforeAction, potAfter: this.pot() };
  p.streetActions.push(p.lastAction);
  this._emit({
    type: "action", player: p.id, name: p.name, action: action, label: label,
    amount: amount, totalBet: p.bet, chips: p.chips, allIn: p.allIn,
    street: this.stage, pot: this.pot(), toCallWas: toCall
  });
  this.history.push({
    street: this.stage, player: p.name, playerId: p.id, action: action, label: label,
    amount: amount, potBefore: potBeforeAction, pot: this.pot(), board: this.board.map(cardText).join(" ")
  });

  this._advance();
  return this;
};

Game.prototype._put = function (p, amt) {
  amt = Math.max(0, Math.min(amt, p.chips));
  p.chips -= amt; p.bet += amt; p.committed += amt;
  p.investedThisHand = (p.investedThisHand || 0) + amt;
  if (p.chips === 0) p.allIn = true;
  return amt;
};

Game.prototype._betRoundClosed = function () {
  var self = this;
  var pending = this.players.filter(function (p) {
    return self.canAct(p) && (!p.hasActed || p.bet < self.currentBet);
  });
  return pending.length === 0;
};

Game.prototype._advance = function () {
  var self = this;
  if (this.live().length === 1) return this._endUncontested();

  if (!this._betRoundClosed()) {
    // find next player who still owes an action, in seat order after actionOn
    var n = this.players.length, cur = this.actionOn;
    for (var k = 0; k < n; k++) {
      cur = this._nextSeated(cur);
      var q = this.players[cur];
      if (self.canAct(q) && (!q.hasActed || q.bet < self.currentBet)) {
        this.actionOn = cur;
        this._emit({ type: "turn", player: cur, name: q.name, street: this.stage });
        return;
      }
    }
  }
  this._settleIfNoActors();
};

Game.prototype._settleIfNoActors = function () {
  // street is complete
  this.actionOn = null;
  var self = this;
  var live = this.live();
  if (live.length === 1) return this._endUncontested();

  // If at most one player can still bet, there is nothing left to decide:
  // run the remaining board out and go to showdown.
  var canStillBet = live.filter(function (p) { return !p.allIn; });
  var allSquare = live.every(function (p) { return p.allIn || p.bet === self.currentBet; });
  if (canStillBet.length <= 1 && allSquare) {
    this._emit({ type: "runout" });
    while (this.board.length < 5) this._dealStreet();
    return this._showdown();
  }

  if (this.stage === "river") return this._showdown();
  this._dealStreet();
  this._resetStreet();
  var order = this._streetOrder();
  if (!order.length) return this._settleIfNoActors();
  this.actionOn = order[0];
  this._emit({ type: "turn", player: this.actionOn, name: this.players[this.actionOn].name, street: this.stage });
};

Game.prototype._dealStreet = function () {
  var next = { preflop: "flop", flop: "turn", turn: "river" }[this.stage];
  if (!next) return;
  var count = next === "flop" ? 3 : 1;
  var dealt = [];
  this.deck.pop(); // burn
  for (var i = 0; i < count; i++) { var c = this.deck.pop(); this.board.push(c); dealt.push(c); }
  this.stage = next;
  this._emit({ type: "street", street: next, cards: dealt, board: this.board.slice(), pot: this.pot() });
  this.history.push({ street: next, player: null, action: "deal",
                      label: next.toUpperCase() + ": " + cardsText(this.board), pot: this.pot() });
};

Game.prototype._resetStreet = function () {
  this.players.forEach(function (p) {
    p.bet = 0; p.hasActed = false; p.raiseLocked = false;
    p.lastAction = null; p.streetActions = [];
  });
  this.currentBet = 0;
  this.minRaise = this.bb;
  this.lastAggressor = null;
};

/* Build side pots from committed amounts. */
Game.prototype._buildPots = function () {
  var levels = [];
  this.players.forEach(function (p) { if (p.committed > 0 && levels.indexOf(p.committed) < 0) levels.push(p.committed); });
  levels.sort(function (a, b) { return a - b; });
  var pots = [], prev = 0;
  var self = this;
  levels.forEach(function (lvl) {
    var amount = 0, eligible = [];
    self.players.forEach(function (p) {
      amount += Math.max(0, Math.min(p.committed, lvl) - prev);
      if (p.committed >= lvl && !p.folded && !p.sittingOut) eligible.push(p.id);
    });
    if (amount > 0) pots.push({ amount: amount, eligible: eligible });
    prev = lvl;
  });
  // merge consecutive pots with identical eligibility
  var merged = [];
  pots.forEach(function (pt) {
    var last = merged[merged.length - 1];
    if (last && last.eligible.join(",") === pt.eligible.join(",")) last.amount += pt.amount;
    else merged.push(pt);
  });
  return merged;
};

Game.prototype._showdown = function () {
  this.stage = "showdown";
  this.handOver = true;
  var self = this;
  var live = this.live();
  live.forEach(function (p) { p.wentToShowdown = live.length > 1; });
  var scores = {};
  live.forEach(function (p) { scores[p.id] = evaluate(p.hole.concat(self.board)); });

  var showdownList = live.map(function (p) {
    return { player: p.id, name: p.name, hole: p.hole.slice(),
             ev: scores[p.id], handName: handName(scores[p.id]),
             best: bestFive(p.hole.concat(self.board)) };
  }).sort(function (a, b) { return cmpEval(b.ev, a.ev); });
  if (live.length > 1) this._emit({ type: "showdown", players: showdownList, board: this.board.slice() });

  var pots = this._buildPots();
  this.pots = pots;
  var awards = [];
  pots.forEach(function (pt, pi) {
    var elig = pt.eligible.filter(function (id) { return scores[id]; });
    if (!elig.length) { // everyone eligible folded — refund to the last contributor
      elig = pt.eligible;
    }
    var best = null;
    elig.forEach(function (id) { if (!best || cmpEval(scores[id], best) > 0) best = scores[id]; });
    var winners = elig.filter(function (id) { return cmpEval(scores[id], best) === 0; });
    var share = Math.floor(pt.amount / winners.length);
    var rem = pt.amount - share * winners.length;
    winners.forEach(function (id, wi) {
      var amt = share + (wi === 0 ? rem : 0);
      self.players[id].chips += amt;
      awards.push({ player: id, name: self.players[id].name, amount: amt,
                    potIndex: pi, potName: pi === 0 ? "Main pot" : "Side pot " + pi,
                    handName: handName(scores[id]),
                    best: bestFive(self.players[id].hole.concat(self.board)) });
    });
    self._emit({ type: "pot", potIndex: pi, potName: pi === 0 ? "Main pot" : "Side pot " + pi,
                 amount: pt.amount, winners: winners.map(function (id) { return self.players[id].name; }),
                 winnerIds: winners, handName: handName(best) });
  });
  this.awards = awards;
  this._emit({ type: "handEnd", uncontested: false, awards: awards, board: this.board.slice() });
  return this;
};

Game.prototype._endUncontested = function () {
  this.handOver = true;
  this.actionOn = null;
  var winner = this.live()[0];
  var amount = this.pot();
  winner.chips += amount;
  this.awards = [{ player: winner.id, name: winner.name, amount: amount,
                   potIndex: 0, potName: "Pot", handName: null, uncontested: true }];
  this._emit({ type: "pot", potIndex: 0, potName: "Pot", amount: amount,
               winners: [winner.name], winnerIds: [winner.id], uncontested: true });
  this._emit({ type: "handEnd", uncontested: true, awards: this.awards, board: this.board.slice() });
  return this;
};

/* Human-readable play-by-play, used for the coach and for the Claude chat. */
Game.prototype.playByPlay = function (opts) {
  opts = opts || {};
  var self = this;
  var lines = [];
  var seated = this.seated();
  lines.push("Game: No-Limit Texas Hold'em, blinds " + this.sb + "/" + this.bb +
             ", " + seated.length + " players.");
  lines.push("Stacks at the start of this hand: " + this.players.map(function (p) {
    return p.name + " " + (p.chips + (p.investedThisHand || 0));
  }).join(", ") + ".");
  lines.push("Dealer button: " + this.players[this.button].name + ".");
  var hero = this.players.filter(function (p) { return p.isHuman; })[0];
  if (hero) {
    lines.push("Hero is " + hero.name + " in " + this.positionOf(hero.id) +
               " holding " + cardsText(hero.hole) + ".");
  }
  var street = null;
  this.history.forEach(function (h) {
    if (h.action === "deal") { lines.push(""); lines.push(h.label); street = h.street; return; }
    if (h.street !== street && h.action !== "deal") {
      if (street === null) { lines.push(""); lines.push("PREFLOP:"); }
      street = h.street;
    }
    if (h.action.indexOf("post") === 0) lines.push("  " + h.player + " posts the " + h.action.slice(5) + " (" + h.amount + ")");
    else lines.push("  " + h.player + " " + (h.label || h.action).toLowerCase() + "   [pot " + h.pot + "]");
  });
  if (this.stage === "showdown" && this.awards) {
    lines.push("");
    lines.push("SHOWDOWN:");
    this.live().forEach(function (p) {
      lines.push("  " + p.name + " shows " + cardsText(p.hole) + " — " +
                 handName(evaluate(p.hole.concat(self.board))));
    });
    this.awards.forEach(function (a) {
      lines.push("  " + a.name + " wins " + a.amount + " (" + a.potName + ")");
    });
  } else if (this.handOver && this.awards) {
    lines.push("");
    lines.push("  " + this.awards[0].name + " wins " + this.awards[0].amount + " uncontested.");
  } else if (this.actionOn !== null) {
    var a = this.players[this.actionOn];
    lines.push("");
    lines.push("It is " + a.name + "'s turn to act (" + this.positionOf(a.id) + ").");
    var lg = this.legal(this.actionOn);
    if (lg) lines.push("  Pot " + lg.pot + ", to call " + lg.toCall + ", stack " + a.chips + ".");
  }
  return lines.join("\n");
};

return {
  RANKS: RANKS, SUITS: SUITS, SUIT_RED: SUIT_RED, SUIT_LETTER: SUIT_LETTER,
  CAT_NAMES: CAT_NAMES, HAND_ORDER: HAND_ORDER,
  newDeck: newDeck, shuffle: shuffle, cardStr: cardStr, cardText: cardText,
  cardsText: cardsText, cardId: cardId,
  evaluate: evaluate, cmpEval: cmpEval, handName: handName, catName: catName,
  bestFive: bestFive, straightHigh: straightHigh,
  handCode: handCode, handPct: handPct, codePct: codePct, boardRange: boardRange,
  rankWord: rankWord, rankPlural: rankPlural,
  equity: equity, analyseHand: analyseHand, boardTexture: boardTexture,
  sampleFromRange: sampleFromRange, equityVsHands: equityVsHands,
  splitRangeEquity: splitRangeEquity,
  mulberry32: mulberry32, Game: Game
};
})();
if (typeof module === "object" && module.exports) module.exports = Poker;
