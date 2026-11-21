
(function () {
  const y = document.getElementById("y");
  if (y) y.textContent = new Date().getFullYear();

  // --- Tiny DOM helpers ---
  // $  -> returns the first element matching a CSS selector (like "#contributions")
  // $$ -> returns an array of all matching elements
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  // -------------------------------------------------------------------------
  // 1. Detail pop-ups — only present on cv.html.
  // -------------------------------------------------------------------------
  // Native <dialog>: Esc-to-close, focus trap and focus restore come free.
  $$("[data-modal]").forEach((btn) => {
    const dlg = document.getElementById(btn.dataset.modal);
    if (dlg) btn.addEventListener("click", () => dlg.showModal());
  });

  $$("dialog.modal").forEach((dlg) => {
    $(".modal-close", dlg).addEventListener("click", () => dlg.close());
    // Backdrop clicks target the dialog itself; padding lives on .modal-body,
    // so this can't fire for clicks on the content.
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  });

  // -------------------------------------------------------------------------
  // 2. GitHub activity — contribution calendar (index.html)
  // -------------------------------------------------------------------------
  // Built from GET /users/{user}/repos?sort=pushed, then GET
  // /repos/{owner}/{repo}/stats/commit_activity per repo. That endpoint
  // returns ~52 weeks of per-day default-branch commit counts — the same data
  // GitHub's contribution graph shows. Needs no auth, but GitHub only allows
  // 60 requests/hour/IP, so results are cached in localStorage for an hour and
  // the page renders from cache while refreshing in the background.
  const USERNAME = "OldManAnders";
  const calEl = $("#contributions");
  const CACHE_KEY = "gh-activity-v4";
  const CACHE_TTL = 60 * 60 * 1000;
  const WEEKS = 52;

  // Cache-first: render whatever we have, then refresh in the background at
  // most once per hour. Without this a visitor who reloads a few times blows
  // the 60 req/hr quota and every later call 403s.
  const readCache = () => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return { data: parsed.data, at: parsed.at };
    } catch (_) { return null; }
  };
  const saveCache = (data) => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })); } catch (_) {}
  };

  // commit_activity returns 202 {} while GitHub generates the stats. Poll
  // briefly (4 tries; every 202 still counts toward the rate limit) then give
  // up on the repo. Network errors just return null.
  async function fetchStats(path) {
    const url = `https://api.github.com/repos/${USERNAME}/${path}`;
    for (let i = 0; i < 4; i++) {
      let res;
      try { res = await fetch(url); } catch (_) { return null; }
      if (res.status === 202) { if (i < 3) await new Promise((r) => setTimeout(r, (i + 1) * 2000)); continue; }
      if (!res.ok) return null;
      try { return await res.json(); } catch (_) { return null; }
    }
    return null;
  }

  // Shown when GitHub can't be reached and nothing is cached.
  function renderError() {
    if (calEl) calEl.innerHTML =
      `<p class="cal-summary">GitHub activity couldn't be loaded.</p>` +
      `<p class="repo-summary">The GitHub API may be rate-limited or unreachable. It should appear when the hourly limit resets, or on the deployed site.</p>`;
  }

  // GitHub-ish intensity: 0, 1-3, 4-6, 7-10, 11+
  const level = (n) => (n === 0 ? 0 : n < 4 ? 1 : n < 7 ? 2 : n < 11 ? 3 : 4);

  function renderCalendar(data) {
    if (!calEl) return;
    // Aggregate per-day counts across repos, aligned to the last 52 weeks.
    const daily = Array.from({ length: WEEKS }, () => [0, 0, 0, 0, 0, 0, 0]);
    let total = 0;
    for (const { weeks } of data.repos) {
      const ws = weeks.slice(-WEEKS);
      const start = WEEKS - ws.length; // shorter histories align to the most recent week
      ws.forEach((week, i) => {
        (week.days || []).forEach((c, d) => { daily[start + i][d] += c; total += c; });
      });
    }
    // Anchor so the last column is the current week, days[0] = Sunday.
    const today = new Date();
    const sunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
    const shift = (days) => { const d = new Date(sunday); d.setDate(d.getDate() + days); return d; };
    const fmtDay = new Intl.DateTimeFormat("en", { weekday: "short" });
    const fmtMonth = new Intl.DateTimeFormat("en", { month: "short" });

    let html = `<p class="cal-summary">${total} contributions in the last year</p><div class="cal-scroll">`;
    html += `<div class="cal-months">`;
    let prevMonth = -1;
    for (let w = 0; w < WEEKS; w++) {
      const date = shift((w - (WEEKS - 1)) * 7);
      const m = date.getMonth();
      html += `<div class="cal-month">${m !== prevMonth ? fmtMonth.format(date) : ""}</div>`;
      prevMonth = m;
    }
    html += `</div><div class="cal-grid">`;
    // Weekday labels, GitHub shows Mon / Wed / Fri only.
    ["", "Mon", "", "Wed", "", "Fri", ""].forEach((l) => (html += `<div class="cal-wd">${l}</div>`));
    for (let w = 0; w < WEEKS; w++) {
      for (let d = 0; d < 7; d++) {
        const date = shift((w - (WEEKS - 1)) * 7 + d);
        const n = daily[w][d];
        html += `<div class="cal-cell lvl-${level(n)}" title="${n} commit${n === 1 ? "" : "s"} on ${fmtDay.format(date)} ${date.getDate()} ${fmtMonth.format(date)}"></div>`;
      }
    }
    html += `</div>`;
    html += `<div class="cal-legend">Less<span class="cal-cell lvl-0"></span><span class="cal-cell lvl-1"></span><span class="cal-cell lvl-2"></span><span class="cal-cell lvl-3"></span><span class="cal-cell lvl-4"></span>More</div>`;
    html += `</div>`;
    calEl.innerHTML = html;
  }

  async function fetchActivity() {
    let repos;
    try {
      const res = await fetch(`https://api.github.com/users/${USERNAME}/repos?per_page=100&sort=pushed`);
      if (!res.ok) return null;
      repos = await res.json();
    } catch (_) { return null; }
    if (!Array.isArray(repos) || !repos.length) return null;

    // Weekly commit counts for the most recently pushed repos only. This bounds
    // the request count and is where the calendar's activity is.
    const stats = (await Promise.all(
      repos.slice(0, 12).map(async (repo) => {
        const weeks = await fetchStats(`${repo.name}/stats/commit_activity`);
        return Array.isArray(weeks) && weeks.length ? { repo, weeks } : null;
      })
    )).filter(Boolean);
    if (!stats.length) return null;

    return { repos: stats };
  }

  const updatedEl = $("#gh-updated");
  const showUpdated = (at, failed) => {
    if (!updatedEl) return;
    const time = new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    updatedEl.textContent = `Last updated ${time}` + (failed ? " \u00b7 refresh failed, showing cached data" : "");
  };

  async function loadActivity() {
    if (!USERNAME) return;
    try {
      const cached = readCache();
      if (cached) {
        renderCalendar(cached.data);
        showUpdated(cached.at, false);
        if (Date.now() - cached.at < CACHE_TTL) return; // fresh enough, skip network
      }
      const data = await fetchActivity();
      if (data) {
        saveCache(data);
        renderCalendar(data);
        showUpdated(Date.now(), false);
      } else if (cached) {
        showUpdated(cached.at, true);
      } else {
        renderError();
      }
    } catch (_) {
      const cached = readCache();
      if (cached) showUpdated(cached.at, true);
      else renderError();
    }
  }

  loadActivity();
})();
