/* context.js — one immutable-ish snapshot shared by range inference, balanced
   strategy providers, exploit adjustments, and the final explanation layer. */
var DecisionContext = (function (P, R) {
"use strict";

function legalSnapshot(lg) {
  if (!lg) return null;
  return {
    toCall: lg.toCall, canCheck: lg.canCheck, canCall: lg.canCall,
    canFold: lg.canFold, canRaise: lg.canRaise,
    minRaiseTo: lg.minRaiseTo, maxRaiseTo: lg.maxRaiseTo,
    pot: lg.pot, contestablePot: lg.contestablePot, currentBet: lg.currentBet
  };
}

function serialize(g, heroId) {
  var lg = g.legal(heroId);
  return {
    game: "holdem-no-limit",
    street: g.stage,
    board: g.board.map(P.cardText),
    hero: {
      id: heroId,
      hand: g.players[heroId].hole.map(P.cardText),
      stack: g.players[heroId].chips,
      committed: g.players[heroId].committed,
      streetBet: g.players[heroId].bet
    },
    players: g.live().map(function (p) {
      return { id: p.id, name: p.name, stack: p.chips,
               committed: p.committed, streetBet: p.bet };
    }),
    pot: lg ? lg.pot : g.pot(),
    contestablePot: lg && lg.contestablePot !== undefined ? lg.contestablePot : g.pot(),
    toCall: lg ? lg.toCall : 0,
    legal: legalSnapshot(lg),
    history: (g.history || []).map(function (h) {
      return { street: h.street, playerId: h.playerId, action: h.action,
               amount: h.amount || 0, potBefore: h.potBefore, pot: h.pot };
    })
  };
}

function build(g, heroId, opts) {
  opts = opts || {};
  var ranges = R.opponentRanges(g, heroId, opts.stats);
  return {
    heroId: heroId,
    street: g.stage,
    board: g.board.slice(),
    stats: opts.stats || null,
    ranges: ranges,
    legal: legalSnapshot(g.legal(heroId)),
    texture: g.board.length ? P.boardTexture(g.board) : null,
    spot: serialize(g, heroId)
  };
}

return { build: build, serialize: serialize };
})(Poker, RangeModel);
if (typeof module === "object" && module.exports) module.exports = DecisionContext;
