/*
 * 프로토타입 공통 스크립트
 * - URL 쿼리 ?d=a|b|c&t=light|dark&shot=1 로 시안·테마 고정 (스크린샷 재현용)
 * - 아이콘 스프라이트, 숙련 아이콘, 진도 링 렌더링
 * - 프로토타입 툴바, ⌘J 튜터 드로어, 아코디언
 */
(function () {
  const params = new URLSearchParams(location.search);
  const root = document.documentElement;
  const dir = ["a", "b", "c"].includes(params.get("d")) ? params.get("d") : "a";
  const theme = ["light", "dark"].includes(params.get("t")) ? params.get("t") : "light";
  root.dataset.direction = dir;
  root.dataset.theme = theme;
  if (params.has("shot")) root.dataset.shot = "";

  const ICONS = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    "chevron-down": '<path d="m6 9 6 6 6-6"/>',
    "chevron-right": '<path d="m9 18 6-6-6-6"/>',
    "arrow-left": '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    play: '<path d="M7 4.5v15l12-7.5z"/>',
    search: '<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.3-4.3"/>',
    settings:
      '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    clock: '<circle cx="12" cy="12" r="9.5"/><path d="M12 7v5l3 2"/>',
    lightbulb:
      '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
    sparkle: '<path d="M12 3.5 13.9 9 19.5 11l-5.6 2L12 18.5 10.1 13 4.5 11l5.6-2z"/><path d="M19 3v3"/><path d="M17.5 4.5h3"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    book: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
    code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
    reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    target: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="1.5"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    copy: '<rect width="13" height="13" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
    chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    format: '<path d="M21 6H3"/><path d="M15 12H3"/><path d="M17 18H3"/>',
    skip: '<path d="M5 4.5 15 12 5 19.5z"/><path d="M19 5v14"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    bar: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6"/>',
    terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
    beaker: '<path d="M9 3h6"/><path d="M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7 15h10"/>',
    stop: '<rect width="12" height="12" x="6" y="6" rx="2"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  };

  const STAGE_LABEL = {
    not_started: "미학습",
    introduced: "입문",
    practicing: "연습 중",
    proficient: "숙련",
    mastered: "숙달",
  };

  function masterySvg(stage, opts) {
    const c = 8, r = 6.5;
    let inner = "";
    if (stage === "not_started") {
      inner = `<circle class="ring" cx="${c}" cy="${c}" r="${r}"/>`;
    } else if (stage === "mastered") {
      inner = `<circle class="bg" cx="${c}" cy="${c}" r="${r + 0.75}"/><path class="check" d="M5 8.3l2.1 2.1L11.2 6"/>`;
    } else {
      const wedge = {
        introduced: `M8 8V1.5A6.5 6.5 0 0 1 14.5 8Z`,
        practicing: `M8 1.5A6.5 6.5 0 0 1 8 14.5Z`,
        proficient: `M8 8V1.5A6.5 6.5 0 1 1 1.5 8Z`,
      }[stage];
      inner = `<circle class="bg" cx="${c}" cy="${c}" r="${r}"/><path class="wedge" d="${wedge}"/><circle class="ring" cx="${c}" cy="${c}" r="${r}"/>`;
    }
    if (opts.due) inner += `<circle class="due" cx="${c}" cy="${c}" r="9.6"/>`;
    if (opts.weak) inner += `<circle class="weak" cx="14" cy="2.2" r="2.6"/>`;
    let label = `숙련 단계: ${STAGE_LABEL[stage]}`;
    if (opts.due) label += ", 복습 예정";
    if (opts.weak) label += ", 약점";
    return { inner, label };
  }

  function renderIcons(scope) {
    scope.querySelectorAll("i[data-icon]").forEach((el) => {
      const name = el.dataset.icon;
      const cls = ["icon", el.className].filter(Boolean).join(" ");
      el.outerHTML = `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ""}</svg>`;
    });
    scope.querySelectorAll("i[data-stage]").forEach((el) => {
      const stage = el.dataset.stage;
      const { inner, label } = masterySvg(stage, { due: el.hasAttribute("data-due"), weak: el.hasAttribute("data-weak") });
      const cls = ["mi", el.className].filter(Boolean).join(" ");
      const hidden = el.hasAttribute("data-decorative");
      el.outerHTML = `<svg class="${cls}" data-stage="${stage}" viewBox="-2 -2 20 20" ${hidden ? 'aria-hidden="true"' : `role="img" aria-label="${label}"`}><title>${label}</title>${inner}</svg>`;
    });
    scope.querySelectorAll("i[data-ring]").forEach((el) => {
      const v = Number(el.dataset.ring);
      const size = Number(el.dataset.size || 40);
      const sw = size >= 56 ? 6 : size <= 22 ? 3 : 4;
      const r = (size - sw) / 2;
      const len = 2 * Math.PI * r;
      const label = el.dataset.label || `진도 ${v}%`;
      el.outerHTML = `<svg class="ring-progress" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="progressbar" aria-valuenow="${v}" aria-valuemin="0" aria-valuemax="100" aria-label="${label}"><circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${sw}"/><circle class="fill" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${sw}" stroke-dasharray="${(len * v) / 100} ${len}"/></svg>`;
    });
  }

  function buildToolbar() {
    const bar = document.createElement("div");
    bar.className = "proto-bar";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "프로토타입 보기 설정");
    const mk = (name, label, items, current) =>
      `<span class="lbl" id="pb-${name}">${label}</span><span role="radiogroup" aria-labelledby="pb-${name}">${items
        .map(([v, t]) => `<button type="button" role="radio" data-k="${name}" data-v="${v}" aria-checked="${v === current}" tabindex="${v === current ? 0 : -1}">${t}</button>`)
        .join("")}</span>`;
    bar.innerHTML =
      mk("d", "시안", [["a", "A"], ["b", "B"], ["c", "C"]], dir) +
      mk("t", "테마", [["light", "라이트"], ["dark", "다크"]], theme) +
      `<a href="index.html${location.search}">목록</a>`;
    document.body.appendChild(bar);
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-k]");
      if (!b) return;
      const p = new URLSearchParams(location.search);
      p.set(b.dataset.k, b.dataset.v);
      location.search = p.toString();
    });
    bar.addEventListener("keydown", (e) => {
      const b = e.target.closest("button[data-k]");
      if (!b || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      const group = [...b.parentElement.querySelectorAll("button")];
      const i = group.indexOf(b);
      const next = group[(i + (e.key === "ArrowRight" ? 1 : group.length - 1)) % group.length];
      next.focus();
      e.preventDefault();
    });
  }

  function wireInteractions() {
    // 튜터 드로어 ⌘J
    const drawer = document.querySelector(".drawer");
    const toggles = document.querySelectorAll("[data-toggle-drawer]");
    const setDrawer = (open) => {
      if (!drawer) return;
      drawer.hidden = !open;
      toggles.forEach((t) => t.setAttribute("aria-expanded", String(open)));
      if (open) drawer.querySelector("textarea")?.focus({ preventScroll: true });
    };
    toggles.forEach((t) => t.addEventListener("click", () => setDrawer(drawer.hidden)));
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setDrawer(drawer ? drawer.hidden : false);
      }
    });
    // 아코디언
    document.querySelectorAll(".acc-head").forEach((h) => {
      h.addEventListener("click", () => {
        const s = h.closest(".acc-section");
        const open = !s.classList.contains("is-open");
        s.classList.toggle("is-open", open);
        h.setAttribute("aria-expanded", String(open));
      });
    });
    // 객관식 선택
    document.querySelectorAll('[role="radiogroup"].choices').forEach((g) => {
      g.addEventListener("click", (e) => {
        const c = e.target.closest(".choice");
        if (!c) return;
        g.querySelectorAll(".choice").forEach((x) => x.setAttribute("aria-checked", String(x === c)));
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderIcons(document);
    buildToolbar();
    wireInteractions();
  });
})();
