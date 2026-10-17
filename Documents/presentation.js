(function () {
  "use strict";

  var STAGE_W = 1280;
  var STAGE_H = 720;
  var TRANSITION_MS = 460;
  var TOAST_MS = 2600;
  var THEMES = ["system", "light", "dark", "contrast"];
  var THEME_LABEL = { system: "System", light: "Textbook", dark: "Night", contrast: "High contrast" };

  var viewport = document.getElementById("viewport");
  var stage = document.getElementById("stage");
  var railFill = document.getElementById("rail-fill");
  var railTicks = document.getElementById("rail-ticks");
  var rail = railFill && railFill.parentNode;
  var counter = document.getElementById("counter");
  var slideName = document.getElementById("slide-name");
  var help = document.getElementById("help");
  var toast = document.getElementById("toast");
  var btnPrev = document.getElementById("btn-prev");
  var btnNext = document.getElementById("btn-next");
  var btnFull = document.getElementById("btn-full");
  var btnTheme = document.getElementById("btn-theme");
  var btnHelp = document.getElementById("btn-help");

  var slides = Array.prototype.slice.call(document.querySelectorAll(".slide"));
  var total = slides.length;

  var index = 0;
  var step = 0;
  var busy = false;
  var timers = [];
  var toastTimer = 0;

  function prefersReducedMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (err) { return false; }
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function later(fn, ms) {
    var id = window.setTimeout(function () {
      timers = timers.filter(function (t) { return t !== id; });
      fn();
    }, ms);
    timers.push(id);
    return id;
  }

  function clearTimers() {
    timers.forEach(window.clearTimeout);
    timers = [];
  }

  function buildRail() {
    if (!railTicks) return;
    railTicks.textContent = "";
    for (var i = 0; i < total; i++) railTicks.appendChild(document.createElement("i"));
  }

  function buildStagger() {
    slides.forEach(function (slide) {
      var groups = {};
      slide.querySelectorAll("[data-step]").forEach(function (node) {
        var key = node.getAttribute("data-step");
        (groups[key] = groups[key] || []).push(node);
      });
      Object.keys(groups).forEach(function (key) {
        groups[key].forEach(function (node, i) {
          node.style.setProperty("--d", (i * 70) + "ms");
        });
      });
    });
  }

  function stepsOf(slide) {
    var n = parseInt(slide.getAttribute("data-steps") || "0", 10);
    return isNaN(n) ? 0 : n;
  }

  function revealStep(slide, n) {
    slide.querySelectorAll("[data-step]").forEach(function (node) {
      var at = parseInt(node.getAttribute("data-step"), 10) || 0;
      node.classList.toggle("is-in", at <= n);
    });
    if (slide.querySelector("[data-walk]")) applyWalk(slide, n);
  }

  function applyWalk(slide, n) {
    var edgeLayer = slide.querySelector("#s9edges");
    var token = slide.querySelector("#w-token");

    if (edgeLayer) {
      edgeLayer.querySelectorAll(".edge--taken").forEach(function (path) {
        path.classList.remove("edge--taken");
        path.setAttribute("marker-end", "url(#s9ah)");
      });
    }
    if (token) token.classList.remove("is-on");

    slide.querySelectorAll("[data-walk] [data-step]").forEach(function (node) {
      var at = parseInt(node.getAttribute("data-step"), 10) || 0;
      node.classList.toggle("is-taken", at > 0 && at <= n);
      node.classList.toggle("is-current", at > 0 && at === n);
      if (node.classList.contains("cell")) node.classList.toggle("is-reading", at === n);
    });

    var live = slide.querySelector('[data-walk] [data-step="' + n + '"][data-edge]');
    if (!live || n === 0) return;
    var id = live.getAttribute("data-edge");
    var path = slide.querySelector("[" + cssEscape("id") + "=\"" + id + "\"]");
    if (!path) return;

    path.classList.add("edge--taken");
    path.setAttribute("marker-end", "url(#s9ahf)");
    if (token && typeof path.getTotalLength === "function") {
      var end = path.getPointAtLength(path.getTotalLength());
      token.style.transform = "translate(" + end.x + "px, " + end.y + "px)";
      token.classList.add("is-on");
    }
  }

  function show(indexToShow, direction) {
    var from = slides[index];
    var to = slides[indexToShow];
    if (!to || to === from) return;

    revealStep(from, 0);
    from.classList.remove("is-current", "is-in-forward", "is-in-backward");

    index = indexToShow;
    step = 0;
    to.classList.add("is-current", direction === "back" ? "is-in-backward" : "is-in-forward");
    revealStep(to, 0);
    syncChrome();

    later(function () { to.classList.remove("is-in-forward", "is-in-backward"); }, TRANSITION_MS);

    busy = true;
    later(function () { busy = false; }, prefersReducedMotion() ? 0 : TRANSITION_MS);
    syncHash();
  }

  function go(delta) {
    if (busy) return false;
    var next = index + delta;
    if (next < 0 || next >= total) return false;
    show(next, delta > 0 ? "fwd" : "back");
    return true;
  }

  function forward(whole) {
    if (busy) return;
    var max = stepsOf(slides[index]);
    if (!whole && step < max) {
      step += 1;
      revealStep(slides[index], step);
      syncChrome();
      return;
    }
    go(1);
  }

  function backward(whole) {
    if (busy) return;
    if (!whole && step > 0) {
      step -= 1;
      revealStep(slides[index], step);
      syncChrome();
      return;
    }
    go(-1);
  }

  function syncChrome() {
    var max = stepsOf(slides[index]);
    var pct = total > 1 ? (index / (total - 1)) * 100 : 100;
    if (railFill) railFill.style.width = pct + "%";
    if (rail) {
      rail.setAttribute("aria-valuemax", String(total));
      rail.setAttribute("aria-valuenow", String(index + 1));
    }
    if (counter) counter.textContent = (index + 1) + " / " + total + (max ? "  ·  step " + step + "/" + max : "");
    if (slideName) slideName.textContent = slides[index].getAttribute("data-title") || "";
  }

  function syncHash() {
    var hash = "#" + (index + 1);
    if (window.location.hash !== hash) {
      try { window.history.replaceState(null, "", hash); }
      catch (err) {  }
    }
  }

  function readHash() {
    var m = /^#(\d+)$/.exec(window.location.hash || "");
    if (!m) return 0;
    var i = parseInt(m[1], 10) - 1;
    return isNaN(i) ? 0 : Math.min(Math.max(i, 0), total - 1);
  }

  function fit() {
    if (!viewport || !stage) return;
    var w = viewport.clientWidth;
    var h = viewport.clientHeight;

    var scale = Math.min((w - 28) / STAGE_W, (h - 20) / STAGE_H);
    scale = Math.max(0.2, Math.min(scale, 2));
    stage.style.setProperty("--deck-scale", String(scale));
  }

  function currentTheme() {
    var t = document.documentElement.getAttribute("data-theme");
    return t || "system";
  }

  function cycleTheme() {
    var next = THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length];
    if (next === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    if (btnTheme) btnTheme.textContent = THEME_LABEL[next];
    say("Appearance: " + THEME_LABEL[next]);
  }

  function fullscreenSupported() {
    var d = document;
    return Boolean(d.fullscreenEnabled || d.webkitFullscreenEnabled);
  }

  function currentFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function toggleFullscreen() {
    if (!fullscreenSupported()) {
      say("This browser has no full-screen API — the deck already fills the window.");
      return;
    }
    var d = document;
    if (currentFullscreenElement()) {
      var exit = d.exitFullscreen || d.webkitExitFullscreen;
      if (exit) exit.call(d);
      return;
    }
    var root = d.documentElement;
    var request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!request) { say("Full screen was refused by the browser."); return; }
    var result = request.call(root, { navigationUI: "hide" });
    if (result && typeof result.catch === "function") {
      result.catch(function () { say("Full screen needs a key press or a click — try again."); });
    }
  }

  function syncFullscreenButton() {
    if (!btnFull) return;
    var on = Boolean(currentFullscreenElement());
    btnFull.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function setHelp(open) {
    if (!help) return;
    help.hidden = !open;
    if (open) btnHelp.focus();
  }

  function say(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toast.hidden = true; }, TOAST_MS);
  }

  function isTyping(target) {
    if (!target || !target.tagName) return false;
    var tag = target.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable === true;
  }

  function onKeyDown(event) {
    if (event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey) return;
    if (isTyping(event.target)) return;

    var key = event.key;

    if (event.altKey && key === "Home") {
      event.preventDefault();
      window.location.href = "index.html";
      return;
    }
    if (event.altKey) return;

    if (key === "Escape") {
      if (help && !help.hidden) { event.preventDefault(); setHelp(false); }
      else if (currentFullscreenElement()) {

      }
      return;
    }

    if (help && !help.hidden && (key === "?" || key === "/")) { event.preventDefault(); setHelp(false); return; }

    switch (key) {
      case "ArrowRight": case "ArrowDown": case " ":
      case "Spacebar": case "Enter":
        event.preventDefault(); forward(false); break;
      case "ArrowLeft": case "ArrowUp":
        event.preventDefault(); backward(false); break;
      case "PageDown":
        event.preventDefault(); forward(true); break;
      case "PageUp":
        event.preventDefault(); backward(true); break;
      case "Home":
        event.preventDefault(); jumpTo(0); break;
      case "End":
        event.preventDefault(); jumpTo(total - 1); break;
      case "f": case "F":
        event.preventDefault(); toggleFullscreen(); break;
      case "t": case "T":
        event.preventDefault(); cycleTheme(); break;
      case "?": case "/":
        event.preventDefault(); setHelp(true); break;
      default:
        break;
    }
  }

  function jumpTo(target) {
    if (target < 0 || target >= total || target === index) return;

    show(target, target < index ? "back" : "fwd");
  }

  function onStageClick(event) {
    if (event.target.closest("button, a, .help")) return;
    var box = stage.getBoundingClientRect();
    if (!box.width) return;
    var x = (event.clientX - box.left) / box.width;
    if (x > 0.72) forward(false);
    else if (x < 0.28) backward(false);
  }

  function wire() {
    if (btnPrev) btnPrev.addEventListener("click", function () { backward(true); });
    if (btnNext) btnNext.addEventListener("click", function () { forward(true); });
    if (btnFull) btnFull.addEventListener("click", toggleFullscreen);
    if (btnTheme) btnTheme.addEventListener("click", cycleTheme);
    if (btnHelp) btnHelp.addEventListener("click", function () { setHelp(!help || help.hidden); });
    if (stage) stage.addEventListener("click", onStageClick);
    if (help) help.addEventListener("click", function (e) { if (e.target === help) setHelp(false); });

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("fullscreenchange", syncFullscreenButton);
    document.addEventListener("webkitfullscreenchange", syncFullscreenButton);
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    window.addEventListener("hashchange", function () { jumpTo(readHash()); });
    window.addEventListener("beforeunload", clearTimers);

    if (typeof ResizeObserver === "function" && viewport) {
      new ResizeObserver(fit).observe(viewport);
    }

    if (!fullscreenSupported() && viewport) viewport.classList.add("no-fullscreen-note");
  }

  function start() {
    buildRail();
    buildStagger();
    wire();

    slides.forEach(function (slide, i) {
      slide.setAttribute("aria-hidden", i === 0 ? "false" : "true");
      slide.querySelectorAll("[data-step]").forEach(function (node) { node.classList.remove("is-in"); });
    });

    var startAt = readHash();
    index = 0;
    slides[0].classList.add("is-current");
    if (startAt > 0) jumpTo(startAt);
    else syncHash();

    fit();
    syncChrome();
    syncHash();
    if (btnTheme) btnTheme.textContent = THEME_LABEL[currentTheme()];
    if (!fullscreenSupported()) {
      say("Full screen is unavailable in this browser — the deck fills the window instead.");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
