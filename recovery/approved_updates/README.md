# Approved updates (staging)

Put a file here when you are deliberately changing one of the five essential
files: `app.py`, `dfa.py`, `index.html`, `script.js`, `styles.css`.

Nothing here is trusted or executed just because it exists. The files stay out
of the running application until you run:

    python run_decider.py --approve-current

That command validates each staged file on its own, copies the valid ones into
the project, validates the project, runs the `dfa.py` oracle, and only then
records the new SHA-256 baseline. If any of that fails the approval is refused
and the previous baseline stays trusted.

While you are working, launch with:

    python run_decider.py --maintenance

so the background monitor does not undo your edits after the confirmation
window. Approval stays a separate, deliberate action.
