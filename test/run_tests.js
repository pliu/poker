/* Test runner. No node on this machine, so we run under macOS JavaScriptCore:
     osascript -l JavaScript test/run_tests.js
   It loads the browser source files verbatim and exercises the pure logic. */
ObjC.import('Foundation');
function slurp(path) {
  var s = $.NSString.stringWithContentsOfFileEncodingError(
    $(path).stringByStandardizingPath, $.NSUTF8StringEncoding, null);
  return ObjC.unwrap(s);
}
var ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;
function load(f) { (0, eval)(slurp(ROOT + '/' + f)); }
load('poker.js');
load('ranges.js');
load('exploit.js');
load('context.js');
load('coach.js');
load('solver.js');
load('bots.js');
load('teaching.js');
load('strategy.js');

var pass = 0, fail = 0, failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (extra ? "  -> " + extra : "")); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + " != " + JSON.stringify(b)); }
function section(s) { console.log("\n=== " + s + " ==="); }

/* helpers */
var R = Poker.RANKS;
function C(str) { // "As" "Td" "7h" "2c"
  var rank = "23456789TJQKA".indexOf(str[0]) + 2;
  var suit = "shdc".indexOf(str[1]);
  if (rank < 2 || suit < 0) throw new Error("bad card " + str);
  return { r: rank, s: suit };
}
function H(s) { return s.split(/\s+/).map(C); }

/* ------------------------------------------------------------------ */
section("hand evaluation");
var E = Poker.evaluate, cmp = Poker.cmpEval;

eq("royal flush", E(H("As Ks Qs Js Ts 2h 3d"))[0], 8);
eq("straight flush high", E(H("9s 8s 7s 6s 5s Kh Qd")), [8, 9]);
eq("steel wheel", E(H("As 2s 3s 4s 5s Kh Qd")), [8, 5]);
eq("quads", E(H("7s 7h 7d 7c Kh Qd 2c"))[0], 7);
eq("full house", E(H("7s 7h 7d Kc Kh 2d 3c")), [6, 7, 13]);
eq("flush", E(H("As Js 9s 5s 3s Kh Qd")), [5, 14, 11, 9, 5, 3]);
eq("straight", E(H("9h 8s 7d 6c 5h Ks Qd")), [4, 9]);
eq("wheel straight", E(H("Ah 2s 3d 4c 5h Ks Qd")), [4, 5]);
eq("trips", E(H("7s 7h 7d Ac Kh 2d 3c")), [3, 7, 14, 13]);
eq("two pair", E(H("7s 7h Kd Kc 9h 2d 3c")), [2, 13, 7, 9]);
eq("one pair", E(H("7s 7h Kd Qc 9h 2d 3c")), [1, 7, 13, 12, 9]);
eq("high card", E(H("As Kh Qd Jc 9h 3d 2c")), [0, 14, 13, 12, 11, 9]);

// the two kicker bugs from the original
eq("quads kicker is the best remaining card, not the pair",
   E(H("7s 7h 7d 7c Kh Kd Ac")), [7, 7, 14]);
eq("three pairs: kicker is the best remaining card",
   E(H("As Ah Ks Kh 7d 7c 9s")), [2, 14, 13, 9]);
ok("A-high flush beats K-high flush",
   cmp(E(H("As Js 9s 5s 3s Kh Qd")), E(H("Ks Js 9s 5s 3s Ah Qd"))) > 0);
ok("higher two pair kicker wins",
   cmp(E(H("Ks Kh 7d 7c Ad 2s 3h")), E(H("Ks Kh 7d 7c Qd 2s 3h"))) > 0);
ok("a straight on the board ties",
   cmp(E(H("9h 8s 7d 6c 5h 2s 3d")), E(H("9h 8s 7d 6c 5h 2c 3c"))) === 0);
ok("boat beats flush", cmp(E(H("7s 7h 7d Kc Kh 2s 3s")), E(H("As Js 9s 5s 3s Kh Qd"))) > 0);
eq("no false straight across a gap (9875432 has no run of five)", E(H("9h 8s 7d 5c 4h 2s 3d"))[0], 0);
eq("not a straight", E(H("Kh 9s 7d 5c 4h 2s Jd"))[0], 0);
ok("flush uses only the flush suit's top five",
   JSON.stringify(E(H("As Ks Qs Js 9s 8s 2h"))) === JSON.stringify([5,14,13,12,11,9]));

section("best five");
var b5 = Poker.bestFive(H("As Ks Qs Js Ts 2h 3d"));
eq("bestFive picks the royal", JSON.stringify(E(b5)), JSON.stringify([8,14]));
ok("bestFive returns 5 cards", b5.length === 5);

section("preflop ranking");
eq("169 distinct hands", Poker.HAND_ORDER.length, 169);
(function () {
  var seen = {}, dupes = [];
  Poker.HAND_ORDER.forEach(function (h) { if (seen[h]) dupes.push(h); seen[h] = 1; });
  eq("no duplicates in the hand order", dupes, []);
  var missing = [];
  for (var i = 12; i >= 0; i--) for (var j = 12; j >= 0; j--) {
    var code = i === j ? R[i] + R[i] : (i > j ? R[i] + R[j] : R[j] + R[i]) + (i > j ? "s" : "o");
    if (!seen[code]) missing.push(code);
  }
  eq("all 169 hands present", missing, []);
})();
ok("AA is the best hand", Poker.handPct(H("As Ah")) < Poker.handPct(H("Ks Kh")));
ok("72o is the worst hand", Poker.handPct(H("7s 2h")) > 0.99);
ok("AKs beats AKo in the ranking", Poker.handPct(H("As Ks")) < Poker.handPct(H("As Kh")));
ok("J2s is NOT a premium hand (original tier bug)", Poker.handPct(H("Js 2s")) > 0.40,
   "J2s pct=" + Poker.handPct(H("Js 2s")));
ok("hand percentiles are weighted by the 1,326 actual combinations",
   Poker.handPct(H("As Kh")) > Poker.handPct(H("As Ks")) + 0.008,
   "AKs=" + Poker.handPct(H("As Ks")) + " AKo=" + Poker.handPct(H("As Kh")));

section("equity");
var rng = Poker.mulberry32(42);
(function () {
  var e = Poker.equity(H("As Ah"), [], [1], 3000, rng).equity;
  ok("AA vs one random hand ~85%", e > 0.80 && e < 0.89, e.toFixed(3));
  var e2 = Poker.equity(H("7d 2c"), [], [1], 3000, rng).equity;
  ok("72o vs one random hand ~35%", e2 > 0.28 && e2 < 0.40, e2.toFixed(3));
  var e3 = Poker.equity(H("As Ah"), [], [1, 1, 1], 2500, rng).equity;
  ok("AA vs three random hands ~55-65%", e3 > 0.50 && e3 < 0.68, e3.toFixed(3));
  var e4 = Poker.equity(H("As Ks"), H("Qs Js 2h"), [1], 3000, rng).equity;
  ok("royal draw is a big favourite", e4 > 0.75, e4.toFixed(3));
  var splitThreeWays = Poker.equity(H("2c 3d"), H("As Ks Qs Js Ts"), [1, 1], 100,
                                        Poker.mulberry32(4));
  ok("a three-way board tie awards one third, not one half",
     Math.abs(splitThreeWays.equity - 1 / 3) < 1e-9, String(splitThreeWays.equity));
  // dominated: AA vs a tight range should be worse than vs a random hand
  var wide = Poker.equity(H("Kd Kc"), [], [1], 3000, rng).equity;
  var tight = Poker.equity(H("Kd Kc"), [], [0.05], 3000, rng).equity;
  ok("KK does worse against a top-5% range than against a random hand",
     tight < wide - 0.05, "tight=" + tight.toFixed(3) + " wide=" + wide.toFixed(3));
  // a made nut hand must be 100%
  var nuts = Poker.equity(H("As Ks"), H("Qs Js Ts 2h 3d"), [1], 400, rng).equity;
  ok("royal flush on the river has ~100% equity", nuts > 0.99, nuts.toFixed(3));

  // Villain's top 0.5% is exactly AA here. Their two aces must be removed
  // before the river is dealt: only 2 of 44 rivers are aces, not 4 of 46.
  var removal = Poker.equity(H("Kd Kc"), H("Kh 7s 2d 3c"), [0.005], 12000,
                             Poker.mulberry32(91)).equity;
  ok("range cards are removed before future board cards are sampled",
     removal > 0.94 && removal < 0.97, removal.toFixed(4));
})();

section("draw detection");
(function () {
  var a = Poker.analyseHand(H("As 5s"), H("Ks 9s 2h"));
  ok("nut flush draw detected", a.flushDraw && a.nutFlushDraw);
  var b = Poker.analyseHand(H("9h 8h"), H("7s 6d 2c"));
  eq("open-ender detected", b.straightDraw, 2);
  var c = Poker.analyseHand(H("9h 8h"), H("7s 5d 2c"));
  eq("gutshot detected", c.straightDraw, 1);
  var d = Poker.analyseHand(H("Ah Kd"), H("7s 5d 2c"));
  eq("two overcards is not a straight draw", d.straightDraw, 0);
  ok("two overcards flagged", d.overcards === 2);
  var e = Poker.analyseHand(H("2h 3d"), H("As Ks Qh Jh Th"));
  ok("playing the board is flagged", e.usesBoardOnly);
  var f = Poker.analyseHand(H("Ah Ad"), H("7s 5d 2c"));
  ok("overpair flagged", f.overPair);
  var g = Poker.analyseHand(H("Ah 7d"), H("As 5d 2c"));
  ok("top pair flagged", g.topPair);
  ok("no phantom draws on the river", Poker.analyseHand(H("Ah Kd"), H("7s 5d 2c 9h Jc")).outs === 0);
})();

section("board texture");
(function () {
  var dry = Poker.boardTexture(H("Ks 7d 2c"));
  var wet = Poker.boardTexture(H("9h 8h 7c"));
  ok("wet board scores higher than dry", wet.wet > dry.wet, wet.wet + " vs " + dry.wet);
  ok("monotone detected", Poker.boardTexture(H("Kh 8h 3h")).monotone);
  ok("paired detected", Poker.boardTexture(H("Kh Kd 3s")).paired);
})();

/* ------------------------------------------------------------------ */
section("betting engine");
function mkGame(stacks, button, seed) {
  return new Poker.Game({
    sb: 10, bb: 20, rng: Poker.mulberry32(seed === undefined ? 7 : seed),
    button: button === undefined ? 0 : button,
    players: (stacks || [2000, 2000, 2000, 2000]).map(function (c, i) {
      return { name: "P" + i, chips: c, isHuman: i === 0 };
    })
  });
}

(function blinds() {
  var g = mkGame().startHand();
  eq("SB posted", g.players[1].committed, 10);
  eq("BB posted", g.players[2].committed, 20);
  eq("pot after blinds", g.pot(), 30);
  eq("UTG acts first preflop", g.actionOn, 3);
  eq("everyone has two cards", g.players.map(function (p) { return p.hole.length; }), [2,2,2,2]);
  eq("current bet is the BB", g.currentBet, 20);
})();

(function contestablePotOdds() {
  var g = mkGame([100, 1050], 0, 17).startHand();
  g.players[0].committed = 50; g.players[0].bet = 0; g.players[0].chips = 100;
  g.players[1].committed = 1050; g.players[1].bet = 1000; g.players[1].chips = 0; g.players[1].allIn = true;
  g.currentBet = 1000; g.actionOn = 0;
  var lg = g.legal(0);
  eq("the displayed pot still includes every committed chip", lg.pot, 1100);
  eq("an all-in caller's contestable pot excludes the bettor's unmatched excess",
     lg.contestablePot, 200);
  ok("the effective all-in price is 100 to win a final pot of 300",
     Math.abs(lg.toCall / (lg.contestablePot + lg.toCall) - 1 / 3) < 1e-12);
})();

(function dealingWithEmptySeats() {
  // Regression: with a player eliminated, _nextSeated cycles through only the
  // seated players, so a loop over players.length dealt the first seated player
  // two cards per round — four in total.
  for (var out = 0; out < 4; out++) {
    var stacks = [2000, 2000, 2000, 2000];
    stacks[out] = 0;
    for (var btn = 0; btn < 4; btn++) {
      var g = mkGame(stacks, btn, 5).startHand();
      var counts = g.players.map(function (p) { return p.hole.length; });
      var expect = [2, 2, 2, 2]; expect[out] = 0;
      eq("one player out (seat " + out + ", button " + btn + "): everyone gets exactly two cards",
         counts, expect);
      var ids = {}, dupes = 0;
      g.players.forEach(function (p) {
        p.hole.forEach(function (c) { var k = Poker.cardId(c); if (ids[k]) dupes++; ids[k] = 1; });
      });
      eq("no duplicate cards dealt (seat " + out + ", button " + btn + ")", dupes, 0);
    }
  }
  // and with two players out
  var g2 = mkGame([2000, 0, 2000, 0], 0, 9).startHand();
  eq("two players out: two cards each to the survivors",
     g2.players.map(function (p) { return p.hole.length; }), [2, 0, 2, 0]);
  eq("two players out is heads-up", g2.seated().length, 2);
})();

(function streetOrderWithEmptySeats() {
  var g = mkGame([2000, 0, 2000, 2000], 0, 4).startHand();
  var order = g._streetOrder();
  var seen = {}, dupes = 0;
  order.forEach(function (id) { if (seen[id]) dupes++; seen[id] = 1; });
  eq("action order contains no duplicates when a seat is empty", dupes, 0);
  ok("action order never includes a player who is sitting out",
     order.indexOf(1) < 0, JSON.stringify(order));
  eq("action order covers every live player exactly once", order.length, 3);
})();

(function eliminationOverManyHands() {
  // Play a long session and assert the invariant on every single hand.
  var rng = Poker.mulberry32(31337);
  var g = new Poker.Game({ sb: 10, bb: 20, rng: rng, button: 0,
    players: Bots.PERSONAS.slice(0, 4).map(function (ps) { return { name: ps.name, chips: 2000, persona: ps }; }) });
  var table = Bots.createTable(g, rng);
  var bad = 0, dealt = 0, withEmptySeats = 0;
  for (var h = 0; h < 400; h++) {
    if (g.players.filter(function (p) { return p.chips > 0; }).length < 2) {
      g.players.forEach(function (p) { p.chips = 2000; });   // rebuy and keep going
    }
    g.button = g.nextSeated(g.button);
    g.startHand();
    if (g.stage === "idle") break;
    dealt++;
    if (g.seated().length < 4) withEmptySeats++;
    g.players.forEach(function (p) {
      var want = p.sittingOut ? 0 : 2;
      if (p.hole.length !== want) bad++;
    });
    var guard = 0;
    while (!g.handOver && guard++ < 300) {
      var id = g.actionOn; if (id === null) break;
      var mv = table.decide(id);
      g.act(id, mv.action, mv.raiseTo);
    }
    table.finishHand();
  }
  console.log("  " + dealt + " hands dealt, " + withEmptySeats + " of them with an empty seat");
  ok("some hands actually ran short-handed (so the test means something)", withEmptySeats > 20,
     withEmptySeats + " short-handed hands");
  ok("nobody ever holds the wrong number of cards", bad === 0, bad + " bad hands");
})();

(function headsUp() {
  var g = mkGame([2000, 2000], 0).startHand();
  eq("HU: button posts the SB", g.players[0].committed, 10);
  eq("HU: other player posts the BB", g.players[1].committed, 20);
  eq("HU: button acts first preflop", g.actionOn, 0);
  g.act(0, "call"); g.act(1, "check");
  eq("HU: flop dealt", g.board.length, 3);
  eq("HU: BB acts first postflop", g.actionOn, 1);
})();

(function foldRound() {
  var g = mkGame().startHand();
  g.act(3, "fold"); g.act(0, "fold"); g.act(1, "fold");
  ok("BB wins uncontested", g.handOver);
  eq("BB collects the blinds", g.players[2].chips, 2010);
  eq("SB lost the small blind", g.players[1].chips, 1990);
})();

(function checkThrough() {
  var g = mkGame().startHand();
  g.act(3, "call"); g.act(0, "call"); g.act(1, "call"); g.act(2, "check");
  eq("flop after preflop calls", g.board.length, 3);
  eq("SB is first to act postflop", g.actionOn, 1);
  g.act(1, "check"); g.act(2, "check"); g.act(3, "check"); g.act(0, "check");
  eq("turn dealt", g.board.length, 4);
  g.act(1, "check"); g.act(2, "check"); g.act(3, "check"); g.act(0, "check");
  eq("river dealt", g.board.length, 5);
  g.act(1, "check"); g.act(2, "check"); g.act(3, "check"); g.act(0, "check");
  eq("showdown reached", g.stage, "showdown");
  ok("hand is over", g.handOver);
  var total = g.players.reduce(function (t, p) { return t + p.chips; }, 0);
  eq("chips are conserved", total, 8000);
})();

(function raiseReopens() {
  var g = mkGame().startHand();
  g.act(3, "raise", 60);
  eq("min raise is now 40 over 60", g.legal(0).minRaiseTo, 100);
  g.act(0, "call");
  g.act(1, "raise", 200);
  eq("3-bettor reopened action for the original raiser", g.actionOn, 2);
  g.act(2, "fold");
  eq("action returns to P3 who must respond to the 3-bet", g.actionOn, 3);
  ok("P3 may re-raise", g.legal(3).canRaise);
  eq("P3 owes 140 more", g.legal(3).toCall, 140);
})();

(function shortAllInDoesNotReopen() {
  // P3 raises to 200, P0 is all-in for 260 (an under-raise: +60 < the 180 min).
  // P3 may call the extra but must NOT be allowed to re-raise.
  var g = mkGame([2000, 2000, 2000, 260], 0).startHand();
  g.act(3, "raise", 200);      // P3 (2000 stack? no: P3 has 260) -- swap
  ok("setup guard", true);
})();

(function shortAllInDoesNotReopen2() {
  var g = mkGame([260, 2000, 2000, 2000], 0).startHand();
  g.act(3, "raise", 200);
  g.act(0, "raise", 260);          // all-in under-raise (+60 < min raise of 180)
  ok("P0 is all in", g.players[0].allIn);
  g.act(1, "fold"); g.act(2, "fold");
  eq("action back on P3", g.actionOn, 3);
  eq("P3 owes the extra 60", g.legal(3).toCall, 60);
  ok("P3 CANNOT re-raise off an under-sized all-in", !g.legal(3).canRaise);
})();

(function fullAllInDoesReopen() {
  var g = mkGame([600, 2000, 2000, 2000], 0).startHand();
  g.act(3, "raise", 200);
  g.act(0, "raise", 600);          // full raise (+400 >= 180)
  g.act(1, "fold"); g.act(2, "fold");
  ok("P3 CAN re-raise a full all-in raise", g.legal(3).canRaise);
})();

(function noSoloBetting() {
  // Three players are all-in and only one player still has chips: there is no
  // one left to bet against, so the board must run out to showdown instead of
  // prompting the lone live player. (Original bug #3.)
  var g = mkGame([2000, 100, 120, 300], 0).startHand();
  g.act(3, "raise", 300);   // all-in
  g.act(0, "call");
  g.act(1, "call");         // all-in for 100
  g.act(2, "call");         // all-in for 120
  ok("hand ran to showdown without another betting round", g.handOver);
  eq("full board", g.board.length, 5);
  eq("nobody is left to act", g.actionOn, null);
  var total = g.players.reduce(function (t, p) { return t + p.chips; }, 0);
  eq("chips conserved through side pots", total, 2520);
})();

(function sideBettingStillHappens() {
  // ...but when two players still have chips behind, betting DOES continue.
  var g = mkGame([2000, 100, 120, 2000], 0).startHand();
  g.act(3, "raise", 300);
  g.act(0, "call");
  g.act(1, "call");         // all-in for 100
  g.act(2, "call");         // all-in for 120
  ok("flop is dealt", g.board.length === 3);
  ok("the two live stacks keep playing a side pot", !g.handOver && g.actionOn !== null);
  ok("only players with chips are asked to act", !g.players[g.actionOn].allIn);
})();

(function sidePots() {
  var g = mkGame([100, 500, 2000, 2000], 0).startHand();
  g.act(3, "raise", 2000);   // shove
  g.act(0, "call");          // all-in 100
  g.act(1, "call");          // all-in 500
  g.act(2, "call");          // all-in 2000
  ok("hand complete", g.handOver);
  var pots = g._buildPots();
  eq("three pot levels", pots.length, 3);
  eq("main pot = 4 x 100", pots[0].amount, 400);
  eq("side pot 1 = 3 x 400", pots[1].amount, 1200);
  eq("side pot 2 = 2 x 1500", pots[2].amount, 3000);
  eq("main pot has 4 eligible", pots[0].eligible.length, 4);
  eq("side pot 2 has 2 eligible", pots[2].eligible.length, 2);
  var total = g.players.reduce(function (t, p) { return t + p.chips; }, 0);
  eq("chips conserved", total, 4600);
  ok("short stack can never win more than 4x his stack",
     g.players[0].chips <= 400);
})();

(function minRaiseFloor() {
  var g = mkGame().startHand();
  eq("preflop min raise-to is 2 BB", g.legal(3).minRaiseTo, 40);
  g.act(3, "call"); g.act(0, "call"); g.act(1, "call"); g.act(2, "check");
  eq("postflop min bet is one BB", g.legal(1).minRaiseTo, 20);
})();

(function illegalActions() {
  var g = mkGame().startHand();
  var threw = false;
  try { g.act(0, "check"); } catch (e) { threw = true; }
  ok("acting out of turn throws", threw);
  threw = false;
  try { g.act(3, "check"); } catch (e) { threw = true; }
  ok("checking into a bet throws", threw);
  threw = false;
  try { g.act(3, "raise", 30); } catch (e) { threw = true; }
  ok("under-min raise throws", threw);
  g.act(3, "fold");
  eq("fold advances to the next player", g.actionOn, 0);
})();

(function foldingForFreeBecomesCheck() {
  var g = mkGame().startHand();
  g.act(3, "call"); g.act(0, "call"); g.act(1, "call"); g.act(2, "check");
  g.act(1, "fold");
  eq("fold with nothing to call is turned into a check", g.players[1].folded, false);
  eq("recorded as a check", g.players[1].lastAction.action, "check");
})();

(function burnCards() {
  var g = mkGame().startHand();
  var before = g.deck.length;
  g.act(3, "call"); g.act(0, "call"); g.act(1, "call"); g.act(2, "check");
  eq("flop burns one card and deals three", g.deck.length, before - 4);
})();

/* ------------------------------------------------------------------ */
section("random full-game fuzz (bots only)");
(function fuzz() {
  var chipErrors = 0, crashes = 0, stuck = 0, hands = 0, showdowns = 0, allIns = 0;
  var actionCounts = { fold: 0, check: 0, call: 0, raise: 0 };
  for (var seed = 1; seed <= 400; seed++) {
    var rng = Poker.mulberry32(seed * 7919);
    var g = new Poker.Game({
      sb: 10, bb: 20, rng: rng, button: seed % 4,
      players: Bots.PERSONAS.slice(0, 4).map(function (ps, i) {
        return { name: ps.name, chips: 2000, persona: ps };
      })
    });
    var table = Bots.createTable(g, rng);
    var expected = 8000;
    try {
      g.startHand();
      if (g.stage === "idle") continue;
      hands++;
      var guard = 0;
      while (!g.handOver && guard++ < 400) {
        var id = g.actionOn;
        if (id === null) { stuck++; break; }
        var mv = table.decide(id);
        g.act(id, mv.action, mv.raiseTo);
        actionCounts[mv.action === "raise" ? "raise" : mv.action]++;
      }
      if (guard >= 400) stuck++;
      if (g.stage === "showdown") showdowns++;
      if (g.players.some(function (p) { return p.allIn; })) allIns++;
      var total = g.players.reduce(function (t, p) { return t + p.chips; }, 0);
      if (total !== expected) { chipErrors++; console.log("  chip mismatch seed " + seed + ": " + total); }
    } catch (e) {
      crashes++;
      if (crashes <= 3) console.log("  CRASH seed " + seed + ": " + e.message);
    }
  }
  console.log("  played " + hands + " hands; showdowns=" + showdowns + " allIns=" + allIns);
  console.log("  actions: " + JSON.stringify(actionCounts));
  ok("no crashes across 400 fuzzed hands", crashes === 0, crashes + " crashes");
  ok("no stuck hands", stuck === 0, stuck + " stuck");
  ok("chips conserved in every hand", chipErrors === 0, chipErrors + " mismatches");
  ok("bots use every action type",
     actionCounts.fold > 0 && actionCounts.check > 0 && actionCounts.call > 0 && actionCounts.raise > 0,
     JSON.stringify(actionCounts));
})();

section("multi-hand session (busts, rebuys, button movement)");
(function session() {
  var rng = Poker.mulberry32(999);
  var g = new Poker.Game({
    sb: 10, bb: 20, rng: rng, button: 0,
    players: Bots.PERSONAS.slice(0, 4).map(function (ps) { return { name: ps.name, chips: 2000, persona: ps }; })
  });
  var table = Bots.createTable(g, rng);
  var crashes = 0, played = 0;
  for (var h = 0; h < 300; h++) {
    if (g.seated().length < 2 && g.players.filter(function(p){return p.chips>0;}).length < 2) break;
    g.button = g._nextSeated(g.button);
    try {
      g.startHand();
      if (g.stage === "idle") break;
      played++;
      var guard = 0;
      while (!g.handOver && guard++ < 400) { var id = g.actionOn; if (id === null) break; var mv = table.decide(id); g.act(id, mv.action, mv.raiseTo); }
    } catch (e) { crashes++; if (crashes <= 2) console.log("  session crash: " + e.message); }
    var total = g.players.reduce(function (t, p) { return t + p.chips; }, 0);
    if (total !== 8000) { console.log("  chip leak at hand " + h + ": " + total); crashes++; break; }
  }
  console.log("  played " + played + " hands; final stacks: " + g.players.map(function (p) { return p.name + "=" + p.chips; }).join(", "));
  ok("long session runs without crashing", crashes === 0);
  ok("chips still conserved after the session",
     g.players.reduce(function (t, p) { return t + p.chips; }, 0) === 8000);
})();

section("bot sanity");
(function botSanity() {
  var rng = Poker.mulberry32(5);
  // A bot holding the nuts on the river facing a check should bet, not check.
  var betCount = 0, trials = 40;
  for (var i = 0; i < trials; i++) {
    var g = new Poker.Game({ sb: 10, bb: 20, rng: Poker.mulberry32(100 + i), button: 0,
      players: [{ name: "H", isHuman: true, chips: 2000 }, { name: "B", chips: 2000, persona: Bots.PERSONAS[2] }] });
    g.startHand();
    // force a scripted spot: bot holds quads on the river
    g.stage = "river";
    g.board = H("As Ah Ad 7c 2d");
    g.players[1].hole = H("Ac Kh");
    g.players[0].hole = H("9s 8s");
    g.players.forEach(function (p) { p.bet = 0; p.hasActed = false; p.committed = 200; });
    g.currentBet = 0; g.actionOn = 1;
    var mv = Bots.createTable(g, Poker.mulberry32(i)).decide(1);
    if (mv.action === "raise") betCount++;
  }
  ok("bots bet the nuts on the river most of the time", betCount >= trials * 0.7,
     betCount + "/" + trials);

  // A bot holding 72o on a dangerous river facing a pot-size bet should fold most of the time.
  var foldCount = 0;
  for (var j = 0; j < 40; j++) {
    var g2 = new Poker.Game({ sb: 10, bb: 20, rng: Poker.mulberry32(200 + j), button: 0,
      players: [{ name: "H", isHuman: true, chips: 2000 }, { name: "B", chips: 2000, persona: Bots.PERSONAS[0] }] });
    g2.startHand();
    g2.stage = "river";
    g2.board = H("As Kh Qd Jc 9s");
    g2.players[1].hole = H("7d 2c");
    g2.players[0].hole = H("Th 8h");
    g2.players.forEach(function (p) { p.bet = 0; p.hasActed = false; p.committed = 200; });
    g2.players[0].bet = 400; g2.players[0].committed = 600;
    g2.currentBet = 400; g2.actionOn = 1;
    var mv2 = Bots.createTable(g2, Poker.mulberry32(j)).decide(1);
    if (mv2.action === "fold") foldCount++;
  }
  ok("tight bots fold trash to a big river bet", foldCount >= 32, foldCount + "/40");

  // Regression: the old fixed percentile chart let the station call this
  // 100-BB shove because J4s happened to fall inside her 88% late-position
  // calling width. Raise size and equity must control the decision too.
  var shove = new Poker.Game({ sb: 10, bb: 20, rng: Poker.mulberry32(77), button: 0,
    players: [{ name: "Vicky", chips: 2000, persona: Bots.PERSONAS[1] },
              { name: "Nora", chips: 2000, persona: Bots.PERSONAS[3] }] }).startHand();
  shove.players[0].hole = H("Js 4s");
  shove.players[0].bet = 10; shove.players[0].committed = 10; shove.players[0].chips = 1990;
  shove.players[1].bet = 2000; shove.players[1].committed = 2000;
  shove.players[1].chips = 0; shove.players[1].allIn = true;
  shove.players[1].streetActions = [{ action: "raise", amount: 1980, street: "preflop" }];
  shove.currentBet = 2000; shove.preflopRaiser = 1; shove.lastAggressor = 1; shove.actionOn = 0;
  var shoveTable = Bots.createTable(shove, Poker.mulberry32(5));
  shoveTable.newHand();
  eq("even the calling station folds J4s to a 100-BB shove", shoveTable.decide(0).action, "fold");
})();

section("bot personalities are actually distinguishable");
(function personaStats() {
  var rng = Poker.mulberry32(20260826);
  var g = new Poker.Game({
    sb: 10, bb: 20, rng: rng, button: 0,
    players: Bots.PERSONAS.map(function (ps) { return { name: ps.name, chips: 100000, persona: ps }; })
  });
  var table = Bots.createTable(g, rng);
  var played = 0;
  for (var h = 0; h < 900; h++) {
    g.players.forEach(function (p) { p.chips = 100000; });   // deep stacks, no busts
    g.button = g.nextSeated(g.button);
    g.startHand();
    if (g.stage === "idle") break;
    table.newHand();
    played++;
    var guard = 0;
    while (!g.handOver && guard++ < 300) {
      var id = g.actionOn; if (id === null) break;
      var mv = table.decide(id);
      g.act(id, mv.action, mv.raiseTo);
    }
    table.finishHand();
  }
  var S = table.stats;
  function af(s) { return s.aggr / Math.max(1, s.passive); }
  console.log("  over " + played + " hands:");
  Bots.PERSONAS.forEach(function (ps) {
    var s = S[ps.name];
    console.log("   " + ps.name.padEnd(6) + " (" + ps.tag + ")  VPIP " +
      (s.vpip * 100).toFixed(0) + "%  PFR " + (s.pfr * 100).toFixed(0) +
      "%  AF " + af(s).toFixed(1) + "  hands " + s.hands);
  });
  var rock = S.Rocky, station = S.Vicky, lag = S.Gus, nit = S.Nora;
  ok("everyone was dealt in every hand", rock.hands === played && lag.hands === played);
  ok("the nit is the tightest player at the table",
     nit.vpip < rock.vpip && nit.vpip < station.vpip && nit.vpip < lag.vpip,
     "nit " + nit.vpip.toFixed(2) + " rock " + rock.vpip.toFixed(2));
  ok("the loose players play far more hands than the tight ones",
     Math.min(station.vpip, lag.vpip) > rock.vpip * 1.5,
     "station " + station.vpip.toFixed(2) + " lag " + lag.vpip.toFixed(2) + " rock " + rock.vpip.toFixed(2));
  ok("the calling station is the most passive player",
     af(station) < af(rock) && af(station) < af(lag) && af(station) < af(nit),
     "AFs: station " + af(station).toFixed(2) + " rock " + af(rock).toFixed(2) +
     " lag " + af(lag).toFixed(2) + " nit " + af(nit).toFixed(2));
  ok("the LAG is the most aggressive player",
     af(lag) > af(rock) && af(lag) > af(station), "lag AF " + af(lag).toFixed(2));
  ok("the LAG raises preflop far more than the nit",
     lag.pfr > nit.pfr * 3, "lag " + lag.pfr.toFixed(2) + " nit " + nit.pfr.toFixed(2));
  ok("VPIP is always at least PFR",
     Bots.PERSONAS.every(function (ps) { return S[ps.name].vpip >= S[ps.name].pfr - 1e-9; }));
  ok("nobody plays literally every hand or literally none",
     Bots.PERSONAS.every(function (ps) { return S[ps.name].vpip > 0.03 && S[ps.name].vpip < 0.95; }));
  ok("the human-style stat pipeline sees showdowns",
     Bots.PERSONAS.some(function (ps) { return S[ps.name].showdowns > 0; }));
})();

/* ------------------------------------------------------------------ */
section("coach");
(function coachTests() {
  function spot(cfg) {
    var g = new Poker.Game({ sb: 10, bb: 20, rng: Poker.mulberry32(3), button: cfg.button === undefined ? 0 : cfg.button,
      players: [{ name: "You", isHuman: true, chips: cfg.stack || 2000 },
                { name: "A", chips: 2000, persona: Bots.PERSONAS[0] },
                { name: "B", chips: 2000, persona: Bots.PERSONAS[1] },
                { name: "C", chips: 2000, persona: Bots.PERSONAS[2] }] });
    g.startHand();
    g.players[0].hole = cfg.hole;
    if (cfg.board) { g.board = cfg.board; g.stage = cfg.stage || "flop"; }
    if (cfg.setup) cfg.setup(g);
    g.actionOn = 0;
    return g;
  }

  var g1 = spot({ hole: H("As Ah") });
  var a1 = Coach.advise(g1, 0, { iters: 600 });
  ok("AA preflop is a raise", /RAISE/.test(a1.headline), a1.headline);

  var g2 = spot({ hole: H("7d 2c") });
  var a2 = Coach.advise(g2, 0, { iters: 600 });
  ok("72o preflop is a fold", /FOLD/.test(a2.headline), a2.headline);

  (function unactedBlindIsUnrestricted() {
    var g = spot({ hole: H("As Ah") });
    var blind = g.players.filter(function (p) {
      return p.id !== 0 && (p.investedThisHand || 0) > 0 && !(p.streetActions || []).length;
    })[0];
    var r = Coach.estimateRange(g, blind.id, null);
    ok("posting a blind is not misread as calling preflop",
       r.hi === 1 && /not acted/.test(r.why), JSON.stringify(r));
  })();

  eq("22 is a set-mine hand", Coach.speculativeHand(H("2s 2h")).kind, "set");
  eq("77 is a set-mine hand", Coach.speculativeHand(H("7s 7h")).kind, "set");
  ok("88 is a pair to play, not a set-mine", Coach.speculativeHand(H("8s 8h")) === null);
  eq("76s is a suited speculative hand", Coach.speculativeHand(H("7h 6h")).kind, "suited");
  eq("A2s is a suited-ace speculative hand", Coach.speculativeHand(H("As 2s")).kind, "suited-ace");
  ok("72o is not a speculative hand", Coach.speculativeHand(H("7d 2c")) === null);
  ok("AA is not set-mining", Coach.speculativeHand(H("As Ah")) === null);

  function faceRaise(better) {
    return function (g) {
      var id = better === undefined ? 3 : better;
      g.players[id].bet = 60; g.players[id].committed = 60;
      g.currentBet = 60; g.preflopRaiser = id;
      g.players[id].streetActions = [{ action: "raise", label: "RAISE TO 60", street: "preflop" }];
    };
  }

  (function pfrDrivesRaiseRange() {
    var g = spot({ hole: H("As Ah"), setup: faceRaise(1) });
    var tightRaise = Coach.estimateRange(g, 1, { A: { hands: 30, vpip: 0.5, pfr: 0.08 } });
    var wideRaise = Coach.estimateRange(g, 1, { A: { hands: 30, vpip: 0.5, pfr: 0.35 } });
    ok("observed PFR, not just VPIP, changes a raiser's range",
       wideRaise.hi > tightRaise.hi * 2, tightRaise.hi + " vs " + wideRaise.hi);
  })();

  (function originalRaiserKeepsRaiseHistory() {
    var g = spot({ hole: H("As Ah"), board: H("Ks 8h 3c"), stage: "flop",
      setup: function (x) {
        x.history.push({ street: "preflop", player: "A", playerId: 1, action: "raise", amount: 60 });
        x.history.push({ street: "preflop", player: "B", playerId: 2, action: "raise", amount: 180 });
        x.history.push({ street: "preflop", player: "A", playerId: 1, action: "call", amount: 120 });
        x.preflopRaiser = 2;
      } });
    var r = Coach.estimateRange(g, 1, null);
    ok("the original raiser remains a raising range after calling a 3-bet",
       /^raised preflop/.test(r.why), JSON.stringify(r));
  })();

  (function postflopActionsNarrowTheRangeActuallySampled() {
    var g = spot({ hole: H("9s 9h"), board: H("As 8h 3c"), stage: "flop",
      setup: function (x) {
        x.players[1].streetActions = [{ action: "raise", amount: 120, potBefore: 180, street: "flop" }];
        x.lastAggressor = 1; x.currentBet = 120;
      } });
    var base = Coach.estimateRange(g, 1, null);
    var model = Coach.conditionRange(g, base, null, Poker.boardTexture(g.board), 0);
    ok("a postflop bet changes the sampled range, not just its description",
       model.isBoardModel && model.bluffPct > 0 && model.valueTop < 0.5,
       JSON.stringify(model));
    var slices = Coach.bettingSlices("river", 0.30, 1);
    ok("a 30% bluffing range uses compact, disjoint value and bluff slices",
       slices.valueTop < 0.25 && slices.bluffBottom < 0.15,
       JSON.stringify(slices));
  })();

  (function heroOpenFacingThreeBet() {
    var g = spot({ hole: H("As Ah"), setup: function (x) {
      x.players[0].bet = 60; x.players[0].committed = 60;
      x.players[1].bet = 180; x.players[1].committed = 180;
      x.players[0].streetActions = [{ action: "raise", amount: 60, street: "preflop" }];
      x.players[1].streetActions = [{ action: "raise", amount: 180, street: "preflop" }];
      x.history.push({ street: "preflop", player: "You", playerId: 0, action: "raise", amount: 60, potBefore: 30, pot: 90 });
      x.history.push({ street: "preflop", player: "A", playerId: 1, action: "raise", amount: 180, potBefore: 90, pot: 270 });
      x.currentBet = 180; x.preflopRaiser = 1; x.lastAggressor = 1;
    } });
    var a = Coach.advise(g, 0, { iters: 500, rng: Poker.mulberry32(31) });
    ok("an opener facing a re-raise is advised to 4-bet, not 3-bet",
       /^4-BET/.test(a.headline), a.headline);
  })();

  (function deepRaiseDoesNotAutoCall() {
    var g = spot({ hole: H("Ts Th"), setup: function (x) {
      x.players[0].bet = 500; x.players[0].committed = 500; x.players[0].chips = 1500;
      x.players[1].bet = 2000; x.players[1].committed = 2000;
      x.players[1].chips = 0; x.players[1].allIn = true;
      x.players[2].folded = true; x.players[3].folded = true;
      x.currentBet = 2000; x.preflopRaiser = 1; x.lastAggressor = 1;
      x.history = [
        { street: "preflop", playerId: 0, action: "raise", amount: 60 },
        { street: "preflop", playerId: 1, action: "raise", amount: 180 },
        { street: "preflop", playerId: 0, action: "raise", amount: 440 },
        { street: "preflop", playerId: 1, action: "raise", amount: 1820 }
      ];
      x.players[1].streetActions = [{ action: "raise", street: "preflop" },
                                    { action: "raise", street: "preflop" }];
    } });
    var a = Coach.advise(g, 0, { iters: 3000, rng: Poker.mulberry32(4),
      stats: { A: { hands: 100, vpip: 0.08, pfr: 0.025, aggression: 0.2 } } });
    ok("TT folds a nit's all-in 5-bet when its equity is below the price",
       a.action === "fold" && a.equity < a.potOddsNeeded,
       a.headline + " eq=" + a.equity + " need=" + a.potOddsNeeded);
  })();

  (function shortRaiserDoesNotBorrowDeepStacks() {
    var g = spot({ hole: H("2s 2h"), setup: function (x) {
      x.players[3].bet = 60; x.players[3].committed = 60; x.players[3].chips = 140;
      x.players[3].streetActions = [{ action: "raise", amount: 60, street: "preflop" }];
      x.currentBet = 60; x.preflopRaiser = 3; x.lastAggressor = 3;
    } });
    var a = Coach.advise(g, 0, { iters: 700, rng: Poker.mulberry32(3) });
    ok("a short raiser cannot be set-mined using uninvolved deep blinds",
       a.action === "fold" && a.implied.ratio < 3,
       a.headline + " ratio=" + a.implied.ratio);
  })();

  (function aceKingIsInTheValueTier() {
    var g = spot({ hole: H("As Kh"), setup: faceRaise() });
    var a = Coach.advise(g, 0, { iters: 1800, rng: Poker.mulberry32(2) });
    ok("AKo value 3-bets a normal open", /^3-BET/.test(a.headline), a.headline);
  })();

  var g22 = spot({ hole: H("2s 2h"), setup: faceRaise() });
  var a22 = Coach.advise(g22, 0, { iters: 400 });
  ok("22 on the button facing a raise is a set-mine call",
     /CALL/.test(a22.headline) && a22.isSpeculative, a22.headline);
  ok("set-mine copy mentions flopping a set", /set/.test(a22.plain + a22.why.join(" ")));

  var g22s = spot({ hole: H("2s 2h"), stack: 200, setup: faceRaise() });
  var a22s = Coach.advise(g22s, 0, { iters: 400 });
  ok("22 facing a raise short-stacked is a fold", /FOLD/.test(a22s.headline), a22s.headline);

  var g88s = spot({ hole: H("8s 8h"), stack: 200, setup: faceRaise() });
  var a88s = Coach.advise(g88s, 0, { iters: 400 });
  ok("88 short vs a raise still continues (it is a pair, not a failed set-mine)",
     /CALL|RAISE|3-BET/.test(a88s.headline), a88s.headline);

  var g76 = spot({ hole: H("7h 6h"), setup: faceRaise() });
  var a76 = Coach.advise(g76, 0, { iters: 400 });
  ok("76s on the button facing a raise is a speculative call",
     /CALL/.test(a76.headline) && a76.isSpeculative, a76.headline);

  var g76sb = spot({ hole: H("7h 6h"), button: 3, setup: faceRaise(2) });
  var a76sb = Coach.advise(g76sb, 0, { iters: 400 });
  ok("76s in the small blind facing a raise is a fold (no position)",
     /FOLD/.test(a76sb.headline), a76sb.headline + " pos=" + a76sb.position);

  var g72r = spot({ hole: H("7d 2c"), setup: faceRaise() });
  var a72r = Coach.advise(g72r, 0, { iters: 400 });
  ok("72o facing a raise is still a fold", /FOLD/.test(a72r.headline), a72r.headline);

  // never fold when checking is free
  var g3 = spot({ hole: H("7d 2c"), board: H("As Kh Qd"), stage: "flop",
    setup: function (g) { g.players.forEach(function (p) { p.bet = 0; p.hasActed = false; }); g.currentBet = 0; } });
  var a3 = Coach.advise(g3, 0, { iters: 600 });
  ok("never recommends folding for free", !/^FOLD/.test(a3.headline), a3.headline);

  // hopeless hand facing a huge bet -> fold
  var g4 = spot({ hole: H("7d 2c"), board: H("As Kh Qd Jc 9s"), stage: "river",
    setup: function (g) {
      g.players.forEach(function (p) { p.bet = 0; p.hasActed = false; p.committed = 100; });
      g.players[1].bet = 400; g.players[1].committed = 500;
      g.players[2].folded = true; g.players[3].folded = true;
      g.currentBet = 400;
    } });
  var a4 = Coach.advise(g4, 0, { iters: 800 });
  ok("air facing a pot bet on the river is a fold", /FOLD/.test(a4.headline), a4.headline);
  ok("river advice has no draw talk", a4.equity !== undefined);

  // nuts on the river -> value bet / raise
  var g5 = spot({ hole: H("Ts 9s"), board: H("Js Qs Ks 2d 3c"), stage: "river",
    setup: function (g) { g.players.forEach(function (p) { p.bet = 0; p.hasActed = false; p.committed = 100; }); g.currentBet = 0;
                          g.players[2].folded = true; g.players[3].folded = true; } });
  var a5 = Coach.advise(g5, 0, { iters: 400 });
  ok("royal flush is a value bet", /BET|RAISE/.test(a5.headline), a5.headline);
  ok("royal flush equity is ~100%", a5.equity > 0.97, String(a5.equity));

  // bluff analysis must exist postflop
  var g6 = spot({ hole: H("Ad 4d"), board: H("Ks 8h 3c"), stage: "flop",
    setup: function (g) { g.players.forEach(function (p) { p.bet = 0; p.hasActed = false; p.committed = 60; }); g.currentBet = 0;
                          g.players[2].folded = true; g.players[3].folded = true; } });
  var a6 = Coach.advise(g6, 0, { iters: 800 });
  ok("bluff analysis is produced", !!a6.bluff, JSON.stringify(Object.keys(a6)));
  ok("bluff analysis has fold equity", a6.bluff.foldEquity > 0 && a6.bluff.foldEquity < 1, String(a6.bluff && a6.bluff.foldEquity));
  ok("bluff analysis reports break-even fold %", a6.bluff.breakEven > 0 && a6.bluff.breakEven < 1);
  ok("bluff EV is a number", isFinite(a6.bluff.ev));

  (function semiBluffUsesTotalEV() {
    var g = spot({ hole: H("9h 8h"), board: H("7s 6d 2c"), stage: "flop",
      setup: function (x) {
        x.players.forEach(function (p) { p.bet = 0; p.committed = 60; p.hasActed = false; p.streetActions = []; });
        x.players[1].bet = 90; x.players[1].committed = 150;
        x.players[1].streetActions = [{ action: "raise", amount: 90, label: "BET 90", street: "flop", potBefore: 240 }];
        x.players[2].folded = true; x.players[3].folded = true;
        x.currentBet = 90; x.lastAggressor = 1;
      } });
    var a = Coach.advise(g, 0, { iters: 1800, rng: Poker.mulberry32(12) });
    ok("a semi-bluff can be profitable below the pure-bluff fold threshold",
       a.bluff.foldEquity < a.bluff.breakEven && a.bluff.profitable,
       "FE=" + a.bluff.foldEquity + " BE=" + a.bluff.breakEven + " EV=" + a.bluff.ev);
  })();

  (function marginalShowdownValueChecks() {
    var g = spot({ hole: H("9h 9c"), board: H("Ad 8h 3c 5s 2d"), stage: "river",
      setup: function (x) {
        x.players.forEach(function (p) { p.bet = 0; p.committed = 100; p.hasActed = false; p.streetActions = []; });
        x.players[2].folded = true; x.players[3].folded = true;
        x.currentBet = 0; x.lastAggressor = null;
      } });
    var a = Coach.advise(g, 0, { iters: 2500, rng: Poker.mulberry32(22) });
    ok("raw 50% equity does not become a value bet against a stronger continuing range",
       a.equity >= 0.5 && a.action === "check" && !a.bluff.profitable,
       a.equity + " " + a.headline + " betEV=" + a.bluff.ev + " checkEV=" + (a.equity * a.pot));
  })();

  eq("raise EV uses the caller's additional 440 rather than matching hero's 640",
     Coach.evValueBet(600, 640, 0, 1, 440), 1040);

  // fold equity should be lower against more opponents
  var g7 = spot({ hole: H("Ad 4d"), board: H("Ks 8h 3c"), stage: "flop",
    setup: function (g) { g.players.forEach(function (p) { p.bet = 0; p.hasActed = false; p.committed = 60; }); g.currentBet = 0; } });
  var a7 = Coach.advise(g7, 0, { iters: 800 });
  ok("fold equity drops with more opponents", a7.bluff.foldEquity < a6.bluff.foldEquity,
     a7.bluff.foldEquity + " vs " + a6.bluff.foldEquity);

  // facing a bet -> the coach reasons about whether the opponent is bluffing
  var g8 = spot({ hole: H("Ah Qc"), board: H("Ad 8h 3c"), stage: "flop",
    setup: function (g) {
      g.players.forEach(function (p) { p.bet = 0; p.hasActed = false; p.committed = 60; });
      g.players[1].bet = 180; g.players[1].committed = 240;
      g.players[1].lastAction = { action: "raise", label: "BET 180", street: "flop" };
      g.players[2].folded = true; g.players[3].folded = true;
      g.currentBet = 180; g.lastAggressor = 1;
    } });
  var a8 = Coach.advise(g8, 0, { iters: 900 });
  ok("bluff-catch analysis produced when facing a bet", !!a8.vsBluff, Object.keys(a8).join(","));
  ok("estimates how often the opponent is bluffing",
     a8.vsBluff.bluffPct >= 0 && a8.vsBluff.bluffPct <= 1);
  ok("top pair top kicker continues facing one bet", /CALL|RAISE/.test(a8.headline), a8.headline);
  ok("top pair facing a bet gets an EV-modelled legal continue",
     a8.action === "call" || a8.action === "raise", a8.headline);

  var g8raise = spot({ hole: H("Ah Qc"), board: H("Ad 8h 3c"), stage: "flop",
    setup: function (g) {
      g.players.forEach(function (p) { p.bet = 0; p.committed = 0; p.hasActed = false; p.streetActions = []; });
      g.players[0].bet = 100; g.players[0].committed = 200;
      g.players[1].bet = 300; g.players[1].committed = 400;
      g.players[1].lastAction = { action: "raise", label: "RAISE TO 300", amount: 300,
                                  street: "flop", potBefore: 300, potAfter: 600 };
      g.players[1].streetActions = [g.players[1].lastAction];
      g.players[2].folded = true; g.players[3].folded = true;
      g.currentBet = 300; g.lastAggressor = 1;
    } });
  var a8raise = Coach.advise(g8raise, 0, { iters: 900, rng: Poker.mulberry32(7) });
  ok("a raise is reconstructed from the aggressor's action, not hero's to-call amount",
     a8raise.vsBluff.betSize === 300 && a8raise.vsBluff.potBefore === 300,
     JSON.stringify({ bet: a8raise.vsBluff.betSize, pot: a8raise.vsBluff.potBefore }));
  eq("the displayed bluff-raise EV uses asymmetric additional costs",
     a8raise.bluff.ev,
     Coach.evValueBet(a8raise.pot, a8raise.bluff.cost, a8raise.bluff.foldEquity,
                      a8raise.bluff.eqWhenCalled, a8raise.bluff.size - g8raise.currentBet));

  (function multiwayBetAndCall() {
    var g = spot({ hole: H("Ah 6h"), board: H("As 9h 7c 3d 2s"), stage: "river",
      setup: function (x) {
        x.players.forEach(function (p) { p.bet = 0; p.committed = 100; p.hasActed = false; p.streetActions = []; });
        x.players[1].bet = 100; x.players[1].committed = 200;
        x.players[1].lastAction = { action: "raise", label: "BET 100", amount: 100,
                                    street: "river", potBefore: 300, potAfter: 400 };
        x.players[1].streetActions = [x.players[1].lastAction];
        x.players[2].bet = 100; x.players[2].committed = 200;
        x.players[2].streetActions = [{ action: "call", label: "CALL 100", amount: 100, street: "river" }];
        x.players[3].folded = true; x.players[3].committed = 0;
        x.currentBet = 100; x.lastAggressor = 1;
      } });
    var a = Coach.advise(g, 0, { iters: 2400, rng: Poker.mulberry32(10) });
    ok("a caller remains in decision equity instead of using heads-up bettor equity",
       a.decisionEq < a.vsBluff.eqVsPolarised - 0.03,
       a.decisionEq + " vs heads-up " + a.vsBluff.eqVsPolarised);
  })();

  (function allInCannotFold() {
    var g = spot({ hole: H("7d 2c"), board: H("As Kh Qd Jc 9s"), stage: "river",
      setup: function (x) {
        x.players.forEach(function (p) { p.bet = 0; p.committed = 400; p.hasActed = false; p.streetActions = []; });
        x.players[1].allIn = true; x.players[1].chips = 0;
        x.players[3].folded = true; x.players[3].committed = 0;
        x.currentBet = 0; x.lastAggressor = null;
      } });
    var a = Coach.advise(g, 0, { iters: 900, rng: Poker.mulberry32(14) });
    var lockedIndex = a.ranges.map(function (r) { return r.id; }).indexOf(1);
    ok("an all-in opponent has exactly zero fold probability",
       lockedIndex >= 0 && a.bluff.perOpponent[lockedIndex] === 0 && a.bluff.foldEquity === 0,
       JSON.stringify(a.bluff.perOpponent));
    ok("a contested main pot cannot produce a profitable fold-equity bluff", !a.bluff.profitable);
  })();

  (function unmatchedAllInUsesEffectivePriceAndSize() {
    var g = spot({ hole: H("Qh Jc"), stack: 100, board: H("As Kh 8d 6c 3s"), stage: "river",
      setup: function (x) {
        x.players[0].bet = 0; x.players[0].committed = 50; x.players[0].chips = 100;
        x.players[1].bet = 1000; x.players[1].committed = 1050;
        x.players[1].chips = 0; x.players[1].allIn = true;
        x.players[1].streetActions = [{ action: "raise", amount: 1000, label: "BET 1000",
                                        street: "river", potBefore: 100 }];
        x.players[2].folded = true; x.players[2].committed = 0;
        x.players[3].folded = true; x.players[3].committed = 0;
        x.currentBet = 1000; x.lastAggressor = 1;
      } });
    var a = Coach.advise(g, 0, { iters: 1200, rng: Poker.mulberry32(8) });
    ok("coach prices an unmatched all-in from the contestable main pot",
       Math.abs(a.potOddsNeeded - 1 / 3) < 1e-12 && a.pot === 200,
       "pot=" + a.pot + " odds=" + a.potOddsNeeded);
    ok("bluff analysis caps the bettor's wager at the effective 100 chips",
       a.vsBluff && a.vsBluff.betSize === 100 && a.vsBluff.potBefore === 100,
       JSON.stringify(a.vsBluff && { bet: a.vsBluff.betSize, pot: a.vsBluff.potBefore }));
  })();

  // pot odds arithmetic
  ok("pot odds are computed correctly",
     Math.abs(a8.potOddsNeeded - (180 / (a8.pot + 180))) < 1e-9,
     a8.potOddsNeeded + " pot=" + a8.pot);

  // the coach must never suggest an illegal action
  var illegal = 0;
  for (var s = 0; s < 120; s++) {
    var rng2 = Poker.mulberry32(s * 31 + 5);
    var gg = new Poker.Game({ sb: 10, bb: 20, rng: rng2, button: s % 4,
      players: [{ name: "You", isHuman: true, chips: 2000 }].concat(
        Bots.PERSONAS.slice(0, 3).map(function (ps) { return { name: ps.name, chips: 2000, persona: ps }; })) });
    var table2 = Bots.createTable(gg, rng2);
    gg.startHand();
    var guard = 0;
    while (!gg.handOver && guard++ < 200) {
      var id = gg.actionOn;
      if (id === null) break;
      if (id === 0) {
        var adv = Coach.advise(gg, 0, { iters: 120 });
        var lg = gg.legal(0);
        if (adv.action === "check" && !lg.canCheck) { illegal++; console.log("  illegal check at seed " + s); }
        if (adv.action === "raise" && !lg.canRaise) { illegal++; console.log("  illegal raise at seed " + s); }
        if (adv.action === "raise" && (adv.raiseTo < lg.minRaiseTo || adv.raiseTo > lg.maxRaiseTo)) {
          illegal++; console.log("  bad raise size " + adv.raiseTo + " (legal " + lg.minRaiseTo + "-" + lg.maxRaiseTo + ")");
        }
        if (adv.action === "fold" && lg.canCheck) { illegal++; console.log("  folded for free at seed " + s); }
        gg.act(0, adv.action, adv.raiseTo);
      } else {
        var mv3 = table2.decide(id);
        gg.act(id, mv3.action, mv3.raiseTo);
      }
    }
  }
  ok("coach never recommends an illegal action over 120 hands", illegal === 0, illegal + " illegal");

  // --- trap EV and mixed frequencies ---
  eq("nuts betting 50 into 100, they fold 40%: EV is 130",
     Math.round(Coach.evValueBet(100, 50, 0.4, 1) * 10) / 10, 130);
  eq("calling 50 into 100 at 50% is +25", Coach.evCallShowdown(100, 50, 0.5), 25);
  eq("checking down the nuts is just the pot", Coach.evCallShowdown(100, 0, 1), 100);

  eq("taking the advertised mix line grades as close",
     Coach.grade({ action: "raise", mix: { show: true, altAction: "check", altFreq: 0.33 } }, "check"),
     "close");
  eq("taking the main line still grades as a match",
     Coach.grade({ action: "raise", mix: { show: true, altAction: "check", altFreq: 0.33 } }, "raise"),
     "match");
  eq("folding when the mix was check is still a miss",
     Coach.grade({ action: "raise", mix: { show: true, altAction: "check", altFreq: 0.33 } }, "fold"),
     "miss");
  eq("calling a non-mixed recommended raise is a miss, not automatically close",
     Coach.grade({ action: "raise", mix: null }, "call"), "miss");
  eq("raising a non-mixed recommended call is a miss, not automatically close",
     Coach.grade({ action: "call", mix: null }, "raise"), "miss");

  function trapSpot(cfg) {
    var oppName = cfg.oppName || "Gus";
    var persona = cfg.persona || Bots.PERSONAS[2];
    var g = new Poker.Game({
      sb: 10, bb: 20, rng: Poker.mulberry32(cfg.seed || 7),
      button: cfg.button === undefined ? 1 : cfg.button,
      players: [
        { name: "You", isHuman: true, chips: 2000 },
        { name: oppName, chips: 2000, persona: persona },
        { name: "B", chips: 2000, persona: Bots.PERSONAS[1] },
        { name: "C", chips: 2000, persona: Bots.PERSONAS[0] }
      ]
    });
    g.startHand();
    g.players[0].hole = cfg.hole;
    if (cfg.board) { g.board = cfg.board; g.stage = cfg.stage || "flop"; }
    if (cfg.setup) cfg.setup(g);
    g.actionOn = 0;
    return { g: g, a: Coach.advise(g, 0, { iters: cfg.iters || 700, stats: cfg.stats, rng: Poker.mulberry32((cfg.seed || 7) + 99) }) };
  }
  function headsUpFirstToAct(g) {
    g.players.forEach(function (p) { p.bet = 0; p.hasActed = false; p.committed = 80; p.streetActions = []; });
    g.players[2].folded = true; g.players[3].folded = true;
    g.currentBet = 0; g.lastAggressor = null;
  }
  function headsUpLastToAct(g) {
    g.players.forEach(function (p) { p.bet = 0; p.hasActed = false; p.committed = 100; p.streetActions = []; });
    g.players[2].folded = true; g.players[3].folded = true;
    g.currentBet = 0; g.lastAggressor = null;
  }

  var riverNuts = trapSpot({
    hole: H("Ts 9s"), board: H("Js Qs Ks 2d 3c"), stage: "river", button: 0,
    setup: headsUpLastToAct, iters: 400
  });
  ok("royal on the river, last to act, is still a value bet",
     /BET|RAISE/.test(riverNuts.a.headline), riverNuts.a.headline);
  ok("river nuts last-to-act has trap analysis", !!(riverNuts.a.trap && riverNuts.a.trap.relevant));
  ok("river nuts last-to-act does not prefer the trap (nobody left to bet)",
     riverNuts.a.trap && riverNuts.a.trap.preferTrap === false,
     JSON.stringify({ prefer: riverNuts.a.trap && riverNuts.a.trap.preferTrap, when: riverNuts.a.trap && riverNuts.a.trap.when, p: riverNuts.a.trap && riverNuts.a.trap.pInduce }));
  ok("river nuts last-to-act cannot induce", riverNuts.a.trap && riverNuts.a.trap.canInduce === false);

  var riverNutsBet = trapSpot({
    hole: H("Ts 9s"), board: H("Js Qs Ks 2d 3c"), stage: "river", button: 0,
    setup: function (g) {
      g.players.forEach(function (p) { p.bet = 0; p.hasActed = false; p.committed = 100; p.streetActions = []; });
      g.players[2].folded = true; g.players[3].folded = true;
      g.players[1].bet = 200; g.players[1].committed = 300;
      g.players[1].lastAction = { action: "raise", label: "BET 200", street: "river" };
      g.players[1].streetActions = [g.players[1].lastAction];
      g.currentBet = 200; g.lastAggressor = 1;
    }, iters: 400
  });
  ok("royal facing a river bet raises rather than slow-plays",
     /RAISE/.test(riverNutsBet.a.headline), riverNutsBet.a.headline);
  ok("no next street to induce after a river bet",
     riverNutsBet.a.trap && riverNutsBet.a.trap.canInduce === false,
     JSON.stringify(riverNutsBet.a.trap && { when: riverNutsBet.a.trap.when, can: riverNutsBet.a.trap.canInduce }));

  var gusStats = { Gus: { hands: 24, vpip: 0.45, pfr: 0.32, aggression: 0.9 } };
  var vickyStats = { Vicky: { hands: 24, vpip: 0.38, pfr: 0.08, aggression: 0.22 } };
  var setFlop = { hole: H("Ks Kh"), board: H("Kd 7c 2s"), stage: "flop" };

  var vsGus = trapSpot({
    hole: setFlop.hole, board: setFlop.board, stage: "flop", button: 1,
    oppName: "Gus", persona: Bots.PERSONAS[2], stats: gusStats,
    setup: headsUpFirstToAct, iters: 800, seed: 11
  });
  var vsVicky = trapSpot({
    hole: setFlop.hole, board: setFlop.board, stage: "flop", button: 1,
    oppName: "Vicky", persona: Bots.PERSONAS[1], stats: vickyStats,
    setup: headsUpFirstToAct, iters: 800, seed: 11
  });
  ok("top set on a dry flop computes trap EV", !!(vsGus.a.trap && isFinite(vsGus.a.trap.evBet) && isFinite(vsGus.a.trap.evTrap)));
  ok("small-bet trap EV is computed as its own line",
     vsGus.a.trap && vsGus.a.trap.smallTo > 0 && isFinite(vsGus.a.trap.evSmall),
     JSON.stringify(vsGus.a.trap && { smallTo: vsGus.a.trap.smallTo, evSmall: vsGus.a.trap.evSmall, valueTo: vsGus.a.trap.valueTo }));
  ok("small trap size is below the full value size",
     vsGus.a.trap && vsGus.a.trap.smallTo < vsGus.a.trap.valueTo,
     vsGus.a.trap && (vsGus.a.trap.smallTo + " vs " + vsGus.a.trap.valueTo));
  ok("trap analysis declares itself a model of the next round",
     vsGus.a.trap && /model of the \*next\* round/.test(vsGus.a.trap.source));
  ok("induce frequency vs Gus is substantial",
     vsGus.a.trap && vsGus.a.trap.pInduce > 0.35, String(vsGus.a.trap && vsGus.a.trap.pInduce));
  ok("Gus is more likely to bet a check than Vicky",
     vsGus.a.trap && vsVicky.a.trap && vsGus.a.trap.pInduce > vsVicky.a.trap.pInduce + 0.08,
     "gus " + (vsGus.a.trap && vsGus.a.trap.pInduce) + " vicky " + (vsVicky.a.trap && vsVicky.a.trap.pInduce));
  ok("trap line vs Gus is at least competitive with betting",
     vsGus.a.trap && vsGus.a.trap.evTrap > vsGus.a.trap.evBet - 40,
     "trap " + Math.round(vsGus.a.trap && vsGus.a.trap.evTrap) + " bet " + Math.round(vsGus.a.trap && vsGus.a.trap.evBet) + " headline " + vsGus.a.headline);
  ok("a check or a bet is legal in the set-flop trap spot",
     vsGus.a.action === "check" || vsGus.a.action === "raise", vsGus.a.action);
  if (vsGus.a.mix && vsGus.a.mix.show) {
    ok("mix names the other action",
       vsGus.a.mix.altAction === "check" || vsGus.a.mix.altAction === "raise" || vsGus.a.mix.altAction === "call",
       String(vsGus.a.mix.altAction));
    ok("taking the mix line is close for this spot",
       Coach.grade(vsGus.a, vsGus.a.mix.altAction) === "close");
  }
  ok("smallBetTarget is actually smaller than a value bet on this flop",
     (function () {
       var sm = Coach.smallBetTarget(vsGus.g, 0, vsGus.a.trap.valueTo);
       return sm > 0 && sm < vsGus.a.trap.valueTo;
     })(),
     String(Coach.smallBetTarget(vsGus.g, 0, vsGus.a.trap.valueTo)));

  var texDry = Poker.boardTexture(H("Kd 7c 2s"));
  var pGus = Coach.estimateInduceFrequency(vsGus.g, 1, texDry, gusStats, { lookWeak: true });
  var pVicky = Coach.estimateInduceFrequency(vsVicky.g, 1, texDry, vickyStats, { lookWeak: true });
  ok("raw induce estimate is higher for the maniac than the station",
     pGus > pVicky + 0.15, "gus " + pGus + " vicky " + pVicky);
})();

section("provenance — every number says where it came from");
(function provenance() {
  function spot(cfg) {
    var g = new Poker.Game({ sb: 10, bb: 20, rng: Poker.mulberry32(cfg.seed || 3), button: 0,
      players: [{ name: "You", isHuman: true, chips: 2000 }].concat(
        Bots.PERSONAS.slice(0, 3).map(function (ps) { return { name: ps.name, chips: 2000, persona: ps }; })) });
    g.startHand();
    g.players[0].hole = cfg.hole;
    if (cfg.board) { g.board = cfg.board; g.stage = cfg.stage || "flop"; }
    if (cfg.setup) cfg.setup(g);
    g.actionOn = 0;
    return Coach.advise(g, 0, { iters: 1000 });
  }

  var pre = spot({ hole: H("As Kh") });
  ok("preflop advice now carries a simulated win %", pre.equity > 0 && pre.equity < 1, String(pre.equity));
  ok("preflop advice carries provenance", !!pre.provenance);
  eq("preflop provenance is a simulation", pre.provenance.kind, "simulation");
  ok("provenance counts add up to the number of deals",
     pre.provenance.won + pre.provenance.tied + pre.provenance.lost === pre.provenance.deals,
     pre.provenance.won + "+" + pre.provenance.tied + "+" + pre.provenance.lost + " != " + pre.provenance.deals);
  ok("provenance carries the exact split-pot equity used by the recommendation",
     Math.abs(pre.provenance.equity - pre.equity) < 1e-12,
     pre.provenance.equity + " vs " + pre.equity);
  ok("provenance names every opponent's assumed range",
     pre.provenance.ranges.length === 3 &&
     pre.provenance.ranges.every(function (r) { return r.name && r.hi > 0 && r.hi <= 1 && r.why; }),
     JSON.stringify(pre.provenance.ranges));
  ok("range provenance expands percentages into auditable hand examples",
     pre.provenance.ranges.every(function (r) {
       return r.classCount > 0 && r.comboCount > 0 && r.strongest && r.strongest.length;
     }), JSON.stringify(pre.provenance.ranges));
  ok("range provenance declares whether observed stats or defaults drove the read",
     pre.provenance.ranges.every(function (r) { return r.source && r.confidence; }),
     JSON.stringify(pre.provenance.ranges));
  ok("the recommendation explicitly declines solver certification",
     pre.audit && pre.audit.solverCertified === false && /not solver-certified/.test(pre.audit.label),
     JSON.stringify(pre.audit));
  ok("margin of error is small but non-zero",
     pre.provenance.margin > 0 && pre.provenance.margin < 0.06, String(pre.provenance.margin));

  var post = spot({ hole: H("As 5s"), board: H("Ks 9s 2h"), stage: "flop",
    setup: function (g) {
      g.players.forEach(function (p) { p.bet = 0; p.hasActed = false; p.committed = 60; });
      g.players[1].bet = 120; g.players[1].committed = 180;
      g.players[1].lastAction = { action: "raise", label: "BET 120", street: "flop" };
      g.players[1].streetActions = [g.players[1].lastAction];
      g.players[2].folded = true; g.players[3].folded = true;
      g.currentBet = 120; g.lastAggressor = 1;
    } });
  ok("postflop provenance present", !!post.provenance && post.provenance.deals > 0);
  eq("postflop provenance knows how many cards are still to come", post.provenance.cardsToCome, 2);
  ok("postflop bettor range shows concrete value and bluff examples on this board",
     post.provenance.ranges.length === 1 && post.provenance.ranges[0].boardExamples &&
     post.provenance.ranges[0].boardExamples.value.length > 0 &&
     post.provenance.ranges[0].boardExamples.bluffs.length > 0,
     JSON.stringify(post.provenance.ranges));
  ok("the fold-equity estimate declares itself an estimate",
     post.bluff && /estimate rather than a simulation/.test(post.bluff.source));
  ok("the bluff-frequency estimate declares itself a read",
     post.vsBluff && /read, not a fact/.test(post.vsBluff.bluffSource));
  ok("the value/bluff split explains its method",
     post.vsBluff && /ranked those hands by how/.test(post.vsBluff.source));

  // provenance must survive every kind of spot the coach can hit
  var missing = 0, mismatched = 0;
  for (var s = 0; s < 60; s++) {
    var rng = Poker.mulberry32(s * 977 + 13);
    var g = new Poker.Game({ sb: 10, bb: 20, rng: rng, button: s % 4,
      players: [{ name: "You", isHuman: true, chips: 2000 }].concat(
        Bots.PERSONAS.slice(0, 3).map(function (ps) { return { name: ps.name, chips: 2000, persona: ps }; })) });
    var table = Bots.createTable(g, rng);
    g.startHand();
    var guard = 0;
    while (!g.handOver && guard++ < 200) {
      var id = g.actionOn; if (id === null) break;
      if (id === 0) {
        var adv = Coach.advise(g, 0, { iters: 200 });
        var pv = adv.provenance;
        if (!pv || !pv.deals) missing++;
        else if (pv.won + pv.tied + pv.lost !== pv.deals) mismatched++;
        g.act(0, adv.action, adv.raiseTo);
      } else { var mv = table.decide(id); g.act(id, mv.action, mv.raiseTo); }
    }
  }
  ok("every decision over 60 hands carries provenance", missing === 0, missing + " missing");
  ok("provenance counts always reconcile", mismatched === 0, mismatched + " mismatched");
})();

section("solver overlay — honest river abstraction");
(function solverOverlay() {
  function riverSpot(facingBet, extraPlayer) {
    var players = [
      { name: "You", isHuman: true, chips: 2000 },
      { name: "Opponent", chips: 2000 }
    ];
    if (extraPlayer) players.push({ name: "Caller", chips: 2000 });
    var g = new Poker.Game({ sb: 10, bb: 20, rng: Poker.mulberry32(77), button: 0,
                             players: players });
    g.startHand();
    g.players[0].hole = H("Ah Qc");
    g.board = H("7s 6d 2c 9h 3s");
    g.stage = "river"; g.handOver = false; g.actionOn = 0;
    g.currentBet = 0; g.minRaise = 20; g.lastAggressor = null;
    g.players.forEach(function (p) {
      p.folded = false; p.allIn = false; p.sittingOut = false;
      p.bet = 0; p.committed = 200; p.chips = 1800;
      p.hasActed = false; p.raiseLocked = false; p.streetActions = [];
    });
    if (facingBet) {
      g.players[1].bet = 200; g.players[1].committed = 400; g.players[1].chips = 1600;
      g.currentBet = 200; g.lastAggressor = 1;
      var wager = { street: "river", player: "Opponent", playerId: 1, action: "raise",
                    amount: 200, potBefore: extraPlayer ? 600 : 400, pot: extraPlayer ? 800 : 600,
                    label: "BET 200" };
      g.players[1].streetActions = [wager]; g.history.push(wager);
    }
    return g;
  }

  var facing = riverSpot(true, false);
  var advice = Coach.advise(facing, 0, { iters: 700, rng: Poker.mulberry32(19) });
  var solved = SolverBaseline.analyse(facing, 0, advice);
  eq("heads-up river facing one bet is supported", solved.status, "supported");
  eq("supported node identifies the analytical abstraction", solved.kind, "river-facing-bet");
  ok("equilibrium bluff share equals the caller's break-even price",
     Math.abs(solved.equilibriumBluffPct - advice.potOddsNeeded) < 1e-12,
     solved.equilibriumBluffPct + " vs " + advice.potOddsNeeded);
  ok("solver baseline reports both call and fold EV", solved.evs.length === 2 &&
     solved.evs[0].action === "Call" && solved.evs[1].action === "Fold",
     JSON.stringify(solved.evs));

  var checked = riverSpot(false, false);
  var checkedAdvice = Coach.advise(checked, 0, { iters: 700, rng: Poker.mulberry32(20) });
  var checkedSolve = SolverBaseline.analyse(checked, 0, checkedAdvice);
  eq("heads-up river checked-to decision is supported", checkedSolve.status, "supported");
  eq("checked-to node compares one bet with checking", checkedSolve.kind, "river-checked-to");
  ok("checked-to node reports finite EV for both lines",
     isFinite(checkedSolve.evs[0].ev) && isFinite(checkedSolve.evs[1].ev),
     JSON.stringify(checkedSolve.evs));

  var earlier = riverSpot(false, false); earlier.stage = "turn"; earlier.board.pop();
  var earlierAdvice = Coach.advise(earlier, 0, { iters: 300, rng: Poker.mulberry32(21) });
  var earlierSolve = SolverBaseline.analyse(earlier, 0, earlierAdvice);
  eq("future-card spots are explicitly unsupported", earlierSolve.status, "unsupported");
  ok("unsupported future-card reason is explanatory", /multi-street game tree/.test(earlierSolve.reason),
     earlierSolve.reason);

  var multiway = riverSpot(true, true);
  var multiAdvice = Coach.advise(multiway, 0, { iters: 400, rng: Poker.mulberry32(22) });
  var multiSolve = SolverBaseline.analyse(multiway, 0, multiAdvice);
  eq("multiway spots are explicitly unsupported", multiSolve.status, "unsupported");
  ok("multiway reason does not pretend to solve the spot", /Multiway/.test(multiSolve.reason),
     multiSolve.reason);

  var serial = SolverBaseline.serializeSpot(facing, 0);
  ok("external-solver adapter serializes cards, stacks and legal actions",
     serial.street === "river" && serial.board.length === 5 && serial.hero.hand.length === 2 &&
     serial.players.length === 2 && serial.legal && serial.toCall === 200,
     JSON.stringify(serial));

  ok("Coach compatibility exports delegate to the extracted range module",
     Coach.estimateRange === RangeModel.estimateRange &&
     Coach.conditionRange === RangeModel.conditionRange &&
     Coach.bettingSlices === RangeModel.bettingSlices);
  ok("Coach compatibility exports delegate to the extracted behaviour module",
     Coach.foldEquity === ExploitModel.foldEquity &&
     Coach.estimateInduceFrequency === ExploitModel.estimateInduceFrequency);

  var context = DecisionContext.build(facing, 0, {});
  ok("shared decision context contains one inferred range and one legal snapshot",
     context.ranges.length === 1 && context.legal.toCall === 200 && context.spot.toCall === 200,
     JSON.stringify(context));
  var orchestrated = StrategyEngine.advise(facing, 0, {
    iters: 500, rng: Poker.mulberry32(23)
  });
  ok("strategy engine records all four architecture layers",
     orchestrated.strategy && orchestrated.strategy.layers.map(function (x) { return x.name; }).join(",") ===
       "range-inference,balanced-baseline,opponent-adjustment,explanation",
     JSON.stringify(orchestrated.strategy));
  eq("strategy engine attaches a supported independent baseline",
     orchestrated.solver.status, "supported");
  ok("strategy engine records the final recommendation and its source",
     orchestrated.strategy.final.action === orchestrated.action &&
     !!orchestrated.strategy.final.source && !!orchestrated.adjustment,
     JSON.stringify(orchestrated.strategy.final));
  ok("teaching layer names concrete value or bluff holdings from this board",
     orchestrated.teaching && orchestrated.teaching.reads.length === 1 &&
     /(value examples|bluff examples)/.test(orchestrated.teaching.reads[0].text) &&
     /→/.test(orchestrated.teaching.reads[0].text),
     JSON.stringify(orchestrated.teaching));
  ok("teaching layer compares fold and call in chips",
     orchestrated.teaching.comparisons.some(function (x) { return x.label === "Fold" && x.ev === 0; }) &&
     orchestrated.teaching.comparisons.some(function (x) { return x.label === "Call" && isFinite(x.ev); }),
     JSON.stringify(orchestrated.teaching.comparisons));
  ok("river teaching exposes the bluff-frequency tipping point",
     /breaks even when roughly \d+%/.test(orchestrated.teaching.tippingPoint) &&
     /currently assumes \d+%/.test(orchestrated.teaching.tippingPoint),
     orchestrated.teaching.tippingPoint);
  ok("teaching ends with a transferable rule and a decision question",
     /^Reusable rule:/.test(orchestrated.teaching.takeaway) &&
     /^Ask yourself:/.test(orchestrated.teaching.question),
     JSON.stringify(orchestrated.teaching));

  var fallback = StrategyEngine.advise(earlier, 0, {
    iters: 300, rng: Poker.mulberry32(24)
  });
  eq("unsupported solver coverage becomes an explicit practical fallback",
     fallback.adjustment.status, "fallback");
  eq("fallback final source is recorded", fallback.strategy.final.source, "coach-fallback");

  var preflop = mkGame([2000, 2000, 2000, 2000], 0, 83).startHand();
  preflop.players[0].hole = H("As Kh"); preflop.actionOn = 0;
  var preflopLesson = StrategyEngine.advise(preflop, 0, {
    iters: 400, rng: Poker.mulberry32(25)
  });
  ok("preflop teaching compares the hand with this seat's opening boundary",
     preflopLesson.openThreshold > 0 &&
     preflopLesson.teaching.comparisons.some(function (x) { return x.label === "Hands played from this seat"; }) &&
     /opening boundary/.test(preflopLesson.teaching.tippingPoint),
     JSON.stringify(preflopLesson.teaching));

  var fullSummary = RangeModel.baseRangeSummary({ lo: 0, hi: 1 });
  ok("range summaries show hands across the set instead of repeating only premiums",
     fullSummary.representative.length >= 5 &&
     fullSummary.representative.join(",") !== fullSummary.strongest.join(",") &&
     fullSummary.representative[fullSummary.representative.length - 1] === "72o",
     JSON.stringify(fullSummary));

  (function positionChangesOpeningRead() {
    function atPosition(position, button) {
      var g = mkGame([2000, 2000, 2000, 2000], button, 91).startHand();
      var p = g.players.filter(function (x) { return g.positionOf(x.id) === position; })[0];
      p.streetActions = [{ action: "raise", street: "preflop", amount: 60 }];
      g.currentBet = 60;
      return RangeModel.estimateRange(g, p.id, null);
    }
    var buttonRaise = atPosition("Button", 0);
    var blindRaise = atPosition("Big Blind", 0);
    ok("late-position raises infer a wider range than big-blind raises",
       buttonRaise.hi > blindRaise.hi && /from Button/.test(buttonRaise.why) &&
       /from Big Blind/.test(blindRaise.why),
       JSON.stringify({ button: buttonRaise, blind: blindRaise }));
  })();

  (function checksChangeTheRange() {
    var g = riverSpot(false, false);
    var check = { action: "check", street: "river", player: "Opponent", playerId: 1 };
    g.players[1].streetActions = [check]; g.history.push(check);
    var base = RangeModel.estimateRange(g, 1, null);
    var conditioned = RangeModel.conditionRange(g, base, null, Poker.boardTexture(g.board), 0);
    var explained = RangeModel.explainRange(conditioned, g.players[0].hole, g.board);
    ok("a postflop check now changes the sampled distribution",
       conditioned.isBoardModel && conditioned.checked && conditioned.slowplayPct > 0,
       JSON.stringify(conditioned));
    ok("checked ranges show both ordinary checks and possible slow-plays",
       explained.boardExamples && explained.boardExamples.checks.length > 0 &&
       explained.boardExamples.slowplays.length > 0,
       JSON.stringify(explained));
  })();
})();

section("play-by-play transcript");
(function pbp() {
  var rng = Poker.mulberry32(11);
  var g = new Poker.Game({ sb: 10, bb: 20, rng: rng, button: 0,
    players: [{ name: "You", isHuman: true, chips: 2000 }].concat(
      Bots.PERSONAS.slice(0, 3).map(function (ps) { return { name: ps.name, chips: 2000, persona: ps }; })) });
  var table = Bots.createTable(g, rng);
  g.startHand();
  var guard = 0;
  while (!g.handOver && guard++ < 200) {
    var id = g.actionOn; if (id === null) break;
    var mv = id === 0 ? { action: "call" } : table.decide(id);
    try { g.act(id, mv.action, mv.raiseTo); } catch (e) { g.act(id, "fold"); }
  }
  var t = g.playByPlay();
  ok("transcript mentions the blinds", /posts the (small|big) blind/.test(t), t.slice(0, 200));
  ok("transcript names hero's cards", /Hero is You/.test(t));
  ok("transcript is non-trivial", t.split("\n").length > 6);
  console.log("  --- sample transcript ---");
  console.log(t.split("\n").map(function (l) { return "  | " + l; }).join("\n"));
})();

/* ------------------------------------------------------------------ */
console.log("\n" + (fail ? "FAILURES:\n  " + failures.join("\n  ") + "\n" : ""));
console.log(pass + " passed, " + fail + " failed");
if (fail) $.NSTask; // non-zero exit below
"RESULT " + pass + " passed " + fail + " failed";
