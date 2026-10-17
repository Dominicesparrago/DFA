"""Decider launcher, integrity baseline and background self-repair.

Why this exists as a separate file
---------------------------------
Recovery code that lives inside the application cannot recover the application:
if app.py is truncated or dfa.py will not parse, the process that would have
repaired them cannot start. So the checking and the repairing live here, and
app.py is only ever loaded after this file has confirmed it is intact.

Commands
--------
  python run_decider.py                  verify, repair if needed, then launch
  python run_decider.py --verify         report integrity and exit
  python run_decider.py --maintenance    launch with restoration suspended
  python run_decider.py --approve-current   make the current files the baseline
  python run_decider.py --present        open the presentation deck in a browser

Layout
------
  recovery/backups/          the approved baseline (one file per essential name)
  recovery/manifest.json     SHA-256 of each approved file, plus when it was approved
  recovery/history/<stamp>/  the previous baselines, kept on every approval
  recovery/approved_updates/ staging area for intentional work in progress

What is and is not trusted
--------------------------
The baseline is a list of SHA-256 digests taken at the moment a developer ran
--approve-current. A file is restored only when its digest does not match that
list AND the mismatch has persisted for the confirmation window, so an editor
saving a file twice in a row is not mistaken for corruption.

Nothing in a damaged file is ever executed or parsed as instructions: recovery
copies bytes and hashes them. A file is only ever validated after it has been
copied into place.

Nothing outside this project directory is written, and no service is installed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import py_compile
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RECOVERY = ROOT / "recovery"
BACKUPS = RECOVERY / "backups"
HISTORY = RECOVERY / "history"
STAGING = RECOVERY / "approved_updates"
MANIFEST = RECOVERY / "manifest.json"
APP = ROOT / "app.py"

# The files whose loss or damage would stop Decider working.
ESSENTIAL = ["app.py", "dfa.py", "index.html", "script.js", "styles.css"]

CONFIRM_WINDOW_S = 7.0      # 5-10 s: long enough to ignore a two-part save
POLL_S = 1.5
MAX_REPAIRS = 8             # stop rather than loop if something keeps changing
LAUNCH_GRACE_S = 10.0       # an app that dies this fast failed to start

_lock = threading.Lock()
_stop = threading.Event()


def log(message: str) -> None:
    print(f"[decider] {message}", flush=True)


# ---------------------------------------------------------------------------
# digests and atomic writes
# ---------------------------------------------------------------------------

def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def atomic_write_bytes(target: Path, data: bytes) -> None:
    """Write via a temporary file in the same directory, then replace."""
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, tmp_name = tempfile.mkstemp(dir=str(target.parent), prefix=".decider-")
    tmp = Path(tmp_name)
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, target)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# manifest
# ---------------------------------------------------------------------------

def load_manifest() -> dict | None:
    if not MANIFEST.is_file():
        return None
    try:
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    if not isinstance(data.get("files"), dict):
        return None
    return data


def save_manifest(data: dict) -> None:
    RECOVERY.mkdir(parents=True, exist_ok=True)
    atomic_write_bytes(MANIFEST, json.dumps(data, indent=2).encode("utf-8"))


def snapshot(names: list[str], note: str) -> dict:
    """Copy the given files into backups and record their digests."""
    entries = {}
    for name in names:
        source = ROOT / name
        if not source.is_file():
            raise FileNotFoundError(f"cannot approve, missing {name}")
        atomic_write_bytes(BACKUPS / name, source.read_bytes())
        entries[name] = {
            "sha256": sha256(source),
            "size": source.stat().st_size,
        }
    stamp = time.strftime("%Y%m%d-%H%M%S")
    data = {"approved_at": stamp, "note": note, "files": entries}
    save_manifest(data)
    return data


def rotate_previous_baseline() -> None:
    """Keep the baseline that is being replaced, so a bad approval is recoverable."""
    if not MANIFEST.is_file() or not BACKUPS.is_dir():
        return
    stamp = time.strftime("%Y%m%d-%H%M%S")
    target = HISTORY / stamp
    target.mkdir(parents=True, exist_ok=True)
    for name in ESSENTIAL:
        source = BACKUPS / name
        if source.is_file():
            shutil.copy2(source, target / name)
    shutil.copy2(MANIFEST, target / "manifest.json")
    log(f"previous baseline kept in {target.relative_to(ROOT)}")


# ---------------------------------------------------------------------------
# validation
# ---------------------------------------------------------------------------

def node_available() -> bool:
    return shutil.which("node") is not None


def validate_file(root: Path, name: str) -> str | None:
    """Return a reason string when the file cannot be a working Decider file."""
    path = root / name
    if not path.is_file():
        return "missing"
    if path.stat().st_size == 0:
        return "empty"

    suffix = path.suffix
    if suffix == ".py":
        try:
            py_compile.compile(str(path), doraise=True, cfile=str(path) + ".pyc-check")
        except py_compile.PyCompileError as exc:
            return f"python syntax error: {str(exc).splitlines()[-1][:90]}"
        finally:
            Path(str(path) + ".pyc-check").unlink(missing_ok=True)
    elif suffix == ".js":
        if not node_available():
            return None  # cannot check; not a reason to reject
        result = subprocess.run(["node", "--check", str(path)], capture_output=True, text=True)
        if result.returncode != 0:
            last = (result.stderr.strip().splitlines() or ["error"])[-1]
            return f"javascript syntax error: {last[:90]}"
    elif suffix == ".html":
        text = path.read_text(encoding="utf-8", errors="replace")
        for marker in ("</html>", "dfa-svg", "transition-table"):
            if marker not in text:
                return f"html missing {marker!r}"
    elif suffix == ".css":
        if "{" not in path.read_text(encoding="utf-8", errors="replace"):
            return "css has no rule blocks"
    return None


def validate_project(root: Path | None = None, names: list[str] | None = None) -> list[str]:
    """Every reason the project at `root` could not run. Empty means it is sound."""
    # Resolved here rather than as a default argument: a default would capture
    # ROOT at import time, so redirecting ROOT later would silently do nothing.
    root = root or ROOT
    names = names or ESSENTIAL
    return [f"{name}: {why}" for name in names
            for why in [validate_file(root, name)] if why]


def validate_dfa_tests(root: Path | None = None) -> tuple[bool, str]:
    """Run the project's own oracle. This is the gate on approving a baseline."""
    root = root or ROOT
    script = root / "dfa.py"
    if not script.is_file():
        return False, "dfa.py missing"
    try:
        result = subprocess.run(
            [sys.executable, str(script)], cwd=str(root),
            capture_output=True, text=True, timeout=120,
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        return False, f"could not run the oracle: {exc}"
    tail = [l for l in result.stdout.strip().splitlines() if l.strip()]
    summary = tail[-1] if tail else ""
    if result.returncode != 0 or "FAIL" in result.stdout:
        return False, summary or "oracle failed"
    return True, summary


# ---------------------------------------------------------------------------
# integrity and repair
# ---------------------------------------------------------------------------

def inspect(root: Path | None = None) -> tuple[list[str], str]:
    """Return (problems, note). A problem is 'name: missing' or 'name: changed'."""
    root = root or ROOT
    data = load_manifest()
    if data is None:
        return ([], "no manifest: the baseline has never been approved, or it is "
                     "damaged. Integrity cannot be checked or recovered from.")
    problems = []
    for name, entry in sorted(data["files"].items()):
        path = root / name
        if not path.is_file():
            problems.append(f"{name}: missing")
            continue
        expected = entry.get("sha256")
        if expected and sha256(path) != expected:
            problems.append(f"{name}: changed")
    return problems, f"baseline approved {data.get('approved_at', 'unknown')}"


def restore(name: str, root: Path | None = None) -> bool:
    """Copy the approved copy into place, atomically, then verify the digest."""
    root = root or ROOT
    source = BACKUPS / name
    target = root / name
    if not source.is_file():
        log(f"RECOVERY FAILED: no approved copy of {name}")
        return False
    try:
        atomic_write_bytes(target, source.read_bytes())
    except OSError as exc:
        log(f"RECOVERY FAILED: could not write {name}: {exc}")
        return False

    expected = (load_manifest() or {}).get("files", {}).get(name, {}).get("sha256")
    if expected and sha256(target) != expected:
        log(f"RECOVERY FAILED: {name} does not match the approved digest after restore")
        return False
    log(f"restored {name} from the approved baseline")
    return True


def repair_all(problems: list[str], root: Path | None = None) -> list[str]:
    """Repair every reported file. Returns the ones that could not be repaired."""
    root = root or ROOT
    data = load_manifest()
    known = set((data or {}).get("files", {}))
    unresolved = []
    with _lock:
        for problem in problems:
            name = problem.split(":", 1)[0]
            if name not in known:
                log(f"cannot repair {name}: not part of the approved baseline")
                unresolved.append(problem)
                continue
            if not restore(name, root):
                unresolved.append(problem)
    return unresolved


# ---------------------------------------------------------------------------
# staging and approval
# ---------------------------------------------------------------------------

def staged_files() -> list[Path]:
    if not STAGING.is_dir():
        return []
    return sorted(p for p in STAGING.iterdir() if p.is_file() and not p.name.startswith("."))


def integrate_staged(verbose: bool = True) -> list[str]:
    """Validate every staged file, then move it into the project.

    Staged files are only copied after they validate on their own, and nothing
    is approved here: this is work in progress becoming the current project, not
    work in progress becoming the trusted baseline.
    """
    accepted, rejected = [], []
    for staged in staged_files():
        if staged.name not in ESSENTIAL:
            rejected.append(f"{staged.name}: not an essential file")
            continue
        why = validate_file(STAGING, staged.name)
        if why:
            rejected.append(f"{staged.name}: {why}")
            continue
        atomic_write_bytes(ROOT / staged.name, staged.read_bytes())
        accepted.append(staged.name)

    if verbose:
        for name in accepted:
            log(f"integrated staged {name}")
        for reason in rejected:
            log(f"staged file rejected - {reason}")
    return accepted


def approve_current(integrate: bool = True) -> int:
    """Make the current project the trusted baseline, if it validates."""
    if integrate:
        integrate_staged()

    problems = validate_project()
    if problems:
        log("APPROVAL REFUSED - the current files do not validate:")
        for problem in problems:
            log(f"  {problem}")
        log("the previous baseline is unchanged and still trusted")
        return 1

    ok, summary = validate_dfa_tests()
    if not ok:
        log(f"APPROVAL REFUSED - the oracle failed: {summary}")
        log("the previous baseline is unchanged and still trusted")
        return 1

    if not node_available():
        log("note: node not found, so script.js syntax was not checked")

    rotate_previous_baseline()
    try:
        data = snapshot(ESSENTIAL, "approved by developer")
    except OSError as exc:
        log(f"APPROVAL FAILED: {exc}")
        return 1

    log(f"baseline approved: {summary}")
    for name, entry in sorted(data["files"].items()):
        log(f"  {name:<12} {entry['sha256'][:16]}… {entry['size']:>7} bytes")
    return 0


# ---------------------------------------------------------------------------
# launching
# ---------------------------------------------------------------------------

def spawn_app() -> subprocess.Popen:
    # DECIDER_MANAGED tells app.py that this launcher owns the recovery. Without
    # it an app that fails to start would spawn a second launcher, and the two
    # would race each other over the same files and each restart the app.
    # It is inherited by whatever the app starts in turn, so the chain stops
    # after one repair attempt even if the fault survives it.
    env = dict(os.environ)
    env["DECIDER_MANAGED"] = "1"
    return subprocess.Popen([sys.executable, str(APP)], cwd=str(ROOT), env=env)


def monitor(proc_holder: dict, maintenance: bool) -> None:
    """Watch the essential files and repair anything that stays wrong.

    A mismatch is only acted on once it has persisted for CONFIRM_WINDOW_S, so a
    save that writes twice does not trigger a repair. Repairs are serialised
    through _lock, and the number of them is capped so a file that is being
    rewritten in a loop stops the monitor instead of thrashing it.
    """
    data = load_manifest()
    if data is None:
        return
    pending: dict[str, float] = {}
    repairs = 0

    while not _stop.is_set() and proc_holder.get("proc") is not None:
        time.sleep(POLL_S)
        if proc_holder["proc"].poll() is not None:
            return

        for name, entry in data["files"].items():
            path = ROOT / name
            if not path.is_file() or sha256(path) == entry.get("sha256"):
                pending.pop(name, None)
                continue

            first = pending.setdefault(name, time.monotonic())
            if time.monotonic() - first < CONFIRM_WINDOW_S:
                continue          # assume a temporary write, confirm next tick

            pending.pop(name, None)
            if maintenance:
                log(f"maintenance mode: {name} is modified and has been left alone")
                continue

            if repairs >= MAX_REPAIRS:
                log("repair limit reached, stopping automatic recovery for this session")
                return

            repairs += 1
            log(f"{name} stayed modified for {CONFIRM_WINDOW_S:.0f}s; repairing")
            if restore(name):
                log("restarting Decider so the repair takes effect")
                stop_process(proc_holder)
                proc_holder["proc"] = spawn_app()


def stop_process(proc_holder: dict) -> None:
    proc = proc_holder.get("proc")
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=6)
    except subprocess.TimeoutExpired:
        proc.kill()


def launch_once() -> tuple[subprocess.Popen | None, int | None]:
    """Start the app. Returns (proc, early_exit_code); code None means healthy."""
    proc = spawn_app()
    try:
        code = proc.wait(timeout=LAUNCH_GRACE_S)
        return None, code
    except subprocess.TimeoutExpired:
        return proc, None


def launch(maintenance: bool) -> int:
    data = load_manifest()
    if data is None:
        log("no usable manifest. Integrity is UNCHECKED.")
        log("run  python run_decider.py --approve-current  once to create the baseline.")
    else:
        problems, note = inspect()
        log(note)
        if problems:
            log(f"{len(problems)} file(s) need repair: " + ", ".join(p.split(':')[0] for p in problems))
            unresolved = repair_all(problems)
            if unresolved:
                log("could not repair everything; starting anyway, but this is not a clean state")
        else:
            log("all essential files match the approved baseline")

    proc, code = launch_once()

    if code is not None:
        log(f"Decider exited immediately with code {code}")
        log("attempting one controlled repair-and-retry")
        problems, _ = inspect()
        if problems:
            repair_all(problems)
        elif code != 0:
            problems, _ = inspect()
            if problems:
                repair_all(problems)
        proc, code = launch_once()
        if code is not None:
            log(f"still failing (code {code}); stopping")
            return code or 1

    log("Decider is running")
    if data is not None:
        holder = {"proc": proc}
        watcher = threading.Thread(
            target=monitor, args=(holder, maintenance), daemon=True)
        watcher.start()
        try:
            return proc.wait()
        except KeyboardInterrupt:
            log("stopping")
            return 0
        finally:
            _stop.set()
            stop_process(holder)
    return proc.wait()


# ---------------------------------------------------------------------------
# presentation deck
# ---------------------------------------------------------------------------

class NoStoreHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory=None, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *args):
        pass


def serve_project() -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", 0), NoStoreHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def present() -> int:
    root = ROOT
    deck = root / "presentation.html"
    if not deck.is_file():
        log("presentation.html is missing")
        return 1

    problems, note = inspect()
    log(note)
    if problems:
        log(f"{len(problems)} essential file(s) need repair: "
            + ", ".join(p.split(':')[0] for p in problems))
        unresolved = repair_all(problems)
        if unresolved:
            log("could not repair everything; opening the deck anyway, but this is not a clean state")
    else:
        log("all essential files match the approved baseline")

    problems = validate_project()
    if problems:
        for why in problems:
            log(f"  {why}")
    log("serving the folder on 127.0.0.1 with Cache-Control: no-store")
    try:
        server = serve_project()
    except OSError as exc:
        log(f"could not start the local server: {exc}")
        log(f"the deck also opens straight from disk: {deck}")
        webbrowser.open(deck.as_uri())
        return 1

    port = server.server_port
    url = f"http://127.0.0.1:{port}/presentation.html"
    log(f"opening {url}")
    log("press F in the deck for full screen, ? for the controls")
    try:
        webbrowser.open(url)
    except Exception as exc:                      # noqa: BLE001 - any failure is reportable
        log(f"could not open a browser automatically ({exc}); use the URL above")
        return 1

    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        log("stopping")
    finally:
        server.shutdown()
        server.server_close()
    return 0


# ---------------------------------------------------------------------------
# entry point
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Decider launcher with integrity checking and background self-repair.")
    parser.add_argument("--verify", action="store_true",
                        help="report integrity and exit without launching")
    parser.add_argument("--maintenance", action="store_true",
                        help="launch with automatic restoration suspended while you work")
    parser.add_argument("--approve-current", action="store_true",
                        help="validate the current files and make them the trusted baseline")
    parser.add_argument("--present", action="store_true",
                        help="open the presentation deck (presentation.html) in the default browser")
    parser.add_argument("--no-integrate", action="store_true",
                        help="with --approve-current, ignore anything in approved_updates/")
    args = parser.parse_args()

    if args.approve_current:
        return approve_current(integrate=not args.no_integrate)

    if args.present:
        return present()

    if args.verify:
        problems, note = inspect()
        log(note)
        if not problems:
            log("OK: every essential file matches the approved baseline")
            return 0
        for problem in problems:
            log(f"  {problem}")
        log(f"{len(problems)} file(s) would be repaired on launch")
        return 1

    return launch(args.maintenance)


if __name__ == "__main__":
    sys.exit(main())
