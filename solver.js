/* solver.js — an additive equilibrium baseline for spots small enough to solve
   honestly in the browser.

   This is NOT a full no-limit Hold'em solver. It solves a deliberately small
   river abstraction: heads-up, one bet size, and no later betting. That model
   has an analytical equilibrium, so the UI can compare the practical coach to
   a balanced opponent without dressing another heuristic up as "GTO".

   Unsupported streets and multiway pots return an explicit reason. The public
   serializeSpot() boundary is also the adapter a future external solver can use. */
var SolverBaseline = (function (P, R, D) {
"use strict";

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function serializeSpot(g, heroId) {
  return D.serialize(g, heroId);
}

function unsupported(reason, spot) {
  return {
    status: "unsupported",
    label: "No solver baseline for this spot",
    reason: reason,
    spot: spot,
    scope: "The built-in baseline currently covers heads-up river decisions with one bet size."
  };
}

/* Facing one river bet. At equilibrium the bettor's bluff share equals the
   caller's break-even price. Value and bluff slices are built independently
   from the shared inferred range, not copied from the practical coach. */
function facingRiverBet(g, heroId, context, spot) {
  var hero = g.players[heroId];
  var potWithBet = context.legal.contestablePot;
  var call = context.legal.toCall;
  if (hero.bet !== 0 || call <= 0 || potWithBet <= call)
    return unsupported("Raises and previously invested river bets are outside the one-bet abstraction.", spot);

  var potBefore = potWithBet - call;
  var price = call / (potWithBet + call);
  var defend = potBefore / (potBefore + call);
  var range = context.ranges[0];
  var slices = R.bettingSlices("river", price, call / potBefore);
  var split = P.splitRangeEquity(hero.hole, g.board, range, slices.valueTop,
                                  900, P.mulberry32(0x6e617368), slices.bluffBottom);
  if (!split) return unsupported("The balanced value and bluff slices could not be enumerated.", spot);
  var eqBalanced = (1 - price) * split.topEq + price * split.bottomEq;
  var callEV = eqBalanced * (potWithBet + call) - call;
  var tolerance = Math.max(1, potWithBet * 0.005);
  var indifferent = Math.abs(callEV) <= tolerance;
  var action = indifferent ? "indifferent" : callEV > 0 ? "call" : "fold";

  return {
    status: "supported",
    kind: "river-facing-bet",
    label: "One-bet river equilibrium",
    action: action,
    actionText: indifferent ? "CALL OR FOLD (approximately indifferent)"
              : action === "call" ? "CALL " + call : "FOLD",
    equilibriumBluffPct: price,
    minimumDefence: defend,
    equityVsBalancedBet: eqBalanced,
    requiredEquity: price,
    evs: [
      { action: "Call", ev: callEV },
      { action: "Fold", ev: 0 }
    ],
    calculation: "A balanced bettor uses " + Math.round(price * 100) +
      "% bluffs at this size. Against the displayed value and bluff slices, this hand wins " +
      Math.round(eqBalanced * 100) + "% and needs " + (price * 100).toFixed(1) + "%.",
    scope: "Uses the analytical equilibrium for the displayed one-bet river abstraction; hand values come from the estimated range, while raises and the earlier game tree are omitted.",
    assumptions: [
      "The opponent's starting range and its value/bluff hand slices are still estimates.",
      "The opponent is balanced rather than following their observed bluff tendency.",
      "Only call and fold are compared."
    ],
    spot: spot
  };
}

/* Checked to on the river. Compare checking with one candidate bet into an
   opponent who defends at the equilibrium frequency and keeps the strongest
   part of their range. This is a best response inside the abstraction, not a
   claim that the chosen size is optimal among every possible chip amount. */
function checkedToOnRiver(g, heroId, context, spot) {
  var hero = g.players[heroId];
  var lg = g.legal(heroId);
  var opp = g.live().filter(function (p) { return p.id !== heroId; })[0];
  if (!lg || !lg.canCheck || g.currentBet !== 0 || hero.bet !== 0)
    return unsupported("The current river action is not a clean check-or-bet decision.", spot);

  var step = Math.max(1, Math.round(g.bb / 2));
  var betTo = Math.round((context.legal.contestablePot * 0.66) / step) * step;
  betTo = clamp(betTo, lg.minRaiseTo, lg.maxRaiseTo);
  var cost = Math.max(0, betTo - hero.bet);
  if (cost <= 0 || !lg.canRaise)
    return unsupported("No legal river bet is available.", spot);
  if (!opp || opp.chips < cost)
    return unsupported("Unequal all-in sizing is outside the one-bet abstraction.", spot);

  var pot = context.legal.contestablePot;
  var defend = pot / (pot + cost);
  var fold = 1 - defend;
  var baseRange = context.ranges.filter(function (r) { return r.id === opp.id; })[0];
  var split = P.splitRangeEquity(hero.hole, g.board, baseRange, clamp(defend, 0.01, 0.99),
                                  900, P.mulberry32(0x51f15e));
  if (!split)
    return unsupported("The opponent's continuing range could not be enumerated.", spot);

  var eqCalled = split.topEq;
  var betEV = fold * pot + defend * (eqCalled * (pot + 2 * cost) - cost);
  var rawEq = P.equity(hero.hole, g.board, [baseRange], 900, P.mulberry32(0x63686563)).equity;
  var checkEV = rawEq * pot;
  var delta = betEV - checkEV;
  var tolerance = Math.max(1, pot * 0.005);
  var indifferent = Math.abs(delta) <= tolerance;
  var action = indifferent ? "indifferent" : delta > 0 ? "raise" : "check";
  var bluffShare = cost / (pot + 2 * cost);

  return {
    status: "supported",
    kind: "river-checked-to",
    label: "One-bet river equilibrium",
    action: action,
    actionText: indifferent ? "BET OR CHECK (approximately indifferent)"
              : action === "raise" ? "BET " + betTo : "CHECK",
    betTo: betTo,
    equilibriumBluffPct: bluffShare,
    minimumDefence: defend,
    equityWhenCalled: eqCalled,
    evs: [
      { action: "Bet " + betTo, ev: betEV },
      { action: "Check", ev: checkEV }
    ],
    calculation: "At this size a balanced opponent continues with " + Math.round(defend * 100) +
      "% of their range. This hand wins " + Math.round(eqCalled * 100) +
      "% against that strongest slice.",
    scope: "Uses equilibrium defence for one candidate bet versus check on the river; hand values come from the estimated range, while check-raises, other sizes and the earlier game tree are omitted.",
    assumptions: [
      "The opponent's starting range is estimated from the same evidence shown by the coach.",
      "The opponent calls with the strongest hands at the equilibrium defence frequency.",
      "Only the displayed bet size and checking are compared."
    ],
    spot: spot
  };
}

function analyse(g, heroId, advice, opts) {
  opts = opts || {};
  if (!g || g.actionOn !== heroId)
    return unsupported("There is no live decision to analyse.", null);
  var context = opts.context || D.build(g, heroId, opts);
  var spot = context.spot || serializeSpot(g, heroId);
  if (g.stage !== "river" || g.board.length !== 5)
    return unsupported("Future cards require a multi-street game tree, which the built-in baseline does not pretend to solve.", spot);
  if (g.live().length !== 2)
    return unsupported("Multiway equilibrium solving is not supported by the built-in baseline.", spot);
  if (context.legal.toCall > 0) return facingRiverBet(g, heroId, context, spot);
  return checkedToOnRiver(g, heroId, context, spot);
}

return { analyse: analyse, serializeSpot: serializeSpot };
})(Poker, RangeModel, DecisionContext);
if (typeof module === "object" && module.exports) module.exports = SolverBaseline;
