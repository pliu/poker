/* ui.js — rendering, animation, the action feed, and the Claude chat box.
   Everything stateful about *presentation* lives here; the rules live in
   poker.js, the advice in coach.js, the opponents in bots.js. */
(function () {
"use strict";

var $ = function (id) { return document.getElementById(id); };
var SB = 10, BB = 20, STACK = 2000;

var G = null;            // Poker.Game
var TABLE = null;        // bot brain
var pending = null;      // coach advice for the human's current decision
var decisions = [];      // {rec, actual, street} for the post-hand review
var busy = false;        // an event animation is playing
var queue = [];          // events waiting to be shown
var winnerIds = [];      // seats to highlight at the end
var highlight = null;    // Set of "p<id>-<i>" / "b<i>" card keys to light up
var revealAll = false;
var sessionStats = { hands: 0, agree: 0, graded: 0, startBank: STACK };
var engine = "claude";                            // which CLI answers questions
var chatSessions = { claude: null, codex: null };  // one conversation per engine
var engineInfo = {                                 // filled in by /api/health
  claude: { label: "Claude", available: false, model: null },
  codex: { label: "Codex", available: false, model: null }
};
var serverUp = false;

var SEAT_POS = [          // %x, %y around the oval — hero at the bottom
  [50, 87], [87, 47], [50, 10], [13, 47]
];
var WAGER_POS = [         // chips on the felt, between each seat and the pot
  [64, 71], [70, 48], [50, 27], [30, 48]
];
var DEALER_OFF = [        // px offset from the seat centre, kept off the cards
  [-98, -6], [-104, 4], [98, 10], [104, 4]
];

/* ═══════════════════════════════════════════════ rendering helpers */
function cardHTML(c, opts) {
  opts = opts || {};
  var cls = "card" + (opts.small ? " sm" : "");
  if (!c) return '<span class="' + cls + ' back"></span>';
  cls += Poker.SUIT_RED[c.s] ? " red" : " black";
  if (opts.hl) cls += " hl";
  if (opts.faded) cls += " faded";
  if (opts.deal) cls += " deal";
  var style = opts.delay ? ' style="animation-delay:' + opts.delay + 'ms"' : "";
  return '<span class="' + cls + '"' + style + '><span class="r">' +
    Poker.RANKS[c.r - 2] + '</span><span class="s">' + Poker.SUITS[c.s] + '</span></span>';
}
function n(x) { return (x || 0).toLocaleString(); }

function badgeClass(p) {
  if (!p.lastAction) return null;
  if (p.allIn) return "a-allin";
  switch (p.lastAction.action) {
    case "fold": return "a-fold";
    case "check": return "a-check";
    case "call": return "a-call";
    case "raise": return "a-raise";
    default: return "a-blind";
  }
}

/* ═══════════════════════════════════════════════ the table */
function render() {
  if (!G) return;
  var seats = $("seats");
  seats.innerHTML = "";

  G.players.forEach(function (p, i) {
    var pos = SEAT_POS[i] || [50, 8];
    var el = document.createElement("div");
    el.className = "seat" + (p.isHuman ? " hero" : "") +
      (p.folded && !p.sittingOut ? " folded" : "") +
      (G.actionOn === i && !G.handOver ? " acting" : "") +
      (winnerIds.indexOf(i) >= 0 ? " winner" : "");
    el.style.left = pos[0] + "%";
    el.style.top = pos[1] + "%";

    var show = p.isHuman || revealAll ||
      (G.stage === "showdown" && !p.folded && G.live().length > 1);
    var cards = "";
    if (p.hole.length && !p.sittingOut) {
      cards = p.hole.map(function (c, ci) {
        var key = "p" + i + "-" + ci;
        if (!show) return cardHTML(null, { small: !p.isHuman });
        return cardHTML(c, {
          small: !p.isHuman,
          hl: highlight ? highlight.has(key) : false,
          faded: highlight ? !highlight.has(key) : false
        });
      }).join("");
    }

    var badge = "";
    if (p.folded && !p.sittingOut) {
      // stays visible for the rest of the hand, not just the street they folded on
      badge = '<div class="act-badge a-fold">Folded</div>';
    } else if (G.actionOn === i && !p.isHuman && !G.handOver && busy) {
      badge = '<div class="thinking"><i></i><i></i><i></i></div>';
    } else if (p.allIn && !p.lastAction) {
      badge = '<div class="act-badge a-allin">All in</div>';
    } else if (p.lastAction && !p.sittingOut) {
      badge = '<div class="act-badge ' + badgeClass(p) + '">' + p.lastAction.label + "</div>";
    }

    el.innerHTML =
      '<div class="cards">' + cards + "</div>" +
      '<div class="plate">' + badge +
        '<div class="who"><span class="nm">' + p.name + "</span></div>" +
        '<div class="stk' + (p.chips < BB * 10 && p.chips > 0 ? " short" : "") + '">' +
        (p.sittingOut ? "OUT" : n(p.chips)) + "</div>" +
      "</div>";
    seats.appendChild(el);

    // chips wagered this street, sitting between the seat and the pot
    if (p.bet > 0) {
      var w = document.createElement("div");
      w.className = "wager";
      var wp = WAGER_POS[i] || [50, 30];
      w.style.left = wp[0] + "%";
      w.style.top = wp[1] + "%";
      w.innerHTML = '<span class="disc"></span>' + n(p.bet);
      seats.appendChild(w);
    }

    if (i === G.button) {
      var off = DEALER_OFF[i] || [0, 0];
      var d = document.createElement("div");
      d.className = "dealer";
      d.textContent = "D";
      d.style.left = "calc(" + pos[0] + "% + " + off[0] + "px)";
      d.style.top = "calc(" + pos[1] + "% + " + off[1] + "px)";
      seats.appendChild(d);
    }
  });

  // board
  $("board").innerHTML = [0, 1, 2, 3, 4].map(function (i) {
    if (!G.board[i]) return '<span class="slot"></span>';
    return cardHTML(G.board[i], {
      hl: highlight ? highlight.has("b" + i) : false,
      faded: highlight ? !highlight.has("b" + i) : false
    });
  }).join("");

  var streetName = { preflop: "Pre-flop", flop: "Flop", turn: "Turn",
                     river: "River", showdown: "Showdown" }[G.stage] || "";
  $("pot").innerHTML = G.stage === "idle" ? "" : "<small>" + streetName + " pot</small>" + n(G.pot());

  $("bankroll").innerHTML = "You <b>" + n(G.players[0].chips) + "</b>";
  $("handCounter").innerHTML = "Hand <b>" + G.handNo + "</b>";
  $("scorecard").innerHTML = "Coach agreement <b>" +
    (sessionStats.graded ? sessionStats.agree + "/" + sessionStats.graded : "—") + "</b>";

  var myTurn = G.actionOn === 0 && !G.handOver && !busy;
  $("bar").classList.toggle("on", myTurn);
  if (myTurn) setupControls();
  renderPlayers();
}

function toast(html, big) {
  var t = $("toast");
  t.innerHTML = big ? '<span class="big">' + html + "</span>" : html;
  t.classList.remove("pop");
  void t.offsetWidth;
  t.classList.add("pop");
}

/* ═══════════════════════════════════════════════ street action rows */
var STREETS = ["preflop", "flop", "turn", "river"];
var STREET_LABEL = { preflop: "Pre-flop", flop: "Flop", turn: "Turn", river: "River" };

function streetRow(street) {
  return document.querySelector('#streets .srow[data-s="' + street + '"]');
}

function streetsReset() {
  STREETS.forEach(function (st) {
    var row = streetRow(st);
    if (!row) return;
    row.classList.remove("live", "done");
    row.querySelector(".scards").innerHTML = "";
    row.querySelector(".sacts").innerHTML = "";
  });
}

// mark a street as the one now being played; the previous one stays filled in
function streetOpen(street, cards) {
  STREETS.forEach(function (st) {
    var r = streetRow(st);
    if (!r) return;
    if (st === street) { r.classList.add("live"); r.classList.remove("done"); }
    else if (r.classList.contains("live")) {
      r.classList.remove("live"); r.classList.add("done");
      r.querySelector(".sacts").scrollLeft = 0;   // read the finished street from the start
    }
  });
  var row = streetRow(street);
  if (row && cards && cards.length) {
    row.querySelector(".scards").innerHTML = cards.map(function (c) {
      return '<span class="sc ' + (Poker.SUIT_RED[c.s] ? "red" : "black") + '">' +
        Poker.cardStr(c) + "</span>";
    }).join("");
  }
}

function streetPush(street, name, verb, kind, isMe) {
  var row = streetRow(street);
  if (!row) return;
  var acts = row.querySelector(".sacts");
  if (acts.querySelectorAll(".fitem").length) {
    var a = document.createElement("span");
    a.className = "arrow"; a.textContent = "\u2192";
    acts.appendChild(a);
  }
  var el = document.createElement("span");
  el.className = "fitem " + kind + (isMe ? " me" : "");
  el.innerHTML = '<span class="fn">' + name + '</span><span class="fa">' + verb + "</span>";
  acts.appendChild(el);
  acts.scrollLeft = acts.scrollWidth;
}

/* ═══════════════════════════════════════════════ event playback */
function speed(ms) { return $("tFast").checked ? Math.round(ms * 0.32) : ms; }

function pump() {
  if (!queue.length) {
    busy = false;
    render();
    afterEvents();
    return;
  }
  busy = true;
  var ev = queue.shift();
  var wait = handleEvent(ev);
  render();
  setTimeout(pump, wait);
}

function handleEvent(ev) {
  switch (ev.type) {
    case "deal":
      streetsReset();
      streetOpen("preflop");
      toast("");
      return speed(220);

    case "blind":
      streetPush("preflop", ev.name, (ev.label === "small blind" ? "SB " : "BB ") + n(ev.amount),
                 "blind", ev.player === 0);
      return speed(120);

    case "turn":
      return speed(30);

    case "action": {
      var kind = ev.action === "raise" ? "raise" : ev.action;
      streetPush(ev.street, ev.name, ev.label, kind, ev.player === 0);
      var verb = { fold: "folds", check: "checks", call: "calls", raise: "raises" }[ev.action];
      if (ev.action === "raise") verb = ev.label.indexOf("BET") === 0 ? "bets " + ev.amount : "raises to " + ev.totalBet;
      else if (ev.action === "call") verb = "calls " + ev.amount;
      toast('<span style="color:var(--muted)">' + ev.name + "</span> " + verb + (ev.allIn ? " — ALL IN" : ""));
      return speed(ev.player === 0 ? 260 : 560);
    }

    case "street":
      streetOpen(ev.street, ev.cards);
      toast(ev.street.toUpperCase() + "  " + ev.cards.map(Poker.cardStr).join("  "));
      return speed(620);

    case "runout":
      toast("All in — running it out");
      return speed(700);

    case "showdown":
      toast("Showdown");
      return speed(900);

    case "pot": {
      winnerIds = winnerIds.concat(ev.winnerIds);
      var who = ev.winners.join(" & ");
      var liveRow = document.querySelector("#streets .srow.live");
      if (liveRow) streetPush(liveRow.getAttribute("data-s"), who, "wins " + n(ev.amount), "win");
      toast(who + " wins " + n(ev.amount) + (ev.handName ? '<br><span style="font-size:14px;color:var(--muted)">' + ev.handName + "</span>" : ""), true);
      return speed(ev.uncontested ? 700 : 1100);
    }

    case "handEnd":
      if (!ev.uncontested) highlightWinners(ev.awards);
      return speed(200);

    default:
      return speed(60);
  }
}

function highlightWinners(awards) {
  var set = new Set();
  awards.forEach(function (aw) {
    if (!aw.best) return;
    aw.best.forEach(function (c) {
      G.board.forEach(function (bc, bi) { if (bc.r === c.r && bc.s === c.s) set.add("b" + bi); });
      G.players[aw.player].hole.forEach(function (hc, hi) {
        if (hc.r === c.r && hc.s === c.s) set.add("p" + aw.player + "-" + hi);
      });
    });
  });
  if (set.size) highlight = set;
}

function showWaiting() {
  if (!$("tCoach").checked || !G || G.handOver) return;
  var who = G.actionOn !== null ? G.players[G.actionOn] : null;
  var me = G.players[0];
  var lines = [];
  if (me.folded) lines.push("You folded. Watch how the rest of the hand plays out — the bots' lines are worth reading.");
  else if (who) lines.push("<b>" + who.name + "</b> is deciding.");
  var body = "";
  if (!me.folded && G.board.length) {
    var an = Poker.analyseHand(me.hole, G.board);
    body += '<div class="row"><span>What you have</span><b>' + an.madeName +
            (an.drawText.length ? ", plus a " + an.drawText.join(" and a ") : "") + "</b></div>";
  }
  body += '<div class="row"><span>Chips in the middle</span><b>' + n(G.pot()) + "</b></div>" +
          '<div class="row"><span>Still in the hand</span><b>' +
          G.live().map(function (p) { return p.name; }).join(", ") + "</b></div>";
  $("p-coach").innerHTML = glossify('<div class="card-box"><h3>' +
    ({ preflop: "Before the flop", flop: "The flop", turn: "The turn", river: "The river" }[G.stage] || "In progress") +
    "</h3>" + lines.map(function (l) { return "<p>" + l + "</p>"; }).join("") + body + "</div>");
}

/* Called once the queue drains: either it's our turn, a bot's turn, or over. */
function afterEvents() {
  if (!G) return;
  if (G.handOver) { finishHand(); return; }
  if (G.actionOn === null) return;
  if (G.actionOn === 0) { humanTurn(); return; }
  showWaiting();
  // a bot acts
  busy = true;
  render();
  var id = G.actionOn;
  setTimeout(function () {
    if (!G || G.handOver || G.actionOn !== id) { busy = false; pump(); return; }
    var mv;
    try { mv = TABLE.decide(id); }
    catch (e) { mv = { action: G.legal(id).canCheck ? "check" : "fold" }; }
    try { G.act(id, mv.action, mv.raiseTo); }
    catch (e) {
      var lg = G.legal(id);
      G.act(id, lg && lg.canCheck ? "check" : "fold");
    }
    queue = queue.concat(G.drainEvents());
    busy = false;
    pump();
  }, speed(430 + Math.random() * 420));
}

/* ═══════════════════════════════════════════════ the human's turn */
function humanTurn() {
  var lg = G.legal(0);
  if (!lg) return;
  $("bFold").style.display = lg.canCheck ? "none" : "";
  $("bCall").textContent = lg.canCheck ? "Check" :
    (lg.toCall >= G.players[0].chips ? "Call all-in " + n(lg.toCall) : "Call " + n(lg.toCall));
  $("bCall").innerHTML += '<span class="k">C</span>';
  $("bRaise").style.display = lg.canRaise ? "" : "none";
  $("raiseBox").style.display = lg.canRaise ? "" : "none";
  amtTouched = false;

  pending = null;
  render();
  toast("Your turn");

  // the equity simulation is heavy enough to be worth deferring a frame
  setTimeout(function () {
    if (!G || G.actionOn !== 0 || G.handOver) return;
    pending = StrategyEngine.advise(G, 0, { iters: 4000, stats: TABLE.stats });
    showCoach(pending);
    // pre-fill the box with what the coach suggests, unless you have typed
    var lg2 = G.legal(0);
    if (!amtTouched && pending.action === "raise" && pending.raiseTo && lg2 && lg2.canRaise) {
      setAmount(Math.max(lg2.minRaiseTo, Math.min(lg2.maxRaiseTo, pending.raiseTo)), false);
    }
    render();
  }, 15);
}

function humanAct(action) {
  if (!G || G.actionOn !== 0 || G.handOver || busy) return;
  var lg = G.legal(0);
  var amount = 0;
  if (action === "raise") {
    if (!lg.canRaise) { toast('<span style="color:var(--red)">You cannot raise here</span>'); return; }
    amount = readAmount();
    if (isNaN(amount)) { $("amtInput").focus(); updateAmount(); return; }
    var clamped = Math.max(lg.minRaiseTo, Math.min(lg.maxRaiseTo, amount));
    if (clamped !== amount) { setAmount(clamped, true); $("amtInput").focus(); return; }
    amount = clamped;
  }
  try {
    if (action === "call" && lg.canCheck) action = "check";
    G.act(0, action, amount);
  } catch (e) { toast('<span style="color:var(--red)">' + e.message + "</span>"); return; }

  if (pending) {
    var verdict = Coach.grade(pending, action);
    decisions.push({ rec: pending, action: action, street: pending.street, verdict: verdict });
    sessionStats.graded++;
    if (verdict === "match") sessionStats.agree++;
    pending = null;
  }
  $("bar").classList.remove("on");
  $("coachHint").textContent = "";
  queue = queue.concat(G.drainEvents());
  pump();
}

var amtTouched = false;      // has the player typed their own number this turn?

function readAmount() {
  var raw = ($("amtInput").value || "").replace(/[^0-9]/g, "");
  return raw === "" ? NaN : parseInt(raw, 10);
}
function setAmount(v, touched) {
  $("amtInput").value = n(v);
  if (touched !== undefined) amtTouched = touched;
  updateAmount();
}

function setupControls() {
  var lg = G.legal(0);
  if (!lg || !lg.canRaise) return;
  var v = readAmount();
  if (!amtTouched || isNaN(v)) {
    $("amtInput").value = n(Math.min(lg.maxRaiseTo, Math.max(lg.minRaiseTo, Coach.betTarget(G, 0, 0.66))));
  }
  updateAmount();
}

/* Validates as you type, but never rewrites what you typed mid-edit — that is
   the thing that makes number boxes maddening. Clamping happens on blur and on
   submit instead. */
function updateAmount() {
  var lg = G.legal(0);
  if (!lg || !lg.canRaise) return;
  var v = readAmount();
  var input = $("amtInput"), hint = $("amtHint"), btn = $("bRaise");
  var verb = lg.currentBet > 0 ? "Raise to " : "Bet ";
  var bad = null;

  if (isNaN(v)) bad = "Enter an amount.";
  else if (v < lg.minRaiseTo) bad = "Minimum is " + n(lg.minRaiseTo) + ".";
  else if (v > lg.maxRaiseTo) bad = "You only have " + n(lg.maxRaiseTo) + ".";

  input.classList.toggle("bad", !!bad);
  hint.classList.toggle("bad", !!bad);
  btn.disabled = !!bad;
  btn.style.opacity = bad ? ".45" : "";

  if (bad) {
    hint.textContent = bad;
    btn.innerHTML = verb + '<span class="k">R</span>';
  } else {
    hint.innerHTML = v >= lg.maxRaiseTo
      ? "<b style='color:var(--red)'>All-in</b> — your whole stack."
      : "min " + n(lg.minRaiseTo) + " &middot; max " + n(lg.maxRaiseTo) +
        "<br>leaves you " + n(lg.maxRaiseTo - v);
    btn.innerHTML = (v >= lg.maxRaiseTo ? "All-in " : verb) + n(v) + '<span class="k">R</span>';
  }

  document.querySelectorAll(".sz").forEach(function (b) {
    b.classList.toggle("on", !isNaN(v) && Math.abs(sizeFor(b.dataset.f) - v) < 1);
  });
}
function sizeFor(f) {
  var lg = G.legal(0);
  if (!lg) return 0;
  if (f === "min") return lg.minRaiseTo;
  if (f === "max") return lg.maxRaiseTo;
  return Coach.betTarget(G, 0, parseFloat(f));
}

/* ═══════════════════════════════════════════════ jargon glossary
   Poker words the coach cannot avoid get a dotted underline and a plain-English
   definition on hover. Only the first mention in each panel is marked, so the
   text does not turn into a field of underlines. */
var GLOSSARY = {
  "showdown": "The end of a hand, when everyone still in turns their cards face up and the best five-card hand wins.",
  "the blinds": "Two forced bets posted before the cards are dealt, so there is always something to play for.",
  "blinds": "Two forced bets posted before the cards are dealt, so there is always something to play for.",
  "big blind": "The bigger of the two forced bets. You post it once per lap around the table.",
  "small blind": "The smaller of the two forced bets, posted by the player to the dealer's left.",
  "outs": "Cards still in the deck that would turn your hand into the winning one.",
  "semi-bluff": "A bluff with a backup plan: they might fold now, and if they don't, you can still hit your card and win anyway.",
  "bluff": "Betting with a hand that is probably not the best, hoping everyone folds.",
  "flush draw": "Four cards of the same suit — one more of that suit and you have a flush.",
  "nut flush draw": "A flush draw headed by the ace, so if it comes in, nobody can have a better flush.",
  "open-ended straight draw": "Four cards in a row — a card at either end completes your straight. Eight cards do it.",
  "gutshot": "A straight missing one card in the middle. Only four cards in the deck complete it.",
  "backdoor flush": "Three of a suit so far — you'd need both remaining cards to be that suit. A long shot.",
  "overpair": "A pocket pair higher than every card on the board.",
  "top pair": "You've paired the highest card on the board.",
  "position": "Where you sit relative to the dealer button. Acting last is a real advantage — you see what everyone else does first.",
  "break even": "The point where a play wins and loses exactly the same amount over the long run.",
  "the pot": "All the chips bet so far in this hand. Whoever wins the hand takes them.",
  "the board": "The community cards face up in the middle. Everyone uses them.",
  "the flop": "The first three community cards, dealt all at once.",
  "the turn": "The fourth community card.",
  "the river": "The fifth and final community card.",
  "value": "Betting because you expect worse hands to call you — as opposed to bluffing.",
  "raise": "Betting more than the player before you. Everyone after has to match it or fold.",
  "all-in": "Putting your last chip in. You can't be forced out, but you can't bet again either.",
  "kicker": "Your unpaired side card, used to break ties when two players have the same pair.",
  "steal": "Raising with a weak hand purely to win the blinds before the flop.",
  "implied odds": "The extra chips you expect to win later if you hit — the reason a cheap call with a weak hand can still be right.",
  "set mine": "Calling a raise with a small pair hoping to flop three of a kind, then win a big pot from a hand that looks stronger than it is.",
  "checked down": "Nobody bet, so the hand reached showdown for free.",
  "trap": "Checking or just calling a strong hand so that someone who thinks you are weak will bet it for you.",
  "trapping": "Checking or just calling a strong hand so that someone who thinks you are weak will bet it for you.",
  "slow-play": "Playing a very strong hand quietly — checking or calling instead of betting — hoping they will put money in later."
};
var GLOSS_RE = (function () {
  var keys = Object.keys(GLOSSARY).sort(function (a, b) { return b.length - a.length; });
  return new RegExp("\\b(" + keys.map(function (k) {
    return k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("|") + ")\\b", "gi");
})();

function glossify(html) {
  var used = {};
  return html.replace(/(<[^>]*>)|([^<]+)/g, function (m, tag, text) {
    if (tag) return tag;
    return text.replace(GLOSS_RE, function (word) {
      var k = word.toLowerCase();
      if (used[k] || !GLOSSARY[k]) return word;
      used[k] = 1;
      return '<i class="gl" data-tip="' + GLOSSARY[k].replace(/"/g, "&quot;") + '">' + word + "</i>";
    });
  });
}

/* one floating tooltip, reused */
var tipEl = null;
document.addEventListener("mouseover", function (e) {
  var t = e.target.closest ? e.target.closest("[data-tip]") : null;
  if (!t) return;
  if (!tipEl) { tipEl = document.createElement("div"); tipEl.id = "tip"; document.body.appendChild(tipEl); }
  tipEl.textContent = t.getAttribute("data-tip");
  tipEl.style.display = "block";
  var r = t.getBoundingClientRect();
  tipEl.style.visibility = "hidden";
  var w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  var top = r.top - h - 9;
  if (top < 8) top = r.bottom + 9;
  tipEl.style.left = left + "px";
  tipEl.style.top = top + "px";
  tipEl.style.visibility = "visible";
});
document.addEventListener("mouseout", function (e) {
  var t = e.target.closest ? e.target.closest("[data-tip]") : null;
  if (t && tipEl) tipEl.style.display = "none";
});

/* ═══════════════════════════════════════════════ coach panel */
var wid = 0;
function working(summary, body) {
  var id = "w" + (++wid);
  return '<details class="working"><summary>' + summary + "</summary>" +
         '<div class="wbody">' + body + "</div></details>";
}

function meter(value, needed, colour) {
  var v = Math.max(0, Math.min(1, value));
  var html = '<div class="meter"><i style="width:' + (v * 100).toFixed(1) + '%;background:' + colour + '"></i>';
  if (needed !== null && needed !== undefined)
    html += '<span class="need" style="left:' + (Math.min(1, needed) * 100).toFixed(1) + '%"></span>';
  return html + "</div>";
}

/* Where does "you win 33% of the time" actually come from? */
function provenanceHTML(a) {
  var p = a.provenance;
  if (!p || !p.deals) return "";
  var eqShown = a.equity !== undefined ? a.equity : 0;
  var lines = [];

  lines.push("<p>That percentage is not a formula — the app played this exact situation out <b>" +
    n(p.deals) + " times</b> and counted. Each time round:</p>");

  var bullets = p.ranges.map(function (r) {
    var start = "<li><b>" + r.name + "</b> started with the best <b>" +
      Math.round(r.hi * 100) + "%</b> of starting hands — the range assumed for someone who " + r.why + ".";
    if (r.boardModel && r.bluffPct !== undefined) {
      start += " Their bet was then modelled as the strongest <b>" + Math.round(r.valueTop * 100) +
        "%</b> for value plus a separate weak <b>" + Math.round(r.bluffBottom * 100) +
        "%</b> bluff slice, mixed to <b>" + Math.round(r.bluffPct * 100) + "%</b> bluffs.";
    } else if (r.boardModel && r.boardTop !== undefined) {
      start += " Their call narrowed that to the strongest <b>" + Math.round(r.boardTop * 100) +
        "%</b> on this board.";
    }
    return start + "</li>";
  });
  if (p.cardsToCome > 0) {
    bullets.push("<li>the " + (p.cardsToCome === 1 ? "last card was" : p.cardsToCome + " remaining cards were") +
      " dealt at random from the rest of the deck.</li>");
  }
  bullets.push("<li>then it worked out who would have won.</li>");
  lines.push("<ul>" + bullets.join("") + "</ul>");

  lines.push("<p>Out of " + n(p.deals) + " deals you won <b>" + n(p.won) + "</b>" +
    (p.tied ? ", tied <b>" + n(p.tied) + "</b>" : "") + " and lost <b>" + n(p.lost) + "</b> — " +
    (p.tied && p.ranges.length > 1
      ? "with tied pots divided among everyone sharing them. Those exact pot shares produce the "
      : "which is where the ") + Math.round(eqShown * 100) + "% result. " +
    "Run it again and you'd get something within about " +
    (p.margin * 100).toFixed(1) + " percentage points of that.</p>");

  lines.push('<p class="caveat">The deal count gives the sampling error above. The larger uncertainty is the ' +
    "range assumption: if somebody is raising far wider than the app thinks, running more deals will " +
    "only produce a more precise answer to the wrong question.</p>");

  return working("Where does " + Math.round(eqShown * 100) + "% come from?", lines.join(""));
}

function auditHTML(a) {
  var x = a.audit;
  if (!x) return "";
  return '<div class="card-box model-warning"><h3>Is this actually optimal?' +
    '<span class="pill v">model, not solver</span></h3>' +
    '<p><b>It is the move this coaching model prefers under its stated assumptions, not a proof of the ' +
    'game-theory-optimal move.</b></p>' +
    '<div class="row"><span>Cards and runouts</span><b>' + x.simulation + '</b></div>' +
    '<div class="row"><span>How the move is chosen</span><b>' + x.decisionModel + '</b></div>' +
    working("What is missing from a true solver proof?", '<p>' + x.limitation +
      '</p><p>A solver would enumerate the full betting tree, assign strategies to every legal hand ' +
      'for every player, and iterate until no player can profit by changing strategy. This coach does ' +
      'not do that, so close decisions deserve caution.</p>') + '</div>';
}

function solverHTML(a) {
  var s = a.solver;
  if (!s) return "";
  if (s.status !== "supported") {
    return '<div class="card-box solver-card"><h3>Solver baseline' +
      '<span class="pill r">unsupported spot</span></h3><p>' + s.reason + '</p>' +
      working("What can the built-in baseline solve?", '<p>' + s.scope +
        '</p><p>Unsupported does not mean the coach is wrong. It means there is no honest equilibrium ' +
        'comparison available here yet.</p>') + '</div>';
  }

  var agree = s.coachAgrees;
  var h = '<div class="card-box solver-card"><h3>' + s.label +
    '<span class="pill ' + (agree ? "g" : "v") + '">' +
    (agree ? "agrees with coach" : "differs from coach") + '</span></h3>' +
    '<div class="rec ' + (s.action === "fold" ? "fold" : s.action === "check" ? "check" : "call") + '">' +
    s.actionText + '</div><p>' + s.calculation + '</p>';
  (s.evs || []).forEach(function (line) {
    h += '<div class="row"><span>' + line.action + ' in this abstraction</span><b>' +
      (line.ev >= 0 ? "+" : "") + Math.round(line.ev) + ' chips</b></div>';
  });
  h += '<div class="row"><span>Balanced opponent keeps playing</span><b>' +
    Math.round(s.minimumDefence * 100) + '% of hands</b></div>' +
    '<div class="row"><span>Balanced betting range uses</span><b>' +
    Math.round(s.equilibriumBluffPct * 100) + '% bluffs</b></div>' +
    working("Scope and assumptions", '<p>' + s.scope + '</p><ul>' +
      s.assumptions.map(function (x) { return '<li>' + x + '</li>'; }).join("") + '</ul>') +
    '</div>';
  return h;
}

function adjustmentHTML(a) {
  var x = a.adjustment;
  if (!x) return "";
  var cls = x.status === "adjusted" ? "v" : x.status === "aligned" ? "g" : "r";
  var evidence = x.evidenceHands
    ? x.evidenceHands + " observed hands" : "no reliable observed sample";
  return '<div class="card-box"><h3>Opponent adjustment' +
    '<span class="pill ' + cls + '">' + x.status + '</span></h3>' +
    '<p><b>' + x.label + '.</b> ' + x.reason + '</p>' +
    '<div class="row"><span>Evidence strength</span><b>' + x.confidence +
      ' — ' + evidence + '</b></div>' +
    '<div class="row"><span>Final recommendation source</span><b>' +
      x.finalSource.replace(/-/g, " ") + '</b></div>' +
    '<p>' + x.finalText + '</p></div>';
}

function rangeExamplesLine(label, examples) {
  if (!examples || !examples.length) return "";
  return '<p class="examples"><b>' + label + ':</b> ' + examples.join(", ") + '.</p>';
}

function rangeReadHTML(r) {
  var h = '<div class="range-read"><p><span class="range-name">' + r.name + '</span> — ' + r.why + '.</p>';
  h += '<p>The starting set is the best <b>' + Math.round(r.hi * 100) + '%</b>: ' +
    (r.classCount || "?") + ' named hand classes, about ' + (r.comboCount || "?") +
    ' of the 1,326 two-card combinations before visible-card removal.</p>';
  h += rangeExamplesLine("Strong-end examples", r.strongest);
  h += rangeExamplesLine("Examples near the loose edge", r.looseEdge);
  if (r.boardExamples) {
    h += rangeExamplesLine("Possible value hands on this board", r.boardExamples.value);
    h += rangeExamplesLine("Possible bluff hands in the model", r.boardExamples.bluffs);
    h += rangeExamplesLine("Possible hands that continue on this board", r.boardExamples.continues);
  }
  if (r.boardModel && r.bluffPct !== undefined) {
    h += '<p>The bet model mixes its strongest <b>' + Math.round(r.valueTop * 100) +
      '%</b> on this board for value with a separate weakest <b>' + Math.round(r.bluffBottom * 100) +
      '%</b> slice, weighted to <b>' + Math.round(r.bluffPct * 100) + '% bluffs</b>.</p>';
  } else if (r.boardModel && r.boardTop !== undefined) {
    h += '<p>The call model keeps the strongest <b>' + Math.round(r.boardTop * 100) +
      '%</b> of that starting set on this board.</p>';
  }
  h += '<p><b>Evidence (' + (r.confidence || "low") + ' confidence):</b> ' +
    (r.source || "No reliable observed sample; defaults are being used") + '.</p>';
  return h + '</div>';
}

function showCoach(a) {
  var box = $("p-coach");
  if (!$("tCoach").checked) {
    box.innerHTML = '<div class="card-box"><h3>Coach</h3><p>Advice is switched off. Turn <b>Coach</b> back on in the header to see recommendations.</p></div>';
    $("coachHint").textContent = "";
    return;
  }
  if (!a) return;

  var h = "";
  h += '<div class="card-box ' + a.cls + '"><h3>What to do</h3>' +
       '<div class="rec ' + a.cls + '">' + a.headline +
         (a.mix && a.mix.altPhrase ? '<span class="sub">' + a.mix.altPhrase + "</span>" : "") +
       "</div>" +
       (a.plain ? '<p class="plain">' + a.plain + "</p>" : "") +
       '<h3 style="margin-top:12px">Why</h3>' +
       a.why.map(function (w) { return "<p>" + w + "</p>"; }).join("") + "</div>";

  // how often you win, against what you need
  if (a.street !== "preflop") {
    var eqShown = a.decisionEq !== undefined ? a.decisionEq : a.equity;
    var good = eqShown > (a.potOddsNeeded || 0);
    h += '<div class="card-box"><h3>' + (a.toCall ? "Your chances vs the price" : "How often you win") + "</h3>" +
      meter(eqShown, a.toCall ? a.potOddsNeeded : null, good ? "var(--green)" : "var(--red)") +
      '<div class="meter-lbl"><span>you win ' + Math.round(eqShown * 100) + "% of the time</span><span>" +
      (a.toCall ? "white line = the " + (a.potOddsNeeded * 100).toFixed(0) + "% you need" : "nothing to call") +
      "</span></div>" +
      (a.toCall ? "<p style='margin-top:8px'>" + (good
        ? "The green bar is past the white line, so calling makes money in the long run."
        : "The green bar is short of the white line, so calling loses money in the long run.") + "</p>" : "") +
      "</div>";
  }

  h += '<div class="card-box"><h3>The numbers behind it</h3>' +
    a.stats.map(function (s) { return '<div class="row"><span>' + s[0] + "</span><b>" + s[1] + "</b></div>"; }).join("") +
    (a.provenance ? provenanceHTML(a) : "") +
    "</div>";

  h += auditHTML(a);
  h += solverHTML(a);
  h += adjustmentHTML(a);

  // would a bluff work?
  if (a.bluff && (a.bluff.relevant || a.isBluff)) {
    var b = a.bluff;
    h += '<div class="card-box bluff"><h3>Would a bluff work here?' +
      '<span class="pill ' + (b.profitable ? "g" : "r") + '">' + (b.profitable ? "yes" : "no") + "</span></h3>" +
      meter(b.foldEquity, b.breakEven, b.foldEquity > b.breakEven ? "var(--violet)" : "var(--red)") +
      '<div class="meter-lbl"><span>they actually fold ' + Math.round(b.foldEquity * 100) + "%</span><span>" +
      "white line = " + Math.round(b.breakEven * 100) + "% for a zero-equity bluff</span></div>" +
      "<p style='margin-top:8px'>" + b.text + "</p>" +
      (b.blockers.length ? "<p>" + b.blockers.join(" ") + "</p>" : "") +
      (b.source ? working("Where does \u201cthey fold " + Math.round(b.foldEquity * 100) + "%\u201d come from?",
                          "<p>" + b.source + "</p>") : "") +
      "</div>";
  }

  // are they bluffing you?
  if (a.vsBluff) {
    var v = a.vsBluff;
    h += '<div class="card-box ' + (v.profitableCall ? "call" : "fold") + '"><h3>Is ' + v.villain + " bluffing?" +
      '<span class="pill v">about ' + Math.round(v.bluffPct * 100) + "% of the time</span></h3>" +
      "<p>" + v.text + "</p>" +
      '<div class="row"><span>If they have a real hand, you win</span><b>' + Math.round(v.eqVsValue * 100) + "%</b></div>" +
      '<div class="row"><span>If they are bluffing, you win</span><b>' + Math.round(v.eqVsAir * 100) + "%</b></div>" +
      '<div class="row"><span>Against that bettor heads-up, you win</span><b>' + Math.round(v.eqVsPolarised * 100) + "%</b></div>" +
      (Math.abs(v.decisionEquity - v.eqVsPolarised) > 0.005
        ? '<div class="row"><span>Including the other players, you win</span><b>' + Math.round(v.decisionEquity * 100) + "%</b></div>"
        : "") +
      '<div class="row"><span>And you need</span><b>' + (v.required * 100).toFixed(1) + "%</b></div>" +
      (v.mdfYouOwe !== null
        ? '<div class="row"><span>Least you should call with</span><b>' + Math.round(v.mdfYouOwe * 100) + "% of your hands</b></div>" +
          "<p style='margin-top:8px;font-size:12px;color:var(--dim)'>That last number is the trap most beginners fall into. " +
          "If you only ever call with strong hands, anyone paying attention can bet at you with anything and win.</p>"
        : "") +
      (v.source ? working("Where do these numbers come from?",
        "<p>" + v.bluffSource + "</p><p>" + v.source + "</p>" +
        '<p class="caveat">The bluffing percentage is the softest number the coach shows. Treat it as ' +
        "a starting point and adjust it yourself: against someone who never bluffs, this call is much worse " +
        "than it looks; against someone who bluffs constantly, much better.</p>") : "") +
      "</div>";
  }

  // full bet vs small bet vs check
  if (a.trap && a.trap.relevant) {
    var t = a.trap;
    var pill = t.preferSmall ? "small trap" : t.preferTrap ? "check trap" : t.canInduce ? "full bet ahead" : "no trap";
    h += '<div class="card-box ' + (t.preferTrap ? "check" : "raise") + '"><h3>How to get paid' +
      '<span class="pill ' + (t.preferTrap || t.preferSmall ? "g" : "v") + '">' + pill + "</span></h3>";
    h += '<div class="row"><span>' + (a.toCall ? "Raising to " + t.valueTo : "Betting " + t.valueTo) +
      " (full)</span><b>" + Math.round(t.evBet) + "</b></div>";
    if (t.evSmall !== null && t.smallTo)
      h += '<div class="row"><span>' + (a.toCall ? "Raising to " + t.smallTo : "Betting " + t.smallTo) +
        " (small)</span><b>" + Math.round(t.evSmall) + "</b></div>";
    h += '<div class="row"><span>' + (a.toCall ? "Calling" : "Checking") +
      "</span><b>" + Math.round(t.evTrap) + "</b></div>";
    if (t.canInduce) {
      h += '<div class="row"><span>They bet if you check</span><b>' + Math.round(t.pInduce * 100) + "%</b></div>";
    }
    if (t.smallTo && t.pRaiseSmall)
      h += '<div class="row"><span>They raise a small bet</span><b>' + Math.round(t.pRaiseSmall * 100) + "%</b></div>";
    h += "<p style='margin-top:8px'>" + t.text + "</p>";
    if (a.mix && a.mix.show) {
      h += "<p>These lines are close enough to mix. The headline is the better one; " +
        a.mix.altPhrase + ".</p>";
    } else if (t.preferTrap || t.preferSmall) {
      h += "<p>The trap is far enough ahead that it is the main line, not a variation.</p>";
    }
    if (t.source) h += working("Where do these totals come from?", "<p>" + t.source + "</p>");
    h += "</div>";
  }

  // what are they likely to have?
  var rangeReads = a.provenance && a.provenance.ranges;
  if (rangeReads && rangeReads.length) {
    h += '<div class="card-box"><h3>What they might be holding</h3>' +
      rangeReads.map(rangeReadHTML).join("") +
      "<p style='margin-top:10px;font-size:11.5px;color:var(--dim)'>These are examples from the exact sets sampled, not a claim about two specific cards. " +
      "Visible cards and your hand remove impossible combinations. In the notation above, <b>s</b> means suited and <b>o</b> means offsuit.</p></div>";
  }

  box.innerHTML = glossify(h);

  var hint = a.plain || (a.headline + " — " + (a.why[0] || ""));
  $("coachHint").innerHTML = "<b>Coach:</b> " + (hint.length > 175 ? hint.slice(0, 172) + "…" : hint);
}

/* ═══════════════════════════════════════════════ players / stats pane */
function renderPlayers() {
  if (!G || !TABLE) return;
  function styleOf(s) {
    if (!s.hands || s.hands < 8) return "not enough hands yet";
    var loose = s.vpip > 0.32, aggro = (s.aggr / Math.max(1, s.passive)) > 1.4;
    return (loose ? "plays a lot of hands" : "plays few hands") + ", " +
           (aggro ? "bets and raises" : "mostly calls");
  }
  var rows = G.players.map(function (p) {
    var s = TABLE.stats[p.name] || Bots.newStats();
    var vpip = s.hands ? Math.round(s.vpip * 100) + "%" : "—";
    var pfr = s.hands ? Math.round(s.pfr * 100) + "%" : "—";
    var af = (s.aggr + s.passive) ? (s.aggr / Math.max(1, s.passive)).toFixed(1) : "—";
    return '<tr><td><span class="pn">' + p.name + '</span><span class="pt">' +
      (p.persona ? p.persona.tag : "you") + "</span></td>" +
      "<td>" + n(p.chips) + "</td><td>" + vpip + "</td><td>" + pfr + "</td><td>" + af + "</td></tr>";
  }).join("");
  $("p-players").innerHTML =
    '<div class="card-box"><h3>How everyone plays</h3>' +
    '<table class="stbl"><thead><tr><th>Player</th><th>Chips</th>' +
    '<th data-tip="VPIP. How often they put money in before the flop instead of folding. Under 20% is tight; over 40% is loose.">Plays</th>' +
    '<th data-tip="PFR. How often they raise before the flop rather than just calling.">Raises</th>' +
    '<th data-tip="Aggression factor. Bets and raises divided by calls. Under 1 means a caller; over 3 means a bettor.">Bets vs calls</th>' +
    "</tr></thead><tbody>" + rows + "</tbody></table>" +
    '<p style="margin-top:9px;font-size:11.5px;color:var(--dim)">' +
    "<b>Plays</b> — how often they put money in before the flop instead of folding. " +
    "<b>Raises</b> — how often they raise rather than just call. " +
    "<b>Bets vs calls</b> — how aggressive they are once the flop comes; under 1 is a caller, over 3 is a bettor. " +
    "Hover any column for more. These build up as you play, and the coach uses them to guess what each player is holding.</p>" +
    '<p style="margin-top:7px;font-size:11.5px;color:var(--dim)">Two rules of thumb that will win you money: ' +
    "<b>bluff the players who fold a lot, never the ones who call a lot</b>, and " +
    "<b>believe the raises of players who rarely raise</b>.</p></div>" +
    G.players.filter(function (p) { return p.persona; }).map(function (p) {
      var s = TABLE.stats[p.name] || Bots.newStats();
      return '<div class="card-box"><h3>' + p.name + " — " + p.persona.tag + "</h3><p>" + p.persona.blurb + "</p>" +
        '<div class="row"><span>Hands they will play</span><b>about their best ' + Math.round(p.persona.openPct * 100) + "%</b></div>" +
        '<div class="row"><span>How often they bluff</span><b>' + Math.round(p.persona.bluff * 100) + "% of the time</b></div>" +
        '<div class="row"><span>How often they fold to a bet</span><b>' + Math.round(p.persona.foldToBet * 100) + "%</b></div>" +
        '<div class="row"><span>Hands you have seen</span><b>' + s.hands + "</b></div>" +
        '<div class="row"><span>What you have observed</span><b>' + styleOf(s) + "</b></div></div>";
    }).join("");
}

/* ═══════════════════════════════════════════════ end of hand */
function finishHand() {
  if (handSettled) return;
  handSettled = true;
  TABLE.finishHand();
  var me = G.players[0];
  var h = "";

  var won = (G.awards || []).filter(function (a) { return a.player === 0; })
                            .reduce(function (t, a) { return t + a.amount; }, 0);
  var invested = me.investedThisHand || 0;
  var net = won - invested;
  h += '<div class="card-box ' + (net > 0 ? "call" : net < 0 ? "fold" : "") + '"><h3>Hand ' + G.handNo + " result</h3>" +
    '<div class="rec ' + (net > 0 ? "call" : net < 0 ? "fold" : "check") + '">' +
    (net > 0 ? "+" : "") + n(net) + " chips</div>" +
    '<p class="plain">' + (net > 0 ? "You won this one." : net < 0 ? "You lost " + n(-net) + " on this hand." : "You broke even.") +
    " " + (G.stage === "showdown" ? "It went to showdown — the cards were turned face up." : "Nobody called, so no cards were shown.") + "</p>";
  if (G.awards && G.awards.length) {
    h += "<p>" + G.awards.map(function (a) {
      return "<b>" + a.name + "</b> won " + n(a.amount) + (a.handName ? " with " + a.handName : " (everyone folded)");
    }).join("<br>") + "</p>";
  }
  h += "</div>";

  if (decisions.length) {
    var agree = decisions.filter(function (d) { return d.verdict === "match"; }).length;
    h += '<div class="card-box"><h3>Decision review</h3>' +
      '<div class="row"><span>Matched the coach</span><b>' + agree + " / " + decisions.length + "</b></div>" +
      decisions.map(function (d) {
        var mark = d.verdict === "match" ? '<span class="pill g">match</span>' :
                   d.verdict === "close" ? '<span class="pill v">close</span>' :
                                           '<span class="pill r">differed</span>';
        return '<div class="row"><span>' + d.street + ": you <b style=\"color:var(--text)\">" +
          d.action + "</b>, coach said <b style=\"color:var(--text)\">" + d.rec.headline + "</b></span>" + mark + "</div>";
      }).join("") +
      "<p style='margin-top:8px;font-size:11.5px;color:var(--dim)'>Agreeing every time is not the goal — there is rarely " +
      "one right answer in poker, and good players deliberately mix things up. What matters is the pattern over many hands: " +
      "if you keep folding where the coach bets, you are playing too scared; if you keep calling where it folds, " +
      "you are paying people off.</p></div>";
  }
  $("p-coach").innerHTML = glossify(h);
  $("coachHint").innerHTML = '<b>Hand over.</b> Press <kbd>N</kbd> or click <b>New hand</b>. Ask Claude on the left to review it.';
  render();
}

/* ═══════════════════════════════════════════════ hand lifecycle */
var handSettled = false;

function newHand() {
  if (G && !G.handOver && G.stage !== "idle") {
    // refund anything uncontested so chips are never lost mid-hand
    G.players.forEach(function (p) { p.chips += p.committed; p.committed = 0; });
    G.handOver = true;
  }
  highlight = null; winnerIds = []; decisions = []; pending = null; queue = []; busy = false;
  handSettled = false;
  $("coachHint").textContent = "";
  streetsReset();
  if (!G) {
    G = new Poker.Game({
      sb: SB, bb: BB, startStack: STACK, button: 3,
      players: [{ name: "You", isHuman: true, chips: STACK }].concat(
        Bots.PERSONAS.slice(0, 3).map(function (ps) {
          return { name: ps.name, chips: STACK, persona: ps };
        }))
    });
    TABLE = Bots.createTable(G, Math.random);
  } else {
    G.button = G.nextSeated(G.button);
  }
  var playable = G.players.filter(function (p) { return p.chips > 0; });
  if (G.players[0].chips <= 0) {
    toast("You are out of chips", true);
    $("p-coach").innerHTML = '<div class="card-box fold"><h3>Busted</h3>' +
      "<p>You have no chips left. Click <b>Rebuy</b> in the header to sit back down with " +
      n(STACK) + " and keep playing — the bots keep their stacks, so you will be the short one for a while.</p>" +
      "<p>Worth asking Claude on the left to review the hands that got you here.</p></div>";
    switchPane("coach");
    $("coachHint").innerHTML = "<b>You are out of chips.</b> Click <b>Rebuy</b> to sit back down.";
    render();
    return;
  }
  if (playable.length < 2) {
    toast("Everyone else is broke — hit Rebuy", true);
    $("coachHint").innerHTML = "<b>Table is dead.</b> Click <b>Rebuy</b> to top everyone back up.";
    render();
    return;
  }
  G.startHand();
  TABLE.newHand();
  sessionStats.hands++;
  queue = G.drainEvents();
  switchPane("coach");
  pump();
}

function rebuy() {
  if (!G) return;
  if (!G.handOver) { toast("Finish the hand first"); return; }
  G.players.forEach(function (p) {
    if (p.chips < STACK) p.chips = STACK;
    p.sittingOut = false;
  });
  toast("Everyone topped up to " + n(STACK), true);
  $("coachHint").innerHTML = "<b>Rebought.</b> Press <kbd>N</kbd> or click <b>New hand</b> to deal.";
  render();
}

/* ═══════════════════════════════════════════════ chat with Claude */
function md(text) {
  // deliberately tiny markdown: escape first, then re-introduce a few things
  var s = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  var out = [], list = null;
  s.split("\n").forEach(function (line) {
    var m = line.match(/^\s*[-*]\s+(.*)$/);
    if (m) { if (!list) { list = []; } list.push("<li>" + m[1] + "</li>"); return; }
    if (list) { out.push("<ul>" + list.join("") + "</ul>"); list = null; }
    if (line.trim()) out.push("<p>" + line + "</p>");
  });
  if (list) out.push("<ul>" + list.join("") + "</ul>");
  return out.join("");
}

function addMsg(kind, who, html) {
  var d = document.createElement("div");
  d.className = "msg " + kind;
  d.innerHTML = (who ? '<div class="who">' + who + "</div>" : "") + "<div class='body'>" + html + "</div>";
  $("msgs").appendChild(d);
  $("msgs").scrollTop = $("msgs").scrollHeight;
  return d;
}

function transcript() {
  if (!G) return "";
  var t = G.playByPlay();
  if (pending) {
    t += "\n\nThe in-app coach currently recommends: " + pending.headline +
         "\n  Reasoning: " + pending.why.join(" ");
    if (pending.equity !== undefined)
      t += "\n  Estimated equity " + Math.round(pending.equity * 100) + "%" +
           (pending.toCall ? ", pot odds needed " + (pending.potOddsNeeded * 100).toFixed(1) + "%" : "");
    if (pending.trap && pending.trap.relevant) {
      t += "\n  How to get paid: full " + pending.trap.valueTo + " ~" + Math.round(pending.trap.evBet) +
           " chips";
      if (pending.trap.evSmall !== null && pending.trap.smallTo)
        t += ", small " + pending.trap.smallTo + " ~" + Math.round(pending.trap.evSmall) + " chips";
      t += ", " + (pending.toCall ? "call" : "check") + " ~" + Math.round(pending.trap.evTrap) + " chips.";
      if (pending.mix && pending.mix.show)
        t += " Mix: " + pending.mix.altPhrase + ".";
    }
    if (pending.provenance && pending.provenance.deals) {
      var pv = pending.provenance;
      t += "\n  That equity is a Monte Carlo estimate over " + pv.deals + " runouts (won " +
           pv.won + ", tied " + pv.tied + ", lost " + pv.lost + ", +/-" +
           (pv.margin * 100).toFixed(1) + " points), assuming these opponent ranges:";
      pv.ranges.forEach(function (r) {
        t += "\n    " + r.name + ": top " + Math.round(r.hi * 100) + "% (" + r.why + ")" +
             "; strong examples " + (r.strongest || []).join(", ") +
             (r.looseEdge && r.looseEdge.length ? "; loose-edge examples " + r.looseEdge.join(", ") : "") +
             "; evidence: " + (r.source || "default assumptions");
        if (r.boardExamples && r.boardExamples.value)
          t += "; board value examples " + r.boardExamples.value.join(", ");
        if (r.boardExamples && r.boardExamples.bluffs)
          t += "; board bluff examples " + r.boardExamples.bluffs.join(", ");
      });
      t += "\n  If you think a range assumption is wrong, say so — the equity number depends on it.";
    }
    if (pending.audit)
      t += "\n  Reliability: " + pending.audit.label + ". " + pending.audit.limitation;
    if (pending.solver) {
      if (pending.solver.status === "supported") {
        t += "\n  River equilibrium baseline: " + pending.solver.actionText +
             "; coach " + (pending.solver.coachAgrees ? "agrees" : "differs") + ". " +
             pending.solver.scope;
      } else {
        t += "\n  Solver baseline unavailable for this spot: " + pending.solver.reason;
      }
    }
    if (pending.adjustment)
      t += "\n  Opponent adjustment: " + pending.adjustment.status + ". " +
           pending.adjustment.reason + " Final source: " + pending.adjustment.finalSource + ".";
    if (pending.bluff)
      t += "\n  Bluff maths: fold equity " + Math.round(pending.bluff.foldEquity * 100) +
           "%, break-even " + Math.round(pending.bluff.breakEven * 100) +
           "%, EV " + Math.round(pending.bluff.ev);
    if (pending.vsBluff)
      t += "\n  Villain bluff estimate: " + Math.round(pending.vsBluff.bluffPct * 100) +
           "% of their betting range, decision equity " + Math.round(pending.vsBluff.decisionEquity * 100) + "%";
  }
  if (TABLE) {
    // Deliberately no persona labels here: the student cannot see how a bot is
    // configured, only how it has actually played, so neither should the coach.
    // Anything said about a player has to be earned from observed behaviour.
    t += "\n\nWhat has actually been observed about each opponent this session " +
         "(no labels — these are the only reads available, and small samples mean little):";
    G.players.forEach(function (p) {
      if (p.isHuman) return;
      var s = TABLE.stats[p.name];
      if (!s || !s.hands) return;
      var af = s.aggr + s.passive ? (s.aggr / Math.max(1, s.passive)).toFixed(1) : "n/a";
      t += "\n  " + p.name + ": " + s.hands + " hands seen, played " +
           Math.round(s.vpip * 100) + "% of them before the flop, raised " +
           Math.round(s.pfr * 100) + "%, bets-and-raises to calls ratio " + af;
    });
  }
  return t;
}

function ask(question) {
  if (!question.trim()) return;
  addMsg("you", "You", md(question));
  $("qbox").value = "";
  $("send").disabled = true;

  if (!serverUp) {
    addMsg("err", null, md("The chat needs the local server. Run **`python3 server.py`** in this folder and open " +
      "**http://127.0.0.1:8777/** — opening `index.html` straight from disk cannot start a `claude` process."));
    $("send").disabled = false;
    return;
  }
  if (!engineInfo[engine].available) {
    addMsg("err", null, md("The `" + engine + "` CLI was not found on PATH. Pick another engine in the " +
      "dropdown, or install it and reload."));
    $("send").disabled = false;
    return;
  }

  var bubble = addMsg("ai", engineInfo[engine].label, '<span class="caret"></span>');
  var body = bubble.querySelector(".body");
  var asked = engine;
  var acc = "";

  fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: question, transcript: transcript(),
      engine: engine, sessionId: chatSessions[engine]
    })
  }).then(function (res) {
    if (!res.ok) return res.json().then(function (j) { throw new Error(j.error || ("HTTP " + res.status)); });
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = "";
    function step() {
      return reader.read().then(function (r) {
        if (r.done) { finish(); return; }
        buf += dec.decode(r.value, { stream: true });
        var parts = buf.split("\n\n");
        buf = parts.pop();
        parts.forEach(function (chunk) {
          var line = chunk.split("\n").filter(function (l) { return l.indexOf("data: ") === 0; })[0];
          if (!line) return;
          var ev;
          try { ev = JSON.parse(line.slice(6)); } catch (e) { return; }
          if (ev.type === "session") chatSessions[asked] = ev.sessionId;
          else if (ev.type === "delta") {
            acc += ev.text;
            body.innerHTML = md(acc) + '<span class="caret"></span>';
            $("msgs").scrollTop = $("msgs").scrollHeight;
          } else if (ev.type === "error") {
            acc += (acc ? "\n\n" : "") + "**Error:** " + ev.message;
            bubble.className = "msg err";
          }
        });
        return step();
      });
    }
    function finish() {
      body.innerHTML = md(acc || "_(no reply)_");
      $("send").disabled = false;
      $("msgs").scrollTop = $("msgs").scrollHeight;
    }
    return step();
  }).catch(function (err) {
    bubble.className = "msg err";
    body.innerHTML = md("Could not reach the coach: " + err.message);
    $("send").disabled = false;
  });
}

function engineStatus() {
  var info = engineInfo[engine];
  if (!serverUp) {
    $("status").className = "bad";
    $("statusText").textContent = "server not running";
    return;
  }
  $("status").className = info.available ? "ok" : "bad";
  $("statusText").textContent = info.available
    ? engine + " ready" + (info.model ? " · " + info.model : "")
    : engine + " CLI not found on PATH";
}

function checkServer() {
  fetch("/api/health").then(function (r) { return r.json(); }).then(function (j) {
    serverUp = true;
    var got = j.engines || {};
    Object.keys(engineInfo).forEach(function (name) {
      var e = got[name] || {};
      engineInfo[name].available = !!e.available;
      engineInfo[name].model = e.model || null;
      if (e.label) engineInfo[name].label = e.label;
      var opt = $("engine").querySelector('option[value="' + name + '"]');
      if (opt) {
        opt.disabled = !e.available;
        opt.textContent = engineInfo[name].label + (e.available ? "" : " (not installed)");
      }
    });
    if (!engineInfo[engine].available) {
      // fall back to whichever engine is actually there rather than dead-ending
      var alt = Object.keys(engineInfo).filter(function (n) { return engineInfo[n].available; })[0];
      if (alt) { engine = alt; $("engine").value = alt; }
    }
    engineStatus();

    var live = Object.keys(engineInfo).filter(function (n) { return engineInfo[n].available; });
    if (live.length) {
      addMsg("sys", null, md("Ask anything about the hand in progress — including \"what does that even mean?\". " +
        "Your question goes to a local `" + engine + "` process along with the full play-by-play, your cards, the board, " +
        "the stacks, and the coach's reasoning. Answers come back in plain English, no poker jargon. " +
        "Follow-up questions stay in the same conversation" +
        (live.length > 1 ? ", and the dropdown above switches which CLI answers — each keeps its own thread." : ".")));
    } else {
      addMsg("err", null, md("The server is running but neither the `claude` nor the `codex` CLI was found on PATH."));
    }
  }).catch(function () {
    serverUp = false;
    engineStatus();
    addMsg("sys", null, md("To use the chat, run **`python3 server.py`** in this folder and open " +
      "**http://127.0.0.1:8777/**. The game itself works fine without it."));
  });
}

/* ═══════════════════════════════════════════════ wiring */
function switchPane(name) {
  document.querySelectorAll(".tab").forEach(function (t) { t.classList.toggle("on", t.dataset.p === name); });
  document.querySelectorAll(".pane").forEach(function (p) { p.classList.toggle("on", p.id === "p-" + name); });
}
document.querySelectorAll(".tab").forEach(function (t) {
  t.addEventListener("click", function () { switchPane(t.dataset.p); });
});
document.querySelectorAll(".ln").forEach(function (b) {
  b.addEventListener("click", function () {
    document.querySelectorAll(".ln").forEach(function (x) { x.classList.toggle("on", x === b); });
    document.querySelectorAll(".lgroup").forEach(function (g) { g.classList.toggle("on", g.dataset.lv === b.dataset.lv); });
    $("p-learn").scrollTop = 0;
  });
});

$("bFold").onclick = function () { humanAct("fold"); };
$("bCall").onclick = function () { humanAct("call"); };
$("bRaise").onclick = function () { humanAct("raise"); };
$("amtInput").addEventListener("input", function () { amtTouched = true; updateAmount(); });
$("amtInput").addEventListener("focus", function () { this.select(); });
$("amtInput").addEventListener("blur", function () {
  var lg = G && G.legal(0);
  if (!lg || !lg.canRaise) return;
  var v = readAmount();
  if (isNaN(v)) { setAmount(Coach.betTarget(G, 0, 0.66), false); return; }
  setAmount(Math.max(lg.minRaiseTo, Math.min(lg.maxRaiseTo, v)), true);
});
$("amtInput").addEventListener("keydown", function (e) {
  var lg = G && G.legal(0);
  if (!lg || !lg.canRaise) return;
  if (e.key === "Enter") { e.preventDefault(); humanAct("raise"); return; }
  if (e.key === "Escape") { e.preventDefault(); this.blur(); return; }
  // arrow keys nudge by one big blind, like a stepper
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    var v = readAmount();
    if (isNaN(v)) v = lg.minRaiseTo;
    var step = e.shiftKey ? BB * 5 : BB;
    setAmount(Math.max(lg.minRaiseTo, Math.min(lg.maxRaiseTo,
      v + (e.key === "ArrowUp" ? step : -step))), true);
  }
});
document.querySelectorAll(".sz").forEach(function (b) {
  b.addEventListener("click", function () {
    if (!G || G.actionOn !== 0) return;
    setAmount(sizeFor(b.dataset.f), true);
  });
});
$("bNew").onclick = newHand;
$("bRebuy").onclick = rebuy;
$("tReveal").addEventListener("change", function () { revealAll = this.checked; render(); });
$("tCoach").addEventListener("change", function () { showCoach(pending); });

document.addEventListener("keydown", function (e) {
  var tag = (e.target.tagName || "").toLowerCase();
  if (tag === "textarea" || tag === "input" || e.metaKey || e.ctrlKey || e.altKey) return;
  var k = e.key.toLowerCase();
  if (k === "n") { newHand(); return; }
  if (!G || G.actionOn !== 0 || G.handOver || busy) return;
  if (k === "f") { e.preventDefault(); humanAct("fold"); }
  if (k === "c") { e.preventDefault(); humanAct("call"); }
  if (k === "r") { e.preventDefault(); humanAct("raise"); }
});

$("engine").addEventListener("change", function () {
  engine = $("engine").value;
  engineStatus();
});
$("chatForm").addEventListener("submit", function (e) { e.preventDefault(); ask($("qbox").value); });
$("qbox").addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask($("qbox").value); }
});
document.querySelectorAll(".qbtn").forEach(function (b) {
  b.addEventListener("click", function () { ask(b.dataset.q); });
});

/* ═══════════════════════════════════════════════ boot */
// A small handle on the live objects, for poking at the game from the console.
window.HoldemCoach = {
  get game() { return G; },
  get table() { return TABLE; },
  get advice() { return pending; },
  transcript: function () { return transcript(); },
  render: render
};
checkServer();
$("p-coach").innerHTML =
  '<div class="card-box gold"><h3>Welcome</h3>' +
  "<p>Texas Hold'em against three opponents, each with a different style. You start with 2,000 chips; " +
  "two players are forced to bet " + SB + " and " + BB + " every hand to get things going.</p>" +
  "<p>Every time it's your turn, this panel tells you <b>what to do and why</b> — how often you win, " +
  "what the bet is costing you, and whether bluffing would actually work. Underlined words have a " +
  "plain-English definition if you hover them.</p>" +
  "<p><b>New to poker?</b> Open the <b>Lessons</b> tab and read <em>Start here</em> — it's about four minutes " +
  "and covers everything you need.</p>" +
  "<p><kbd>F</kbd> fold &nbsp; <kbd>C</kbd> check/call &nbsp; <kbd>R</kbd> bet/raise &nbsp; <kbd>N</kbd> new hand</p></div>";
newHand();
})();
