/* solver.js — hypothetical river response benchmark, not an equilibrium solver.
   Fixed MDF-derived frequencies describe an assumed opponent. They do not
   establish optimal play for the actual ranges. serializeSpot remains the
   adapter boundary for a future external solver. */
var SolverBaseline = (function (P, R, D) {
"use strict";

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function serializeSpot(g, heroId) {
  return D.serialize(g, heroId);
}

function unsupported(reason, spot) {
  return {
    status: "unsupported",
    label: "No river response benchmark for this spot",
    reason: reason,
    spot: spot,
    scope: "The built-in baseline currently covers heads-up river decisions with one bet size."
  };
}

/* Facing one river bet, assume a bluff share equal to the caller's price.
   This is a sensitivity benchmark, not a solution for the actual ranges. */
function facingRiverBet(g, heroId, context, spot) {
  var hero = g.players[heroId];
  var potWithBet = context.legal.contestablePot;
  var call = context.legal.toCall;
  if (hero.bet !== 0 || call <= 0 || potWithBet <= call)
    return unsupported("Raises and previously invested river bets are outside the one-bet abstraction.", spot);
  var bettor = g.live().filter(function (p) { return p.id !== heroId; })[0];
  if (bettor.bet !== call)
    return unsupported("Unequal all-in sizing is outside the one-bet abstraction.", spot);

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
    solverCertified: false,
    kind: "river-facing-bet",
    label: "Hypothetical river response model",
    action: action,
    actionText: indifferent ? "CALL OR FOLD (approximately indifferent)"
              : action === "call" ? "CALL " + call : "FOLD",
    assumedBluffPct: price,
    minimumDefence: defend,
    equityVsBalancedBet: eqBalanced,
    requiredEquity: price,
    evs: [
      { action: "Call", ev: callEV },
      { action: "Fold", ev: 0 }
    ],
    calculation: "This hypothetical bettor uses " + Math.round(price * 100) +
      "% bluffs at this size. Against the displayed value and bluff slices, this hand wins " +
      Math.round(eqBalanced * 100) + "% and needs " + (price * 100).toFixed(1) + "%.",
    scope: "A fixed response assumption, not a solved equilibrium. The bluff share is set from pot odds; hand slices, raises and the earlier game tree are not solved.",
    assumptions: [
      "The opponent's starting range and its value/bluff hand slices are still estimates.",
      "The assumed bluff frequency need not be feasible or optimal for the actual ranges.",
      "Only call and fold are compared."
    ],
    spot: spot
  };
}

/* Checked to on the river: compare checking with one candidate bet into an
   opponent assumed to defend the strongest MDF-sized slice of their range. */
function checkedToOnRiver(g, heroId, context, spot) {
  var hero = g.players[heroId];
  var lg = g.legal(heroId);
  var opp = g.live().filter(function (p) { return p.id !== heroId; })[0];
  if (!lg || !lg.canCheck || g.currentBet !== 0 || hero.bet !== 0)
    return unsupported("The current river action is not a clean check-or-bet decision.", spot);

  var order = g._streetOrder();
  if (order[order.length - 1] !== heroId)
    return unsupported("Checking does not close the river action; later bets are outside this response model.", spot);

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
    solverCertified: false,
    kind: "river-checked-to",
    label: "Hypothetical river response model",
    action: action,
    actionText: indifferent ? "BET OR CHECK (approximately indifferent)"
              : action === "raise" ? "BET " + betTo : "CHECK",
    betTo: betTo,
    assumedBluffPct: bluffShare,
    minimumDefence: defend,
    equityWhenCalled: eqCalled,
    evs: [
      { action: "Bet " + betTo, ev: betEV },
      { action: "Check", ev: checkEV }
    ],
    calculation: "This hypothetical opponent continues with " + Math.round(defend * 100) +
      "% of their range. This hand wins " + Math.round(eqCalled * 100) +
      "% against that strongest slice.",
    scope: "A fixed MDF-based response assumption, not a solved equilibrium. Compares one bet size with checking; check-raises, other sizes and the earlier game tree are omitted.",
    assumptions: [
      "The opponent's starting range is estimated from the same evidence shown by the coach.",
      "The opponent is assumed to call the strongest hands at the MDF frequency; actual optimal defence may differ.",
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
    return unsupported("Multiway response modeling is not supported by the built-in baseline.", spot);
  // If no legal holding can improve the board, folding a guaranteed share
  // cannot be justified by MDF. Do not fabricate fold equity in this case.
  var boardScore = P.evaluate(g.board);
  var pool = P.newDeck().filter(function (c) {
    return !g.board.some(function (b) { return P.cardId(b) === P.cardId(c); });
  });
  var canImprove = false;
  for (var i = 0; i < pool.length && !canImprove; i++)
    for (var j = i + 1; j < pool.length && !canImprove; j++)
      canImprove = P.cmpEval(P.evaluate(g.board.concat([pool[i], pool[j]])), boardScore) > 0;
  if (!canImprove)
    return unsupported("The board guarantees a shared hand. An MDF fold assumption is inappropriate for a guaranteed chop.", spot);
  if (context.legal.toCall > 0) return facingRiverBet(g, heroId, context, spot);
  return checkedToOnRiver(g, heroId, context, spot);
}

return { analyse: analyse, serializeSpot: serializeSpot };
})(Poker, RangeModel, DecisionContext);
if (typeof module === "object" && module.exports) module.exports = SolverBaseline;
