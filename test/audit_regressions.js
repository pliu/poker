/* Correctness audit regressions; loaded by run_tests.js. */
section("correctness audit regressions");
(function () {
  function spot(hole, board, bet, oppStack) {
    bet = bet || 0;
    var g = new Poker.Game({ button: 0, rng: Poker.mulberry32(3), players: [
      { name: "Hero", isHuman: true, chips: 5000 },
      { name: "Villain", chips: oppStack === undefined ? 5000 : oppStack }
    ] });
    g.startHand(); g.board = H(board); g.stage = "river"; g.history = []; g.handOver = false;
    g.players.forEach(function (p) {
      p.bet = 0; p.committed = 100; p.chips = p.id === 0 ? 5000 : oppStack === undefined ? 5000 : oppStack;
      p.hasActed = false; p.actedAtBet = null; p.streetActions = []; p.allIn = false;
    });
    g.players[0].hole = H(hole); g.currentBet = bet; g.minRaise = Math.max(20, bet);
    g.actionOn = 0; g.lastAggressor = bet ? 1 : null;
    if (bet) {
      var p = g.players[1]; p.bet = bet; p.committed += bet; p.chips -= bet; p.allIn = p.chips === 0;
      var a = { playerId: 1, player: p.name, action: "raise", label: "BET " + bet,
        amount: bet, potBefore: 200, street: "river" };
      p.streetActions = [a]; g.history = [a];
    }
    return g;
  }

  var side = new Poker.Game({ button: 0, players: [
    { name: "Hero" }, { name: "Short" }, { name: "Deep" }
  ] });
  side.startHand(); side.board = H("Ah Ad Ks 2c 3d"); side.stage = "river";
  side.history = []; side.currentBet = 100; side.minRaise = 100; side.lastAggressor = 2; side.actionOn = 0;
  side.players.forEach(function (p, i) {
    p.committed = i === 1 ? 10 : i === 2 ? 200 : 100; p.bet = i === 2 ? 100 : 0;
    p.chips = i === 1 ? 0 : 1000; p.allIn = i === 1; p.folded = false; p.streetActions = [];
  });
  side.players[0].hole = H("Kc Kd");
  var ranges = [
    { id: 1, name: "Short", lo: 0, hi: 0.005, loose: 0.42, canFold: false },
    { id: 2, name: "Deep", lo: 0, hi: 1, loose: 0.42, canFold: true }
  ];
  var sim = Poker.equityForCall(side, 0, ranges, 500, Poker.mulberry32(9));
  eq("side pots retain separate eligibility", side.callPots(0), [
    { amount: 30, eligible: [0, 1, 2] }, { amount: 380, eligible: [0, 2] }
  ]);
  eq("short-stack aces beat hero in every main pot", sim.pots[0].equity, 0);
  eq("short-stack aces block deep opponent from beating hero's full house", sim.pots[1].equity, 1);
  eq("expected payout includes the won side pot", sim.expectedPayout, 380);
  eq("overall showdown equity remains zero", sim.showdownEquity, 0);
  var sa = Coach.advise(side, 0, { iters: 500, rng: Poker.mulberry32(9), context: { ranges: ranges } });
  eq("coach calls to win the side pot even when main pot is lost", sa.action, "call");
  ok("side-pot explanation reports the actual net return", /\+280 chips/.test(sa.why.join(" ")));
  ok("side-pot teaching does not advertise an unmodeled raise",
    TeachingModel.build({ ranges: ranges }, sa).comparisons.every(function (x) { return !/^Raise/.test(x.label); }));

  // A tie must be divided among eligible winners for each pot, not all live players.
  side.board = H("As Ks Qs Js Ts"); side.players[0].hole = H("2h 3h");
  ranges[0].hi = 1;
  var ties = Poker.equityForCall(side, 0, ranges, 200, Poker.mulberry32(2));
  ok("main pot splits three ways and side pot two ways",
    Math.abs(ties.expectedPayout - 200) < 1e-9, ties.expectedPayout);

  var bluff = spot("Ah Qc", "7s 6d 2c 9h 3s", 50);
  var ba = Coach.advise(bluff, 0, { iters: 500, rng: Poker.mulberry32(9),
    stats: { Villain: { hands: 100, vpip: 0.42, pfr: 0.1, aggression: 0 } } });
  ok("regression spot has a losing raise that loses less than calling",
    ba.bluff.ev < 0 && ba.bluff.ev > Coach.evCallShowdown(ba.pot, ba.toCall, ba.decisionEq));
  eq("a losing raise is not profitable", ba.bluff.profitable, false);
  ok("losing-bluff explanation states a loss", /loses about/.test(ba.bluff.text));
  ok("fold explanation does not offer a money-making losing bluff", !/would also make money/.test(ba.why.join(" ")));

  [30, 5].forEach(function (stack) {
    var short = spot("As 4s", "Ks 9s 2s 7h 3d", 0, stack);
    var a = Coach.advise(short, 0, { iters: 700, rng: Poker.mulberry32(9) });
    ok("value bet respects effective stack " + stack, a.raiseTo <= Math.max(short.bb, stack));
    ok("value EV cannot win nonexistent chips " + stack, a.trap.evBet <= 200 + stack);
    ok("bluff EV cannot win nonexistent chips " + stack, a.bluff.ev <= 200 + stack);
    var before = short.players.reduce(function (sum, p) { return sum + p.chips; }, 0) + short.pot();
    short.act(0, "raise", a.raiseTo); short.act(1, "call");
    ok("short call completes the hand " + stack, short.handOver);
    eq("uncalled minimum-bet excess is returned " + stack,
      short.players.reduce(function (sum, p) { return sum + p.chips; }, 0), before);
  });

  var royal = spot("2h 3h", "As Ks Qs Js Ts");
  var ra = StrategyEngine.advise(royal, 0, { iters: 300, rng: Poker.mulberry32(4) });
  eq("guaranteed chop is outside MDF response coverage", ra.solver.status, "unsupported");
  ok("royal-flush teaching cannot claim a pair beats it", !/pairs the board beats/.test(ra.why.join(" ")) && /cannot be beaten/.test(ra.why.join(" ")));
  var ordinary = spot("Ah Qc", "7s 6d 2c 9h 3s");
  var reference = SolverBaseline.analyse(ordinary, 0, null);
  eq("river response is explicitly not solver certified", reference.solverCertified, false);
  ok("river response is labeled hypothetical", /Hypothetical/.test(reference.label) && /not a solved equilibrium/.test(reference.scope));
  ordinary.button = 1;
  eq("check-down benchmark excludes players still to act", SolverBaseline.analyse(ordinary, 0, null).status, "unsupported");

  function splitPot(button, contributions, folded) {
    var g = new Poker.Game({ button: button, players: contributions.map(function (_, i) {
      return { name: "P" + i, chips: 100 };
    }) });
    g.startHand(); g.board = H("As Ks Qs Js Ts");
    g.players.forEach(function (p, i) {
      p.committed = contributions[i]; p.chips = 100 - p.committed; p.folded = folded.indexOf(i) >= 0;
    });
    g._showdown(); return g;
  }
  var odd = splitPot(0, [21, 21, 21], [2]);
  eq("odd chip goes to the winner left of button", odd.players.map(function (p) { return p.chips; }), [110, 111, 79]);
  var twoOdd = splitPot(1, [21, 21, 21, 21, 20], [3, 4]);
  eq("multiple odd chips go to distinct winners in clockwise order", twoOdd.players.map(function (p) { return p.chips; }), [114, 113, 114, 79, 80]);
  var wrapped = splitPot(2, [21, 21, 21], [2]);
  eq("odd-chip order wraps around the table", wrapped.players.map(function (p) { return p.chips; }), [111, 110, 79]);

  var lone = new Poker.Game({ button: 0, players: [
    { name: "Button", chips: 20 }, { name: "SB", chips: 100 }, { name: "BB", chips: 100 }
  ] });
  lone.startHand(); lone.act(0, "call"); lone.act(1, "fold");
  ok("matched lone actor immediately runs out the board", lone.handOver && lone.board.length === 5);
  eq("matched lone actor has no betting controls", lone.legal(2), null);
  var owes = spot("Ah Qc", "7s 6d 2c 9h 3s", 100, 100);
  ok("lone actor owing chips must still decide", owes.legal(0).canCall);
  eq("lone actor cannot raise into an all-in opponent", owes.legal(0).canRaise, false);
  var shortBlind = new Poker.Game({ button: 0, players: [
    { name: "SB", chips: 100 }, { name: "BB", chips: 5 }
  ] });
  shortBlind.startHand();
  ok("short big blind cannot require an unmatched extra call", shortBlind.handOver && shortBlind.board.length === 5);
  var unmatched = spot("Ah Qc", "7s 6d 2c 9h 3s", 100);
  unmatched.players[0].chips = 30;
  eq("river reference excludes unequal all-in calls", SolverBaseline.analyse(unmatched, 0, null).status, "unsupported");

  ok("showdown transcript retains original starting stacks", /Stacks at the start of this hand: P0 100, P1 100, P2 100\./.test(odd.playByPlay()));
  var folded = new Poker.Game({ button: 0, players: [{ name: "A", chips: 100 }, { name: "B", chips: 200 }] });
  folded.startHand(); folded.act(0, "fold");
  ok("uncontested transcript retains original stacks", /A 100, B 200\./.test(folded.playByPlay()));
  var nextStacks = folded.players.map(function (p) { return p.chips; });
  folded.startHand();
  eq("a new hand refreshes starting stacks", folded.players.map(function (p) { return p.startingChips; }), nextStacks);
})();
