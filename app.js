(() => {
  const USER = "best-radar";
  const EXCLUDE = new Set([USER, `${USER}.github.io`]);
  const THEME_KEY = "best-radar-theme";
  const CACHE_KEY = "best-radar-repos-v1";
  const TAG_RE = /#([\p{L}\p{N}_-]{2,40})/gu;

  const els = {
    grid: document.getElementById("grid"),
    empty: document.getElementById("empty"),
    error: document.getElementById("error"),
    meta: document.getElementById("meta"),
    search: document.getElementById("search"),
    sort: document.getElementById("sort"),
    sortWrap: document.getElementById("sort-wrap"),
    sortTrigger: document.getElementById("sort-trigger"),
    sortMenu: document.getElementById("sort-menu"),
    sortValue: document.getElementById("sort-value"),
    themeToggle: document.getElementById("theme-toggle"),
    featured: document.getElementById("featured"),
    skeleton: document.getElementById("skeleton"),
    categoryChips: document.getElementById("category-chips"),
    languageChips: document.getElementById("language-chips"),
    statusDot: document.getElementById("status-dot"),
    statProjects: document.getElementById("stat-projects"),
    statStars: document.getElementById("stat-stars"),
    statCategories: document.getElementById("stat-categories"),
    statLangs: document.getElementById("stat-langs"),
    statProjectsLabel: document.getElementById("stat-projects-label"),
    statStarsLabel: document.getElementById("stat-stars-label"),
    statCategoriesLabel: document.getElementById("stat-categories-label"),
    statLangsLabel: document.getElementById("stat-langs-label"),
  };

  const LANG_COLORS = {
    JavaScript: "#f1e05a",
    TypeScript: "#3178c6",
    Python: "#3572A5",
    Go: "#00ADD8",
    Rust: "#dea584",
    Java: "#b07219",
    HTML: "#e34c26",
    CSS: "#563d7c",
    Shell: "#89e051",
    C: "#555555",
    "C++": "#f34b7d",
    Ruby: "#701516",
    PHP: "#4F5D95",
    Swift: "#F05138",
    Kotlin: "#A97BFF",
    Dart: "#00B4AB",
    Vue: "#41b883",
    Dockerfile: "#384d54",
  };

  /** @type {Array<any>} */
  let repos = [];
  let activeCategory = "all";
  let activeLanguage = "all";

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem(THEME_KEY, theme);
    if (els.themeToggle) {
      els.themeToggle.setAttribute(
        "aria-label",
        theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"
      );
    }
  }

  function initTheme() {
    if (!document.documentElement.getAttribute("data-theme")) {
      const saved = localStorage.getItem(THEME_KEY);
      const theme = saved === "light" || saved === "dark" ? saved : "dark";
      setTheme(theme);
    } else if (els.themeToggle) {
      els.themeToggle.setAttribute(
        "aria-label",
        currentTheme() === "dark" ? "Включить светлую тему" : "Включить тёмную тему"
      );
    }
    els.themeToggle?.addEventListener("click", () => {
      setTheme(currentTheme() === "dark" ? "light" : "dark");
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function formatDate(iso) {
    try {
      return new Intl.DateTimeFormat("ru-RU", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(new Date(iso));
    } catch {
      return "";
    }
  }

  function plural(n, one, few, many) {
    const abs = Math.abs(Number(n)) || 0;
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  function countLabel(n, one, few, many) {
    return `${n} ${plural(n, one, few, many)}`;
  }

  function extractTags(...texts) {
    const map = new Map();
    for (const text of texts) {
      if (!text) continue;
      const re = new RegExp(TAG_RE.source, TAG_RE.flags);
      let m;
      while ((m = re.exec(text))) {
        const raw = m[1];
        const key = raw.toLowerCase();
        if (!map.has(key)) map.set(key, raw);
      }
    }
    return [...map.values()];
  }

  function normalizeTopics(topics) {
    return (topics || []).map((t) => t.replace(/\s+/g, "-")).filter(Boolean);
  }

  function uniqueTags(list) {
    const map = new Map();
    for (const t of list) {
      const key = String(t).toLowerCase();
      if (!map.has(key)) map.set(key, t);
    }
    return [...map.values()];
  }

  async function mapPool(items, limit, fn) {
    const out = new Array(items.length);
    let i = 0;
    async function worker() {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
  }

  async function fetchReadmeTags(fullName) {
    try {
      const res = await fetch(`https://api.github.com/repos/${fullName}/readme`, {
        headers: { Accept: "application/vnd.github.raw" },
      });
      if (!res.ok) return [];
      const text = await res.text();
      // Prefer tags near the top (first ~4k chars) for signal
      return extractTags(text.slice(0, 4000));
    } catch {
      return [];
    }
  }

  async function fetchTopics(fullName) {
    try {
      const res = await fetch(`https://api.github.com/repos/${fullName}/topics`, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return normalizeTopics(data.names || []);
    } catch {
      return [];
    }
  }

  async function enrichRepo(repo) {
    const [readmeTags, topics] = await Promise.all([
      fetchReadmeTags(repo.full_name),
      fetchTopics(repo.full_name),
    ]);
    const fromDesc = extractTags(repo.description || "");
    const categories = uniqueTags([...readmeTags, ...fromDesc, ...topics]);
    return {
      ...repo,
      categories,
      language: repo.language || "Другое",
    };
  }

  function setLoading(on) {
    els.skeleton.hidden = !on;
    els.statusDot.classList.toggle("is-loading", on);
    els.statusDot.classList.remove("is-error");
  }

  function updateStats(list) {
    const cats = new Set();
    const langs = new Set();
    let stars = 0;
    for (const r of list) {
      stars += r.stargazers_count || 0;
      (r.categories || []).forEach((c) => cats.add(c.toLowerCase()));
      if (r.language) langs.add(r.language);
    }
    const projects = list.length;
    const categories = cats.size;
    const languages = langs.size;

    els.statProjects.textContent = String(projects);
    els.statStars.textContent = String(stars);
    els.statCategories.textContent = String(categories);
    els.statLangs.textContent = String(languages);

    if (els.statProjectsLabel) {
      els.statProjectsLabel.textContent = plural(projects, "проект", "проекта", "проектов");
    }
    if (els.statStarsLabel) {
      els.statStarsLabel.textContent = plural(stars, "звезда", "звезды", "звёзд");
    }
    if (els.statCategoriesLabel) {
      els.statCategoriesLabel.textContent = plural(categories, "категория", "категории", "категорий");
    }
    if (els.statLangsLabel) {
      els.statLangsLabel.textContent = plural(languages, "язык", "языка", "языков");
    }
  }

  function renderChips(container, values, active, onPick, allLabel, asHash = true) {
    container.innerHTML = "";
    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = `chip${active === "all" ? " is-active" : ""}`;
    allBtn.textContent = allLabel;
    allBtn.addEventListener("click", () => onPick("all"));
    container.appendChild(allBtn);

    values.forEach((value) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `chip${active.toLowerCase() === value.toLowerCase() ? " is-active" : ""}`;
      btn.textContent = asHash ? (value.startsWith("#") ? value : `#${value}`) : value;
      btn.addEventListener("click", () => onPick(value));
      container.appendChild(btn);
    });
  }

  function collectFilters(list) {
    const catMap = new Map();
    const langMap = new Map();
    for (const r of list) {
      for (const c of r.categories || []) {
        const key = c.toLowerCase();
        if (!catMap.has(key)) catMap.set(key, c);
      }
      if (r.language) langMap.set(r.language, r.language);
    }
    return {
      categories: [...catMap.values()].sort((a, b) => a.localeCompare(b, "ru")),
      languages: [...langMap.values()].sort((a, b) => a.localeCompare(b, "ru")),
    };
  }

  function sorted(list) {
    const mode = els.sort.value;
    const copy = [...list];
    if (mode === "name") {
      copy.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    } else if (mode === "updated") {
      copy.sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at));
    } else {
      copy.sort((a, b) => b.stargazers_count - a.stargazers_count || a.name.localeCompare(b.name));
    }
    return copy;
  }

  function filtered() {
    const q = els.search.value.trim().toLowerCase();
    return sorted(
      repos.filter((r) => {
        if (activeCategory !== "all") {
          const ok = (r.categories || []).some((c) => c.toLowerCase() === activeCategory.toLowerCase());
          if (!ok) return false;
        }
        if (activeLanguage !== "all" && r.language !== activeLanguage) return false;
        if (!q) return true;
        const hay = [r.name, r.description || "", r.language || "", ...(r.categories || [])]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
    );
  }

  function icons() {
    return {
      book: `<svg class="repo-book" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M0 1.75A.75.75 0 0 1 .75 1h4.253c1.227 0 2.317.59 3 1.501A3.743 3.743 0 0 1 11.006 1h4.245a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.507a2.25 2.25 0 0 0-1.591.659l-.622.621a.75.75 0 0 1-1.06 0l-.622-.621A2.25 2.25 0 0 0 5.258 13H.75a.75.75 0 0 1-.75-.75Zm7.251 10.324.004-5.073-.002-2.253A2.25 2.25 0 0 0 5.003 2.5H1.5v9h3.757a3.75 3.75 0 0 1 1.994.574ZM12.527 2.5a2.25 2.25 0 0 0-2.254 2.248l.002 2.253.004 5.073a3.748 3.748 0 0 1 1.993-.574H14.5v-9Z"/></svg>`,
      star: `<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"/></svg>`,
      fork: `<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5 5.372v.878c0 .192.168.1.5.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-10.20.0.5 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/></svg>`,
    };
  }

  function renderFeatured(item) {
    if (!item) {
      els.featured.hidden = true;
      els.featured.innerHTML = "";
      return;
    }
    const ic = icons();
    const owner = (item.full_name || `${USER}/${item.name}`).split("/")[0];
    els.featured.hidden = false;
    const tags = (item.categories || [])
      .slice(0, 6)
      .map((t) => `<span class="topic">${escapeHtml(t)}</span>`)
      .join("");
    const color = LANG_COLORS[item.language] || "#0969da";
    const stars = item.stargazers_count || 0;
    const forks = item.forks_count || 0;
    els.featured.innerHTML = `
      <a class="featured-card" href="${escapeHtml(item.html_url)}" target="_blank" rel="noopener noreferrer">
        <div class="featured-main">
          <div class="featured-kicker">В фокусе</div>
          <div class="repo-title-row">
            ${ic.book}
            <h3 class="repo-name"><span class="owner">${escapeHtml(owner)}</span><span class="sep"> / </span><span class="name">${escapeHtml(item.name)}</span></h3>
          </div>
          <p>${escapeHtml(item.description || "Откройте репозиторий на GitHub, чтобы узнать больше.")}</p>
          <div class="repo-topics">${tags}</div>
          <div class="repo-meta">
            <span class="meta-item"><span class="lang-dot" style="background:${color}"></span>${escapeHtml(item.language || "Другое")}</span>
            <span class="meta-item" title="${escapeHtml(countLabel(stars, "звезда", "звезды", "звёзд"))}">${ic.star} ${stars}</span>
            <span class="meta-item" title="${escapeHtml(countLabel(forks, "форк", "форка", "форков"))}">${ic.fork} ${forks}</span>
            <span class="meta-item">Обновлён ${escapeHtml(formatDate(item.updated_at))}</span>
          </div>
        </div>
        <div class="featured-side">
          <div class="featured-metrics">
            <div class="metric"><span>${escapeHtml(plural(stars, "Звезда", "Звезды", "Звёзды"))}</span><strong>★ ${stars}</strong></div>
            <div class="metric"><span>${escapeHtml(plural(forks, "Форк", "Форки", "Форки"))}</span><strong>${forks}</strong></div>
            <div class="metric"><span>Язык</span><strong>${escapeHtml(item.language || "—")}</strong></div>
            <div class="metric"><span>Обновлён</span><strong>${escapeHtml(formatDate(item.updated_at))}</strong></div>
          </div>
          <span class="btn btn-ghost" style="align-self:flex-start">Открыть репозиторий</span>
        </div>
      </a>
    `;
  }

  function renderCards(list) {
    const ic = icons();
    els.grid.innerHTML = "";
    list.forEach((repo, i) => {
      const a = document.createElement("a");
      a.className = "repo-card";
      a.href = repo.html_url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.setAttribute("role", "listitem");
      a.style.animationDelay = `${Math.min(i, 10) * 35}ms`;
      const color = LANG_COLORS[repo.language] || "#0969da";
      const owner = (repo.full_name || `${USER}/${repo.name}`).split("/")[0];
      const tags = (repo.categories || [])
        .slice(0, 4)
        .map((t) => `<span class="topic">${escapeHtml(t)}</span>`)
        .join("");
      const stars = repo.stargazers_count || 0;
      const forks = repo.forks_count || 0;
      a.innerHTML = `
        <div class="repo-title-row">
          ${ic.book}
          <h3 class="repo-name"><span class="owner">${escapeHtml(owner)}</span><span class="sep"> / </span><span class="name">${escapeHtml(repo.name)}</span></h3>
        </div>
        <p class="repo-desc">${escapeHtml(repo.description || "Откройте репозиторий на GitHub, чтобы узнать больше.")}</p>
        <div class="repo-topics">${tags}</div>
        <div class="repo-meta">
          <span class="meta-item"><span class="lang-dot" style="background:${color}"></span>${escapeHtml(repo.language || "Другое")}</span>
          <span class="meta-item" title="${escapeHtml(countLabel(stars, "звезда", "звезды", "звёзд"))}">${ic.star} ${stars}</span>
          <span class="meta-item" title="${escapeHtml(countLabel(forks, "форк", "форка", "форков"))}">${ic.fork} ${forks}</span>
          <span class="meta-item">Обновлён ${escapeHtml(formatDate(repo.updated_at))}</span>
        </div>
      `;
      els.grid.appendChild(a);
    });
  }

  function applyFilter() {
    const list = filtered();
    els.empty.hidden = true;
    els.error.hidden = true;

    updateStats(repos);

    if (!repos.length) {
      els.featured.hidden = true;
      els.grid.innerHTML = "";
      els.categoryChips.innerHTML = "";
      els.languageChips.innerHTML = "";
      els.empty.hidden = false;
      els.empty.innerHTML = `<strong>Пока тихо на радаре</strong>Скоро здесь появятся новые крутые проекты.`;
      els.meta.textContent = countLabel(0, "проект", "проекта", "проектов");
      document.querySelectorAll(".filter-row").forEach((row) => {
        row.hidden = true;
      });
      return;
    }

    document.querySelectorAll(".filter-row").forEach((row) => {
      row.hidden = false;
    });

    const { categories, languages } = collectFilters(repos);
    renderChips(els.categoryChips, categories, activeCategory, (v) => {
      activeCategory = v;
      applyFilter();
    }, "Все", true);
    renderChips(els.languageChips, languages, activeLanguage, (v) => {
      activeLanguage = v;
      applyFilter();
    }, "Все", false);

    if (!list.length) {
      els.featured.hidden = true;
      els.grid.innerHTML = "";
      els.empty.hidden = false;
      els.empty.innerHTML = `<strong>Ничего не найдено</strong>Попробуйте другой запрос или сбросьте фильтры.`;
      els.meta.textContent = countLabel(0, "совпадение", "совпадения", "совпадений");
      return;
    }

    const [head, ...rest] = list;
    renderFeatured(head);
    renderCards(rest.length ? rest : []);
    if (!rest.length) {
      els.grid.innerHTML = "";
    }

    els.meta.textContent = countLabel(list.length, "проект", "проекта", "проектов");
  }

  async function load() {
    setLoading(true);
    els.meta.textContent = "Загрузка…";
    els.error.hidden = true;

    try {
      const res = await fetch(
        `https://api.github.com/users/${USER}/repos?sort=updated&per_page=100`
      );
      if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
      const data = await res.json();
      const base = data.filter((r) => !r.fork && !EXCLUDE.has(r.name));

      if (!base.length) {
        repos = [];
      } else {
        els.meta.textContent = "Обновление витрины…";
        repos = await mapPool(base, 4, enrichRepo);
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), repos }));
        } catch {}
      }

      setLoading(false);
      applyFilter();
    } catch (e) {
      try {
        const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
        if (cached?.repos?.length) {
          repos = cached.repos;
          setLoading(false);
          applyFilter();
          return;
        }
      } catch {}

      repos = [];
      setLoading(false);
      els.statusDot.classList.add("is-error");
      applyFilter();
      els.error.hidden = false;
      els.error.innerHTML = `<strong>Не удалось загрузить проекты</strong>Проверьте интернет и обновите страницу.`;
    }
  }

  function initCustomSelect() {
    const wrap = els.sortWrap;
    const trigger = els.sortTrigger;
    const menu = els.sortMenu;
    const hidden = els.sort;
    if (!wrap || !trigger || !menu || !hidden) return;

    function close() {
      wrap.classList.remove("is-open");
      trigger.setAttribute("aria-expanded", "false");
      menu.hidden = true;
    }

    function open() {
      wrap.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
      menu.hidden = false;
    }

    function selectOption(li) {
      hidden.value = li.dataset.value;
      els.sortValue.textContent = li.textContent.trim();
      menu.querySelectorAll('[role="option"]').forEach((opt) => {
        const on = opt === li;
        opt.classList.toggle("is-selected", on);
        opt.setAttribute("aria-selected", on ? "true" : "false");
      });
      close();
      applyFilter();
    }

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menu.hidden) open();
      else close();
    });

    menu.querySelectorAll('[role="option"]').forEach((li) => {
      li.addEventListener("click", (e) => {
        e.stopPropagation();
        selectOption(li);
      });
    });

    document.addEventListener("click", (e) => {
      if (!wrap.contains(e.target)) close();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }

  const params = new URLSearchParams(location.search);
  const qParam = params.get("q");
  if (qParam) els.search.value = qParam;

  els.search.addEventListener("input", applyFilter);
  initCustomSelect();

  function initRadar() {
    const canvas = document.getElementById("radar-canvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const RPM = 12;
    const BEAM_WIDTH = (6 * Math.PI) / 180;
    const TRAIL_DEG = 55;
    const FADE_IN = 10;
    const FADE_OUT = 0.38;
    const TARGET_COUNT = 28;

    let sweep = -Math.PI / 2;
    let lastTs = 0;
    let raf = 0;
    let dpr = 1;

    const targets = Array.from({ length: TARGET_COUNT }, (_, i) => {
      const a = (i / TARGET_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      return {
        angle: ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2),
        dist: 0.22 + Math.random() * 0.7,
        size: 2.2 + Math.random() * 2.8,
        intensity: 0,
      };
    });

    for (let i = 0; i < 8; i++) {
      const base = Math.random() * Math.PI * 2;
      targets.push({
        angle: base + (Math.random() - 0.5) * 0.12,
        dist: 0.35 + Math.random() * 0.45,
        size: 1.8 + Math.random() * 2,
        intensity: 0,
      });
    }

    function cssVar(name, fallback) {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const size = Math.max(280, Math.floor(rect.width));
      canvas.width = Math.floor(size * dpr);
      canvas.height = Math.floor(size * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function angleDiff(a, b) {
      let d = ((a - b + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (d < -Math.PI) d += Math.PI * 2;
      return d;
    }

    function drawFrame(dt) {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(w, h) * 0.46;

      const accent = cssVar("--accent", "#0969da");
      const border = cssVar("--border", "#d0d7de");
      const muted = cssVar("--muted", "#656d76");
      const isDark = currentTheme() === "dark";
      const scopeBg = isDark ? "rgba(13, 17, 23, 0.92)" : "rgba(246, 248, 250, 0.95)";
      const ring = isDark ? "rgba(47, 129, 247, 0.28)" : "rgba(9, 105, 218, 0.22)";
      const cross = isDark ? "rgba(132, 141, 151, 0.45)" : "rgba(101, 109, 118, 0.35)";

      ctx.clearRect(0, 0, w, h);

      ctx.beginPath();
      ctx.arc(cx, cy, radius + 6, 0, Math.PI * 2);
      ctx.strokeStyle = border;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = scopeBg;
      ctx.fill();
      ctx.strokeStyle = ring;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.clip();

      const vig = ctx.createRadialGradient(cx, cy, radius * 0.15, cx, cy, radius);
      vig.addColorStop(0, "transparent");
      vig.addColorStop(1, isDark ? "rgba(0,0,0,0.35)" : "rgba(31,35,40,0.06)");
      ctx.fillStyle = vig;
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

      for (let i = 1; i <= 4; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, (radius * i) / 4, 0, Math.PI * 2);
        ctx.strokeStyle = ring;
        ctx.lineWidth = i === 4 ? 1.4 : 1;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.moveTo(cx - radius, cy);
      ctx.lineTo(cx + radius, cy);
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx, cy + radius);
      ctx.strokeStyle = cross;
      ctx.lineWidth = 1;
      ctx.stroke();

      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * radius * 0.92, cy + Math.sin(a) * radius * 0.92);
        ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
        ctx.strokeStyle = muted;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      const trailRad = (TRAIL_DEG * Math.PI) / 180;
      const trailSteps = 36;
      for (let i = 0; i < trailSteps; i++) {
        const t0 = i / trailSteps;
        const t1 = (i + 1) / trailSteps;
        const a0 = sweep - trailRad * (1 - t0);
        const a1 = sweep - trailRad * (1 - t1);
        const strength = Math.pow(t1, 2.1) * (isDark ? 0.26 : 0.2);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, a0, a1);
        ctx.closePath();
        ctx.fillStyle = accent;
        ctx.globalAlpha = strength;
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sweep) * radius, cy + Math.sin(sweep) * radius);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.shadowColor = accent;
      ctx.shadowBlur = isDark ? 14 : 9;
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();

      const sweepNorm = ((sweep % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      for (const t of targets) {
        const diff = Math.abs(angleDiff(sweepNorm, t.angle));
        const underBeam = diff < BEAM_WIDTH;
        if (underBeam) t.intensity = Math.min(1, t.intensity + FADE_IN * dt);
        else if (t.intensity > 0) t.intensity = Math.max(0, t.intensity - FADE_OUT * dt);
        if (t.intensity <= 0.015) continue;

        const px = cx + Math.cos(t.angle) * t.dist * radius;
        const py = cy + Math.sin(t.angle) * t.dist * radius;
        const alpha = t.intensity * (0.35 + 0.65 * t.intensity);
        ctx.beginPath();
        ctx.arc(px, py, t.size + 4 * t.intensity, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.16 * alpha;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px, py, t.size * (0.65 + 0.55 * t.intensity), 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.globalAlpha = alpha;
        ctx.shadowColor = accent;
        ctx.shadowBlur = 5 + t.size * 2.4 * t.intensity;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }

      ctx.restore();

      if (!reduceMotion) {
        ctx.fillStyle = isDark ? "rgba(255,255,255,0.02)" : "rgba(31,35,40,0.025)";
        for (let i = 0; i < 22; i++) {
          const a = Math.random() * Math.PI * 2;
          const d = Math.random() * radius * 0.98;
          ctx.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1, 1);
        }
      }
    }

    function tick(ts) {
      if (!lastTs) lastTs = ts;
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;
      if (!reduceMotion) sweep += (RPM / 60) * Math.PI * 2 * dt;
      drawFrame(dt);
      raf = requestAnimationFrame(tick);
    }

    resize();
    window.addEventListener("resize", () => {
      resize();
      drawFrame(0);
    });
    new MutationObserver(() => drawFrame(0)).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    if (reduceMotion) {
      sweep = -Math.PI / 2 + 0.8;
      for (const t of targets) {
        if (Math.abs(angleDiff(((sweep % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), t.angle)) < 0.9) {
          t.intensity = 0.55 + Math.random() * 0.4;
        }
      }
      drawFrame(0);
    } else {
      raf = requestAnimationFrame(tick);
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        lastTs = 0;
      } else if (!reduceMotion) {
        raf = requestAnimationFrame(tick);
      }
    });
  }

  function initFaq() {
    const root = document.getElementById("faq-accordion");
    if (!root) return;
    const items = [...root.querySelectorAll(".faq-item")];

    function setOpen(target, open) {
      const trigger = target.querySelector(".faq-trigger");
      const panel = target.querySelector(".faq-panel-body");
      target.classList.toggle("is-open", open);
      if (trigger) trigger.setAttribute("aria-expanded", open ? "true" : "false");
      if (panel) panel.setAttribute("aria-hidden", open ? "false" : "true");
    }

    items.forEach((item) => {
      const open = item.classList.contains("is-open");
      setOpen(item, open);
      const trigger = item.querySelector(".faq-trigger");
      if (!trigger) return;
      trigger.addEventListener("click", () => {
        const willOpen = !item.classList.contains("is-open");
        items.forEach((other) => setOpen(other, willOpen && other === item));
      });
    });
  }

  initTheme();
  initFaq();
  initRadar();
  load();
})();
