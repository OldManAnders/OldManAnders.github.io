
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
  // 3. GitHub activity — contribution calendar + most-active repos (index.html)
  // -------------------------------------------------------------------------
  // Built from GET /users/{user}/repos?sort=pushed, then GET
  // /repos/{owner}/{repo}/stats/commit_activity per repo. That endpoint
  // returns ~52 weeks of per-day default-branch commit counts — the same data
  // GitHub's contribution graph shows. Needs no auth, but GitHub only allows
  // 60 requests/hour/IP, so results are cached in localStorage for 24h and the
  // page renders from cache while refreshing in the background.
  const reposEl = $("#repos");
  const USERNAME = (reposEl && reposEl.dataset.username) || "";
  const calEl = $("#contributions");
  const CACHE_KEY = "gh-activity-v3";
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const WEEKS = 52;

  // Cache-first: render whatever we have, then refresh in the background at
  // most once per 24h. Without this a visitor who reloads a few times blows
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

  // commit_activity / code_frequency return 202 {} while GitHub generates the
  // stats. Poll briefly (3 tries; every 202 still counts toward the rate limit)
  // then give up on the repo. Network errors just return null.
  async function fetchStats(path) {
    const url = `https://api.github.com/repos/${USERNAME}/${path}`;
    for (let i = 0; i < 3; i++) {
      let res;
      try { res = await fetch(url); } catch (_) { return null; }
      if (res.status === 202) { await new Promise((r) => setTimeout(r, 2000 + i * 2000)); continue; }
      if (!res.ok) return null;
      try { return await res.json(); } catch (_) { return null; }
    }
    return null;
  }

  // Shown when GitHub can't be reached and nothing is cached.
  function renderError() {
    if (calEl) calEl.innerHTML =
      `<p class="h3">GitHub activity couldn't be loaded.</p>` +
      `<p class="meta">The GitHub API may be rate-limited or unreachable. It should appear when the hourly limit resets, or on the deployed site.</p>`;
    const summaryEl = $("#repos-summary");
    if (summaryEl) summaryEl.textContent = "";
    if (reposEl) reposEl.innerHTML = "";
  }

  // GitHub-ish intensity: 0, 1-3, 4-6, 7-10, 11+
  function level(n) {
    if (n === 0) return 0;
    if (n < 4) return 1;
    if (n < 7) return 2;
    if (n < 11) return 3;
    return 4;
  }

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
    const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    let html = `<p class="cal-summary">${total} contributions in the last year</p><div class="cal-scroll">`;
    html += `<div class="cal-months">`;
    let prevMonth = -1;
    for (let w = 0; w < WEEKS; w++) {
      const date = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + (w - (WEEKS - 1)) * 7);
      const m = date.getMonth();
      html += `<div class="cal-month">${m !== prevMonth ? months[m] : ""}</div>`;
      prevMonth = m;
    }
    html += `</div><div class="cal-grid">`;
    // Weekday labels, GitHub shows Mon / Wed / Fri only.
    ["", "Mon", "", "Wed", "", "Fri", ""].forEach((l) => (html += `<div class="cal-wd">${l}</div>`));
    for (let w = 0; w < WEEKS; w++) {
      for (let d = 0; d < 7; d++) {
        const date = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + (w - (WEEKS - 1)) * 7 + d);
        const n = daily[w][d];
        html += `<div class="cal-cell lvl-${level(n)}" title="${n} commit${n === 1 ? "" : "s"} on ${dayName[d]} ${date.getDate()} ${months[date.getMonth()]}"></div>`;
      }
    }
    html += `</div>`;
    html += `<div class="cal-legend">Less<span class="cal-cell lvl-0"></span><span class="cal-cell lvl-1"></span><span class="cal-cell lvl-2"></span><span class="cal-cell lvl-3"></span><span class="cal-cell lvl-4"></span>More</div>`;
    html += `</div>`;
    calEl.innerHTML = html;
  }

  function renderSummary(data) {
    const el = $("#repos-summary");
    if (!el) return;
    // Lines added/removed in the last month, summed across repos. GitHub's
    // code_frequency returns [week, additions, deletions] tuples with
    // deletions as negative numbers.
    let added = 0, removed = 0;
    for (const { freq } of data.repos) {
      if (!Array.isArray(freq) || !freq.length) continue;
      freq.slice(-4).forEach((w) => { added += w[1] || 0; removed += Math.abs(w[2]) || 0; });
    }
    // Hide the line when there's no data yet (e.g. first load before GitHub
    // has generated code_frequency) rather than showing a misleading 0/0.
    if (!added && !removed) { el.textContent = ""; return; }
    el.textContent = `Total lines added: ${added.toLocaleString()} · Total lines removed: ${removed.toLocaleString()} in the last month`;
  }

  function renderRepos(data) {
    if (!reposEl) return;
    // "Last month" ≈ the 4 most recent weekly buckets of commit_activity.
    const ranked = data.repos
      .map(({ repo, weeks }) => ({ repo, n: weeks.slice(-4).reduce((a, w) => a + w.total, 0) }))
      .filter((r) => r.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 4);
    if (!ranked.length) return; // keep the static fallback
    reposEl.innerHTML = ranked
      .map(
        ({ repo, n }) =>
          `<li class="repo">` +
          `<a href="${repo.html_url}" target="_blank" rel="noopener">${repo.name}</a>` +
          `<span class="meta">${n} commit${n === 1 ? "" : "s"} last month${repo.language ? " &middot; " + repo.language : ""}</span>` +
          `<p class="desc">${(repo.description || "").replace(/</g, "&lt;")}</p>` +
          `</li>`
      )
      .join("");
  }

  async function fetchActivity() {
    let repos;
    try {
      const res = await fetch(`https://api.github.com/users/${USERNAME}/repos?per_page=100&sort=pushed`);
      if (!res.ok) return null;
      repos = await res.json();
    } catch (_) { return null; }
    if (!Array.isArray(repos) || !repos.length) return null;

    // Phase 1: weekly commit counts for the most recently pushed repos only.
    // This bounds the request count and is where this month's activity is.
    const stats = (await Promise.all(
      repos.slice(0, 12).map(async (repo) => {
        const weeks = await fetchStats(`${repo.name}/stats/commit_activity`);
        return Array.isArray(weeks) && weeks.length ? { repo, weeks } : null;
      })
    )).filter(Boolean);
    if (!stats.length) return null;

    // Phase 2: line counts only for repos that had commits in the last month.
    await Promise.all(stats.map(async (s) => {
      const lastMonth = s.weeks.slice(-4).reduce((a, w) => a + (w.total || 0), 0);
      const freq = lastMonth > 0 ? await fetchStats(`${s.repo.name}/stats/code_frequency`) : null;
      s.freq = Array.isArray(freq) && freq.length ? freq : [];
    }));

    return { repos: stats };
  }

  async function loadActivity() {
    if (!USERNAME) return;
    try {
      const cached = readCache();
      if (cached) {
        renderCalendar(cached.data);
        renderSummary(cached.data);
        renderRepos(cached.data);
        if (Date.now() - cached.at < CACHE_TTL) return; // fresh enough, skip network
      }
      const data = await fetchActivity();
      if (data) {
        saveCache(data);
        renderCalendar(data);
        renderSummary(data);
        renderRepos(data);
      } else if (!cached) {
        renderError();
      }
    } catch (_) {
      if (!readCache()) renderError();
    }
  }

  loadActivity();
})();
