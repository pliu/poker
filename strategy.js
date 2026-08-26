/* strategy.js — orchestration only. It creates one shared context, obtains the
   practical recommendation and balanced reference independently, asks the
   opponent model to explain deviations, and packages the final decision. */
var StrategyEngine = (function (D, C, S, X) {
"use strict";

function withContext(opts, context) {
  var out = {}, k;
  opts = opts || {};
  for (k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) out[k] = opts[k];
  out.context = context;
  return out;
}

function advise(g, heroId, opts) {
  opts = opts || {};
  var context = D.build(g, heroId, opts);
  var practical = C.advise(g, heroId, withContext(opts, context));
  if (!practical) return null;
  var baseline;
  try { baseline = S.analyse(g, heroId, practical, { stats: opts.stats, context: context }); }
  catch (e) {
    baseline = {
      status: "unsupported", label: "Balanced baseline unavailable",
      reason: "The baseline could not analyse this spot: " + e.message,
      scope: "The practical coach remains available."
    };
  }
  if (baseline.status === "supported") {
    var indifferent = baseline.action === "indifferent";
    baseline.coachAgrees = indifferent || practical.action === baseline.action;
  }
  var adjustment = X.compare(context, practical, baseline);

  practical.context = {
    street: context.street,
    opponentCount: context.ranges.length,
    rangeIds: context.ranges.map(function (r) { return r.id; })
  };
  practical.solver = baseline;
  practical.adjustment = adjustment;
  practical.strategy = {
    layers: [
      { name: "range-inference", status: "complete" },
      { name: "balanced-baseline", status: baseline.status },
      { name: "opponent-adjustment", status: adjustment.status },
      { name: "explanation", status: "complete" }
    ],
    final: {
      action: practical.action,
      raiseTo: practical.raiseTo || 0,
      headline: practical.headline,
      source: adjustment.finalSource,
      text: adjustment.finalText
    }
  };
  return practical;
}

return { advise: advise, buildContext: D.build };
})(DecisionContext, Coach, SolverBaseline, ExploitModel);
if (typeof module === "object" && module.exports) module.exports = StrategyEngine;
