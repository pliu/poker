# Hold'em Coach

No-Limit Texas Hold'em against three bots with distinct, real strategies, plus a
coach that shows the arithmetic behind every decision — including bluffing in
both directions — and a chat box that hands the play-by-play of the current hand
to a local `claude` (or `codex`) process.

## Running it

```sh
./run.sh                 # or: python3 server.py
```

Then open <http://127.0.0.1:8777/>.

The game itself is static and works if you just open `index.html` from disk.
The chat box needs the server, because it spawns `claude -p` (or `codex exec`)
per question. The dropdown above the chat picks which one answers; Claude is the
default, each engine keeps its own conversation thread, and an engine whose CLI
is missing from `PATH` shows up disabled. The server binds to loopback only.

| Environment variable   | Default  | Meaning                          |
| ---------------------- | -------- | -------------------------------- |
| `PORT`                 | `8777`   | port to serve on                 |
| `POKER_COACH_MODEL`    | `sonnet` | model passed to `claude --model` |
| `POKER_COACH_TIMEOUT`  | `120`    | seconds before a question is killed |
| `CLAUDE_BIN`           | *(PATH)* | path to the `claude` binary      |
| `CODEX_BIN`            | *(PATH)* | path to the `codex` binary       |
| `POKER_COACH_CODEX_MODEL` | *(codex default)* | model passed to `codex --model` |

## Tests

```sh
./test/run.sh
```

There is no Node on this machine, so the suite runs the browser source files
verbatim under macOS JavaScriptCore (`osascript -l JavaScript`). It covers hand
evaluation, side pots, betting legality, a 400-hand bot fuzz with chip
conservation, persona-distinguishability, and the coach's recommendations. Also
useful: `osascript -l JavaScript test/coach_spots.js` prints the coach's full
reasoning for a set of textbook spots so you can read it and disagree.

## Files

| File           | What lives there |
| -------------- | ---------------- |
| `poker.js`     | Cards, hand evaluation, range-aware equity, the betting state machine. No DOM. |
| `ranges.js`    | Inferred opponent hand sets, action conditioning, and auditable range examples. Pure. |
| `exploit.js`   | Opponent fold/future-bet models and explanation of deviations from balance. Pure. |
| `context.js`   | The shared decision snapshot and external-solver serialization boundary. Pure. |
| `coach.js`     | Practical fallback advice, price/EV arithmetic, bluff-catching, and compatibility exports. Pure. |
| `solver.js`    | Hypothetical response benchmark for supported heads-up river decisions. Pure. |
| `teaching.js`  | Spot-specific hand stories, alternative-line comparisons, tipping points, and reusable lessons. Pure. |
| `strategy.js`  | Orchestrates context → coach/baseline → opponent adjustment → final explanation. Pure. |
| `bots.js`      | Opponent AI and the observed-stats tracker. Pure. |
| `ui.js`        | Rendering, event animation, the action feed, the chat client. |
| `index.html`   | Markup and styles. |
| `server.py`    | Static server + `POST /api/ask`, which streams a `claude -p` or `codex exec` subprocess back as SSE. |

The decision modules are deterministic given an injected RNG, which is what
makes the whole pipeline testable without a browser.

---

## Written for someone who has never played

The coach explains itself in plain English first and names the poker term second.
Instead of *"~35% equity vs a top-12% range, pot odds 33%, MDF 67%"* you get:

> **CALL 200**
> Call. You win often enough to justify the price.
>
> It costs 200 to stay in a pot that would then be worth 800. So you need to win
> 25% of the time to break even — and you win 35% of the time (about 1 time in 3).
> That makes calling profitable.

Jargon that can't be avoided gets a dotted underline and a one-line definition on
hover, drawn from a glossary in `ui.js`. Numbers are given as odds people think in
("about 1 time in 3") and hand strength in words ("a premium hand", "close to
junk") rather than percentiles alone.

**Every number says where it came from.** Under each figure there's a *"Where does
29% come from?"* disclosure that shows the actual working: how many simulated deals
were run, how many you won, tied and lost, the range assumed for each opponent by
name, and the sampling margin of error. The range panel expands "top 18%" into
concrete hand-class examples, shows the observed evidence behind the estimate, and
on later streets shows example value and bluff holdings from the exact board slices
being sampled. It also separates measurable simulation noise from model uncertainty:
*"they fold 55%"* and *"that's a bluff 36% of the time"* are assumptions, not facts.

**The recommendation is not advertised as solver-optimal.** The coach combines
Monte Carlo showdown chances with hand-built models of opening ranges, folds,
bluffs, and one-street future betting. The sidebar says explicitly that this is the
move the model prefers under those assumptions, not a solved equilibrium. A real solver would
build the complete game tree and jointly optimise every hand in every player's
strategy; this app does not do that.

The separate **river response benchmark** compares actions against an explicitly
hypothetical opponent. It assumes a bluff share derived from pot odds when facing
a bet, or an MDF-sized continuing range when checked to. Those frequencies are
assumptions, not a solved equilibrium for the displayed ranges. The panel shows
action values under those assumptions and whether the practical coach agrees.
Earlier streets, multiway pots, prior river raises, unequal all-ins, guaranteed
chops, and checks that leave another player to act are marked unsupported.
`SolverBaseline.serializeSpot()` remains the boundary for a future external solver.

The live recommendation now runs through an explicit strategy pipeline:

```text
DecisionContext (public state + observed stats)
    ├─ RangeModel          → inferred hand sets
    ├─ SolverBaseline      → hypothetical response benchmark, when supported
    └─ Coach               → practical fallback recommendation
             ↓
       ExploitModel        → explains opponent-specific deviation
             ↓
       StrategyEngine      → final action + source + explanation
```

The range snapshot is constructed once and shared; the solver no longer copies
the coach's value/bluff result. Each final recommendation records whether the
response benchmark was supported, whether an opponent adjustment was made, and
whether the practical coach was used as a fallback. Compatibility exports on
`Coach` keep existing bot and test callers working while the implementations
remain separated.

The **What they might be holding** panel now samples representative hands from
across each inferred set rather than repeatedly displaying only premium hands.
The set responds to position, observed player tendencies, and the latest action.
A check shifts most weight toward medium and weak holdings while preserving a
small, explicit slow-play component; the panel names examples of both. When two
players genuinely have the same evidence, it says why their rows match instead
of implying false precision.

The **Learn from this spot** card is produced separately from action selection.
It turns the current calculation into four concrete teaching steps: read the
opponent's line using named example holdings, compare available actions in chips,
find the numerical boundary that would reverse the decision, and retain one rule
for similar future hands. River bluff-catches solve for the minimum bluff share
directly; value/trap spots rank full bet, small bet, and check/call by modeled
chip return. The card also poses the specific range question the player should
ask before acting, rather than merely repeating “bet strong hands” or “fold weak
hands.”

The **Lessons** tab is split into four short reads — *Start here*, *The money*,
*Bluffing*, *Reading people* — starting from what the game is and how a hand runs,
with a hand-ranking table showing how often each hand actually turns up. The
**Players** tab labels its columns *Plays / Raises / Bets vs calls* instead of
VPIP/PFR/AF, and says what to do about each type of opponent.

The **chat** answers under the same rules — its system prompt in `server.py` carries an
explicit list of terms it may not use unexplained (equity, range, pot odds, MDF,
blockers, polarised, c-bet, GTO...) with the plain phrasing to use instead.

**The chat is not told how the bots are configured.** It receives only what the player
can also see: the play-by-play and the observed statistics. No persona labels, no
"Vicky is a calling station" — if it wants to call somebody a station it has to earn
that from the numbers, say how many hands it is drawn from, and admit when the sample
is too small to mean anything.

**The bet amount is a text box**, not a slider — type an exact number (commas fine),
or use the quick-pick buttons for min / a third / half / three-quarters / pot / all-in.
Arrow keys nudge by a big blind (shift for five), Enter commits. It pre-fills with
whatever the coach suggests until you type your own number, and refuses to submit an
illegal amount rather than silently clamping it.

## How the coaching works

The old version measured your equity against **random** hands. That is the wrong
question — you never play against random cards, you play against the hands
somebody would play *this way*. So:

- Preflop, a hand that is too weak for *this* pot can still be a call for the
  pot it wins when it hits something they will not expect. Small pairs (22–77)
  call a raise to flop a set (~1 in 8) when ~15× the call remains behind.
  Suited connectors / one-gappers and wheel aces (A2s–A5s) do the same from
  late position or the big blind, a bit more expensively. Short stacks, 3-bet
  pots without depth, offsuit junk, and suited hands out of the small blind
  still fold. The unused `speculative` flag is now a real check with chip
  arithmetic in the explanation.
- Each opponent gets an estimated range (a cumulative percentage of the 1,326
  equally likely starting-card combinations) from what they've done this hand
  and their observed VPIP/PFR over the session. A preflop raiser might be top
  12%; a big blind that just checked is nearly any two cards.
- Equity is Monte-Carlo'd against those ranges, not against the deck — including
  preflop, so the win percentage is shown and explainable on every street. Hidden
  hands are sampled before future board cards, preserving card-removal effects.
- When somebody bets, their range is re-split **by how strong each holding is on
  this board**, not by preflop rank — because AK is a premium hand preflop and
  complete air on 7-6-2.

### Bluffing

Every postflop decision computes both directions.

**Should you bluff?** Betting `b` to win `p` needs folds `b / (p + b)` of the
time. How often you actually get them is anchored on minimum defence frequency —
a balanced opponent continues with `p / (p + b)` of their range — and adjusted
for how sticky that particular opponent has been, how wet the board is, and how
many people you have to get through. Raising a bettor is treated as much harder
than betting into a checker, because it is. Then:

```
EV = fold% × pot + (1 − fold%) × (equity-when-called × (pot + 2b) − b)
```

`equity-when-called` is measured against the top slice of their range — the part
that actually calls — not against their whole range. The pure-bluff fold line is
shown as context, but the recommendation uses total EV. A semi-bluff can therefore
be profitable below that line when its equity on calls makes up the difference;
a zero-equity bluff cannot.

**Are you being bluffed?** From the bet size, the street, the board and their
observed aggression, the coach estimates what fraction of their betting range is
air, then reports your equity against a compact value slice, against a separate bluffing slice,
and blended — versus the price you're being laid. It also shows the MDF you owe,
which is the argument for calling with hands that feel too weak to call.

Blockers get flagged when you hold them (the ace of the board's flush suit,
top-pair blockers), because a bluff representing a hand they cannot have is a
much better bluff.

### Trapping and mixed lines

With a strong made hand the coach compares **three** chip totals, not just
“you are ahead, therefore bet”:

- **Full bet/raise** — the usual value size (~⅔–¾ pot). Fold equity at that
  size, win rate against the hands that continue.
- **Small bet/raise** — about a third of the pot (or a min-raise). Looks like a
  stab, so worse hands stay and they raise more often. Same value formula at
  the smaller size, plus the extra they put in when they raise the stab. This
  is slow-play that still charges for a card.
- **Check/call** — look one street ahead. How often they bet if you look weak,
  win rate against that betting range, minus a free-card cost on wet boards.
  If nobody can still bet (last to act on the river) this line is just
  checking down, and it loses.

The headline is whichever total is bigger (ties stay with the full bet). When
lines are close it also prints a **mix**: “also bet small about 1 time in 3.”
That frequency is a softmax of the chip gap, not a coin flip, so the tests
stay deterministic. Taking another line with real weight grades as `close`,
not a miss. The numbers declare themselves a model of the next betting round,
not a simulation of every future card.

## Bugs found in the original single-file version

1. `applyAction()`'s raise branch declared `let text`, shadowing the outer
   variable — so `lastActionText` was always empty and seats never displayed
   "BET 120" or "RAISE to 240". The one thing that most needed to be visible was
   the one thing that never rendered.
2. An under-sized all-in re-opened the betting for everyone. A short all-in that
   is less than a full raise must not hand already-matched players a new raise
   right.
3. Betting continued when only one player still had chips: if two bots called
   all-in for less, the engine dealt the next street and prompted the lone live
   player to bet into a pot nobody could call.
4. `evaluate()` chose kickers by group order rather than by rank. Quads plus a
   pair plus a higher single returned the pair as the kicker; with three pairs,
   the two-pair kicker was the *lowest* pair instead of the best remaining card.
5. Side-pot payouts were keyed by player name, so duplicate names merged stacks.
6. `showdown()` dereferenced `potDesc[0]` with no guard.
7. Postflop action always began scanning from the button, and there was no
   heads-up blind reversal (button posts the small blind and acts first preflop,
   last postflop).
8. `advanceAfterNoActions()` was unreachable-but-live code that could deal a
   street twice.
9. Rebuy topped players up mid-hand without reconciling committed chips.
10. The "coach agreement" score compared two freshly built `Set` objects with
    `===`, so it was always 0/N.
11. `preflopTier()` gave tier 2 to every suited hand with a jack or better — J2s
    and Q3s were rated as near-premium.
12. Equity was computed against random hands, so the coach badly misjudged spots
    against opponents who had already raised.
13. "Draw" was `made[0] <= 1` — any unpaired hand counted as a draw and got
    credited with implied odds, including on the river.
14. There was no fold-equity or bluff analysis at all, in either direction.

## Bugs found after the rewrite

15. **Players were dealt four cards once anyone was eliminated.** `_nextSeated()`
    skips players who are sitting out, so it cycles through the *seated* players —
    but the dealing loop ran `players.length` times. With one seat empty the first
    seated player got a second card on each pass and ended up holding four. The same
    mistake in `_streetOrder()` put a player into the betting order twice. Both now
    loop over `seated().length`. Covered by tests over all twelve
    elimination/button combinations, plus a 400-hand session in which 367 hands ran
    short-handed.

## Calibration fixes from the coaching audit

16. **Opponents were assumed to fold 25% more than the price demands.** With no
    history, the fold model multiplied the minimum-defence continue rate by
    0.75, so a two-thirds-pot flop bet was assumed to fold 60% of hands where
    the price says 40%. Every bluff and semi-bluff looked better than it was,
    and every value line worse. The default is now anchored on the
    minimum-defence rate; observed looseness and board texture move it.
17. **River bettors were assumed to over-bluff.** The default bluff share sat
    five to eight points above the balanced share for the size, so ace-high
    called three-quarters pot with a plain CALL. The default is now the
    balanced share, `b / (p + 2b)`, adjusted by observed aggression; a spot
    within a couple of points of break-even says so in both directions.
18. **A raise of a small bet was valued against the betting range.** The
    small-bet trap line credited the hero with the same win rate against a
    re-raise as against the original bet. Raising ranges are stronger; the line
    now measures against a narrower value slice plus thinner bluffs.
19. **The coach read the bot's persona.** The future-bet estimate used the
    programmed c-bet and aggression until twelve hands had been observed. It now
    uses only the observed statistics, the same evidence the player can see.
20. **The big blind raised 55% of hands over a limp.** The open threshold was
    reused as an isolation threshold, and the copy claimed the big blind would
    act last after the flop. Blinds now raise about their best 20–24% over
    limpers, the big blind checks the rest, and the small blind completes with
    playable hands.
21. **The steal copy claimed the blinds fold more often than the break-even
    bar.** They fold to a button raise together around 40% of the time, not
    67%. The copy now says so, and explains that position and equity when
    called make up the difference.
22. **Seven-card hand odds were wrong at the top.** Straight flush and quads
    were listed at 1 in 30,000 and 1 in 4,000; over seven cards they are about
    1 in 3,200 and 1 in 600.
23. **Set-mining wanted only 10× behind.** The rule now asks for about 15×,
    since a flopped set does not get paid every time.

## Further correctness fixes

- Call equity scores each main/side pot against its eligible opponents in the
  same sampled deal, preserving card removal across all live hands. The displayed
  percentage in these spots is the expected share weighted by pot size. Side-pot
  calls use expected payout minus call cost; this remains a showdown benchmark
  before future betting, not a solved raise strategy.
- Bluff profitability includes folding at zero additional cost, and displayed
  chip returns preserve losses. Bet sizes and modeled contributions respect
  effective stacks, including returned excess on minimum bets against short stacks.
- Odd chips are distributed one at a time to tied winners clockwise from the
  button. Betting ends when the sole remaining live stack has nothing left to
  call, and raising requires another stack that can respond.
- Playing-the-board explanations compare five-card hands rather than claiming
  a pair beats any board. Hand transcripts retain the original starting stacks
  after both showdown and uncontested payouts.

These cases are covered by `test/audit_regressions.js`, loaded by the main suite.
