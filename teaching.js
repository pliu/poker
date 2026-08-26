/* teaching.js — turns a computed decision into a reusable lesson. It does not
   choose an action; it explains the concrete hand story, alternatives, and the
   numerical point at which the recommendation would change. */
var TeachingModel = (function () {
"use strict";

function pct(x, digits) { return (x * 100).toFixed(digits || 0) + "%"; }
function signedChips(x) { return (x >= 0 ? "+" : "−") + Math.abs(Math.round(x)) + " chips"; }
function first(xs, n) { return (xs || []).slice(0, n); }

function rangeReads(advice) {
  var ranges = advice.provenance && advice.provenance.ranges
    ? advice.provenance.ranges : [];
  return ranges.map(function (r) {
    var parts = [];
    if (r.boardExamples && r.boardExamples.value && r.boardExamples.value.length)
      parts.push("value examples: " + first(r.boardExamples.value, 3).join(", "));
    if (r.boardExamples && r.boardExamples.bluffs && r.boardExamples.bluffs.length)
      parts.push("bluff examples: " + first(r.boardExamples.bluffs, 3).join(", "));
    if (r.boardExamples && r.boardExamples.continues && r.boardExamples.continues.length)
      parts.push("continuing examples: " + first(r.boardExamples.continues, 3).join(", "));
    if (r.boardExamples && r.boardExamples.checks && r.boardExamples.checks.length)
      parts.push("likely checks: " + first(r.boardExamples.checks, 3).join(", "));
    if (r.boardExamples && r.boardExamples.slowplays && r.boardExamples.slowplays.length)
      parts.push("possible traps: " + first(r.boardExamples.slowplays, 2).join(", "));
    if (!parts.length) {
      parts.push("representative hands: " + first(r.representative || r.strongest, 4).join(", "));
      if (r.looseEdge && r.looseEdge.length)
        parts.push("loose edge: " + first(r.looseEdge, 4).join(", "));
    }
    return {
      name: r.name,
      text: r.name + " " + r.why + ", so the model starts with the best " +
        Math.round(r.hi * 100) + "% of hands (" + parts.join("; ") + ").",
      evidence: r.source || "Default assumptions",
      confidence: r.confidence || "low"
    };
  });
}

function line(label, ev, note) {
  return { label: label, value: signedChips(ev), ev: ev, note: note || "" };
}

function postflopComparisons(advice) {
  var out = [];
  if (advice.trap && advice.trap.relevant) {
    out.push(line(advice.toCall ? "Raise full" : "Bet full", advice.trap.evBet,
      "larger value size"));
    if (advice.trap.evSmall !== null && advice.trap.smallTo)
      out.push(line(advice.toCall ? "Raise small" : "Bet small", advice.trap.evSmall,
        "keeps more worse hands and can induce a raise"));
    out.push(line(advice.toCall ? "Call" : "Check", advice.trap.evTrap,
      "lets the opponent bet later or reaches showdown"));
    return out;
  }

  if (advice.toCall > 0) {
    var callEV = advice.decisionEq * (advice.pot + advice.toCall) - advice.toCall;
    out.push(line("Fold", 0, "future result from this decision; chips already committed are sunk"));
    out.push(line("Call", callEV,
      advice.street === "river" ? "no future betting remains" : "showdown benchmark before future betting"));
    if (advice.bluff && advice.legal && advice.legal.canRaise)
      out.push(line("Raise to " + advice.bluff.size, advice.bluff.ev,
        "uses the model's fold estimate and equity when called"));
  } else {
    out.push(line("Check", advice.equity * advice.pot,
      "showdown value if no more money goes in"));
    if (advice.bluff && advice.legal && advice.legal.canRaise)
      out.push(line("Bet " + advice.bluff.size, advice.bluff.ev,
        "wins immediately on folds and retains value when called"));
  }
  return out;
}

function preflopComparisons(advice) {
  var out = [
    { label: "Your hand in the full deck", value: "top " + pct(advice.handPct),
      note: "lower is stronger" },
    { label: "Cost to continue", value: advice.toCall ? advice.toCall + " chips" : "free",
      note: advice.toCall ? "needs " + pct(advice.potOddsNeeded, 1) + " raw showdown wins" : "checking never costs chips" }
  ];
  if (advice.openThreshold !== undefined)
    out.push({ label: "Hands played from this seat", value: "about top " + pct(advice.openThreshold),
      note: advice.position });
  if (advice.decisionOpponents)
    out.push({ label: "Simulated showdown chance", value: pct(advice.decisionEq),
      note: "against " + advice.decisionOpponents +
        (advice.decisionOpponents === 1 ? " estimated opponent range" : " estimated opponent ranges") });
  return out;
}

function trapTipping(advice) {
  var lines = [
    { name: advice.toCall ? "raising full" : "betting full", ev: advice.trap.evBet },
    { name: advice.toCall ? "calling" : "checking", ev: advice.trap.evTrap }
  ];
  if (advice.trap.evSmall !== null && advice.trap.smallTo)
    lines.push({ name: advice.toCall ? "raising small" : "betting small", ev: advice.trap.evSmall });
  lines.sort(function (a, b) { return b.ev - a.ev; });
  var gap = lines.length > 1 ? lines[0].ev - lines[1].ev : 0;
  return "The best modeled line is " + lines[0].name + ", only " + Math.round(gap) +
    " chips ahead of " + lines[1].name + ". " +
    (gap <= Math.max(5, advice.pot * 0.04)
      ? "That is a fragile edge, so mixing the two is reasonable."
      : "That gap is large enough to prefer it clearly under these assumptions.");
}

function tippingPoint(context, advice) {
  if (advice.trap && advice.trap.relevant) return trapTipping(advice);

  if (advice.street === "preflop" && !advice.facingRaise && advice.openThreshold !== undefined) {
    var openEdge = advice.openThreshold - advice.handPct;
    return "From " + advice.position + " the opening boundary is roughly the best " +
      pct(advice.openThreshold) + " of hands. " + advice.code + " sits " +
      pct(Math.abs(openEdge), 1) + " points " + (openEdge >= 0 ? "inside" : "outside") + " that boundary.";
  }

  if (advice.toCall > 0 && advice.vsBluff && context.ranges.length === 1) {
    var valueEq = advice.vsBluff.eqVsValue;
    var airEq = advice.vsBluff.eqVsAir;
    var spread = airEq - valueEq;
    if (spread > 0.01) {
      var minimum = (advice.potOddsNeeded - valueEq) / spread;
      minimum = Math.max(0, Math.min(1, minimum));
      return "This call breaks even when roughly " + pct(minimum) +
        " of the bettor's hands are bluffs. The opponent model currently assumes " +
        pct(advice.vsBluff.bluffPct) + ". Below the first number, fold; above it, call.";
    }
  }

  if (advice.toCall > 0) {
    var cushion = advice.decisionEq - advice.potOddsNeeded;
    return "The continue/fold boundary is " + pct(advice.potOddsNeeded, 1) +
      " wins. The model puts this hand at " + pct(advice.decisionEq) + "—" +
      (cushion >= 0 ? pct(cushion, 1) + " points above" : pct(-cushion, 1) + " points below") +
      " the boundary. Change the assumed range enough to cross that line and the answer flips.";
  }

  if (advice.bluff) {
    var foldGap = advice.bluff.foldEquity - advice.bluff.breakEven;
    return "A bluff with no chance when called needs " + pct(advice.bluff.breakEven) +
      " folds; this model predicts " + pct(advice.bluff.foldEquity) + "—" +
      pct(Math.abs(foldGap), 1) + " points " + (foldGap >= 0 ? "above" : "below") +
      " that line. Draws can still justify a bet below it because they sometimes win when called.";
  }

  return "The recommendation is sensitive to the inferred opponent ranges; change those assumptions before trusting a small numerical edge.";
}

function takeaway(advice) {
  if (advice.street === "preflop")
    return "Reusable rule: starting cards are not a fixed verdict. Position, price, players behind, and stack depth determine whether the same hand is playable.";
  if (advice.trap && advice.trap.relevant)
    return "Reusable rule: with a monster, compare how many chips each line earns—not merely whether you are ahead. Slow-play only when induced bets repay the free-card risk.";
  if (advice.toCall > 0 && advice.street === "river")
    return "Reusable rule: on the river, turn the call price into the minimum bluff frequency. Then ask whether this opponent can realistically reach that many bluffs.";
  if (advice.toCall > 0)
    return "Reusable rule: the price is only the first test before the river. Also ask whether future betting will let you reach showdown without paying again.";
  if (advice.isBluff || advice.cls === "bluff")
    return "Reusable rule: a bluff needs enough folds or enough equity when called. Count both, and remember that every extra opponent sharply reduces the chance everyone folds.";
  if (advice.action === "raise")
    return "Reusable rule: value betting is about the hands that pay you. Choose a size by naming the worse hands that call—not by naming how strong your own hand feels.";
  return "Reusable rule: compare the alternatives in chips and identify the assumption that would reverse them before acting.";
}

function question(advice) {
  if (advice.street === "preflop")
    return "Ask yourself: how many players remain, will I act late after the flop, and is this price cheap enough for this exact hand class?";
  if (advice.toCall > 0)
    return "Ask yourself: which real hands take this betting line for value, which missed hands bluff, and are there enough bluffs to clear my price?";
  if (advice.action === "raise")
    return "Ask yourself: which worse hands call this exact size, and which better hands could actually fold?";
  return "Ask yourself: what does checking preserve, what does betting accomplish, and which opponent hands respond differently?";
}

function build(context, advice) {
  return {
    title: "Learn from this spot",
    reads: rangeReads(advice),
    comparisons: advice.street === "preflop"
      ? preflopComparisons(advice) : postflopComparisons(advice),
    tippingPoint: tippingPoint(context, advice),
    takeaway: takeaway(advice),
    question: question(advice)
  };
}

return { build: build };
})();
if (typeof module === "object" && module.exports) module.exports = TeachingModel;
