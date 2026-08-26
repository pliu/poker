/* coach.js — the coaching brain. Pure functions over a Poker.Game.
   Produces a recommendation plus the arithmetic behind it, including
   two-sided bluff analysis:
     * bluff   — should *you* bluff here, and does the EV work?
     * vsBluff — how often is the bettor bluffing, and can you call? */
var Coach = (function (P, R, X) {
"use strict";

/* Compatibility names keep the public Coach API stable while the actual range
   and opponent-behaviour implementations live in their own modules. */
var actionBelongsTo = R.actionBelongsTo;
var estimateRange = R.estimateRange;
var opponentRanges = R.opponentRanges;
var explainRange = R.explainRange;
var baseRangeSummary = R.baseRangeSummary;
var estimateBluffFrequency = R.estimateBluffFrequency;
var bettingSlices = R.bettingSlices;
var conditionRange = R.conditionRange;
var lastAggressiveAction = R.lastAggressiveAction;
var foldEquity = X.foldEquity;
var estimateInduceFrequency = X.estimateInduceFrequency;

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function pct(x) { return Math.round(x * 100) + "%"; }
function chips(x) { var v = Math.abs(Math.round(x)); return v + (v === 1 ? " chip" : " chips"); }
function pct1(x) { return (x * 100).toFixed(1) + "%"; }

/* Percentages are abstract. "About 1 time in 3" is not. */
function timesIn(x) {
  var n = Math.round(x * 100);
  if (n <= 0) return "basically never";
  if (n >= 100) return "every single time";
  if (n >= 90) return "almost always";
  if (n >= 66) return "about 2 times in 3";
  if (n >= 47 && n <= 53) return "about half the time";
  if (n >= 30 && n <= 36) return "about 1 time in 3";
  if (n >= 23 && n <= 27) return "about 1 time in 4";
  if (n >= 18 && n <= 22) return "about 1 time in 5";
  if (n <= 10) return "about 1 time in 10";
  return "about " + n + " times in 100";
}
function oddsPhrase(x) {
  var w = timesIn(x);
  // don't say "63% of the time (about 63 times in 100)"
  return /times in 100/.test(w) ? pct(x) + " of the time" : pct(x) + " of the time (" + w + ")";
}

/* Plain words for how good a starting hand is, instead of "top 43%". */
function strengthWord(hp) {
  if (hp <= 0.02) return "one of the very best hands in poker";
  if (hp <= 0.06) return "a premium hand";
  if (hp <= 0.13) return "a strong hand";
  if (hp <= 0.25) return "a decent hand";
  if (hp <= 0.45) return "a marginal hand";
  if (hp <= 0.72) return "a weak hand";
  if (hp <= 0.95) return "close to junk";
  return "just about the worst hand you can be dealt";
}
function betterThan(hp) {
  var b = Math.round((1 - hp) * 100);
  if (b >= 99) return "better than 99% of starting hands";
  if (b <= 2) return "worse than almost every other starting hand";
  // Being middle-of-the-pack sounds fine and isn't: say so.
  if (hp > 0.45) return "only better than " + b + "% of starting hands";
  return "better than " + b + "% of starting hands";
}
function handPhrase(code, hp) { return code + " is " + strengthWord(hp) + " — " + betterThan(hp); }

/* Bet size as a fraction of the pot, in words people use at the table. */
function sizeWord(frac) {
  if (frac >= 1.35) return "a big overbet";
  if (frac >= 0.95) return "a pot-sized bet";
  if (frac >= 0.7) return "about three-quarters of the pot";
  if (frac >= 0.55) return "about two-thirds of the pot";
  if (frac >= 0.42) return "about half the pot";
  if (frac >= 0.28) return "about a third of the pot";
  return "a small bet";
}

/* ---------------------------------------------------------- hand history */
function preflopRaiseCount(g) {
  var n = 0, found = false;
  (g.history || []).forEach(function (h) {
    if (h.street === "preflop" && h.action === "raise") { n++; found = true; }
  });
  if (!found && g.stage === "preflop") {
    g.players.forEach(function (p) {
      (p.streetActions || []).forEach(function (a) {
        if ((!a.street || a.street === "preflop") && a.action === "raise") n++;
      });
    });
  }
  return n;
}
/* ---------------------------------------------------------------- provenance */
/* Every number the coach shows is either a simulation or an estimate, and the
   two deserve very different amounts of trust. This packages up "where did that
   come from" so the UI can show it rather than asking you to take it on faith. */
function simProvenance(eqRes, ranges, board, iters, hole) {
  var n = eqRes.iters || iters;
  var p = eqRes.equity;
  var margin = n ? 1.96 * Math.sqrt(Math.max(p * (1 - p), 0.0001) / n) : 0;
  return {
    kind: "simulation",
    deals: n,
    won: Math.round(eqRes.win * n),
    tied: Math.round(eqRes.tie * n),
    lost: Math.round(eqRes.lose * n),
    tieEquity: eqRes.tieEquity || 0,
    equity: eqRes.equity,
    margin: margin,
    cardsToCome: 5 - board.length,
    ranges: ranges.map(function (r) {
      var base = r && r.isBoardModel ? r.base : r;
      var explained = explainRange(r, hole, board);
      return { name: base.name, hi: base.hi,
               why: base.why + (r && r.modelWhy ? ", " + r.modelWhy : ""),
               source: explained.source, confidence: explained.confidence,
               observedHands: explained.observedHands,
               classCount: explained.classCount, comboCount: explained.comboCount,
               strongest: explained.strongest, looseEdge: explained.looseEdge,
               representative: explained.representative,
               notation: explained.notation, boardExamples: explained.boardExamples,
               boardModel: !!(r && r.isBoardModel),
               bluffPct: r && r.isBoardModel ? r.bluffPct : undefined,
               valueTop: r && r.isBoardModel ? r.valueTop : undefined,
               bluffBottom: r && r.isBoardModel ? r.bluffBottom : undefined,
               checked: r && r.isBoardModel ? r.checked : undefined,
               slowplayTop: r && r.isBoardModel ? r.slowplayTop : undefined,
               slowplayPct: r && r.isBoardModel ? r.slowplayPct : undefined,
               boardTop: r && r.isBoardModel ? r.boardTop : undefined };
    })
  };
}

/* ---------------------------------------------------------------- blockers */
/* Do hero's cards remove combos from villain's value range? */
function blockers(hole, board) {
  var notes = [];
  var suitCount = [0, 0, 0, 0];
  board.forEach(function (c) { suitCount[c.s]++; });
  var flushSuit = -1;
  for (var s = 0; s < 4; s++) if (suitCount[s] >= 3) flushSuit = s;
  var suitName = ["spades", "hearts", "diamonds", "clubs"];
  if (flushSuit >= 0) {
    hole.forEach(function (c) {
      if (c.s === flushSuit && c.r === 14)
        notes.push("Useful detail: you are holding the ace of " + suitName[c.s] + ". Since it is in your hand, nobody else can have the best possible flush — so a bet from you tells a story they cannot argue with.");
      else if (c.s === flushSuit && c.r >= 12)
        notes.push("You hold the " + P.RANKS[c.r - 2] + " of " + suitName[c.s] + ", which takes some of the biggest flushes out of their hands.");
    });
  }
  var bRanks = board.map(function (c) { return c.r; });
  var top = Math.max.apply(null, bRanks.concat([0]));
  hole.forEach(function (c) {
    if (c.r === top)
      notes.push("You are holding one of the " + P.RANKS[c.r - 2] + "s, the highest card on the board — so there are fewer of them left for them to have paired with.");
  });
  var a = P.analyseHand(hole, board);
  if (a.straightDraw && board.length >= 4)
    notes.push("Your cards also take a few of their possible straights off the table.");
  return notes;
}

/* Range conditioning and behavioural fold estimates are provided by
   RangeModel and ExploitModel through the compatibility names above. */
/* ---------------------------------------------------------------- sizing */
function roundChips(x, bb) { var step = Math.max(1, Math.round(bb / 2)); return Math.round(x / step) * step; }
function betTarget(g, heroId, fracOfPot) {
  var lg = g.legal(heroId);
  if (!lg) return 0;
  var pot = lg.contestablePot === undefined ? lg.pot : lg.contestablePot;
  var target = lg.currentBet + Math.round((pot + lg.toCall) * fracOfPot);
  if (lg.currentBet === 0) target = Math.round(pot * fracOfPot);
  target = roundChips(target, g.bb);
  return clamp(target, lg.minRaiseTo, lg.maxRaiseTo);
}

/* A slow-play size: small enough to look like a stab, distinct from the
   full value bet. Returns 0 if a smaller raise isn't actually available. */
function smallBetTarget(g, heroId, valueTo) {
  var lg = g.legal(heroId);
  if (!lg || !lg.canRaise) return 0;
  var hero = g.players[heroId];
  var frac = lg.toCall > 0 ? 0.28 : 0.32;
  var to = betTarget(g, heroId, frac);
  var gap = Math.max(g.bb * 2, Math.round(valueTo * 0.18));
  if (to >= valueTo - gap) to = lg.minRaiseTo;
  to = clamp(to, lg.minRaiseTo, lg.maxRaiseTo);
  if (to >= valueTo - gap) return 0;
  if (to <= hero.bet) return 0;
  return to;
}

function eqVsContinuing(hero, board, ranges, nOpp, continueFrac, iters, rng, eq) {
  continueFrac = clamp(continueFrac, 0.05, 0.95);
  if (nOpp === 1) {
    var sp = P.splitRangeEquity(hero.hole, board, ranges[0], continueFrac,
                                Math.round(iters * 0.35), rng);
    return sp ? sp.topEq : clamp(eq * 0.85, 0, 1);
  }
  return clamp(eq * (0.72 + 0.22 * continueFrac), 0, 1);
}

/* Chip EV of betting `cost` into `pot`: they fold `foldEq` of the time, and
   when they don't your win rate is `eqContinue` against the hands that stay. */
function evValueBet(pot, cost, foldEq, eqContinue, callerCost) {
  cost = Math.max(0, cost);
  callerCost = callerCost === undefined ? cost : Math.max(0, callerCost);
  if (cost <= 0) return eqContinue * pot;
  return foldEq * pot + (1 - foldEq) * (eqContinue * (pot + cost + callerCost) - cost);
}
function evCallShowdown(pot, cost, eq) {
  return eq * (pot + cost) - cost;
}

/* Opponents who still get a chance to bet this street if hero checks.
   Street order, not seat order: someone who already checked to you is behind
   you around the table but is not still to act. */
function opponentsStillToAct(g, heroId) {
  var order = g._streetOrder();
  var i = order.indexOf(heroId);
  var out = [];
  if (i < 0) return out;
  for (var k = i + 1; k < order.length; k++) {
    var p = g.players[order[k]];
    if (p && !p.folded && !p.sittingOut && !p.allIn) out.push(p);
  }
  return out;
}
/* Future betting-frequency estimates come from ExploitModel. */
/* Multi-street trap EV. Compares betting/raising for value *now* against
   checking/calling and letting them put the next bet in. One street of
   lookahead, not a full tree — and it says so. Returns null if there is no
   value-vs-trap choice (can't raise, nobody left who can bet, etc.). */
function trapEV(g, heroId, ctx) {
  ctx = ctx || {};
  var hero = g.players[heroId];
  var lg = g.legal(heroId);
  if (!lg) return null;
  var pot = lg.contestablePot === undefined ? lg.pot : lg.contestablePot, toCall = lg.toCall;
  var ranges = ctx.ranges || [];
  var nOpp = ranges.length;
  if (!nOpp) return null;
  // A side pot needs separate eligibility/equity accounting. Do not pretend an
  // all-in player can fold or compare trap lines against the whole main pot.
  if (ranges.some(function (r) { return r.canFold === false; })) return null;
  var canValue = lg.canRaise;
  if (!canValue) return null;
  var texture = ctx.texture;
  var eq = ctx.eq;
  var stats = ctx.stats;
  var rng = ctx.rng;
  var iters = ctx.iters || 900;
  var cardsToCome = 5 - g.board.length;
  var behind = opponentsStillToAct(g, heroId);
  var lastToAct = behind.length === 0;
  var liveOpp = g.live().filter(function (p) {
    return p.id !== heroId && !p.allIn && p.chips > 0;
  });
  if (!liveOpp.length) return null;

  var valueTo = ctx.valueTo || betTarget(g, heroId, 0.65);
  valueTo = clamp(valueTo, lg.minRaiseTo, lg.maxRaiseTo);
  var valueCost = Math.max(0, valueTo - hero.bet);
  if (valueCost <= 0) return null;

  var feVal = foldEquity(g, heroId, valueCost, pot, ranges, texture, stats, toCall > 0);
  var eqWhenCalled = ctx.eqWhenCalled;
  if (eqWhenCalled === undefined || eqWhenCalled === null) {
    var continueFrac = clamp(1 - feVal.all, 0.05, 0.95);
    if (nOpp === 1) {
      var spCall = P.splitRangeEquity(hero.hole, g.board, ranges[0], continueFrac,
                                      Math.round(iters * 0.4), rng);
      eqWhenCalled = spCall ? spCall.topEq : clamp(eq * 0.85, 0, 1);
    } else {
      eqWhenCalled = clamp(eq * 0.85, 0, 1);
    }
  }
  var valueCallerCost = Math.max(0, valueTo - lg.currentBet);
  var evBet = evValueBet(pot, valueCost, feVal.all, eqWhenCalled, valueCallerCost);

  var when, induceOpps;
  if (toCall > 0) {
    when = cardsToCome > 0 ? "next street" : "never";
    induceOpps = when === "never" ? [] : liveOpp;
  } else if (!lastToAct) {
    when = "this street";
    induceOpps = behind;
  } else if (cardsToCome > 0) {
    when = "next street";
    induceOpps = liveOpp;
  } else {
    when = "never";
    induceOpps = [];
  }

  var eachP = induceOpps.map(function (p) {
    return estimateInduceFrequency(g, p.id, texture, stats, {
      lookWeak: true,
      nextStreet: when === "next street",
      barrel: toCall > 0
    });
  });
  var pInd = 0;
  if (eachP.length) {
    var none = 1;
    eachP.forEach(function (p) { none *= (1 - p); });
    pInd = 1 - none;
  }

  var maxOpp = 0, maxOppTo = 0;
  liveOpp.forEach(function (p) {
    if (p.chips > maxOpp) maxOpp = p.chips;
    if (p.bet + p.chips > maxOppTo) maxOppTo = p.bet + p.chips;
  });
  var potAfterCall = pot + toCall;
  var potForInduce = toCall > 0 ? potAfterCall : pot;
  var theirBet = roundChips(Math.max(g.bb, potForInduce * 0.62), g.bb);
  var heroLeft = Math.max(0, hero.chips - (toCall > 0 ? toCall : 0));
  theirBet = clamp(theirBet, 0, Math.min(maxOpp, heroLeft));

  var eqInd = eq;
  var bluffPct = 0.28;
  var vs = ctx.vsBluff;
  if (vs && toCall > 0) {
    eqInd = vs.decisionEquity;
    bluffPct = vs.bluffPct;
  } else if (nOpp === 1 && theirBet > 0 && pInd > 0.02) {
    var vId = (induceOpps[0] && induceOpps[0].id !== undefined) ? induceOpps[0].id : ranges[0].id;
    bluffPct = estimateBluffFrequency(g, vId, theirBet, Math.max(1, potForInduce), texture, stats,
                                      { nextStreet: when === "next street" });
    var indStage = g.stage;
    if (when === "next street") indStage = g.stage === "flop" ? "turn" : "river";
    var indSlices = bettingSlices(indStage, bluffPct, theirBet / Math.max(1, potForInduce));
    var spInd = P.splitRangeEquity(hero.hole, g.board, ranges[0], indSlices.valueTop,
                                   Math.round(iters * 0.4), rng, indSlices.bluffBottom);
    if (spInd) eqInd = bluffPct * spInd.bottomEq + (1 - bluffPct) * spInd.topEq;
    else eqInd = clamp(eq * 0.92, 0, 1);
  } else {
    eqInd = clamp(eq * (nOpp > 1 ? 0.88 : 0.92), 0, 1);
    if (nOpp === 1 && liveOpp[0])
      bluffPct = estimateBluffFrequency(g, liveOpp[0].id, Math.max(g.bb, theirBet || pot * 0.62),
                                        Math.max(1, potForInduce), texture, stats,
                                        { nextStreet: when === "next street" });
  }

  var freeCardCost = 0;
  if (cardsToCome > 0) {
    var wet = clamp(texture.wet, 0.08, 1);
    freeCardCost = (1 - eq) * pot * wet * (cardsToCome === 2 ? 0.42 : 0.28);
    if (nOpp > 1) freeCardCost *= 1 + 0.45 * (nOpp - 1);
  }

  var decisionEq = (vs && vs.decisionEquity !== undefined) ? vs.decisionEquity : eq;
  var evShowdown = toCall > 0 ? evCallShowdown(pot, toCall, decisionEq) : eq * pot;
  var canInduce = pInd >= 0.08 && theirBet > 0 && when !== "never";
  var evTrap, evVsBet = null, evNoBet = null;

  if (!canInduce) {
    evTrap = evShowdown;
  } else {
    if (toCall > 0) {
      evVsBet = eqInd * (pot + toCall + 2 * theirBet) - theirBet - toCall;
    } else {
      evVsBet = eqInd * (pot + 2 * theirBet) - theirBet;
    }
    if (toCall > 0) {
      if (cardsToCome > 0) {
        var bUs = roundChips(Math.max(g.bb, potAfterCall * 0.65), g.bb);
        bUs = clamp(bUs, 0, Math.min(heroLeft, maxOpp));
        var feUs = foldEquity(g, heroId, bUs, potAfterCall, ranges, texture, stats, false);
        evNoBet = evValueBet(potAfterCall, bUs, feUs.all, eqWhenCalled) - toCall;
      } else {
        evNoBet = evShowdown;
      }
    } else if (cardsToCome > 0) {
      var bUs2 = roundChips(Math.max(g.bb, pot * 0.65), g.bb);
      bUs2 = clamp(bUs2, 0, Math.min(hero.chips, maxOpp));
      var feUs2 = foldEquity(g, heroId, bUs2, pot, ranges, texture, stats, false);
      evNoBet = evValueBet(pot, bUs2, feUs2.all, eqWhenCalled);
    } else {
      evNoBet = eq * pot;
    }
    evTrap = pInd * evVsBet + (1 - pInd) * evNoBet;
    if (toCall === 0 && lastToAct && cardsToCome > 0) evTrap -= freeCardCost;
    else if (cardsToCome > 0) evTrap -= (1 - pInd) * freeCardCost;
  }

  if (!isFinite(evBet) || !isFinite(evTrap)) return null;

  /* ---- Small bet/raise: keep worse hands, still look weak enough to raise */
  var smallTo = ctx.smallTo !== undefined ? ctx.smallTo : smallBetTarget(g, heroId, valueTo);
  var evSmall = null, smallCost = 0, feSmall = 0, eqSmallCont = eq, pRaiseSmall = 0;
  if (smallTo > 0) {
    smallCost = Math.max(0, smallTo - hero.bet);
    var feS = foldEquity(g, heroId, smallCost, pot, ranges, texture, stats, toCall > 0);
    feSmall = feS.all;
    eqSmallCont = eqVsContinuing(hero, g.board, ranges, nOpp, 1 - feSmall, iters, rng, eq);
    var pFoldS = feSmall;
    var pContS = 1 - pFoldS;
    var raiseEach = liveOpp.map(function (p) {
      return estimateInduceFrequency(g, p.id, texture, stats, {
        lookWeak: true, vsSmallBet: true, alreadyChecked: lastToAct && toCall === 0
      });
    });
    var noneR = 1;
    raiseEach.forEach(function (p) { noneR *= (1 - p); });
    pRaiseSmall = Math.min(1 - noneR, pContS * 0.85);
    if (maxOppTo <= smallTo) pRaiseSmall = 0;
    var extra = roundChips(Math.max(g.bb * 2, (pot + smallTo) * 0.55), g.bb);
    var T = smallTo + extra;
    var maxT = Math.min(hero.bet + hero.chips, maxOppTo);
    if (maxT <= smallTo) { T = smallTo; pRaiseSmall = 0; }
    else T = clamp(T, Math.min(smallTo + g.bb, maxT), maxT);
    var pCallS = Math.max(0, pContS - pRaiseSmall);
    var smallCallerCost = Math.max(0, smallTo - lg.currentBet);
    var evCallS = eqSmallCont * (pot + smallCost + smallCallerCost) - smallCost;
    var heroFinalCost = Math.max(0, T - hero.bet);
    var oppFinalCost = Math.max(0, T - lg.currentBet);
    var evRaiseS = eqInd * (pot + heroFinalCost + oppFinalCost) - heroFinalCost;
    evSmall = pFoldS * pot + pCallS * evCallS + pRaiseSmall * evRaiseS;
    if (!isFinite(evSmall)) evSmall = null;
  }

  var trapAction = toCall > 0 ? "call" : "check";
  var valueWord = toCall > 0 ? "raising to " + valueTo : "betting " + valueTo;
  var smallWord = smallTo > 0
    ? (toCall > 0 ? "raising small, to " + smallTo : "betting small, " + smallTo)
    : "";
  var trapWord = toCall > 0 ? "just calling" : "checking";

  var lines = [
    { key: "value", ev: evBet, action: "raise", raiseTo: valueTo, label: toCall > 0 ? "raise" : "bet" }
  ];
  if (evSmall !== null) {
    lines.push({ key: "small", ev: evSmall, action: "raise", raiseTo: smallTo,
                 label: toCall > 0 ? "raise small" : "bet small" });
  }
  lines.push({ key: "passive", ev: evTrap, action: trapAction, raiseTo: 0,
               label: trapAction === "call" ? "call" : "check" });

  var tau = Math.max(10, pot * 0.08, valueCost * 0.2);
  var margin = Math.max(2, pot * 0.015);
  var best = lines[0];
  lines.forEach(function (l) { if (l.ev > best.ev) best = l; });
  // not enough of an edge to leave the teaching default (bet for value)
  if (best.key !== "value" && evBet >= best.ev - margin) best = lines[0];

  var peak = lines[0].ev;
  lines.forEach(function (l) { if (l.ev > peak) peak = l.ev; });
  var weights = lines.map(function (l) { return Math.exp((l.ev - peak) / tau); });
  var wsum = 0;
  weights.forEach(function (w) { wsum += w; });
  var mixed = lines.map(function (l, i) {
    return { key: l.key, action: l.action, raiseTo: l.raiseTo, ev: l.ev,
             freq: weights[i] / wsum, label: l.label };
  });
  if (!canInduce) {
    mixed.forEach(function (m) { if (m.key === "passive") m.freq = 0; });
    var rest = 0;
    mixed.forEach(function (m) { rest += m.freq; });
    if (rest > 0) mixed.forEach(function (m) { m.freq = m.freq / rest; });
  }
  var alts = mixed.filter(function (m) { return m.key !== best.key && m.freq >= 0.12; });
  alts.sort(function (a, b) { return b.freq - a.freq; });
  var showMix = alts.length > 0;
  var topAlt = alts[0] || null;

  var preferTrap = best.key === "passive" && canInduce;
  var preferSmall = best.key === "small";

  var names = (induceOpps.length ? induceOpps : liveOpp).map(function (p) { return p.name; });
  var who = names.length === 1 ? names[0]
          : names.length === 2 ? names[0] + " and " + names[1]
          : "someone still in";

  var text;
  if (!canInduce && !preferSmall) {
    text = lastToAct && cardsToCome === 0
      ? "Nobody left who can bet, so " + trapWord + " just takes this to the end — you only win the " +
        pot + " already in the middle, and you give up the extra they would pay if they called a bet."
      : "They will not bet often enough after you show weakness for a check to pay.";
  } else if (preferSmall) {
    text = (toCall > 0 ? "Raising small, to " : "Betting small, ") + smallTo +
      " — about a third of the pot. That looks like a stab, not a monster: they fold only " +
      pct(feSmall) + " of the time, so worse hands stay, and they raise it " +
      oddsPhrase(pRaiseSmall) + ". Against the hands that just call you win " + pct(eqSmallCont) +
      "; against a raise you still win " + pct(eqInd) + ".";
  } else if (when === "this street") {
    text = "If you check, " + who + " still has to act. A check looks like weakness, so they bet " +
      oddsPhrase(pInd) + " — about " + theirBet + " into " + pot + ". Your win rate against the hands " +
      "they'd bet is " + pct(eqInd) + ".";
  } else {
    text = "If you " + (toCall > 0 ? "just call" : "check") + " now, the next card comes and " + who +
      " will bet " + oddsPhrase(pInd) + " — about " + theirBet + " more. Against the hands they'd keep " +
      "betting, you win " + pct(eqInd) + " of the time.";
  }
  text += " " + valueWord.charAt(0).toUpperCase() + valueWord.slice(1) + " is worth about " +
    chips(evBet) + " in the long run";
  if (evSmall !== null) text += "; " + smallWord + " is worth about " + chips(evSmall);
  text += "; " + trapWord + " is worth about " + chips(evTrap) + ".";
  if (freeCardCost > 4 && cardsToCome > 0 && canInduce) {
    text += " The check already takes off about " + chips(freeCardCost) + " for giving them a free card on this board.";
  }

  var mixText = "";
  if (showMix && topAlt) {
    mixText = "These lines are close. The headline is the better one; " + topAlt.label +
      " is also fine " + timesIn(topAlt.freq) +
      ". Mixing is how a small bet or a check stops meaning 'I missed.'";
  } else if (preferTrap || preferSmall) {
    mixText = "The trap is ahead by enough that " +
      (preferSmall ? (toCall > 0 ? "the small raise" : "the small bet")
                   : (toCall > 0 ? "calling" : "checking")) +
      " is the main line here, not a spice you sprinkle on.";
  }

  var source = "Unlike your win percentage, these totals are a model of the *next* round of betting, not a " +
    "simulation of every future card. The big bet is ordinary value: how often they fold that size, and your " +
    "win rate against the hands that stay. The small bet uses the same formula at a third-pot size, then adds " +
    "the extra they put in when they raise a stab (a small bet looks weak, and raising it is cheap). The check/" +
    "call line guesses how often " + who + " bets if you look weak — from how aggressive they have been, the " +
    "board, and that a check is an invitation — and subtracts a free-card cost on wet boards. Treat the totals " +
    "as a comparison, not a promise.";

  return {
    relevant: true,
    preferTrap: preferTrap,
    preferSmall: preferSmall,
    bestKey: best.key,
    canInduce: canInduce,
    when: when,
    lastToAct: lastToAct,
    pInduce: pInd,
    pRaiseSmall: pRaiseSmall,
    theirBet: theirBet,
    bluffPct: bluffPct,
    eqWhenCalled: eqWhenCalled,
    eqInduced: eqInd,
    eqSmallCont: eqSmallCont,
    evBet: evBet,
    evSmall: evSmall,
    evTrap: evTrap,
    evShowdown: evShowdown,
    freeCardCost: freeCardCost,
    valueTo: valueTo,
    valueCost: valueCost,
    smallTo: smallTo,
    smallCost: smallCost,
    foldEq: feVal.all,
    foldEqSmall: feSmall,
    trapAction: trapAction,
    valueAction: "raise",
    who: who,
    text: text,
    mixText: mixText,
    source: source,
    lines: mixed,
    mix: {
      show: showMix,
      trapFreq: (mixed.filter(function (m) { return m.key === "passive"; })[0] || { freq: 0 }).freq,
      altAction: topAlt ? topAlt.action : (preferTrap || preferSmall ? "raise" : trapAction),
      altFreq: topAlt ? topAlt.freq : 0,
      altLabel: topAlt ? topAlt.label : "",
      altRaiseTo: topAlt ? topAlt.raiseTo : 0,
      alts: alts,
      text: mixText
    }
  };
}

/* ================================================================ PREFLOP */
var POSITION_OPEN = {   // top X% you should open when the pot is unopened
  "Under the Gun": 0.13, "Middle Position": 0.19, "Cutoff": 0.28,
  "Button": 0.45, "Button (SB)": 0.45, "Small Blind": 0.36, "Big Blind": 0.55
};

/* Hands that are too weak to play for *this* pot, but can be worth a cheap
   call for the pot they win on the times they smash the flop. */
function speculativeHand(hole) {
  var hi = Math.max(hole[0].r, hole[1].r), lo = Math.min(hole[0].r, hole[1].r);
  var suited = hole[0].s === hole[1].s;
  var gap = hi - lo - 1;
  if (hi === lo && hi <= 7) {
    return {
      kind: "set", hit: 0.12, needMult: 10, needPos: false, label: "set mine",
      hitWord: "a set about 1 time in 8"
    };
  }
  if (suited && hi === 14 && lo <= 5 && lo >= 2) {
    return {
      kind: "suited-ace", hit: 0.06, needMult: 12, needPos: true, label: "speculative",
      hitWord: "the nut flush, and sometimes a straight"
    };
  }
  if (suited && hi !== lo && lo >= 4 && hi <= 12 && gap <= 1) {
    return {
      kind: "suited", hit: gap === 0 ? 0.05 : 0.035, needMult: gap === 0 ? 12 : 15,
      needPos: true, label: "speculative",
      hitWord: gap === 0
        ? "a straight or a flush (or a strong draw to one)"
        : "a disguised straight or flush"
    };
  }
  return null;
}

function speculativePosOK(g, heroId, spec) {
  if (!spec.needPos) return true;
  var pos = g.positionOf(heroId);
  return g.isLatePosition(heroId) || pos === "Cutoff" || pos === "Big Blind" || pos === "Big Blind (BB)";
}

/* Can we win enough *after* we hit to pay for all the times we miss?
   `needed` is "chips behind / call" — the usual 10:1 for a set, a bit more
   for suited connectors that hit less often. Stations pay; nits don't. */
function impliedOddsOK(g, heroId, lg, spec, opts) {
  opts = opts || {};
  var hero = g.players[heroId];
  var toCall = lg.toCall;
  if (toCall <= 0) return { ok: false, ratio: 0, needed: spec.needMult, left: 0, toCall: 0 };
  // Only players who have actually matched the raise can supply implied odds.
  // A deep blind that has not entered the pot is not a bankroll behind a short
  // raiser and must not turn a 2:1 set mine into a fictional 30:1 one.
  var payers = g.live().filter(function (p) {
    return p.id !== heroId && (p.bet >= g.currentBet || p.id === g.preflopRaiser);
  });
  var maxBehind = 0;
  payers.forEach(function (p) { if (p.chips > maxBehind) maxBehind = p.chips; });
  var left = Math.max(0, Math.min(hero.chips - toCall, maxBehind));
  var ratio = left / toCall;
  var needed = spec.needMult;
  if (payers.length >= 2) needed *= 0.82;
  if (opts.threeBet) needed *= 1.7;
  var raiser = (g.preflopRaiser !== null && g.players[g.preflopRaiser])
    ? g.players[g.preflopRaiser] : null;
  var st = (opts.stats && raiser) ? opts.stats[raiser.name] : null;
  if (st && st.hands >= 12) {
    if (st.vpip < 0.18) needed *= 1.25;
    if (st.vpip > 0.32 && st.aggression < 0.35) needed *= 0.8;
  }
  var commit = toCall / Math.max(1, hero.chips);
  return {
    ok: ratio >= needed && commit <= 0.16,
    ratio: ratio, needed: needed, left: left, toCall: toCall, hit: spec.hit
  };
}

function advisePreflop(g, heroId, opts) {
  var hero = g.players[heroId];
  var lg = g.legal(heroId);
  var code = P.handCode(hero.hole);
  var hp = P.handPct(hero.hole);
  var ranges = opts && opts.context && opts.context.ranges
    ? opts.context.ranges : opponentRanges(g, heroId, opts && opts.stats);
  var preIters = Math.max(400, Math.round(((opts && opts.iters) || 1200) * 0.5));
  var pos = g.positionOf(heroId);
  var behind = g.playersBehind(heroId);
  var openThreshold = POSITION_OPEN[pos] || 0.22;
  var raiseCount = preflopRaiseCount(g);
  var facingRaise = lg.toCall > 0 && g.currentBet > g.bb;
  /* Who are you actually up against? Once someone has raised, the hands that
     matter are the ones that have already matched the price — the raiser *and*
     every cold caller. Measuring against the raiser alone ignores the callers
     entirely and talks you into calls the arithmetic does not support; measuring
     against everyone still seated counts players who have yet to act as random
     hands, when most of them are about to fold. One number, one meaning: the
     field that has already paid to be here. */
  var contested = ranges.filter(function (r) {
    var q = g.players[r.id];
    return q.bet >= g.currentBet || q.allIn;   // all-in for less is still contesting
  });
  var decisionRanges = (facingRaise && contested.length) ? contested : ranges;
  var eqRes = decisionRanges.length
    ? P.equity(hero.hole, [], decisionRanges, preIters, opts && opts.rng)
    : { equity: 1, win: 1, tie: 0, lose: 0, iters: 0 };
  var eq = eqRes.equity;
  var prov = simProvenance(eqRes, decisionRanges, [], preIters, hero.hole);
  var nDecision = decisionRanges.length;
  var facingThreeBet = raiseCount >= 2;
  var limpers = g.players.filter(function (p) {
    return !p.folded && p.id !== heroId && p.bet === g.bb && (p.streetActions || []).length && !(p.streetActions || []).some(function (a) { return a.action === "raise"; });
  }).length;
  var decisionPot = lg.contestablePot === undefined ? lg.pot : lg.contestablePot;
  var potOdds = lg.toCall > 0 ? lg.toCall / (decisionPot + lg.toCall) : 0;

  var why = [];
  var plain = "";
  var action, raiseTo = 0, headline, cls;
  var isSteal = false, isBluff = false;

  /* The panel beside a fold shows a win percentage and a break-even price, and
     on a chart-driven fold the first is often comfortably above the second.
     Left unexplained that reads as the coach contradicting its own arithmetic. */
  function noteEquityLooksTempting() {
    if (!(potOdds > 0 && eq > potOdds + 0.02)) return;
    why.push("You may notice the panel says you win " + pct(eq) + " and only need " + pct1(potOdds) +
      " to break even. That number assumes you get to see all five cards, and you will not. " +
      (g.isLatePosition(heroId)
        ? "You would have to keep paying on every later round to collect it."
        : "You have to act before them on every later round, so they get to bet you off the hand whenever the flop misses you — and it misses roughly two times in three.") +
      " A hand this far outside your continuing range cashes in far less of that " + pct(eq) + " than it looks like it should.");
  }

  // Value tiers
  var premium = hp <= P.codePct("AKo");      // AA-TT, AK, AQs
  var playable = hp <= openThreshold;

  // Blocker/bluff candidates for 3-betting: suited aces and suited broadway
  var suited = hero.hole[0].s === hero.hole[1].s;
  var hasAce = hero.hole.some(function (c) { return c.r === 14; });
  var bluff3betCandidate = suited && (hasAce || (hp <= 0.30 && Math.abs(hero.hole[0].r - hero.hole[1].r) <= 3));
  var spec = speculativeHand(hero.hole);
  var implied = spec ? impliedOddsOK(g, heroId, lg, spec, {
    stats: opts && opts.stats, threeBet: facingThreeBet
  }) : null;

  if (!facingRaise) {
    // Unopened (or limped) pot
    var stealSpot = (pos === "Button" || pos === "Cutoff" || pos === "Small Blind" || pos === "Button (SB)") && limpers === 0;
    if (premium) {
      action = "raise"; raiseTo = betTarget(g, heroId, limpers ? 1.0 : 0.75); cls = "raise";
      headline = "RAISE to " + raiseTo;
      plain = "Raise. This is one of the best hands you can be dealt — get money in while you're ahead.";
      why.push(handPhrase(code, hp) + ". You are a long way ahead of anything the others are likely holding, so the goal is simple: get chips into the pot while that is true.");
      why.push("Raising also thins the field. Every player you knock out now is one fewer chance for someone to get lucky on you later.");
    } else if (playable) {
      action = "raise"; raiseTo = betTarget(g, heroId, limpers ? 0.9 : 0.7); cls = "raise";
      headline = "RAISE to " + raiseTo;
      plain = "Raise. This hand is good enough to play, and raising beats just calling.";
      why.push(handPhrase(code, hp) + ". From " + pos + " it is worth playing about the best " + pct(openThreshold) + " of hands, and this one makes the cut.");
      why.push("Raise rather than just call. Two reasons: sometimes everyone folds and you win right now, and when they don't, you are the one who looks strong for the rest of the hand.");
      if (behind <= 1) why.push("Only " + behind + " player" + (behind === 1 ? "" : "s") + " still to act behind you, and you will get to act after them on every later round. Acting last is a real edge — you see what they do before you commit.");
    } else if (stealSpot && hp <= openThreshold * 1.45) {
      action = "raise"; raiseTo = betTarget(g, heroId, 0.7); cls = "bluff"; isSteal = true; isBluff = true;
      headline = "RAISE to " + raiseTo + "  (steal)";
      plain = "Raise — but as a bluff. You're attacking the blinds, not betting a good hand.";
      why.push("Be clear about what this is: " + code + " is " + strengthWord(hp) + ". You are not raising because you expect to have the best hand — you are raising because nobody has shown any strength and there " + (behind === 1 ? "is only 1 player" : "are only " + behind + " players") + " left who could stop you.");
      // What you risk is what you *add*, not the raise-to total: from the small
      // blind the chips you already posted are in the pot and are not at stake again.
      var stealCost = raiseTo - hero.bet;
      why.push("The arithmetic: you put in " + stealCost + (hero.bet ? " more" : "") + " to win the " + decisionPot + " sitting there. That only has to work " +
        oddsPhrase(stealCost / (stealCost + decisionPot)) + " to be worth doing — and players in the blinds throw away far more hands than that.");
      why.push("If you never do this, the players to your left get free money every time it folds to you.");
    } else if (lg.canCheck) {
      action = "check"; cls = "check"; headline = "CHECK";
      plain = "Check. It costs you nothing to see the flop, so take it.";
      why.push(code + " is not worth raising, but you are in the big blind and nobody raised — so you can see the next three cards without paying a chip.");
      why.push("Never fold when checking is free. Folding here gives up a hand that might flop something, in exchange for absolutely nothing.");
    } else {
      action = "fold"; cls = "fold"; headline = "FOLD";
      plain = "Fold. This hand isn't good enough from where you're sitting.";
      why.push(handPhrase(code, hp) + ". From " + pos + " you want roughly your best " + pct(openThreshold) + " of hands, and this is outside that.");
      why.push("Folding feels like doing nothing, but it is the single most common winning move in poker. You will throw away most hands you are dealt — that patience is exactly what pays for the big pots when they come.");
      noteEquityLooksTempting();
    }
  } else {
    // Facing a raise
    var valueCandidate;
    if (raiseCount <= 1) {
      valueCandidate = hp <= P.codePct("AKo");
    } else if (raiseCount === 2) {
      valueCandidate = hp <= P.codePct("QQ") || code === "AKs" || code === "AKo";
    } else {
      valueCandidate = hp <= P.codePct("KK");
    }
    var raiserId = g.preflopRaiser;
    // Against the whole field that has already paid the price, not just the
    // raiser — every extra caller takes a bite out of this number.
    var facingEq = eq;
    // How wide you can profitably continue is a function of the price you are
    // being laid and of where you will sit after the flop, not a fixed chart.
    var posMult = g.isLatePosition(heroId) ? 1.5 : pos === "Small Blind" ? 1.0 : 0.7;
    var contWidth = clamp((0.42 - potOdds * 0.75) * posMult, 0.04, 0.45);
    var realization = g.isLatePosition(heroId) ? 0.92
                    : (pos === "Big Blind" || pos === "Big Blind (BB)") ? 0.84 : 0.76;
    var threeBetValue = valueCandidate && facingEq * realization >= potOdds + 0.025;
    var callable = hp <= contWidth && facingEq * realization >= potOdds + 0.015;
    // The big blind already has money in and closes the action, so how wide you
    // defend is a function of the price, not of a fixed chart.
    var defendWidth = clamp(0.85 - potOdds * 1.5, 0.14, 0.62);
    var bbDefend = (pos === "Big Blind" || pos === "Big Blind (BB)") && hp <= defendWidth &&
      facingEq * 0.84 >= potOdds;

    var specCall = spec && implied && implied.ok && speculativePosOK(g, heroId, spec);

    if (threeBetValue && lg.canRaise) {
      action = "raise"; raiseTo = betTarget(g, heroId, facingThreeBet ? 0.8 : 1.0); cls = "raise";
      headline = (raiseCount + 2) + "-BET to " + raiseTo;
      plain = "Raise them back. Your hand is stronger than the hand they're raising with.";
      why.push(handPhrase(code, hp) + ". Even against someone who has already shown strength by raising, you are still ahead — so raise again rather than just call.");
      why.push("Re-raising also pushes everyone else out, which is what you want. Strong hands make the most money against one opponent, not four.");
    } else if (spec && spec.kind === "set" && specCall) {
      // 22–77: call for the set, not because the pair is often best. If the
      // price is wrong, fall through — 77 might still be a normal call, 22 a fold.
      action = "call"; cls = "call";
      headline = "CALL " + lg.toCall + "  (set mine)";
      plain = "Call. The pair is weak — you're paying to flop three of a kind, which they will not see coming.";
      why.push(handPhrase(code, hp) + ". You will lose most flops with this. That is not why you are calling.");
      why.push("You'll flop " + spec.hitWord + ". On those times their aces and kings pay you, because they never put you on " + code + ". You put in " + lg.toCall + ". There are " + Math.round(implied.left) + " chips still behind — " +
        (Math.round(implied.ratio * 10) / 10) + " times the call, and you want about " + Math.round(implied.needed) + " times. That is the whole plan: miss cheap, get paid expensive.");
      why.push("If they go all-in and there is nothing left behind, this plan is dead. Fold. There is no payoff left.");
      if (facingThreeBet) why.push("This is already a re-raise pot, so the price is steep. You only continue because the stacks are still deep enough that a set gets paid.");
    } else if (bluff3betCandidate && !facingThreeBet && g.isLatePosition(heroId) && hp <= 0.28 && hp > 0.09) {
      action = "raise"; raiseTo = betTarget(g, heroId, 1.0); cls = "bluff"; isBluff = true;
      headline = "3-BET to " + raiseTo + "  (bluff)";
      plain = "Re-raise as a bluff. Not because you're ahead — because it works.";
      why.push("This is a deliberate bluff. " + code + " is probably not better than the hand they raised with, but it is a good hand to bluff *with*: your cards remove some of the strong hands they could have, and if they call, this hand can still flop something worth betting again.");
      why.push("Do it here maybe one time in three, not every time. If you only ever re-raise with aces and kings, everyone learns to fold unless they have you beaten — and your good hands stop getting paid.");
    } else if (callable || bbDefend) {
      action = "call"; cls = "call";
      headline = "CALL " + lg.toCall;
      plain = "Call. The price is good enough to keep going with this hand.";
      why.push(handPhrase(code, hp) + ". Calling " + lg.toCall + " to play for a pot of " + (decisionPot + lg.toCall) + " means you only need to end up winning " + pct1(potOdds) + " of the time to make it worthwhile, and this hand clears that from " + pos + ".");
      why.push(nDecision === 1
        ? "Against the range this particular raiser has shown, the simulation gives you " + pct(facingEq) +
          " before allowing for the difficulty of realizing all of that equity after the flop."
        : "That is measured against all " + nDecision + " players who have already put the money in, not just the raiser — " +
          "the simulation gives you " + pct(facingEq) + " against the lot of them, before allowing for the difficulty " +
          "of realizing all of that equity after the flop. Every extra caller costs you a slice of it.");
      if (pos === "Small Blind") why.push("One warning about the small blind: you will have to act first on every later round, which is a real disadvantage. Raising again is often better than calling here, because it can win the pot immediately instead.");
      if (bbDefend) why.push("You are in the big blind, so your " + g.bb + " is already in the pot — you are getting a discount nobody else gets, and nobody can raise behind you. At this price it is right to keep playing roughly your best " + pct(defendWidth) + " of hands. Fold much more than that and people can raise your blind for free all night.");
      if (!g.isLatePosition(heroId)) why.push("You will be acting before them after the flop, which is awkward. Keep the pot small, and don't be afraid to give this up if they keep betting.");
    } else if (specCall) {
      action = "call"; cls = "call";
      headline = "CALL " + lg.toCall + "  (" + spec.label + ")";
      plain = "Call. This hand is weak — you're paying a little to flop something they will not expect.";
      why.push(handPhrase(code, hp) + ". Against a raise this is not a hand you play because it is often best. You play it because when it hits big — " + spec.hitWord + " — they never put you on it, and they pay with their obvious pairs and aces.");
      why.push("You put in " + lg.toCall + ". There are " + Math.round(implied.left) + " chips still behind (" +
        (Math.round(implied.ratio * 10) / 10) + " times the call). That is enough that the rare times you smash the flop pay for the times you miss and fold.");
      why.push("Two conditions, both true here: the flop is cheap, and you " +
        (g.isLatePosition(heroId) || pos.indexOf("Big Blind") === 0
          ? "will get to see what they do before you put more in after the flop."
          : "have enough behind that a disguised monster still gets paid.") +
        " Miss either one and this is just a weak hand. Fold it.");
    } else {
      action = "fold"; cls = "fold"; headline = "FOLD";
      plain = "Fold. Somebody raised, and this hand isn't good enough to pay for.";
      why.push(handPhrase(code, hp) + ". Somebody has already raised, which means they are holding something decent — and paying " + lg.toCall + " to find out with this hand loses money over time.");
      if (spec && implied && !implied.ok) {
        why.push("This would be a candidate to see a flop cheaply and hit something disguised — " + spec.hitWord + " — but there is not enough left behind. You would put in " + implied.toCall + " to chase " + Math.round(implied.left) + " (" + (Math.round(implied.ratio * 10) / 10) + " times). You want about " + Math.round(implied.needed) + " times.");
      } else if (spec && !speculativePosOK(g, heroId, spec)) {
        why.push("This is the kind of hand that can smash a flop they will not expect, but you will have to act first after the flop. That makes the disguised-hit plan too expensive — they bet, you guess. Fold and wait for a cheaper seat.");
      } else {
        why.push("A raise is information. Until you have a specific reason to think a player is raising light, believe them and save your chips for a better spot.");
      }
      noteEquityLooksTempting();
    }
  }

  if (action === "fold" && lg.canCheck) { action = "check"; headline = "CHECK"; cls = "check"; plain = "Check — seeing the next cards costs you nothing."; }
  if (action === "raise" && !lg.canRaise) { action = lg.canCheck ? "check" : "call"; headline = lg.canCheck ? "CHECK" : "CALL " + lg.toCall; cls = "call"; }
  if (action === "raise") raiseTo = clamp(raiseTo, lg.minRaiseTo, lg.maxRaiseTo);

  var r = {
    street: "preflop", action: action, raiseTo: raiseTo, headline: headline, cls: cls,
    plain: plain, why: why, code: code, handPct: hp, position: pos,
    openThreshold: openThreshold,
    equity: eq, decisionEq: eq, provenance: prov, ranges: ranges,
    decisionOpponents: nDecision,
    pot: decisionPot, totalPot: lg.pot, toCall: lg.toCall,
    potOddsNeeded: potOdds, isBluff: isBluff, isSteal: isSteal,
    facingRaise: facingRaise,
    spec: spec, implied: implied,
    isSpeculative: !!(action === "call" && spec && /set mine|speculative/.test(headline)),
    stats: [
      ["Your two cards", code + " — " + betterThan(hp)],
      ["Your chance of winning", nDecision
        ? pct(eq) + " against " + (nDecision === 1 ? "1 opponent" : nDecision + " opponents") +
          (facingRaise && nDecision < ranges.length ? " already in" : "")
        : "—"],
      ["Where you're sitting", pos],
      ["Players still to act after you", behind],
      ["Worth playing from here", "your best " + pct(openThreshold) + " of hands"],
      ["Chips you can win", decisionPot],
      ["Costs you to stay in", lg.toCall || "nothing"],
      ["You'd need to win", lg.toCall ? pct1(potOdds) + " of the time to break even" : "—"]
    ]
  };
  if (lg.pot !== decisionPot) r.stats.push(["Total chips committed", lg.pot + " (the excess is in a side pot you cannot win)"]);
  if (spec && implied && facingRaise) {
    r.stats.push(["Disguised hit", spec.hitWord]);
    r.stats.push(["Chips behind if you call", Math.round(implied.left)]);
    r.stats.push(["Behind / this call", (Math.round(implied.ratio * 10) / 10) + "×  (want ~" + Math.round(implied.needed) + "×)"]);
  }
  return r;
}

/* ================================================================ POSTFLOP */
function advisePostflop(g, heroId, opts) {
  var hero = g.players[heroId];
  var lg = g.legal(heroId);
  var iters = (opts && opts.iters) || 900;
  var rng = opts && opts.rng;
  var stats = opts && opts.stats;
  var ranges = opts && opts.context && opts.context.ranges
    ? opts.context.ranges : opponentRanges(g, heroId, stats);
  var nOpp = ranges.length;
  var texture = P.boardTexture(g.board);
  var a = P.analyseHand(hero.hole, g.board);
  var equityRanges = ranges.map(function (r) { return conditionRange(g, r, stats, texture, heroId); });
  var eqRes = P.equity(hero.hole, g.board, equityRanges, iters, rng);
  var eq = eqRes.equity;
  var prov = simProvenance(eqRes, equityRanges, g.board, iters, hero.hole);
  var pot = lg.contestablePot === undefined ? lg.pot : lg.contestablePot, toCall = lg.toCall;
  var potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  var oppStacks = g.live().filter(function (p) { return p.id !== heroId; })
                   .map(function (p) { return p.chips + p.bet; });
  var effStack = Math.min(hero.chips, oppStacks.length ? Math.max.apply(null, oppStacks) : hero.chips);
  var spr = pot > 0 ? effStack / pot : 0;
  var cardsToCome = 5 - g.board.length;
  var blockerNotes = blockers(hero.hole, g.board);
  var hasLockedOpponent = ranges.some(function (r) { return r.canFold === false; });

  /* ---- Should YOU bluff here? ---------------------------------------- */
  var isRaise = toCall > 0;
  // Bluff-raises should be smaller than bluff-bets: the break-even bar is
  // already higher because you are risking more to win the same pot.
  var bluffFrac = isRaise ? 0.55 : (texture.wet > 0.5 ? 0.75 : 0.6);
  var bluffSize = betTarget(g, heroId, bluffFrac);
  var bluffCost = bluffSize - hero.bet;
  var bluffCallerCost = Math.max(0, bluffSize - lg.currentBet);
  var potIfTheyFold = pot;
  var fe = foldEquity(g, heroId, bluffCost, potIfTheyFold, ranges, texture, stats, isRaise);
  var breakEven = bluffCost / (potIfTheyFold + bluffCost);

  // When they DO call, they are calling with the strong end of their range —
  // so measure equity against that slice, not against the whole range.
  var continueFrac = clamp(1 - fe.all, 0.05, 0.95);
  var split = nOpp === 1 ? P.splitRangeEquity(hero.hole, g.board, ranges[0], continueFrac,
                                              Math.round(iters * 0.55), rng) : null;
  var eqWhenCalled = split ? split.topEq : clamp(eq * 0.7, 0, 1);
  var bluffEV = evValueBet(potIfTheyFold, bluffCost, fe.all, eqWhenCalled, bluffCallerCost);
  var semiBluff = a.outs >= 6 && cardsToCome > 0;
  var bluffProfitable = false; // finalized after the call/check alternative is valued
  var bluff = {
    // this one is a model, not a simulation — say so plainly
    source: "Unlike your win percentage, this is an estimate rather than a simulation. " +
      "It starts from the price your bet would be laying them — against " +
      (isRaise ? "a raise" : "a bet") + " that size, someone playing well keeps going with about " +
      pct(fe.mdf) + " of their hands — and then adjusts for how loose this particular player has " +
      "been so far and how many hands this board is likely to have helped.",
    size: bluffSize, cost: bluffCost, foldEquity: fe.all, perOpponent: fe.each,
    mdf: fe.mdf, breakEven: breakEven, ev: bluffEV, semiBluff: semiBluff,
    outs: a.outs, blockers: blockerNotes, eqWhenCalled: eqWhenCalled,
    isRaise: isRaise,
    // Profitability is total EV, including equity when called. The pure-bluff
    // fold threshold remains useful context, but a semi-bluff can correctly be
    // profitable below it because the draw retains value on calls.
    profitable: bluffProfitable,
    relevant: eq < 0.62,
    text: ""
  };
  /* ---- Are YOU being bluffed? ---------------------------------------- */
  var vsBluff = null;
  if (toCall > 0 && g.lastAggressor !== null && g.lastAggressor !== heroId) {
    var vId = g.lastAggressor;
    var wager = lastAggressiveAction(g, vId);
    var rawBetSize = wager && wager.amount > 0 ? wager.amount : toCall;
    var bettor = g.players[vId];
    var heroFinalCommit = hero.committed + toCall;
    var bettorBefore = Math.max(0, bettor.committed - rawBetSize);
    var betSize = Math.max(1,
      Math.min(bettor.committed, heroFinalCommit) - Math.min(bettorBefore, heroFinalCommit));
    var recordedPotBefore = wager && wager.potBefore !== undefined ? wager.potBefore : pot - betSize;
    var potBefore = Math.max(1, Math.min(recordedPotBefore, pot - betSize));
    var bluffPct = estimateBluffFrequency(g, vId, betSize, potBefore, texture, stats);
    var vRange = estimateRange(g, vId, stats);
    // Split their range by strength ON THIS BOARD: the top slice is what they
    // are value-betting, the bottom slice is what they are bluffing with.
    var slices = bettingSlices(g.stage, bluffPct, betSize / potBefore);
    var sp = P.splitRangeEquity(hero.hole, g.board, vRange, slices.valueTop,
                                Math.round(iters * 0.55), rng, slices.bluffBottom);
    if (sp) {
      var eqVsValue = sp.topEq, eqVsAir = sp.bottomEq;
      var eqVsPolar = bluffPct * eqVsAir + (1 - bluffPct) * eqVsValue;
      var decisionModels = ranges.map(function (r) {
        if (r.id === vId) return P.boardRange(r, {
          bluffPct: bluffPct, valueTop: slices.valueTop, bluffBottom: slices.bluffBottom
        });
        var op = g.players[r.id];
        var calledThisStreet = op.bet >= g.currentBet && (op.streetActions || []).some(function (x) {
          return x.action === "call" && (!x.street || x.street === g.stage);
        });
        return calledThisStreet ? P.boardRange(r, { boardTop: 0.55 })
                                : conditionRange(g, r, stats, texture, heroId);
      });
      var multiDecisionEq = nOpp > 1
        ? P.equity(hero.hole, g.board, decisionModels, Math.max(300, Math.round(iters * 0.7)), rng).equity
        : eqVsPolar;
      var wagerVerb = wager && /^RAISE/.test(wager.label || "") ? "raised" : "bet";
      vsBluff = {
        villain: g.players[vId].name, bluffPct: bluffPct,
        source: "How the two halves were worked out: the app took every hand " +
          g.players[vId].name + " would plausibly still be holding (their best " +
          pct(vRange.hi) + ", because they " + vRange.why + "), ranked those hands by how " +
          "strong they are <em>on this particular board</em> rather than by how good they look " +
          "before the flop. It used the strongest " + pct(slices.valueTop) + " as value bets and a separate " +
          pct(slices.bluffBottom) + " slice from the weak end as possible bluffs, then mixed those groups at " +
          pct(bluffPct) + " bluffs. Your win rate against each group was simulated separately.",
        bluffSource: "The " + pct(bluffPct) + " is an estimate. It comes from the size of the bet " +
          "(big bets come from very good hands and very bad ones, rarely the middle), which round " +
          "of betting this is, how connected the board is, and how aggressive this player has been " +
          "so far. It is a read, not a fact.",
        eqVsValue: eqVsValue, eqVsAir: eqVsAir, eqVsPolarised: eqVsPolar,
        decisionEquity: multiDecisionEq,
        required: potOdds, mdfYouOwe: nOpp === 1 ? potBefore / (potBefore + betSize) : null,
        sizeFrac: betSize / potBefore, betSize: betSize, potBefore: potBefore,
        valueExample: sp.topName, airExample: sp.bottomName,
        profitableCall: multiDecisionEq > potOdds,
        text: g.players[vId].name + " " + wagerVerb + " " + betSize + " into a pot of " + potBefore +
              " — " + sizeWord(betSize / potBefore) + ". Bets that size are bluffs " +
              "roughly " + pct(bluffPct) + " of the time. " +
              "Against the good hands they'd bet, you win " + pct(eqVsValue) + " of the time; " +
              "against the bluffs, " + pct(eqVsAir) + ". Put those together in the right " +
              "proportion and you win " + pct(eqVsPolar) + " heads-up against that player. " +
              (nOpp > 1 ? "Including the other " + (nOpp - 1) + " player" + (nOpp === 2 ? "" : "s") +
                " still in, you win " + pct(multiDecisionEq) + ". " : "") +
              "You only need " + pct1(potOdds) + " to make calling worth it."
      };
    }
  }

  // When one opponent has bet, their *betting* range is the honest yardstick.
  var decisionEq = vsBluff ? vsBluff.decisionEquity : eq;
  var passiveAlternativeEV = toCall > 0 ? evCallShowdown(pot, toCall, decisionEq) : eq * pot;
  bluffProfitable = !hasLockedOpponent &&
    bluffEV > passiveAlternativeEV + Math.max(2, pot * 0.01);
  bluff.profitable = bluffProfitable;
  var chanceToHit = pct(clamp(a.outs * (cardsToCome === 2 ? 4 : 2) / 100, 0, 1));
  bluff.text =
    "You would be putting in " + bluffCost + " to win the " + potIfTheyFold +
    " already in the middle" + (isRaise ? " (raising to " + bluffSize + ")" : "") + ". " +
    "That has to work " + pct(breakEven) + " of the time just to break even — " +
    "and against " + (nOpp === 1 ? "this opponent" : nOpp === 2 ? "both of them" : "all " + nOpp + " of them") +
    " it works " + oddsPhrase(fe.all) + "." +
    (semiBluff ? " And when they do call, you still have " + a.outs +
      " cards that would give you the best hand — about a " + chanceToHit + " chance of getting there." : "") +
    " " + (bluff.profitable
      ? "It is also worth more than " + (toCall > 0 ? "just calling" : "checking") +
        ", so over the long run this line returns roughly " + chips(bluffEV) + "."
      : bluffEV <= passiveAlternativeEV
        ? "The bet may recover some chips, but " + (toCall > 0 ? "calling" : "checking") +
          " is worth more — about " + chips(passiveAlternativeEV) + " — so there is no reason to turn this hand into a bluff."
        : bluffEV < -5
          ? "They do not fold often enough, so over the long run this loses about " + chips(bluffEV) + " each time."
          : "They do not fold often enough to clear that bar, so at best this is break-even — and there is no reason to take the risk for nothing.");

  var madeStrong = a.category >= 2 || a.overPair;
  var nutty = a.category >= 5 || (a.category === 4 && cardsToCome === 0);
  // Top pair often earns more by keeping a bettor's bluffs in than by raising
  // them out. Put it through the same value-vs-passive EV comparison rather
  // than automatically treating "protection" as a reason to raise.
  // Playing the board is a chop, not a monster to slow-play.
  var trapCandidate = !a.usesBoardOnly && (nutty || madeStrong ||
    (a.topPair && decisionEq >= 0.60) || (toCall === 0 && eq >= 0.70));
  function valueSize() {
    var frac = nutty ? 0.8 : madeStrong ? 0.65 : 0.5;
    if (texture.wet > 0.55) frac += 0.1;
    return betTarget(g, heroId, frac);
  }

  var trap = null;
  if (trapCandidate && lg.canRaise) {
    trap = trapEV(g, heroId, {
      ranges: ranges, texture: texture, eq: eq, stats: stats, rng: rng, iters: iters,
      valueTo: valueSize(), vsBluff: vsBluff
    });
  }

  // A raw 50% against the whole range is not enough for a value bet: the hands
  // that fold are usually the weakest ones. Compare the bet with checking, and
  // require an actual edge against the range that continues.
  // Only ever consulted when the action is checked to you — betting thin for
  // value is not a choice you have while facing a bet. The simulations behind it
  // are not cheap, so don't run them when nothing can read the answer.
  var thinValueTo = 0, thinValueProfitable = false;
  if (toCall === 0) {
    thinValueTo = betTarget(g, heroId, 0.45);
    var thinValueCost = Math.max(0, thinValueTo - hero.bet);
    var thinCallerCost = Math.max(0, thinValueTo - lg.currentBet);
    var thinFE = foldEquity(g, heroId, thinValueCost, pot, ranges, texture, stats, false);
    var thinContinue = clamp(1 - thinFE.all, 0.05, 0.95);
    var thinEqCalled = eqVsContinuing(hero, g.board, ranges, nOpp, thinContinue, iters, rng, eq);
    var thinBetEV = evValueBet(pot, thinValueCost, thinFE.all, thinEqCalled, thinCallerCost);
    var checkEV = eq * pot;
    thinValueProfitable = !hasLockedOpponent && thinEqCalled > 0.50 &&
      thinBetEV > checkEV + Math.max(2, pot * 0.01);
  }

  /* ---- The recommendation -------------------------------------------- */
  var action, raiseTo = 0, headline, cls, why = [], plain = "";
  var oppWord = nOpp === 1 ? "your opponent" : "them";
  var drawWord = a.drawText.join(" and ") || (a.outs + " cards that would help you");
  var mixNote = trap && trap.mix && trap.mix.show ? trap.mix.text : "";
  var trapNow = trap && trap.preferTrap;
  var smallNow = trap && trap.preferSmall;

  function fracOf(target) { return (target - hero.bet) / Math.max(1, pot); }

  if (toCall === 0) {
    if (trapNow) {
      action = "check"; cls = "check";
      headline = "CHECK  (trap)";
      plain = "Check. You likely have the best hand — but letting them bet it is worth more than betting it yourself.";
      why.push("You have " + a.madeName + ", and against the kinds of hands " + oppWord +
        " would play this way you win " + oddsPhrase(eq) + ". You are the favourite. The usual play is to bet. Not here.");
      why.push(trap.text);
      why.push("The extra money comes from hands that would *fold* if you bet — especially bluffs — but will put chips in if you look weak. You are not hiding the hand forever: if they check it through, " +
        (cardsToCome > 0 ? "you can still bet the next card." : "you go to the end and win."));
      if (nOpp > 1) why.push("With " + nOpp + " people still in this is a thinner trap. Any one of them can wake up with something, and a free card is more dangerous. The numbers still prefer checking, but be ready to give it up if two of them start raising.");
      if (mixNote) why.push(mixNote);
    } else if (smallNow) {
      action = "raise"; raiseTo = trap.smallTo; cls = "raise";
      headline = "BET " + raiseTo + "  (small trap)";
      plain = "Bet small. You have the best hand — a small bet keeps worse hands in and still looks weak enough to raise.";
      why.push("You have " + a.madeName + ", and against the kinds of hands " + oppWord +
        " would play this way you win " + oddsPhrase(eq) + ". You are the favourite. A big bet would fold the hands you want to pay you.");
      why.push(trap.text);
      why.push("This is still a bet, so they do not see the next card for free. It is just not the obvious 'I have it' size. If they raise, you are delighted — that was the point.");
      if (mixNote) why.push(mixNote);
    } else if ((trap && trap.bestKey === "value") ||
               (!trap && eq >= 0.66 && (thinValueProfitable || hasLockedOpponent))) {
      action = "raise"; raiseTo = valueSize(); cls = "raise";
      headline = "BET " + raiseTo;
      plain = "Bet. You probably have the best hand — make them pay to see the next card.";
      why.push("You have " + a.madeName + ", and against the kinds of hands " + oppWord +
        " would play this way you win " + oddsPhrase(eq) + ". You are the favourite, so the aim is to build the pot.");
      why.push("Bet " + sizeWord(fracOf(raiseTo)) + " — " + raiseTo + " chips. That is big enough to charge anyone chasing a straight or flush, and small enough that weaker hands will still call you.");
      if (nOpp > 1) why.push("Careful though: with " + nOpp + " people still in, somebody hits the flop far more often. If two of them stay in and start raising, be ready to slow down.");
      if (trap && trap.canInduce) why.push(trap.text);
      if (mixNote) why.push(mixNote);
    } else if (semiBluff && bluff.profitable) {
      action = "raise"; raiseTo = bluffSize; cls = "bluff";
      var ahead = eq >= 0.5;
      headline = "BET " + raiseTo + (ahead ? "  (value + protection)" : "  (semi-bluff)");
      plain = ahead
        ? "Bet. You're slightly ahead and you can still improve — betting wins both ways."
        : "Bet as a bluff — but one with a safety net, because you can still improve.";
      why.push(ahead
        ? "You would win " + oddsPhrase(eq) + " if this were checked down — slightly ahead, and a lot of that comes from your " + drawWord + ". Betting does two jobs at once: it gets money in while you are ahead, and it stops them seeing the next card for free."
        : "Right now you are behind — you would only win " + oddsPhrase(eq) + " if the hand were checked to the end. But you have " + drawWord + ", so this is not a pure bluff.");
      why.push(bluff.text);
      why.push(ahead
        ? "Either way you come out ahead: they fold and you take it now, they call with something worse and you are already winning, or they call with something better and you can still hit your card. Three outcomes, and two of them are good."
        : "This is the best kind of bluff there is. You win straight away when they fold — and on the times they don't, you can still hit your card and win anyway. Two ways to win instead of one.");
    } else if (semiBluff) {
      action = "check"; cls = "check";
      headline = "CHECK  (take the free card)";
      plain = "Check. You've got a draw, but bluffing here won't get through enough people.";
      why.push("You have " + drawWord + ", which is worth something — but betting as a bluff does not pay off here.");
      why.push(bluff.text);
      why.push("With " + (nOpp === 1 ? "even one player" : nOpp + " players") + " to get through, they just don't fold often enough. So check, get to see the next card for free, and bet when you actually hit it.");
    } else if (eq >= 0.5 && thinValueProfitable) {
      action = "raise"; raiseTo = thinValueTo; cls = "raise";
      headline = "BET " + raiseTo + "  (small)";
      plain = "Bet a small amount. You're a little ahead, so take a little value.";
      why.push("You win " + oddsPhrase(eq) + " here — ahead, but not by much.");
      why.push("Bet small: " + raiseTo + ", roughly half the pot. Worse hands will still call, and you stop them seeing the next card for nothing. Keep it cheap though — you do not want a huge pot with a medium hand.");
    } else if (bluff.profitable && eq < 0.35 && nOpp === 1 && !texture.paired) {
      action = "raise"; raiseTo = bluffSize; cls = "bluff";
      headline = "BET " + raiseTo + "  (bluff)";
      plain = "Bet as a bluff. Your hand can't win by checking, so betting costs you nothing.";
      why.push("Your hand is almost worthless if this goes to the end — you'd win only " + oddsPhrase(eq) + ". That is exactly what makes it a good hand to bluff with: checking wins this pot practically never, so you are giving up nothing by betting.");
      why.push(bluff.text);
      if (blockerNotes.length) why.push(blockerNotes[0]);
      why.push("Bluff with your worst hands, not your middling ones. A hand that might win at showdown is worth more if you just check it.");
    } else {
      action = "check"; cls = "check"; headline = "CHECK";
      why.push("You'd win " + oddsPhrase(eq) + " if this went to the end — not enough to bet and expect worse hands to pay you.");
      if (!bluff.profitable) {
        plain = "Check. Not strong enough to bet, and a bluff wouldn't work either.";
        why.push("And bluffing does not work here. " + bluff.text);
        if (nOpp > 1) why.push("Remember a bluff has to get past everyone. Each extra player makes it much less likely that they all fold.");
      } else if (nOpp > 1) {
        // the maths is positive, but it is thin and it has to survive several players
        plain = "Check. A bluff is close to break-even here, and it has to get past " + nOpp + " people.";
        why.push("Bluffing is not crazy — the numbers are nearly there. " + bluff.text);
        why.push("But that edge is thin, and it assumes all " + nOpp + " of them fold. Only one of them needs a hand for the bet to be wasted, and the estimate of how often they fold is the least reliable number here. Checking gives up almost nothing; a bluff that gets called costs you " + bluffCost + ".");
      } else {
        plain = "Check. This board is a bad one to bluff on.";
        why.push("The raw numbers say a bluff is close, but the board is paired — that makes it much more likely somebody is holding three of a kind and simply cannot fold, whatever you bet. " + bluff.text);
        why.push("Save the bluff for a board where the hands you are trying to fold out are actually foldable.");
      }
    }
  } else {
    if (trapNow) {
      action = "call"; cls = "call";
      headline = "CALL " + toCall + "  (trap)";
      plain = "Call. You are ahead — but raising folds out the hands you most want to keep betting.";
      why.push("You have " + a.madeName + " and you beat " + pct(decisionEq) + " of the hands they would bet here. Raising looks like the obvious play. The numbers prefer calling.");
      why.push(trap.text);
      why.push("A raise makes their bluffs give up, and those are the hands that will keep paying you if you just call." +
        (cardsToCome > 0 ? " You can always raise the next card if they check to you." : " If they check, you go to the end ahead."));
      if (mixNote) why.push(mixNote);
    } else if (smallNow) {
      action = "raise"; raiseTo = trap.smallTo; cls = "raise";
      headline = "RAISE to " + raiseTo + "  (small trap)";
      plain = "Raise small. You are ahead — a small raise keeps their worse hands and their bluffs.";
      why.push("You have " + a.madeName + " and you beat " + pct(decisionEq) + " of the hands they would bet here. A big raise looks like the nuts and they fold. A small one looks like you might be making a move.");
      why.push(trap.text);
      why.push("If they re-raise, that is the trap working." +
        (cardsToCome > 0 ? " You can always play a bigger pot on the next card if they just call." : " If they just call, you are already getting extra from hands that would have folded a bigger raise."));
      if (mixNote) why.push(mixNote);
    } else if ((decisionEq >= 0.72 || (trap && trap.bestKey === "value")) && lg.canRaise) {
      action = "raise"; raiseTo = valueSize(); cls = "raise";
      headline = "RAISE to " + raiseTo;
      plain = "Raise. You're well ahead of what they'd bet with — charge them for it.";
      why.push("You have " + a.madeName + " and you beat " + oddsPhrase(decisionEq) + " of the hands they would bet here. Don't just call — raise.");
      why.push("They have already shown they are willing to put chips in. Calling wins you their one bet; raising can win you two or three.");
      if (vsBluff) why.push("Raising also punishes the " + pct(vsBluff.bluffPct) + " of the time they are bluffing. Those hands give up — and the ones that do call you are worse than yours anyway.");
      if (trap && trap.canInduce) why.push(trap.text);
      if (mixNote) why.push(mixNote);
    } else if (semiBluff && bluff.profitable && lg.canRaise && a.outs >= 8 && spr > 1) {
      action = "raise"; raiseTo = bluffSize; cls = "bluff";
      headline = "RAISE to " + raiseTo + "  (semi-bluff)";
      plain = "Raise as a bluff. You can still improve, so you win two different ways.";
      why.push("Calling would be fine — you have " + a.outs + " cards that would give you the best hand. But raising is better: it makes them fold everything mediocre, and if they do call, you still win " + pct(eq) + " of the time.");
      why.push(bluff.text);
    } else if (decisionEq > potOdds + 0.015) {
      action = "call"; cls = "call";
      headline = "CALL " + toCall;
      plain = "Call. You win often enough to justify the price.";
      why.push("It costs " + toCall + " to stay in a pot that would then be worth " + (pot + toCall) +
        ". So you need to win " + pct1(potOdds) + " of the time to break even — and you win " + oddsPhrase(decisionEq) + ". That makes calling profitable.");
      if (vsBluff && decisionEq < 0.55) {
        why.push("Be honest about what this call is: you are not calling because your hand is strong, you are calling because theirs often isn't. " + vsBluff.text);
        if (vsBluff.mdfYouOwe !== null)
          why.push("You have to call sometimes here — roughly " + pct(vsBluff.mdfYouOwe) + " of the hands you could have. If you fold more than that, betting at you becomes free money and they can do it with any two cards.");
      }
    } else {
      action = "fold"; cls = "fold";
      headline = "FOLD";
      plain = "Fold. The price is higher than this hand is worth.";
      why.push("It costs " + toCall + " to stay in, which means you would need to win " + pct1(potOdds) + " of the time to break even. You only win " + oddsPhrase(decisionEq) + ". Over time, calling here loses money.");
      if (vsBluff) why.push("And that already gives them credit for bluffing " + pct(vsBluff.bluffPct) + " of the time. Even then you only get to " + pct(decisionEq) + ". " + (a.outs ? "Your " + a.outs + " outs are not enough at this price." : "You have nothing to improve to."));
      if (bluff.profitable && lg.canRaise)
        why.push("There is a bolder option: raise as a bluff. " + bluff.text + " Folding is the calm, low-risk choice — but this is a spot where a raise would also make money if you have the stomach for it.");
    }
  }

  if (a.usesBoardOnly)
    why.push("Watch out: the best five cards here are all on the table, so your two cards add nothing. The very best you can do is split the pot — and anything that pairs the board beats you outright.");
  if (action === "fold" && lg.canCheck) { action = "check"; headline = "CHECK"; cls = "check"; plain = "Check — it costs you nothing to see the next card."; }
  if (action === "raise" && !lg.canRaise) { action = toCall > 0 ? "call" : "check"; headline = toCall > 0 ? "CALL " + toCall : "CHECK"; cls = "call"; }
  if (action === "raise") raiseTo = clamp(raiseTo, lg.minRaiseTo, lg.maxRaiseTo);

  var boardWords = {
    "very wet": "very connected — lots of straights and flushes possible",
    "wet": "connected — straights and flushes are live",
    "semi-dry": "fairly disconnected",
    "dry": "disconnected — misses most hands"
  }[texture.label] || texture.label;
  if (texture.paired) boardWords += ", and it's paired (someone could have three of a kind)";
  else if (texture.monotone) boardWords += ", all one suit";

  var statRows = [
    ["What you have", a.madeName + (a.drawText.length ? ", plus a " + a.drawText.join(" and a ") : "")],
    ["Your chance of winning", pct(eq) + " against " + (nOpp === 1 ? "1 opponent" : nOpp + " opponents")]
  ];
  if (vsBluff) statRows.push([
    nOpp > 1 ? "...after the bet and other callers" : "...against the hand they just bet",
    pct(vsBluff.decisionEquity)
  ]);
  if (trap && trap.relevant) {
    statRows.push([toCall ? "Raising full (long-run)" : "Betting full (long-run)", chips(trap.evBet)]);
    if (trap.evSmall !== null && trap.smallTo)
      statRows.push([toCall ? "Raising small (long-run)" : "Betting small (long-run)", chips(trap.evSmall)]);
    statRows.push([toCall ? "Calling (long-run)" : "Checking (long-run)", chips(trap.evTrap)]);
    if (trap.canInduce) statRows.push(["They bet if you look weak", oddsPhrase(trap.pInduce)]);
    if (trap.smallTo && trap.pRaiseSmall)
      statRows.push(["They raise a small bet", oddsPhrase(trap.pRaiseSmall)]);
  }
  statRows = statRows.concat([
    ["Chips you can win", pot],
    ["Costs you to stay in", toCall || "nothing"],
    ["You'd need to win", toCall ? pct1(potOdds) + " of the time to break even" : "—"],
    ["Cards that would save you", a.outs ? a.outs + " — about a " + pct(clamp(a.outs * (cardsToCome === 2 ? 4 : 2) / 100, 0, 1)) + " chance of hitting one" : "none"],
    ["The board", boardWords],
    ["Chips left behind", pot ? (Math.round(spr * 10) / 10) + "× the size of the pot" : "—"]
  ]);
  if (lg.pot !== pot)
    statRows.push(["Total chips committed", lg.pot + " (the excess is in a side pot you cannot win)"]);

  var mix = null;
  if (trap && trap.mix && trap.mix.show && trap.mix.altLabel) {
    mix = {
      show: true,
      altAction: trap.mix.altAction,
      altFreq: trap.mix.altFreq,
      altLabel: trap.mix.altLabel,
      altPhrase: "also " + trap.mix.altLabel + " " + timesIn(trap.mix.altFreq),
      altRaiseTo: trap.mix.altRaiseTo,
      alts: trap.mix.alts,
      text: trap.mix.text
    };
  }

  return {
    street: g.stage, action: action, raiseTo: raiseTo, headline: headline, cls: cls,
    plain: plain, why: why, equity: eq, decisionEq: decisionEq, pot: pot, totalPot: lg.pot, toCall: toCall,
    potOddsNeeded: potOdds, spr: spr, analysis: a, texture: texture,
    bluff: bluff, vsBluff: vsBluff, trap: trap, mix: mix,
    ranges: ranges, isBluff: cls === "bluff",
    isTrap: !!(trap && (trap.preferTrap || trap.preferSmall)),
    provenance: prov, stats: statRows
  };
}

function advise(g, heroId, opts) {
  opts = opts || {};
  if (!g || g.handOver || g.actionOn !== heroId) return null;
  var r = g.board.length === 0 ? advisePreflop(g, heroId, opts) : advisePostflop(g, heroId, opts);
  r.legal = g.legal(heroId);
  r.audit = {
    solverCertified: false,
    label: "Model-based recommendation — not solver-certified",
    simulation: r.provenance && r.provenance.deals
      ? r.provenance.deals + " sampled deals, about ±" +
        (r.provenance.margin * 100).toFixed(1) + " percentage points of sampling uncertainty"
      : "No runout simulation available",
    decisionModel: r.street === "preflop"
      ? "Preflop rules combine hand strength, position, price, stack depth and estimated opponent ranges."
      : (r.trap && r.trap.relevant
          ? "The move compares a one-street model of full betting, small betting and checking/calling."
          : "The move combines simulated showdown chances with price, fold and bluff estimates."),
    limitation: "It does not solve the complete game tree or calculate a game-theory equilibrium. More simulations reduce card-runout noise, but they do not make a wrong opponent range or behaviour assumption correct."
  };
  return r;
}

/* Did the player's actual action match the recommendation? */
function grade(rec, actual) {
  if (!rec) return null;
  var r = rec.action, a = actual;
  if (r === a) return "match";
  if (rec.mix && rec.mix.show && rec.mix.altAction === a) return "close";
  if (rec.mix && rec.mix.alts) {
    for (var i = 0; i < rec.mix.alts.length; i++) {
      if (rec.mix.alts[i].action === a && rec.mix.alts[i].freq >= 0.12) return "close";
    }
  }
  return "miss";
}

return {
  advise: advise, advisePreflop: advisePreflop, advisePostflop: advisePostflop,
  estimateRange: estimateRange, opponentRanges: opponentRanges,
  foldEquity: foldEquity, estimateBluffFrequency: estimateBluffFrequency,
  bettingSlices: bettingSlices, conditionRange: conditionRange,
  estimateInduceFrequency: estimateInduceFrequency, trapEV: trapEV,
  smallBetTarget: smallBetTarget, speculativeHand: speculativeHand, impliedOddsOK: impliedOddsOK,
  evValueBet: evValueBet, evCallShowdown: evCallShowdown,
  blockers: blockers, grade: grade, betTarget: betTarget,
  simProvenance: simProvenance, explainRange: explainRange,
  baseRangeSummary: baseRangeSummary, POSITION_OPEN: POSITION_OPEN
};
})(Poker, RangeModel, ExploitModel);
if (typeof module === "object" && module.exports) module.exports = Coach;
