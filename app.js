/* ===========================================================================
   Ukrainian Out Loud — app.js
   Minimal, framework-free. Only: theme toggle, YouTube facade, share,
   and the Phase-8 search hook (stub). Nothing else.
   =========================================================================== */
(function () {
  "use strict";

  /* -------------------------------------------------------------------------
     1) THEME TOGGLE
     Default = follow the OS (no [data-theme] attribute → prefers-color-scheme
     mirror in tokens.css applies). Clicking sets an explicit choice that wins
     over the OS. Persisted in localStorage under "uol-theme".
     ------------------------------------------------------------------------- */
  var THEME_KEY = "uol-theme";
  var root = document.documentElement;

  try {
    var saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved);
  } catch (e) { /* storage blocked — fall back to OS default */ }

  function toggleTheme() {
    var current = root.getAttribute("data-theme");
    // If unset, infer what the OS is showing so the first click flips visibly.
    if (!current) {
      current = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    var next = current === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    var btn = document.querySelector(".theme-toggle");
    if (btn) btn.setAttribute("aria-pressed", String(next === "dark"));
  }

  document.addEventListener("click", function (ev) {
    var t = ev.target.closest(".theme-toggle");
    if (t) { ev.preventDefault(); toggleTheme(); }
  });

  /* -------------------------------------------------------------------------
     2) YOUTUBE FACADE  (click-to-load, privacy-friendly nocookie)
     Markup: <div class="yt-facade" data-video-id="{{YOUTUBE_VIDEO_ID}}">...
     No network until the user clicks. Respects reduced motion (no auto-anim).
     ------------------------------------------------------------------------- */
  function loadYouTube(facade) {
    var id = facade.getAttribute("data-video-id");
    if (!id) return;
    facade.setAttribute("data-state", "loading");
    var iframe = document.createElement("iframe");
    iframe.className = "yt-embed";
    iframe.setAttribute("title", facade.getAttribute("data-title") || "Pronunciation video");
    iframe.setAttribute("loading", "lazy");
    iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture");
    iframe.setAttribute("allowfullscreen", "");
    iframe.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) + "?autoplay=1&rel=0";
    facade.replaceWith(iframe);
  }

  document.addEventListener("click", function (ev) {
    var f = ev.target.closest(".yt-facade");
    if (f) { ev.preventDefault(); loadYouTube(f); }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    var f = ev.target.closest(".yt-facade");
    if (f) { ev.preventDefault(); loadYouTube(f); }
  });

  /* -------------------------------------------------------------------------
     3) SHARE  (Web Share API → clipboard fallback → toast)
     Markup: <button class="share__btn" data-share-url="..." data-share-title="...">
     ------------------------------------------------------------------------- */
  function showToast(msg) {
    var toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = msg;
    toast.setAttribute("data-visible", "true");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.setAttribute("data-visible", "false"); }, 2200);
  }

  document.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-share-url]");
    if (!b) return;
    ev.preventDefault();
    var url = b.getAttribute("data-share-url");
    var title = b.getAttribute("data-share-title") || document.title;
    if (navigator.share) {
      navigator.share({ title: title, url: url }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () { showToast("Link copied"); },
        function () { showToast("Couldn't copy — press Ctrl/Cmd-C"); });
    } else {
      showToast(url);
    }
  });

  /* -------------------------------------------------------------------------
     4) SEARCH HOOK  — PHASE 8 STUB. DO NOT BUILD THE INDEX HERE.
     Phase 8 will: (a) fetch /search-index.json, (b) init Fuse.js over it,
     (c) render .result-row items into #results, (d) toggle #no-results,
     (e) read the ?q= param below to prefill + run an initial query.
     This block only wires the DOM shell so Phase 8 has clean anchors.
     ------------------------------------------------------------------------- */
  var searchInput = document.getElementById("search-input");
  if (searchInput) {
    // Client-read ?q= (decision #6: no server token). Prefill only; no query yet.
    var q = new URLSearchParams(window.location.search).get("q");
    if (q) searchInput.value = q;

    // Phase 8 entry point — intentionally inert until the index ships.
    window.UOL_SEARCH_READY = false;
    searchInput.addEventListener("input", function () {
      if (!window.UOL_SEARCH_READY) return; // no-op until Phase 8 flips this
      /* Phase 8: run Fuse query on searchInput.value, populate #results. */
    });
  }

  /* -------------------------------------------------------------------------
     5) CYRILLIC ON-SCREEN KEYBOARD  (Phase 5.1)
     For English speakers with no Ukrainian layout. A .cyr-toggle shows/hides a
     .cyr-keyboard whose keys insert a Ukrainian letter at the target input's
     cursor. Focus is preserved (mousedown preventDefault) so the caret stays
     put. After each key we dispatch an "input" event, so the Phase 8 search
     reacts exactly as if the user typed. Target input = keyboard's
     data-cyr-target (an element id).
     ------------------------------------------------------------------------- */
  // Toggle open/close
  document.addEventListener("click", function (ev) {
    var toggle = ev.target.closest(".cyr-toggle");
    if (!toggle) return;
    ev.preventDefault();
    var panel = document.getElementById(toggle.getAttribute("aria-controls"));
    if (!panel) return;
    var open = panel.hasAttribute("hidden");
    if (open) { panel.removeAttribute("hidden"); } else { panel.setAttribute("hidden", ""); }
    toggle.setAttribute("aria-expanded", String(open));
  });

  // Keep focus in the input when a key is pressed (don't let the button steal it)
  document.addEventListener("mousedown", function (ev) {
    if (ev.target.closest(".cyr-key")) ev.preventDefault();
  });

  function cyrTarget(keyboard) {
    var id = keyboard.getAttribute("data-cyr-target");
    return id ? document.getElementById(id) : null;
  }

  function insertAtCursor(input, text) {
    var start = input.selectionStart, end = input.selectionEnd;
    if (start == null) { input.value += text; }
    else {
      input.value = input.value.slice(0, start) + text + input.value.slice(end);
      var pos = start + text.length;
      input.setSelectionRange(pos, pos);
    }
  }
  function backspaceAtCursor(input) {
    var start = input.selectionStart, end = input.selectionEnd;
    if (start == null) { input.value = input.value.slice(0, -1); return; }
    if (start !== end) { // delete selection
      input.value = input.value.slice(0, start) + input.value.slice(end);
      input.setSelectionRange(start, start);
    } else if (start > 0) { // delete char before caret
      input.value = input.value.slice(0, start - 1) + input.value.slice(end);
      input.setSelectionRange(start - 1, start - 1);
    }
  }

  document.addEventListener("click", function (ev) {
    var key = ev.target.closest(".cyr-key");
    if (!key) return;
    ev.preventDefault();
    var keyboard = key.closest(".cyr-keyboard");
    var input = cyrTarget(keyboard);
    if (!input) return;
    var action = key.getAttribute("data-action");
    if (action === "backspace") backspaceAtCursor(input);
    else if (action === "space") insertAtCursor(input, " ");
    else insertAtCursor(input, key.getAttribute("data-char") || "");
    input.focus();
    input.dispatchEvent(new Event("input", { bubbles: true })); // Phase 8 listens here
  });
})();
