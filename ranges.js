/* ranges.js — opponent hand-set inference and provenance. Pure functions over
   public game state and observed session statistics; no recommendation logic. */
var RangeModel = (function (P) {
"use strict";

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

function actionBelongsTo(g, h, id) {
  if (h.playerId !== undefined && h.playerId !== null) return h.playerId === id;
  return h.player === g.players[id].name;
}

function preflopStory(g, playerId) {
  var story = { raised: 0, calledRaise: false, limped: false, checked: false, acted: false };
  var sawRaise = false;
  (g.history || []).forEach(function (h) {
    if (h.street !== "preflop" || !h.action || h.action.indexOf("post") === 0) return;
    var mine = actionBelongsTo(g, h, playerId);
    if (h.action === "raise") {
      if (mine) { story.raised++; story.acted = true; }
      sawRaise = true;
    } else if (mine && h.action === "call") {
      story.acted = true;
      if (sawRaise) story.calledRaise = true;
      else story.limped = true;
    } else if (mine && h.action === "check") {
      story.acted = true; story.checked = true;
    } else if (mine && h.action === "fold") {
      story.acted = true;
    }
  });
  if (!story.acted && g.stage === "preflop") {
    (g.players[playerId].streetActions || []).forEach(function (a) {
      if (a.street && a.street !== "preflop") return;
      if (a.action === "raise") { story.raised++; story.acted = true; }
      else if (a.action === "call") {
        story.calledRaise = g.currentBet > g.bb;
        story.limped = !story.calledRaise; story.acted = true;
      } else if (a.action === "check") { story.checked = true; story.acted = true; }
    });
  }
  if (!story.acted && g.board.length && g.preflopRaiser === playerId) {
    story.raised = 1; story.acted = true;
  }
  return story;
}

function estimateRange(g, playerId, stats) {
  var player = g.players[playerId];
  var st = (stats && stats[player.name]) || null;
  var reliable = st && st.hands >= 12;
  var loose = reliable ? clamp(st.vpip, 0.08, 0.88) : 0.42;
  var pfr = reliable ? clamp(st.pfr, 0.025, loose) : 0.18;
  var story = preflopStory(g, playerId);
  var position = g.positionOf ? g.positionOf(playerId) : "unknown position";
  var positionFactor = position === "Button" ? 1.28
    : position === "Cutoff" ? 1.10
    : position === "Small Blind" ? 1.05
    : position === "Big Blind" ? 0.92
    : 0.82;
  var hi, why;
  if (!story.acted && g.stage === "preflop") {
    hi = 1; why = "has not acted yet";
  } else if (story.raised) {
    hi = clamp(pfr * 1.25 * (story.raised >= 2 ? 0.55 : positionFactor), 0.035, 0.55);
    why = (story.raised >= 2 ? "re-raised preflop" : "raised preflop") + " from " + position;
  } else if (story.calledRaise) {
    hi = clamp(loose * (position === "Big Blind" ? 1.18 : 0.92), 0.12, 0.88);
    why = "called a preflop raise from " + position;
  } else if (story.limped) {
    hi = clamp(loose * positionFactor, 0.12, 0.88); why = "limped preflop from " + position;
  } else if (story.checked) {
    hi = 1; why = "checked the big blind from " + position;
  } else {
    hi = clamp(loose, 0.18, 0.88); why = "has no recorded preflop action";
  }

  var observedHands = st && st.hands ? st.hands : 0;
  var source = reliable
    ? "Based on " + observedHands + " observed hands: played " + Math.round(st.vpip * 100) +
      "% before the flop and raised " + Math.round(st.pfr * 100) + "%"
    : observedHands
      ? "Only " + observedHands + " hands observed, so the coach still uses its default player assumptions"
      : "No reliable session sample yet, so the coach uses default player assumptions";
  return {
    lo: 0, hi: hi, why: why, loose: loose, pfr: pfr,
    source: source, confidence: reliable ? "limited" : "low", observedHands: observedHands,
    name: player.name, id: playerId, canFold: !player.allIn && player.chips > 0
  };
}

function opponentRanges(g, heroId, stats) {
  var out = [];
  g.players.forEach(function (p) {
    if (p.id === heroId || p.folded || p.sittingOut) return;
    out.push(estimateRange(g, p.id, stats));
  });
  return out;
}

function estimateBluffFrequency(g, playerId, betSize, potBefore, texture, stats, opts) {
  opts = opts || {};
  var player = g.players[playerId];
  var st = (stats && stats[player.name]) || null;
  // Start from the bluff share that makes a caller indifferent at this size —
  // b / (p + 2b) — so that with no history a bettor is assumed balanced, not
  // over-bluffing. Observed aggression, texture and street move it from there.
  var sizeFrac = betSize / Math.max(1, potBefore);
  var base = sizeFrac / (1 + 2 * sizeFrac);
  if (st && st.hands >= 12) base += clamp((st.aggression - 0.5) * 0.30, -0.12, 0.15);
  base += (texture.wet - 0.35) * 0.15;
  var street = g.stage;
  if (opts.nextStreet) {
    if (street === "flop") street = "turn";
    else if (street === "turn") street = "river";
  }
  if (street === "flop") base += 0.05;        // draws bet as semi-bluffs
  else if (street === "turn") base += 0.02;
  if (street === "preflop") base -= 0.08;
  if (g.live().length > 2) base -= 0.08;
  return clamp(base, 0.04, 0.60);
}

function bettingSlices(stage, bluffPct, sizeFrac) {
  var valueTop = stage === "river" ? 0.16 : stage === "turn" ? 0.22 : 0.32;
  valueTop /= 1 + Math.max(0, (sizeFrac || 0.65) - 0.6) * 0.45;
  valueTop = clamp(valueTop, 0.06, 0.42);
  var bluffBottom = valueTop * bluffPct / Math.max(0.05, 1 - bluffPct);
  return { valueTop: valueTop, bluffBottom: clamp(bluffBottom, 0.025, 0.35) };
}

function lastAggressiveAction(g, playerId) {
  var found = null;
  (g.history || []).forEach(function (h) {
    if (h.street === g.stage && h.action === "raise" && actionBelongsTo(g, h, playerId)) found = h;
  });
  if (found) {
    return {
      amount: Math.max(0, found.amount || 0),
      potBefore: found.potBefore !== undefined ? found.potBefore
               : Math.max(0, (found.pot || 0) - (found.amount || 0)),
      label: found.label || "BET"
    };
  }
  var acts = g.players[playerId].streetActions || [];
  for (var i = acts.length - 1; i >= 0; i--) {
    if (acts[i].action !== "raise") continue;
    var amount = acts[i].amount || 0;
    if (!amount && acts[i].label) {
      var nums = acts[i].label.match(/\d+/g);
      if (nums && nums.length) amount = Number(nums[nums.length - 1]);
    }
    return { amount: amount, potBefore: acts[i].potBefore, label: acts[i].label || "BET" };
  }
  return null;
}

function conditionRange(g, range, stats, texture, observerId) {
  if (!g.board.length) return range;
  var raised = false, called = false, checked = false;
  var latest = null, currentSeen = false;
  (g.history || []).forEach(function (h) {
    if (h.street === "preflop" || h.action === "deal" || !actionBelongsTo(g, h, range.id)) return;
    if (h.action !== "raise" && h.action !== "call" && h.action !== "check") return;
    latest = h;
    if (h.street === g.stage) currentSeen = true;
  });
  (g.players[range.id].streetActions || []).forEach(function (a) {
    if (a.action === "raise" || a.action === "call" || a.action === "check") {
      var onCurrentStreet = !a.street || a.street === g.stage;
      if (onCurrentStreet || !currentSeen) latest = a;
      if (onCurrentStreet) currentSeen = true;
    }
  });
  if (latest) {
    raised = latest.action === "raise";
    called = latest.action === "call";
    checked = latest.action === "check";
  }
  if (raised) {
    var wager = lastAggressiveAction(g, range.id);
    var amount = wager && wager.amount > 0 ? wager.amount : Math.max(g.bb, g.currentBet || g.pot() * 0.65);
    var before = wager && wager.potBefore !== undefined
      ? Math.max(1, wager.potBefore) : Math.max(1, g.pot() - amount);
    if (observerId !== undefined && observerId !== null && g.players[observerId]) {
      var observer = g.players[observerId], bettor = g.players[range.id];
      var extra = g.toCall(observer);
      var finalCommit = observer.committed + extra;
      var bettorBefore = Math.max(0, bettor.committed - amount);
      amount = Math.max(1, Math.min(bettor.committed, finalCommit) - Math.min(bettorBefore, finalCommit));
      var eligibleNow = g.contestablePot(observerId, extra);
      before = Math.max(1, Math.min(before, eligibleNow - amount));
    }
    var bluffPct = estimateBluffFrequency(g, range.id, amount, before, texture, stats);
    var slices = bettingSlices(g.stage, bluffPct, amount / before);
    return P.boardRange(range, {
      bluffPct: bluffPct, valueTop: slices.valueTop, bluffBottom: slices.bluffBottom,
      modelWhy: "then bet or raised postflop"
    });
  }
  if (called) return P.boardRange(range, {
    boardTop: g.stage === "river" ? 0.42 : 0.55,
    modelWhy: "then called a postflop bet"
  });
  if (checked) return P.boardRange(range, {
    checked: true,
    slowplayTop: 0.16,
    slowplayPct: clamp(0.10 + (texture.paired ? 0.05 : 0) - (texture.wet > 0.6 ? 0.03 : 0), 0.06, 0.20),
    modelWhy: "then checked " + (currentSeen ? "this street" : "on the previous street")
  });
  return range;
}

function comboWeight(code) {
  return code.length === 2 ? 6 : code.charAt(2) === "s" ? 4 : 12;
}

function baseRangeSummary(spec) {
  var base = spec && spec.isBoardModel ? spec.base : spec;
  var lo = base && base.lo ? base.lo : 0;
  var hi = base && base.hi !== undefined ? base.hi : 1;
  var codes = P.HAND_ORDER.filter(function (code) {
    var at = P.codePct(code);
    return at > lo && at <= hi;
  });
  var combos = 0;
  codes.forEach(function (code) { combos += comboWeight(code); });
  var show = Math.min(6, codes.length);
  var representative = [];
  if (codes.length) {
    var repN = Math.min(6, codes.length);
    for (var ri = 0; ri < repN; ri++) {
      var idx = repN === 1 ? 0 : Math.round(ri * (codes.length - 1) / (repN - 1));
      if (representative.indexOf(codes[idx]) < 0) representative.push(codes[idx]);
    }
  }
  return {
    classCount: codes.length, comboCount: combos,
    strongest: codes.slice(0, show),
    looseEdge: codes.length > show ? codes.slice(Math.max(show, codes.length - 6)) : [],
    representative: representative,
    notation: "s means both cards share a suit; o means they do not; a pair such as QQ has either suit pattern"
  };
}

function spacedHoldingExamples(items, limit) {
  if (!items.length) return [];
  var out = [], seen = {}, want = Math.min(limit, items.length);
  for (var i = 0; i < want; i++) {
    var at = want === 1 ? 0 : Math.round(i * (items.length - 1) / (want - 1));
    var text = items[at].code + " → " + P.handName(items[at].score);
    if (!seen[text]) { seen[text] = 1; out.push(text); }
  }
  for (var j = 0; j < items.length && out.length < want; j++) {
    var next = items[j].code + " → " + P.handName(items[j].score);
    if (!seen[next]) { seen[next] = 1; out.push(next); }
  }
  return out;
}

function boardRangeExamples(spec, hole, board) {
  if (!spec || !spec.isBoardModel || !board || !board.length) return null;
  var base = spec.base || spec, dead = {};
  (hole || []).concat(board).forEach(function (c) { dead[P.cardId(c)] = 1; });
  var pool = P.newDeck().filter(function (c) { return !dead[P.cardId(c)]; });
  var scored = [];
  for (var i = 0; i < pool.length; i++) for (var j = i + 1; j < pool.length; j++) {
    var h = [pool[i], pool[j]], at = P.handPct(h);
    if (at <= (base.lo || 0) || at > (base.hi === undefined ? 1 : base.hi)) continue;
    scored.push({ code: P.handCode(h), score: P.evaluate(h.concat(board)) });
  }
  scored.sort(function (a, b) { return P.cmpEval(b.score, a.score); });
  if (!scored.length) return null;
  var out = {};
  if (spec.bluffPct !== undefined && spec.bluffPct !== null) {
    var valueN = Math.max(1, Math.min(scored.length - 1,
      Math.round(scored.length * (spec.valueTop === undefined ? 0.28 : spec.valueTop))));
    var bluffStart = Math.max(valueN, Math.min(scored.length - 1,
      scored.length - Math.round(scored.length *
        (spec.bluffBottom === undefined ? 0.08 : spec.bluffBottom))));
    out.value = spacedHoldingExamples(scored.slice(0, valueN), 5);
    out.bluffs = spacedHoldingExamples(scored.slice(bluffStart), 5);
  } else if (spec.boardTop !== undefined) {
    var continueN = Math.max(1, Math.round(scored.length * spec.boardTop));
    out.continues = spacedHoldingExamples(scored.slice(0, continueN), 6);
  } else if (spec.checked) {
    var slowN = Math.max(1, Math.min(scored.length - 1,
      Math.round(scored.length * (spec.slowplayTop === undefined ? 0.16 : spec.slowplayTop))));
    out.slowplays = spacedHoldingExamples(scored.slice(0, slowN), 3);
    out.checks = spacedHoldingExamples(scored.slice(slowN), 6);
  }
  return out;
}

function explainRange(spec, hole, board) {
  var base = spec && spec.isBoardModel ? spec.base : spec;
  var summary = baseRangeSummary(spec);
  summary.source = base.source; summary.confidence = base.confidence;
  summary.observedHands = base.observedHands || 0;
  summary.boardExamples = boardRangeExamples(spec, hole, board);
  return summary;
}

return {
  actionBelongsTo: actionBelongsTo, preflopStory: preflopStory,
  estimateRange: estimateRange, opponentRanges: opponentRanges,
  estimateBluffFrequency: estimateBluffFrequency, bettingSlices: bettingSlices,
  lastAggressiveAction: lastAggressiveAction, conditionRange: conditionRange,
  baseRangeSummary: baseRangeSummary, explainRange: explainRange
};
})(Poker);
if (typeof module === "object" && module.exports) module.exports = RangeModel;
