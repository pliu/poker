/* bots.js — opponent AI. Each persona has a distinct, readable strategy so the
   table plays like real opponents rather than an equity calculator: chart-based
   preflop ranges, continuation betting, planned bluffs, and pot-odds calling.
   Pure: all randomness comes from the injected rng. */
var Bots = (function (P, R) {
"use strict";

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

var PERSONAS = [
  {
    key: "rock", name: "Rocky", tag: "Tight-Aggressive",
    blurb: "Plays few hands but bets them hard. When Rocky raises, believe him.",
    openPct: 0.16, callPct: 0.11, threeBetPct: 0.035,
    aggression: 0.55, bluff: 0.08, cbet: 0.65, foldToBet: 0.62,
    stationness: 0.25, sizing: 0.65
  },
  {
    key: "station", name: "Vicky", tag: "Loose-Passive",
    blurb: "Calls far too much and rarely folds. Value bet her thin; bluff her almost never.",
    openPct: 0.38, callPct: 0.55, threeBetPct: 0.02,
    aggression: 0.25, bluff: 0.05, cbet: 0.35, foldToBet: 0.25,
    stationness: 0.85, sizing: 0.45
  },
  {
    key: "lag", name: "Gus", tag: "Loose-Aggressive",
    blurb: "Raises constantly and bluffs a lot. Let him bet your good hands for you.",
    openPct: 0.45, callPct: 0.30, threeBetPct: 0.12,
    aggression: 0.9, bluff: 0.32, cbet: 0.78, foldToBet: 0.45,
    stationness: 0.35, sizing: 0.8
  },
  {
    key: "nit", name: "Nora", tag: "Nit",
    blurb: "Folds everything except monsters. Steal her blinds relentlessly.",
    openPct: 0.09, callPct: 0.07, threeBetPct: 0.02,
    aggression: 0.4, bluff: 0.03, cbet: 0.5, foldToBet: 0.75,
    stationness: 0.15, sizing: 0.55
  }
];

function newStats() {
  return { hands: 0, vpipHands: 0, pfrHands: 0, aggr: 0, passive: 0,
           showdowns: 0, showdownWins: 0, bluffsCaught: 0, won: 0,
           vpip: 0.4, pfr: 0.2, aggression: 0.5 };
}

function createTable(game, rng) {
  rng = rng || Math.random;
  var stats = {};
  game.players.forEach(function (p) { stats[p.name] = newStats(); });
  var plans = {};    // per hand, per bot: {bluffing: bool}

  function newHand() {
    plans = {};
    game.players.forEach(function (p) {
      if (p.sittingOut) return;
      stats[p.name] = stats[p.name] || newStats();
      stats[p.name].hands++;
      var pers = p.persona;
      // decided up front: is this bot running a bluff line this hand?
      plans[p.id] = { bluffing: pers ? rng() < pers.bluff * 1.6 : false };
    });
  }

  /* Stats are derived from the hand history rather than from the bots' own
     decisions, so the human's VPIP/PFR/AF are tracked on exactly the same
     footing as the opponents' — and the coach's reads stay honest. */
  function finishHand() {
    var pre = {}, aggr = {}, pass = {};
    game.history.forEach(function (h) {
      if (!h.player || h.action.indexOf("post") === 0 || h.action === "deal") return;
      if (h.action === "raise") aggr[h.player] = (aggr[h.player] || 0) + 1;
      else if (h.action === "call") pass[h.player] = (pass[h.player] || 0) + 1;
      if (h.street !== "preflop") return;
      if (h.action === "call" || h.action === "raise") {
        pre[h.player] = pre[h.player] || {};
        pre[h.player].vpip = true;
        if (h.action === "raise") pre[h.player].pfr = true;
      }
    });
    game.players.forEach(function (p) {
      var s = stats[p.name];
      if (!s || p.sittingOut) return;
      if (pre[p.name] && pre[p.name].vpip) s.vpipHands++;
      if (pre[p.name] && pre[p.name].pfr) s.pfrHands++;
      s.aggr += aggr[p.name] || 0;
      s.passive += pass[p.name] || 0;
      s.vpip = s.hands ? s.vpipHands / s.hands : 0.4;
      s.pfr = s.hands ? s.pfrHands / s.hands : 0.2;
      s.aggression = s.aggr / Math.max(1, s.aggr + s.passive);
      if (p.wentToShowdown) s.showdowns++;
    });
  }

  function sizeBet(id, frac) {
    var lg = game.legal(id);
    var pot = lg.contestablePot === undefined ? lg.pot : lg.contestablePot;
    var target = lg.currentBet === 0
      ? Math.round(pot * frac)
      : lg.currentBet + Math.round((pot + lg.toCall) * frac);
    var step = Math.max(1, Math.round(game.bb / 2));
    target = Math.round(target / step) * step;
    return clamp(target, lg.minRaiseTo, lg.maxRaiseTo);
  }

  function preflop(p, lg, pers, plan) {
    var hp = P.handPct(p.hole);
    var pos = game.positionOf(p.id);
    var late = game.isLatePosition(p.id) || pos === "Cutoff";
    var behind = game.playersBehind(p.id);
    var openWidth = pers.openPct * (late ? 1.9 : pos === "Middle Position" ? 1.15 : pos.indexOf("Blind") >= 0 ? 1.5 : 0.85);
    openWidth = clamp(openWidth, 0.05, 0.9);
    var raisedBefore = game.currentBet > game.bb;
    var pot = lg.contestablePot === undefined ? lg.pot : lg.contestablePot;
    var potOdds = lg.toCall > 0 ? lg.toCall / (pot + lg.toCall) : 0;

    if (!raisedBefore) {
      // passive players open-limp even good hands; only aggressive ones auto-raise
      if (hp <= pers.threeBetPct * 3 || (pers.aggression > 0.4 && hp <= openWidth * 0.55)) {
        return { action: "raise", raiseTo: sizeBet(p.id, 0.7 + pers.sizing * 0.3) };
      }
      if (hp <= openWidth) {
        // loose-passive players limp; aggressive players raise
        if (rng() < pers.aggression && lg.canRaise) {
          return { action: "raise", raiseTo: sizeBet(p.id, 0.6 + pers.sizing * 0.3) };
        }
        return lg.canCheck ? { action: "check" } : { action: "call" };
      }
      // blind steal from late position
      if (late && behind <= 2 && hp <= openWidth * 1.5 && rng() < pers.bluff * 2.2 && lg.canRaise) {
        return { action: "raise", raiseTo: sizeBet(p.id, 0.7) };
      }
      return lg.canCheck ? { action: "check" } : { action: "fold" };
    }

    // Facing a raise: use the raiser/callers' ranges and the actual price. A
    // fixed percentile chart cannot sensibly handle both a min-raise and a
    // 100-BB shove.
    var raiseCount = 0;
    (game.history || []).forEach(function (h) {
      if (h.street === "preflop" && h.action === "raise") raiseCount++;
    });
    if (!raiseCount) raiseCount = 1;
    var entered = [];
    game.players.forEach(function (q) {
      if (q.id === p.id || q.folded || q.sittingOut) return;
      if (q.bet >= game.currentBet || q.allIn)
        entered.push(R.estimateRange(game, q.id, stats));
    });
    var facingEq = entered.length
      ? P.equityForCall(game, p.id, entered, entered.length > 2 ? 220 : 320, rng).equity : 0.5;
    var allInCall = lg.toCall >= p.chips;
    var realization = allInCall ? 1 : late ? 0.92
                    : pos.indexOf("Big Blind") >= 0 ? 0.84 : 0.76;
    var valueWidth = raiseCount <= 1 ? pers.threeBetPct
                   : raiseCount === 2 ? Math.min(pers.threeBetPct, 0.025)
                   : Math.min(pers.threeBetPct, 0.01);
    if (hp <= valueWidth && facingEq * realization >= potOdds + 0.025 && lg.canRaise) {
      return { action: "raise", raiseTo: sizeBet(p.id, 1.0) };
    }
    if (raiseCount === 1 && plan.bluffing && late && hp <= 0.30 &&
        p.hole[0].s === p.hole[1].s && lg.canRaise &&
        lg.toCall < p.chips * 0.12 && rng() < 0.5) {
      return { action: "raise", raiseTo: sizeBet(p.id, 1.0) };   // 3-bet bluff
    }
    var depthPenalty = 1 + Math.max(0, raiseCount - 1) * 0.45;
    var priceBoost = clamp((0.32 - potOdds) * 2.0, -0.35, 0.45);
    var callWidth = pers.callPct * (late ? 1.45 : 1) * (1 + priceBoost) / depthPenalty;
    var callSlack = pers.stationness * 0.025; // personality, capped at a small EV mistake
    if (hp <= clamp(callWidth, 0.025, 0.65) &&
        facingEq * realization >= potOdds + 0.01 - callSlack) return { action: "call" };
    // stations peel cheaply
    if (lg.toCall <= game.bb * 2 && rng() < pers.stationness * 0.7 && hp <= 0.6) {
      return { action: "call" };
    }
    return lg.canCheck ? { action: "check" } : { action: "fold" };
  }

  function postflop(p, lg, pers, plan) {
    var ranges = [];
    game.players.forEach(function (q) {
      if (q.id === p.id || q.folded || q.sittingOut) return;
      ranges.push(R.estimateRange(game, q.id, stats));
    });
    if (!ranges.length) return { action: lg.canCheck ? "check" : "call" };

    var texture = P.boardTexture(game.board);
    var actionRanges = ranges.map(function (r) { return R.conditionRange(game, r, stats, texture, p.id); });
    var iters = ranges.length > 2 ? 220 : 320;
    var eq = P.equityForCall(game, p.id, actionRanges, iters, rng).equity;
    var a = P.analyseHand(p.hole, game.board);
    var pot = lg.contestablePot === undefined ? lg.pot : lg.contestablePot;
    var potOdds = lg.toCall > 0 ? lg.toCall / (pot + lg.toCall) : 0;
    var wasAggressor = game.preflopRaiser === p.id;
    var cardsToCome = 5 - game.board.length;
    var strongDraw = a.outs >= 8 && cardsToCome > 0;

    // a touch of noise so the bots are not perfectly readable
    eq = clamp(eq + (rng() - 0.5) * 0.05, 0, 1);

    if (lg.toCall === 0) {
      if (eq >= 0.72) return { action: "raise", raiseTo: sizeBet(p.id, 0.6 + pers.sizing * 0.35) };
      if (eq >= 0.55 && rng() < pers.aggression) return { action: "raise", raiseTo: sizeBet(p.id, 0.45 + pers.sizing * 0.25) };
      if (strongDraw && rng() < pers.aggression * 0.8) return { action: "raise", raiseTo: sizeBet(p.id, 0.55) };
      // continuation bet as the preflop raiser
      if (wasAggressor && game.stage === "flop" && rng() < pers.cbet * (1 - texture.wet * 0.35))
        return { action: "raise", raiseTo: sizeBet(p.id, 0.5 + pers.sizing * 0.2) };
      // planned bluff, heads-up, on a board that misses most ranges
      if (plan.bluffing && ranges.length === 1 && texture.wet < 0.5 && rng() < pers.bluff * 2)
        return { action: "raise", raiseTo: sizeBet(p.id, 0.6) };
      return { action: "check" };
    }

    // facing a bet
    if (eq >= 0.80 && lg.canRaise) return { action: "raise", raiseTo: sizeBet(p.id, 0.7 + pers.sizing * 0.4) };
    if (eq >= 0.66 && lg.canRaise && rng() < pers.aggression * 0.6) return { action: "raise", raiseTo: sizeBet(p.id, 0.7) };
    if (strongDraw && lg.canRaise && rng() < pers.aggression * 0.35 && lg.toCall < p.chips * 0.35)
      return { action: "raise", raiseTo: sizeBet(p.id, 0.65) };      // semi-bluff raise

    // The simulation already includes the chance of completing a draw. Do not
    // add those outs a second time as fake equity; personality may move a close
    // decision only a couple of points.
    var threshold = potOdds + 0.015 - pers.stationness * 0.025;
    if (eq >= threshold) {
      return { action: "call" };
    }
    // bluff-raise a missed board
    if (plan.bluffing && lg.canRaise && ranges.length === 1 && lg.toCall < p.chips * 0.2 &&
        rng() < pers.bluff * 1.2) {
      return { action: "raise", raiseTo: sizeBet(p.id, 1.0) };
    }
    if (lg.toCall <= game.bb && rng() < pers.stationness) return { action: "call" };
    return { action: "fold" };
  }

  function decide(id) {
    var p = game.players[id];
    var lg = game.legal(id);
    if (!lg) return { action: "check" };
    var pers = p.persona || PERSONAS[0];
    if (!plans[id]) plans[id] = { bluffing: rng() < pers.bluff * 1.6 };
    var plan = plans[id];
    var mv;
    try {
      mv = game.board.length === 0 ? preflop(p, lg, pers, plan) : postflop(p, lg, pers, plan);
    } catch (e) {
      mv = { action: lg.canCheck ? "check" : "fold" };
    }
    // legality guard — the engine is the referee, but never hand it an illegal move
    if (mv.action === "check" && !lg.canCheck) mv = { action: "call" };
    if (mv.action === "raise") {
      if (!lg.canRaise) mv = { action: lg.canCheck ? "check" : "call" };
      else mv.raiseTo = clamp(mv.raiseTo || lg.minRaiseTo, lg.minRaiseTo, lg.maxRaiseTo);
    }
    if (mv.action === "fold" && lg.canCheck) mv = { action: "check" };
    return mv;
  }

  return {
    decide: decide, stats: stats, newHand: newHand, finishHand: finishHand,
    plans: function () { return plans; }
  };
}

return { PERSONAS: PERSONAS, createTable: createTable, newStats: newStats };
})(Poker, RangeModel);
if (typeof module === "object" && module.exports) module.exports = Bots;
