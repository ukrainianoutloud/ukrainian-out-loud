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
     4) SEARCH  (Phase 8 — live Fuse.js over /search-index.json)
     Only runs on /search/ (guarded by #search-input). Lazy-loads the index on
     first interaction, builds Fuse once, debounces input, renders word-card
     results, toggles #no-results, honours category chips, and prefills+runs the
     ?q= param. The Cyrillic keyboard (§5) already dispatches "input", so on-
     screen typing flows through the same handler — no extra wiring needed.

     Record shape (lean, from 140_SearchIndex.gs):
       { s:slug, u:ukrainian, t:translit(col D), m:meaning,
         p:phonetic(raw), c:category, k:[tags] }
     Result markup mirrors _word-card.html (same classes) so it inherits the
     design system. NOTE: word cards render a styled PRONUNCIATION_BLOCK + a
     separate PHONETIC_PLAIN; here we approximate with the raw phonetic string
     `p` for both (stress is already conveyed by UPPERCASE). If you want the
     word page's exact per-syllable markup, share renderPronunciation_'s output
     and swap renderPron() below — that's the only change needed.
     ------------------------------------------------------------------------- */
  var searchInput = document.getElementById("search-input");
  if (searchInput) {
    window.UOL_SEARCH_READY = false;

    var results   = document.getElementById("results");
    var noResults = document.getElementById("no-results");
    var chipsWrap = document.querySelector(".filter-chips");

    var WORDS_PREFIX = "/words/";   // slug is identity; URLs are /words/{slug}/
    var RESULT_LIMIT = 30;

    var FUSE_OPTS = {
      includeScore: true,
      ignoreLocation: true,
      threshold: 0.3,
      minMatchCharLength: 2,
      keys: [
        { name: "u", weight: 3 },    // ukrainian (Cyrillic)  — дякую
        { name: "t", weight: 2.5 },  // transliteration col D  — diakuiu
        { name: "m", weight: 2 },    // meaning
        { name: "p", weight: 1.5 },  // phonetic (raw)
        { name: "k", weight: 1 },    // tags
        { name: "s", weight: 1 }     // slug (catches slug-style spellings)
      ]
    };

    var fuse = null, records = [], loadPromise = null, activeCategory = null;

    function esc(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    // Approximate the word-card pron block from raw phonetic `p`.
    function renderPron(p) {
      if (!p) return "";
      return '<span class="pron" aria-label="Pronounced ' + esc(p) + '">' +
             esc(p) + "</span>";
    }

    function cardHtml(r) {
      return '<a class="word-card" href="' + WORDS_PREFIX + esc(r.s) + '/">' +
               '<span class="word-card__cyr" lang="uk">' + esc(r.u) + "</span>" +
               '<span class="word-card__translit">' + esc(r.t) + "</span>" +
               renderPron(r.p) +
               '<span class="word-card__meaning">' + esc(r.m) + "</span>" +
             "</a>";
    }

    function applyCategory(list) {
      if (!activeCategory) return list;
      return list.filter(function (r) { return r.c === activeCategory; });
    }

    function render(list) {
      if (!results) return;
      if (!list.length) {
        results.hidden = true; results.innerHTML = "";
        if (noResults) noResults.hidden = false;
        return;
      }
      if (noResults) noResults.hidden = true;
      results.innerHTML = list.slice(0, RESULT_LIMIT).map(cardHtml).join("");
      results.hidden = false;
    }

    // Empty query: show nothing (or category-filtered full list if a chip is on).
    function runQuery() {
      var q = searchInput.value.trim();
      if (!fuse) return;
      if (!q) {
        if (activeCategory) { render(applyCategory(records)); }
        else { if (results) { results.hidden = true; results.innerHTML = ""; }
               if (noResults) noResults.hidden = true; }
        return;
      }
      var hits = fuse.search(q).map(function (h) { return h.item; });
      render(applyCategory(hits));
    }

    var debounceT = null;
    function onInput() {
      if (!window.UOL_SEARCH_READY) { ensureLoaded(); return; }
      clearTimeout(debounceT);
      debounceT = setTimeout(runQuery, 150);
    }

    function ensureLoaded() {
      if (loadPromise) return loadPromise;
      loadPromise = fetch("/search-index.json", { cache: "force-cache" })
        .then(function (res) {
          if (!res.ok) throw new Error("index " + res.status);
          return res.json();
        })
        .then(function (data) {
          records = Array.isArray(data) ? data : [];
          if (typeof Fuse === "undefined") throw new Error("Fuse not loaded");
          fuse = new Fuse(records, FUSE_OPTS);
          window.UOL_SEARCH_READY = true;
          runQuery(); // run whatever's already in the box (incl. prefilled ?q=)
        })
        .catch(function (err) {
          if (window.console) console.error("[UOL search]", err);
          loadPromise = null; // allow a retry on next keystroke
        });
      return loadPromise;
    }

    // Category chips (single-select toggle). Defensive: reads data-category,
    // falls back to trimmed text. If _category-chip.html uses a different
    // attribute, change the getCat() line only.
    function getCat(btn) {
      return btn.getAttribute("data-category") ||
             (btn.textContent || "").trim();
    }
    if (chipsWrap) {
      chipsWrap.addEventListener("click", function (ev) {
        var chip = ev.target.closest("button, [role='button'], .chip, a");
        if (!chip || !chipsWrap.contains(chip)) return;
        ev.preventDefault();
        var cat = getCat(chip);
        var wasActive = chip.getAttribute("aria-pressed") === "true";
        Array.prototype.forEach.call(
          chipsWrap.querySelectorAll("[aria-pressed]"),
          function (c) { c.setAttribute("aria-pressed", "false"); }
        );
        if (wasActive) { activeCategory = null; chip.setAttribute("aria-pressed", "false"); }
        else { activeCategory = cat; chip.setAttribute("aria-pressed", "true"); }
        if (window.UOL_SEARCH_READY) runQuery();
        else ensureLoaded();
      });
    }

    searchInput.addEventListener("input", onInput);

    // Prefill ?q= (shareable, no-JS-friendly) and load immediately if present.
    var q = new URLSearchParams(window.location.search).get("q");
    if (q) { searchInput.value = q; ensureLoaded(); }
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
