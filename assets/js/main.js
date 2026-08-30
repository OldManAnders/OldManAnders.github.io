/**
 * main.js — tiny vanilla JS for the CV page (no dependencies)
 * -------------------------------------------------------------
 * What it does:
 *  1. Expand / Collapse all — buttons open or close every <details> section.
 *  2. Print handling — collapses everything before printing so the CV fits
 *     on one page, then restores the previous open/closed state after.
 *  3. Optional GitHub repos — if #repos has a data-username attribute, fetches
 *     the latest 6 repos from the GitHub API and renders them. Falls back to
 *     the static HTML if the fetch fails or no username is set.
 *
 * Notes for readers:
 *  - `$`  = shorthand for document.querySelector (find first match)
 *  - `$$` = shorthand for document.querySelectorAll (find all matches)
 *  - The whole file is wrapped in an IIFE (function(){...})() so variables
 *    do not leak to the global scope.
 */

(function () {
  // --- Tiny DOM helpers ---
  // $  -> returns the first element matching a CSS selector (like "#repos" or "details")
  // $$ -> returns an array of all matching elements
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  // -------------------------------------------------------------------------
  // 1. Expand / Collapse all — only present on cv.html
  // -------------------------------------------------------------------------
  // Helper that grabs every <details> element on the page
  const allDetails = () => $$("details");

  // Buttons are optional — index.html does not have them, so we guard with if()
  const expandBtn = $("#expand-all");
  const collapseBtn = $("#collapse-all");

  if (expandBtn) {
    expandBtn.addEventListener("click", () => {
      // Setting .open = true expands the <details> natively (no CSS needed)
      allDetails().forEach((d) => (d.open = true));
    });
  }

  if (collapseBtn) {
    collapseBtn.addEventListener("click", () => {
      allDetails().forEach((d) => (d.open = false));
    });
  }

  // -------------------------------------------------------------------------
  // 2. Print handling — keep printed CV to 1 page (collapsed)
  // -------------------------------------------------------------------------
  // We save which sections were open so we can restore them after printing.
  // beforeprint collapses all; afterprint re-opens what was open before.
  let savedState = null;

  window.addEventListener("beforeprint", () => {
    // Snapshot: [true, false, true, ...] for each <details>
    savedState = allDetails().map((d) => d.open);
    allDetails().forEach((d) => (d.open = false));
  });

  window.addEventListener("afterprint", () => {
    if (savedState) {
      allDetails().forEach((d, i) => (d.open = savedState[i]));
    }
    savedState = null;
  });

  // -------------------------------------------------------------------------
  // 3. Optional GitHub fetch — replaces static repo list with live data
  // -------------------------------------------------------------------------
  // To enable: add data-username="your-github-handle" to <ul id="repos"> in HTML.
  // Example: <ul id="repos" data-username="octocat">
  // Leave it empty (or omit the attribute) to keep the static list.
  const reposEl = $("#repos");
  const USERNAME = (reposEl && reposEl.dataset.username) || ""; // empty = disabled

  if (reposEl && USERNAME) {
    fetch(`https://api.github.com/users/${USERNAME}/repos?per_page=6&sort=updated`)
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((repos) => {
        if (!Array.isArray(repos) || !repos.length) return; // nothing to show

        // Build HTML for each repo — .replace escapes "<" to prevent HTML injection
        reposEl.innerHTML = repos
          .map(
            (repo) =>
              `<li class="repo">` +
              `<a href="${repo.html_url}" target="_blank" rel="noopener">${repo.name}</a>` +
              `<span class="meta"> &#9733; ${repo.stargazers_count} &middot; ${repo.language || ""}</span>` +
              `<p class="desc">${(repo.description || "").replace(/</g, "&lt;")}</p>` +
              `</li>`
          )
          .join("");
      })
      .catch(() => {
        // Silently keep the static fallback — no need to show an error to the visitor
      });
  }
})();
