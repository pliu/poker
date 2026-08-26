#!/usr/bin/env python3
"""Local dev server for Hold'em Coach.

Serves the static app and exposes one endpoint, POST /api/ask, which spawns a
`claude -p` (or `codex exec`) subprocess, feeds it the play-by-play of the hand
in progress plus the user's question, and streams the reply back as
Server-Sent Events. Which of the two answers is chosen per request by the
engine dropdown in the browser.

Everything is Python standard library, and the socket is bound to loopback only
(the endpoint runs a local subprocess, so it must never be reachable off-box).
"""

import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get("POKER_COACH_MODEL", "sonnet")
CLAUDE_BIN = os.environ.get("CLAUDE_BIN") or shutil.which("claude")
CODEX_BIN = os.environ.get("CODEX_BIN") or shutil.which("codex")
CODEX_MODEL = os.environ.get("POKER_COACH_CODEX_MODEL") or None
TIMEOUT_S = int(os.environ.get("POKER_COACH_TIMEOUT", "120"))

DEFAULT_ENGINE = "claude"
ENGINES = {
    "claude": {"label": "Claude", "bin": CLAUDE_BIN, "model": MODEL},
    "codex": {"label": "Codex", "bin": CODEX_BIN, "model": CODEX_MODEL},
}

SYSTEM_PROMPT = """You are a sharp, friendly No-Limit Texas Hold'em coach sitting next to a \
student who is playing a 4-handed cash game against three bots.

The student is a beginner. Assume they know nothing about poker beyond which \
hands beat which. Your analysis should be just as rigorous as it would be for an \
expert — but your *vocabulary* must not be.

You will be given the complete play-by-play of the hand in progress (or the hand \
that just finished), the student's hole cards, the board, stack sizes, what the \
in-app coach recommends, and the opponent ranges its numbers assume. Then their question.

WRITE IN PLAIN ENGLISH
- Answer the actual question in the first sentence. No preamble.
- Never use a poker term where an ordinary phrase will do. If a term is genuinely \
unavoidable, define it inline in a few words the first time you use it, then carry on.
- Specifically, do not use these unexplained: equity, range, pot odds, implied odds, \
fold equity, MDF, minimum defence frequency, blockers, polarised, capped, c-bet, \
continuation bet, barrel, GTO, EV, ICM, nut, nutted, air, value-town, thin value, \
board texture, wet, dry, out of position, villain, hero, bricked, runner-runner, \
backdoor, overcard, kicker, board coverage, equity realisation.
  Say instead: how often you win / the hands they'd play this way / the price you're \
being offered / the extra money you'd win later when it comes in / how often they fold \
/ how often you have to call so they can't bet at you for free / cards in your hand \
they therefore can't have / either very good or nothing / betting again on the next \
card / the long-run average / the best possible hand / nothing at all / how connected \
the cards in the middle are / acting before them / your opponent / you / missed.
- Give percentages a plain gloss where it helps: "about 1 time in 3", "roughly half \
the time", "almost never".
- Use the actual chip numbers from this hand, not abstractions. "You'd be putting in \
120 to win the 300 already there" beats "you're getting 2.5:1".
- Explain what a number *means*, not just what it is. A percentage with no consequence \
attached teaches nothing.
- The transcript and the coach's notes below use poker shorthand among themselves. Do \
not mirror it back at the student.

WHAT TO COVER
- Reason about all the hands the opponent could have, given how they've bet — not one \
imagined holding. Say which of those hands are good ones they're betting because they \
expect to win, and which are bluffs.
- Take bluffing seriously in both directions: when the student should bluff (how often \
it needs to work to be worth it, and whether these opponents fold that often), and when \
they're being bluffed.
- If the notes compare a full bet, a small bet, and a check/call for a strong hand, \
explain all three in chips. A small bet is also a trap: it keeps worse hands and still \
looks weak enough to raise. If it says to mix them, say how often and why a check or a \
tiny bet should not always mean weakness.
- The numbers you're given come with their assumptions attached. If an assumption looks \
wrong to you — a range too tight or too wide for how that player has actually behaved — \
say so and say which way it moves the answer. You are the second opinion, not an echo.
- If the in-app coach's recommendation looks wrong, say so and explain why.

FORMAT
- A few short paragraphs or a tight bullet list. This is a chat box beside a live game, \
not an essay. Plain text and simple markdown only.
- You are NOT told how the bots are programmed, and you must not pretend otherwise. \
The only thing you know about an opponent is what the transcript shows them doing and \
the observed statistics attached to it. Base every read on that, say how many hands it \
is drawn from, and be honest that a handful of hands tells you almost nothing. If you \
have no read, say you have no read and reason from the situation instead.

Never claim to know the bots' hole cards unless they are shown in the transcript."""


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        if os.environ.get("POKER_COACH_VERBOSE"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ------------------------------------------------------------------ GET
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/health":
            self._json(200, {
                "ok": True,
                # kept for anything still asking only about claude
                "claude": CLAUDE_BIN or None,
                "model": MODEL,
                "available": bool(CLAUDE_BIN),
                "defaultEngine": DEFAULT_ENGINE,
                "engines": dict((name, {
                    "label": e["label"],
                    "bin": e["bin"] or None,
                    "model": e["model"],
                    "available": bool(e["bin"]),
                }) for name, e in ENGINES.items()),
            })
            return
        if path == "/":
            self.path = "/index.html"
        return super().do_GET()

    # ----------------------------------------------------------------- POST
    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path != "/api/ask":
            self._json(404, {"error": "no such endpoint"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception as exc:
            self._json(400, {"error": "bad request: %s" % exc})
            return

        question = (body.get("question") or "").strip()
        transcript = body.get("transcript") or ""
        session_id = body.get("sessionId") or None
        engine = (body.get("engine") or DEFAULT_ENGINE).strip().lower()
        if not question:
            self._json(400, {"error": "empty question"})
            return
        if engine not in ENGINES:
            self._json(400, {"error": "unknown engine %r" % engine})
            return
        if not ENGINES[engine]["bin"]:
            self._json(503, {"error": "the `%s` CLI was not found on PATH" % engine})
            return

        self._stream_engine(engine, question, transcript, session_id)

    # ------------------------------------------------------------- internals
    def _json(self, code, payload):
        data = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _sse(self, obj):
        self.wfile.write(b"data: " + json.dumps(obj).encode() + b"\n\n")
        self.wfile.flush()

    def _stream_engine(self, engine, question, transcript, session_id):
        cmd, prompt, events = COMMANDS[engine](question, transcript, session_id)

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Connection", "close")
        self.end_headers()

        try:
            proc = subprocess.Popen(
                cmd, cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True, bufsize=1,
            )
        except Exception as exc:
            self._sse({"type": "error", "message": "could not start %s: %s" % (engine, exc)})
            self._sse({"type": "done"})
            return

        errbuf = []
        threading.Thread(target=lambda: errbuf.append(proc.stderr.read()),
                         daemon=True).start()

        def feed():
            try:
                proc.stdin.write(prompt)
                proc.stdin.close()
            except Exception:
                pass
        threading.Thread(target=feed, daemon=True).start()

        killer = threading.Timer(TIMEOUT_S, proc.kill)
        killer.start()
        try:
            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue
                for out in events.feed(line):
                    self._sse(out)
        except (BrokenPipeError, ConnectionResetError):
            proc.kill()
            return
        finally:
            killer.cancel()

        rc = proc.wait()
        if rc != 0 and not events.got_text:
            msg = ("".join(errbuf) or "").strip()[-600:] or ("%s exited with code %d" % (engine, rc))
            self._sse({"type": "error", "message": msg})
        self._sse({"type": "done"})


class ClaudeEvents:
    """Turns `claude --output-format stream-json` lines into browser events."""

    def __init__(self):
        self.got_text = False

    def feed(self, line):
        out = []
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            return out
        kind = ev.get("type")
        if kind == "system" and ev.get("subtype") == "init":
            out.append({"type": "session", "sessionId": ev.get("session_id"),
                        "model": ev.get("model")})
        elif kind == "stream_event":
            inner = ev.get("event") or {}
            if inner.get("type") == "content_block_delta":
                delta = inner.get("delta") or {}
                if delta.get("type") == "text_delta":
                    self.got_text = True
                    out.append({"type": "delta", "text": delta.get("text", "")})
        elif kind == "result":
            if ev.get("is_error"):
                out.append({"type": "error",
                            "message": ev.get("result") or "claude reported an error"})
            elif not self.got_text and ev.get("result"):
                self.got_text = True
                out.append({"type": "delta", "text": ev["result"]})
            out.append({"type": "usage",
                        "costUsd": ev.get("total_cost_usd"),
                        "durationMs": ev.get("duration_ms")})
        return out


class CodexEvents:
    """Turns `codex exec --json` JSONL into the same browser events.

    Codex reports the reply as an item that may arrive complete in one event or
    as a run of updates each carrying the whole text so far, so remember what has
    already gone out per item and forward only the new tail.
    """

    def __init__(self):
        self.got_text = False
        self.sent = {}

    def feed(self, line):
        out = []
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            return out
        kind = ev.get("type")
        if kind == "thread.started":
            out.append({"type": "session", "sessionId": ev.get("thread_id"),
                        "model": CODEX_MODEL})
        elif kind in ("item.started", "item.updated", "item.completed"):
            item = ev.get("item") or {}
            if item.get("type") == "agent_message":
                text = item.get("text") or ""
                key = item.get("id") or "item"
                already = self.sent.get(key, "")
                tail = text[len(already):] if text.startswith(already) else text
                self.sent[key] = text
                if tail:
                    self.got_text = True
                    out.append({"type": "delta", "text": tail})
        elif kind == "turn.completed":
            usage = ev.get("usage") or {}
            out.append({"type": "usage", "costUsd": None, "durationMs": None,
                        "inputTokens": usage.get("input_tokens"),
                        "outputTokens": usage.get("output_tokens")})
        elif kind in ("turn.failed", "error"):
            err = ev.get("error") or {}
            out.append({"type": "error",
                        "message": err.get("message") or ev.get("message")
                        or "codex reported an error"})
        return out


def claude_command(question, transcript, session_id):
    cmd = [CLAUDE_BIN, "-p",
           "--model", MODEL,
           "--output-format", "stream-json",
           "--include-partial-messages",
           "--verbose",
           "--strict-mcp-config",
           "--allowed-tools", ""]
    if session_id:
        cmd += ["--resume", session_id]
    else:
        cmd += ["--system-prompt", SYSTEM_PROMPT]
    prompt = build_prompt(question, transcript, first_turn=not session_id)
    return cmd, prompt, ClaudeEvents()


def codex_command(question, transcript, session_id):
    cmd = [CODEX_BIN, "exec"]
    if session_id:
        cmd += ["resume", session_id]
    cmd += ["--json", "--skip-git-repo-check",
            "-c", 'sandbox_mode="read-only"',
            "-c", 'approval_policy="never"']
    if CODEX_MODEL:
        cmd += ["-m", CODEX_MODEL]
    cmd += ["-"]                       # the prompt itself arrives on stdin
    prompt = build_prompt(question, transcript, first_turn=not session_id)
    if not session_id:
        # codex has no --system-prompt, so the coaching brief rides along with
        # the first prompt of the thread; resumed turns already have it.
        prompt = SYSTEM_PROMPT + "\n\n" + prompt
    return cmd, prompt, CodexEvents()


COMMANDS = {"claude": claude_command, "codex": codex_command}


def build_prompt(question, transcript, first_turn):
    parts = []
    if transcript:
        parts.append("Here is the current state of the hand:\n\n<hand>\n"
                     + transcript.strip() + "\n</hand>\n")
    else:
        parts.append("No hand is in progress right now.\n")
    if not first_turn:
        parts.append("(This is a follow-up question about the same session. The hand "
                     "state above is current as of right now and may have moved on "
                     "since your last answer.)\n")
    parts.append("The student asks:\n\n" + question.strip())
    return "\n".join(parts)


def main():
    port = int(os.environ.get("PORT", "8777"))
    host = "127.0.0.1"
    missing = [n for n, e in ENGINES.items() if not e["bin"]]
    if missing:
        print("!! not found on PATH: %s — the chat box will report %s unavailable."
              % (", ".join("`%s`" % m for m in missing),
                 "them" if len(missing) > 1 else "it"), file=sys.stderr)
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    url = "http://%s:%d/" % (host, port)
    engines = ", ".join("%s%s" % (n, " (missing)" if not e["bin"] else "")
                        for n, e in ENGINES.items())
    print("Hold'em Coach running at %s   (claude model: %s; engines: %s)"
          % (url, MODEL, engines))
    print("Press Ctrl-C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
        server.shutdown()


if __name__ == "__main__":
    main()
