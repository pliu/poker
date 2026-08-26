/* Prints the coach's advice for a set of textbook spots so a human can check it. */
ObjC.import('Foundation');
function slurp(p){return ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError($(p).stringByStandardizingPath,$.NSUTF8StringEncoding,null));}
var ROOT=$.NSFileManager.defaultManager.currentDirectoryPath.js;
function load(f){(0,eval)(slurp(ROOT+'/'+f));}
load('poker.js');load('ranges.js');load('exploit.js');load('context.js');load('coach.js');load('solver.js');load('bots.js');load('teaching.js');load('strategy.js');
function C(s){return {r:"23456789TJQKA".indexOf(s[0])+2,s:"shdc".indexOf(s[1])};}
function H(s){return s.trim().split(/\s+/).map(C);}

function spot(title, cfg) {
  var g = new Poker.Game({ sb:10, bb:20, rng: Poker.mulberry32(cfg.seed||3), button: cfg.button===undefined?0:cfg.button,
    players:[{name:"You",isHuman:true,chips:cfg.stack||2000},
             {name:"Rocky",chips:2000,persona:Bots.PERSONAS[0]},
             {name:"Vicky",chips:2000,persona:Bots.PERSONAS[1]},
             {name:"Gus",chips:2000,persona:Bots.PERSONAS[2]}]});
  g.startHand();
  g.players[0].hole = cfg.hole;
  if (cfg.board){ g.board=cfg.board; g.stage=cfg.stage||"flop"; }
  if (cfg.setup) cfg.setup(g);
  g.actionOn = 0;
  var a = Coach.advise(g, 0, { iters: 2500 });
  console.log("\n────────────────────────────────────────────────────────");
  console.log(title);
  console.log("  hole " + Poker.cardsText(cfg.hole) + (cfg.board? "   board " + Poker.cardsText(cfg.board):"") + "   pos " + g.positionOf(0));
  console.log("  >>> " + a.headline + "   [" + a.cls + "]");
  a.why.forEach(function(w){ console.log("      - " + w); });
  a.stats.forEach(function(s){ console.log("      " + s[0] + ": " + s[1]); });
  if (a.bluff) console.log("      BLUFF: FE=" + (a.bluff.foldEquity*100|0) + "%  breakeven=" + (a.bluff.breakEven*100|0) + "%  EV=" + Math.round(a.bluff.ev) + "  profitable=" + a.bluff.profitable);
  if (a.vsBluff) console.log("      VS-BLUFF: villain bluffs " + (a.vsBluff.bluffPct*100|0) + "%  eqVsValue=" + (a.vsBluff.eqVsValue*100|0) + "%  eqVsAir=" + (a.vsBluff.eqVsAir*100|0) + "%  blended=" + (a.vsBluff.eqVsPolarised*100|0) + "%");
  if (a.trap) console.log("      TRAP: evBet=" + Math.round(a.trap.evBet) +
    (a.trap.evSmall !== null && a.trap.smallTo ? "  evSmall=" + Math.round(a.trap.evSmall) + "@" + a.trap.smallTo : "") +
    "  evTrap=" + Math.round(a.trap.evTrap) + "  pInd=" + ((a.trap.pInduce*100)|0) +
    "%  pRaiseSmall=" + ((a.trap.pRaiseSmall*100)|0) + "%  best=" + a.trap.bestKey +
    (a.mix && a.mix.show ? "  mix: " + a.mix.altPhrase : "  mix: no"));
  return a;
}
function heroFacesBet(betterId, bet, preCommit) {
  return function (g) {
    g.players.forEach(function(p){ p.bet=0; p.hasActed=false; p.committed=preCommit||60; p.streetActions=[]; });
    g.players.forEach(function(p,i){ if (i!==0 && i!==betterId) p.folded = true; });
    var b = g.players[betterId];
    b.bet = bet; b.committed = (preCommit||60) + bet;
    b.lastAction = {action:"raise", label:"BET "+bet, street:g.stage};
    b.streetActions = [b.lastAction];
    g.currentBet = bet; g.lastAggressor = betterId;
  };
}
function heroChecksTo(nOpp) {
  return function (g) {
    g.players.forEach(function(p){ p.bet=0; p.hasActed=false; p.committed=60; p.streetActions=[]; });
    for (var i = 3; i > nOpp; i--) g.players[i].folded = true;
    g.currentBet = 0; g.lastAggressor = null;
  };
}

console.log("############ PREFLOP ############");
spot("AA under the gun", { hole: H("As Ah"), button: 0 });
spot("72o under the gun", { hole: H("7d 2c"), button: 0 });
spot("KJo on the button, folded to you", { hole: H("Kd Jc"), button: 3,
  setup: function(g){ g.players[3].folded=true; g.actionOn=0; } });
spot("J4s on the button, folded to you (steal?)", { hole: H("Js 4s"), button: 3,
  setup: function(g){ g.players[3].folded=true; } });
spot("A5s in the cutoff facing a raise (3-bet bluff candidate)", { hole: H("As 5s"), button: 2,
  setup: function(g){
    g.players[3].bet=60; g.players[3].committed=60; g.currentBet=60; g.preflopRaiser=3;
    g.players[3].streetActions=[{action:"raise",label:"RAISE TO 60",street:"preflop"}];
  }});
spot("Q9o in the big blind facing a min-raise (price)", { hole: H("Qd 9c"), button: 1,
  setup: function(g){
    g.players[0].bet=20; g.players[0].committed=20;
    g.players[3].bet=40; g.players[3].committed=40; g.currentBet=40; g.preflopRaiser=3;
    g.players[3].streetActions=[{action:"raise",label:"RAISE TO 40",street:"preflop"}];
  }});
spot("22 on the button facing a raise (set mine?)", { hole: H("2s 2h"), button: 0,
  setup: function(g){
    g.players[3].bet=60; g.players[3].committed=60; g.currentBet=60; g.preflopRaiser=3;
    g.players[3].streetActions=[{action:"raise",label:"RAISE TO 60",street:"preflop"}];
  }});
spot("76s on the button facing a raise (speculative?)", { hole: H("7h 6h"), button: 0,
  setup: function(g){
    g.players[3].bet=60; g.players[3].committed=60; g.currentBet=60; g.preflopRaiser=3;
    g.players[3].streetActions=[{action:"raise",label:"RAISE TO 60",street:"preflop"}];
  }});
spot("22 short-stacked facing a raise (no implied odds)", { hole: H("2s 2h"), stack: 200, button: 0,
  setup: function(g){
    g.players[3].bet=60; g.players[3].committed=60; g.currentBet=60; g.preflopRaiser=3;
    g.players[3].streetActions=[{action:"raise",label:"RAISE TO 60",street:"preflop"}];
  }});

console.log("\n############ POSTFLOP: VALUE ############");
spot("Top set on a dry flop, checked to you heads-up",
  { hole: H("Ks Kh"), board: H("Kd 7c 2s"), stage:"flop", setup: heroChecksTo(1) });
spot("Top set, first to act heads-up vs Gus (trap?)",
  { hole: H("Ks Kh"), board: H("Kd 7c 2s"), stage:"flop", button: 3,
    setup: function(g){
      g.players.forEach(function(p){ p.bet=0; p.hasActed=false; p.committed=80; p.streetActions=[]; });
      g.players[1].folded=true; g.players[2].folded=true;
      g.currentBet=0; g.lastAggressor=null;
    }});
spot("Nut flush on the river, checked to you",
  { hole: H("As 4s"), board: H("Ks 9s 2s 7h 3d"), stage:"river", setup: heroChecksTo(1) });
spot("Playing the board (your cards are irrelevant), facing a pot bet",
  { hole: H("3d 2c"), board: H("As Ks Qs Js Ts"), stage:"river", setup: heroFacesBet(1, 240) });

console.log("\n############ POSTFLOP: DRAWS & BLUFFS ############");
spot("Nut flush draw + overcard, checked to you heads-up (semi-bluff?)",
  { hole: H("As 5s"), board: H("Ks 9s 2h"), stage:"flop", setup: heroChecksTo(1) });
spot("Same draw, 3-way (fold equity collapses)",
  { hole: H("As 5s"), board: H("Ks 9s 2h"), stage:"flop", setup: heroChecksTo(3) });
spot("Total air with the nut-flush blocker on the river, checked to you",
  { hole: H("As 4d"), board: H("Ks 9s 2s 7h 3c"), stage:"river", setup: heroChecksTo(1) });
spot("Open-ended straight draw facing a half-pot bet",
  { hole: H("9h 8h"), board: H("7s 6d 2c"), stage:"flop", setup: heroFacesBet(1, 90, 60) });
spot("Gutshot facing a big bet (should fold)",
  { hole: H("9h 8h"), board: H("5s 6d Kc"), stage:"flop", setup: heroFacesBet(1, 200, 60) });

console.log("\n############ POSTFLOP: BLUFF-CATCHING ############");
spot("Ace-high facing a big river bet from the maniac",
  { hole: H("Ah Qc"), board: H("7s 6d 2c 9h 3s"), stage:"river", setup: heroFacesBet(3, 300, 100) });
spot("Ace-high facing a big river bet from the nit",
  { hole: H("Ah Qc"), board: H("7s 6d 2c 9h 3s"), stage:"river",
    setup: function(g){ heroFacesBet(1, 300, 100)(g); } });
spot("Top pair top kicker facing a flop bet",
  { hole: H("Ah Qc"), board: H("Ad 8h 3c"), stage:"flop", setup: heroFacesBet(1, 180, 60) });
spot("Second pair facing a river overbet",
  { hole: H("9h 9c"), board: H("Ad 8h 3c 5s 2d"), stage:"river", setup: heroFacesBet(3, 500, 200) });
"done";
