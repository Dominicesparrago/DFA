"""PyWebView application for Decider.

The window is pointed at a small local server rather than at the file directly.
Loading over file:// lets the web view cache script.js and styles.css, so after
an edit a relaunch can quietly run the previous build and the app stops matching
what is on disk. Everything here is served with no-store, so a restart always
shows the current files.

Self-healing, and the one thing it cannot cover
----------------------------------------------
If this application cannot finish starting, it says so and hands the job to
run_decider.py, which owns the approved baseline and knows how to restore a
damaged file. That covers a broken dfa.py, a missing webview, a port that will
not bind and a window that fails to open.

It cannot cover damage to *this* file. If app.py is truncated or will not parse,
Python cannot load it, so no code inside it gets the chance to run. That case is
recovered the same way as always: start run_decider.py instead, which verifies
the baseline and restores app.py before trying to load it again.

Two guards keep the handoff from looping:

  DECIDER_MANAGED is set by run_decider.py on the process it starts, and passed
  on to anything that process starts in turn. When it is already set, run_decider
  is the parent and it owns the repair, so app.py reports the failure and stops
  rather than starting a second launcher against the same files.

  The handoff also sets it for the launcher it starts, so if the fault survives
  the repair, the relaunched app hands off once more and no further.
"""

import os
import subprocess
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Api:

    def check(self, text):
        return check(text)

    def run_tests(self):
        return run_tests()


class NoStoreHandler(SimpleHTTPRequestHandler):

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *args):
        pass


def serve(directory, port=0):
    handler = partial(NoStoreHandler, directory=str(directory))
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


ROOT = Path(__file__).resolve().parent
LAUNCHER = ROOT / "run_decider.py"

# Set by run_decider.py on the app process it starts, and inherited by anything
# that app starts. See the module docstring.
MANAGED = "DECIDER_MANAGED"


def report(message):
    print(f"[decider] {message}", flush=True)


def handoff(reason):
    """Report a startup failure and hand the repair to run_decider.py.

    Returns the exit code to leave with. Never raises, because a launcher that
    throws while handling a crash tends to hide the crash.
    """
    report(f"STARTUP FAILED: {reason}")

    if os.environ.get(MANAGED):
        # run_decider.py started us, so it is watching and will do the repair
        # itself. Starting a second launcher here would race it over the same
        # files, and both would try to restart the app.
        report("run_decider.py started this process and owns the repair; "
               "leaving the fault to it")
        return 1

    if not LAUNCHER.is_file():
        report(f"cannot hand over: {LAUNCHER.name} is not there")
        return 1

    report(f"handing over to {LAUNCHER.name} to repair and relaunch")
    env = dict(os.environ)
    env[MANAGED] = "1"
    try:
        subprocess.Popen([sys.executable, str(LAUNCHER)], cwd=str(ROOT), env=env)
    except OSError as exc:
        report(f"could not start {LAUNCHER.name}: {exc}")
        return 1
    return 1


def main():
    # dfa and webview are both imported here rather than at module scope, and
    # that is the whole point: a top-level `from dfa import ...` raises while
    # this file is still being imported, so a damaged dfa.py would stop Decider
    # before main() was ever reached and nothing could report it or hand over.
    # Inside the guard, the same failure becomes a reportable fault.
    global check, run_tests

    try:
        from dfa import check, run_tests
    except Exception as exc:
        return handoff(f"dfa is unusable ({type(exc).__name__}: {exc})")

    try:
        import webview
    except Exception as exc:
        return handoff(f"webview is unavailable ({type(exc).__name__}: {exc})")

    try:
        server = serve(ROOT)
        url = f"http://127.0.0.1:{server.server_port}/index.html"

        webview.create_window(
            "Decider",
            url,
            js_api=Api(),
            width=1200,
            height=800,
            min_size=(360, 560),
            resizable=True
        )
        webview.start()
    except Exception as exc:
        return handoff(f"{type(exc).__name__}: {exc}")

    return 0


if __name__ == "__main__":
    sys.exit(main())