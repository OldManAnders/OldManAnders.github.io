(function () {
  const y = document.getElementById("y");
  if (y) y.textContent = new Date().getFullYear();

  // Tiny DOM helpers.
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
    const close = $(".modal-close", dlg);
    if (close) close.addEventListener("click", () => dlg.close());
    // Backdrop clicks target the dialog itself; padding lives on .modal-body,
    // so this can't fire for clicks on the content.
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  });

  // -------------------------------------------------------------------------
  // 2. GitHub activity — 52 weekly bars (index.html)
  // -------------------------------------------------------------------------
  // Built from GET /users/{user}/repos?sort=pushed, then GET
  // /repos/{owner}/{repo}/stats/commit_activity per repo. That endpoint
  // returns ~52 weeks of per-day default-branch commit counts. Needs no auth,
  // but GitHub only allows 60 requests/hour/IP, so results are cached in
  // localStorage for an hour and the page renders from cache while refreshing
  // in the background.
  const USERNAME = "OldManAnders";
  const stripBox = $("#contributions");
  const CACHE_KEY = "gh-activity-v4";
  const CACHE_TTL = 60 * 60 * 1000;
  const WEEKS = 52;

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
  async function fetchStats(name) {
    const url = `https://api.github.com/repos/${USERNAME}/${name}/stats/commit_activity`;
    for (let i = 0; i < 4; i++) {
      let res;
      try { res = await fetch(url); } catch (_) { return null; }
      if (res.status === 202) {
        if (i < 3) await new Promise((r) => setTimeout(r, (i + 1) * 2000));
        continue;
      }
      if (!res.ok) return null;
      try { return await res.json(); } catch (_) { return null; }
    }
    return null;
  }

  async function fetchActivity() {
    let repos;
    try {
      const res = await fetch(`https://api.github.com/users/${USERNAME}/repos?per_page=100&sort=pushed`);
      if (!res.ok) return null;
      repos = await res.json();
    } catch (_) { return null; }
    if (!Array.isArray(repos) || !repos.length) return null;

    // Weekly commit counts for the most recently pushed repos only. This
    // bounds the request count and is where the activity is.
    const stats = (await Promise.all(
      repos.slice(0, 10).map(async (repo) => {
        const weeks = await fetchStats(repo.name);
        return Array.isArray(weeks) && weeks.length ? { repo, weeks } : null;
      })
    )).filter(Boolean);
    if (!stats.length) return null;

    return { repos: stats };
  }

  const monthFmt = new Intl.DateTimeFormat("en", { month: "short" });

  function renderStrip(data, updatedAt, failed) {
    if (!stripBox || !data || !Array.isArray(data.repos)) return;

    // Aggregate per-day counts across repos, aligned to the last 52 weeks.
    const daily = Array.from({ length: WEEKS }, () => [0, 0, 0, 0, 0, 0, 0]);
    let total = 0;
    for (const { weeks } of data.repos) {
      const ws = (weeks || []).slice(-WEEKS);
      const start = WEEKS - ws.length; // shorter histories align to the most recent week
      ws.forEach((week, i) => {
        (week.days || []).forEach((c, d) => { daily[start + i][d] += c; total += c; });
      });
    }

    const totals = daily.map((week) => week.reduce((a, b) => a + b, 0));
    const max = Math.max(1, ...totals);

    // Align the last column to the week containing today (weeks start Sunday).
    const today = new Date();
    const sunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
    const weekStart = (i) => {
      const d = new Date(sunday);
      d.setDate(d.getDate() - (WEEKS - 1 - i) * 7);
      return d;
    };

    const bars = totals.map((v, i) => {
      const h = v ? (7 + 36 * Math.pow(v / max, 0.6)) : 3;
      const cls = v ? (v / max > 0.55 ? "hot" : "on") : "off";
      const d = weekStart(i);
      const label = `Week of ${d.getDate()} ${monthFmt.format(d)} — ${v} commit${v === 1 ? "" : "s"}`;
      return `<i class="${cls}" style="height:${h.toFixed(1)}px" title="${label}"></i>`;
    }).join("");

    const first = weekStart(0);
    const last = weekStart(WEEKS - 1);

    stripBox.innerHTML =
      `<p class="strip-total"><b>${total}</b>contributions in the last 12 months</p>` +
      `<div class="strip" aria-hidden="true">${bars}</div>` +
      `<div class="strip-labels"><span>${monthFmt.format(first)} ${first.getFullYear()}</span>` +
      `<span>${monthFmt.format(last)} ${last.getFullYear()}</span></div>` +
      `<p class="strip-note">Source: GitHub commit activity, default branches` +
      (updatedAt ? ` · read ${new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "") +
      (failed ? " · refresh failed, showing cache" : "") + `</p>`;
  }

  // Shown when GitHub can't be reached and nothing is cached.
  function renderError() {
    if (stripBox) stripBox.innerHTML =
      `<p class="strip-note">GitHub activity is unavailable right now — the API may be rate-limited or offline. The strip returns when the limit resets.</p>`;
  }

  async function loadActivity() {
    if (!USERNAME || !stripBox) return;
    try {
      const cached = readCache();
      if (cached && cached.data) {
        renderStrip(cached.data, cached.at, false);
        if (Date.now() - cached.at < CACHE_TTL) return; // fresh enough, skip network
      }
      const data = await fetchActivity();
      if (data) {
        saveCache(data);
        renderStrip(data, Date.now(), false);
      } else if (cached && cached.data) {
        renderStrip(cached.data, cached.at, true);
      } else {
        renderError();
      }
    } catch (_) {
      const cached = readCache();
      if (cached && cached.data) renderStrip(cached.data, cached.at, true);
      else renderError();
    }
  }

  loadActivity();
})();
