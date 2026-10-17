"""PyWebView application for Decider.

This is the main application entry point using PyWebView.

The window is pointed at a small local server rather than at the file directly.
Loading over file:// lets the web view cache script.js and styles.css, so after
an edit a relaunch can quietly run the previous build and the app stops matching
what is on disk. Everything here is served with no-store, so a restart always
shows the current files.
"""

import threading
import webview
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from dfa import check, run_tests


class Api:
    def check(self, text):
        """Check the input string for DFA acceptance."""
        return check(text)

    def run_tests(self):
        """Run all test cases."""
        return run_tests()


class NoStoreHandler(SimpleHTTPRequestHandler):
    """Serves the folder, and never lets the web view keep a copy."""

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *args):
        pass  # the web view is noisy enough on its own


def serve(directory, port=0):
    """Start the folder on a free local port and return the server."""
    handler = partial(NoStoreHandler, directory=str(directory))
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main():
    current_dir = Path(__file__).resolve().parent

    server = serve(current_dir)
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


if __name__ == "__main__":
    main()
