/* Creative Space — scripted demo (no server, no real agents).
 *
 * Looks and moves like the real board (Creative-Space/src/components/kanban-app.tsx):
 * dnd-kit drag with a 2° tilted overlay and no drop animation, agent activity as the
 * "Architect · thinking" / "Coder · working" badge with a pulsing dot, chat messages
 * that simply appear.
 *
 * One control drives it (the portfolio demo panel's button, or a floating
 * button when this page is opened on its own):
 *   idle    ▶  waiting; starts by itself after AUTOSTART_MS, or on click,
 *              or when the visitor drags the hinted card to Ready
 *   playing ⏸  the scenario runs; click = pause
 *   paused  ▶  the visitor dragged cards or clicked pause; click = put the
 *              board back the way it was and continue the scenario
 *   ended   ↻  click = start over
 *
 * Embedding protocol (window.postMessage):
 *   host → demo  { source: "cs-demo-host", type: "toggle" | "play" | "pause" | "restart" }
 *   demo → host  { source: "cs-demo", type: "state", state: "idle" | "playing" | "paused" | "ended" }
 */
(() => {
  "use strict";

  const AUTOSTART_MS = 8000;    // idle → autoplay
  const AUTO_APPROVE_MS = 8000; // "ship it?" → autoplay presses Approve
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const embedded = window.parent !== window;

  /* ---------- data ---------- */
  const TARGET = "dark-mode";
  const INITIAL = [
    { id: TARGET, col: "backlog", ref: "WEB-24", title: "Dark Mode Toggle", desc: "Add a light / dark theme toggle to the site header.", tag: "medium", comments: 0, files: 1, people: ["ms"] },
    { id: "404", col: "backlog", ref: "WEB-21", title: "404 Page Design", desc: "Create a custom and user-friendly 404 error page with helpful links.", tag: "low", comments: 0, files: 0, people: ["ms"] },
    { id: "loading", col: "backlog", ref: "WEB-19", title: "Loading Animation Design", desc: "Design a creative loading animation to keep users engaged.", tag: "new", comments: 0, files: 3, people: ["ms"] },
    { id: "nav", col: "review", ref: "WEB-17", title: "Navigation Menu Optimization", desc: "Review and optimize the navigation menu for clarity and ease of use.", tag: "low", comments: 4, files: 1, people: ["ac", "cd"] },
    { id: "img", col: "done", ref: "WEB-12", title: "Image Optimization", desc: "Optimize images for web use to improve page load times.", tag: "new", comments: 3, files: 0, people: ["ac", "cd"] },
    { id: "type", col: "done", ref: "WEB-09", title: "Typography Selection", desc: "Choose fonts for headings, subheadings, and body text.", tag: "medium", comments: 2, files: 1, people: ["ac", "cd"] },
  ];
  /* Avatar tones from Creative-Space/src/lib/kanban-data.ts */
  const PEOPLE = {
    ms: { initials: "MS", name: "Max Shakurov", short: "Max", bg: "#fff3da", fg: "#f2a000" },
    ac: { initials: "AC", name: "Architect (Claude)", short: "Architect", bg: "#ffe6f6", fg: "#d64aa6" },
    cd: { initials: "BC", name: "Board Claude", short: "Coder", bg: "#e8f2ff", fg: "#2176dd" },
  };
  const TAGS = { new: "NEW", low: "LOW", medium: "MEDIUM", high: "HIGH" };

  /* ---------- state ---------- */
  let cards = [];
  let state = "idle";         // idle | playing | paused | ended
  let step = 0;
  let runToken = 0;
  let snapshot = null;        // the board before the visitor interfered
  let autostartTimer = 0;
  let pendingChoice = null;

  const $ = (s, r = document) => r.querySelector(s);
  const board = $("#board");
  const messages = $("#messages");
  const ghost = $("#ghost");

  /* ---------- rendering ---------- */
  function avatar(key, size = 22) {
    const p = PEOPLE[key];
    return `<span class="avatar" title="${p.name}" style="width:${size}px;height:${size}px;font-size:${size <= 24 ? 9 : 12}px;background:${p.bg};color:${p.fg}">${p.initials}</span>`;
  }
  /* AgentBadge: "<Agent> · <verb>" with a pulsing dot while running */
  function badge(c) {
    if (!c.agent) return `<span class="tag tag-${c.tag}">${TAGS[c.tag]}</span>`;
    const p = PEOPLE[c.agent.who];
    return `<span class="agent-badge" style="background:${p.bg};color:${p.fg}"><span class="dot pulse" style="background:${p.fg}"></span><span class="badge-text">${p.short} · ${c.agent.verb}</span></span>`;
  }
  function stats(c) {
    const parts = [];
    if (c.comments) parts.push(`<span class="stat"><span class="ico-comment"></span>${c.comments}</span>`);
    if (c.comments && c.files) parts.push(`<span class="divider"></span>`);
    if (c.files) parts.push(`<span class="stat"><span class="ico-attach"></span>${c.files}</span>`);
    if (parts.length) parts.push(`<span class="divider"></span>`);
    return parts.join("");
  }
  function cardEl(c) {
    const el = document.createElement("article");
    el.className = "card" + (c.id === TARGET ? " is-selected" : "");
    el.dataset.id = c.id;
    el.innerHTML = `
      <div class="card-head"><p class="card-title">${c.title}</p><span class="card-ref">${c.ref}</span></div>
      <p class="card-desc">${c.desc}</p>
      <div class="card-meta">
        <span class="meta-left">${badge(c)}</span>
        <span class="meta-right">${stats(c)}<span class="assignees">${c.people.map((p) => avatar(p)).join("")}</span></span>
      </div>`;
    if (c.id === TARGET && state === "idle") el.insertAdjacentHTML("beforeend", `<span class="hint">Drag me to Ready</span>`);
    return el;
  }
  function render() {
    for (const col of board.querySelectorAll(".column")) {
      const list = col.querySelector(".cards");
      const items = cards.filter((c) => c.col === col.dataset.col);
      list.replaceChildren(...items.map(cardEl));
      col.querySelector(".count").textContent = items.length;
    }
  }
  function card(id) { return cards.find((c) => c.id === id); }
  /* Server-driven moves on the real board just re-render: no animation. */
  function move(id, col, patch = {}) {
    const c = card(id);
    Object.assign(c, patch, { col });
    cards = [c, ...cards.filter((x) => x !== c)];
    render();
  }
  function setAgent(who, verb) { card(TARGET).agent = who ? { who, verb } : null; render(); }

  /* ---------- chat (messages appear as they arrive, like the live board) ---------- */
  function stamp() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function scrollChat() { messages.scrollTop = messages.scrollHeight; }
  function clearEmpty() { $("#chat-empty")?.remove(); }
  function sys(text) {
    clearEmpty();
    messages.insertAdjacentHTML("beforeend", `<p class="sys">${text} · ${stamp()}</p>`);
    scrollChat();
  }
  function bubble(who, html, extra = "") {
    clearEmpty();
    const row = document.createElement("div");
    row.className = "msg";
    row.innerHTML = `${avatar(who, 24)}<div class="stack"><div class="bubble">${html}</div>${extra}<span class="stamp">${PEOPLE[who].name} · ${stamp()}</span></div>`;
    messages.append(row);
    card(TARGET).comments += 1;
    render();
    scrollChat();
    return row;
  }
  function addParticipant(key) {
    const meta = $("#chat-avatars");
    if (meta.querySelector(`[data-p="${key}"]`)) return;
    meta.insertAdjacentHTML("beforeend", `<span data-p="${key}" class="ring">${avatar(key, 22)}</span>`);
    $("#chat-count").textContent = `${meta.children.length} participants`;
  }
  function resetChat() {
    messages.innerHTML = `<p class="empty" id="chat-empty">No messages yet for this task. Move it to Ready — the Architect picks it up.</p>`;
    $("#chat-avatars").innerHTML = `<span data-p="ms" class="ring">${avatar("ms", 22)}</span>`;
    $("#chat-count").textContent = "1 participants";
  }

  /* ---------- timing that respects pause / restart ---------- */
  function wait(ms, token) {
    return new Promise((resolve, reject) => {
      let left = ms;
      let last = performance.now();
      const tick = (now) => {
        if (token !== runToken) return reject(new Error("restart"));
        if (state === "playing") left -= now - last;
        last = now;
        if (left <= 0) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
  async function whenPlaying(token) {
    while (state !== "playing") {
      if (token !== runToken) throw new Error("restart");
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /* ---------- drag overlay (dnd-kit DragOverlay: rotate 2°, shadow, original at 40%) ---------- */
  function liftCard(el) {
    const r = el.getBoundingClientRect();
    const lift = el.cloneNode(true);
    lift.style.boxSizing = "border-box";
    lift.querySelector(".hint")?.remove();
    lift.classList.remove("is-selected");
    lift.classList.add("is-overlay");
    Object.assign(lift.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, margin: 0, pointerEvents: "none" });
    document.body.append(lift);
    el.classList.add("is-dragging");
    return { lift, rect: r };
  }

  /* ---------- ghost cursor (autoplay hands) ---------- */
  let ghostX = innerWidth * 0.55, ghostY = innerHeight + 40;
  function ghostTo(x, y, ms, token) {
    ghost.classList.add("is-on");
    const x0 = ghostX, y0 = ghostY;
    const t0 = performance.now();
    return new Promise((resolve, reject) => {
      const frame = (now) => {
        if (token !== runToken) return reject(new Error("restart"));
        const t = reduceMotion ? 1 : Math.min(1, (now - t0) / ms);
        const e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        ghostX = x0 + (x - x0) * e; ghostY = y0 + (y - y0) * e;
        ghost.style.transform = `translate(${ghostX}px, ${ghostY}px)`;
        if (t < 1) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    });
  }
  function ghostHide() { ghost.classList.remove("is-on", "is-down"); }
  function center(el) { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }

  async function ghostDragToReady(token) {
    const el = board.querySelector(`.card[data-id="${TARGET}"]`);
    if (!el) return;
    const [cx, cy] = center(el);
    await ghostTo(cx, cy, 900, token);
    ghost.classList.add("is-down");
    await wait(250, token);
    const readyCol = board.querySelector('.column[data-col="ready"]');
    const rr = readyCol.querySelector(".cards").getBoundingClientRect();
    const tx = rr.left + rr.width / 2, ty = rr.top + 62;
    el.querySelector(".hint")?.remove();
    const { lift, rect } = liftCard(el);
    readyCol.classList.add("is-over");
    const dx = cx - rect.left, dy = cy - rect.top;
    const follow = () => { lift.style.left = `${ghostX - dx}px`; lift.style.top = `${ghostY - dy}px`; if (lift.isConnected) requestAnimationFrame(follow); };
    follow();
    try {
      await ghostTo(tx, ty, 1100, token);
    } finally {
      lift.remove();
      readyCol.classList.remove("is-over");
    }
    ghost.classList.remove("is-down");
    move(TARGET, "ready");
    await wait(200, token);
    ghostTo(ghostX + 40, innerHeight + 40, 700, token).then(ghostHide, () => {});
  }

  /* ---------- the scenario ---------- */
  const STEPS = [
    async (t) => { // 0 — the card reaches Ready
      if (card(TARGET).col !== "ready") await ghostDragToReady(t);
      sys("Moved to Ready — Architect (Claude) sorts the queue");
      addParticipant("ac");
      setAgent("ac", "sorting the queue");
      await wait(1800, t);
    },
    async (t) => { // 1 — brief
      bubble("ac", `Brief for <span class="mention">@coder</span>: add a light / dark toggle to the header. Remember the choice, follow the system theme by default. Done when both themes pass the check.`);
      await wait(1200, t);
      sys("Architect (Claude) assigned this to Board Claude");
      addParticipant("cd");
      move(TARGET, "progress", { people: ["ms", "cd"], agent: { who: "cd", verb: "working" } });
      await wait(2600, t);
    },
    async (t) => { // 2 — coder works
      bubble("cd", "On it. Adding the toggle to the header and the theme tokens.");
      await wait(3400, t);
      bubble("cd", "Toggle works, the choice is saved, both themes pass the check ✓");
      await wait(1000, t);
    },
    async (t) => { // 3 — Review
      sys("Board Claude finished the work — Architect (Claude) reviews it here");
      move(TARGET, "review", { agent: { who: "ac", verb: "thinking" } });
      await wait(2400, t);
    },
    async (t) => { // 4 — the owner decides
      setAgent(null);
      const row = bubble("ac", `Reviewed: matches the brief. <span class="mention">@max</span> — ship it?`,
        `<div class="choices"><button type="button" class="choice primary" data-choice="approve">Approve</button><button type="button" class="choice" data-choice="changes">Request changes</button></div>`);
      const choice = await askOwner(row, t);
      if (choice === "changes") {
        bubble("ms", "Make the toggle icon a bit bigger, please.");
        setAgent("ac", "thinking");
        await wait(1600, t);
        bubble("ac", `Noted. <span class="mention">@coder</span>, icon 20px instead of 16px.`);
        move(TARGET, "progress", { agent: { who: "cd", verb: "working" } });
        await wait(2600, t);
        bubble("cd", "Done — the icon is 20px, the check passes ✓");
        move(TARGET, "review", { agent: { who: "ac", verb: "thinking" } });
        await wait(1800, t);
        setAgent(null);
        const again = bubble("ac", `Looks right now. <span class="mention">@max</span> — ship it?`,
          `<div class="choices"><button type="button" class="choice primary" data-choice="approve">Approve</button></div>`);
        await askOwner(again, t);
      }
      bubble("ms", "Approved — ship it.");
      await wait(700, t);
    },
    async (t) => { // 5 — Done
      sys("Max Shakurov approved — moved to Done");
      move(TARGET, "done", { agent: null });
      await wait(600, t);
    },
  ];

  function askOwner(row, token) {
    return new Promise((resolve, reject) => {
      const buttons = [...row.querySelectorAll(".choice")];
      let left = AUTO_APPROVE_MS, last = performance.now(), auto = false;
      const finish = (value, btn) => {
        buttons.forEach((b) => (b.disabled = true));
        btn?.classList.add("is-chosen");
        pendingChoice = null;
        resolve(value);
      };
      buttons.forEach((b) => b.addEventListener("click", () => { if (!b.disabled) { ghostHide(); finish(b.dataset.choice, b); } }));
      pendingChoice = true;
      const tick = async (now) => {
        if (token !== runToken) { pendingChoice = null; return reject(new Error("restart")); }
        if (!pendingChoice) return;
        if (state === "playing") left -= now - last;
        last = now;
        if (left <= 0 && !auto) {
          auto = true;
          const approve = row.querySelector('[data-choice="approve"]');
          try {
            const [x, y] = center(approve);
            await ghostTo(x, y, 900, token);
            ghost.classList.add("is-down");
            await wait(200, token);
            ghost.classList.remove("is-down");
            if (pendingChoice) finish("approve", approve);
            ghostTo(ghostX + 30, innerHeight + 40, 700, token).then(ghostHide, () => {});
          } catch { /* restarted */ }
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  async function runScenario(token) {
    try {
      while (step < STEPS.length) {
        await whenPlaying(token);
        await STEPS[step](token);
        step += 1;
      }
      if (token === runToken) setState("ended");
    } catch (e) {
      if (e.message !== "restart") throw e;
    }
  }

  /* ---------- control ---------- */
  function setState(next) {
    state = next;
    if (embedded) parent.postMessage({ source: "cs-demo", type: "state", state }, "*");
    updateStandalone();
  }
  function start() {
    clearTimeout(autostartTimer);
    if (state !== "idle") return;
    setState("playing");
    render(); // drops the hint
    runScenario(runToken);
  }
  function pause() { if (state === "playing") setState("paused"); }
  function resume() {
    if (state !== "paused") return;
    if (snapshot) { // the board goes back to how it was when the visitor stepped in
      cards = [...snapshot.values()].sort((a, b) => a.order - b.order).map(({ order, ...c }) => c);
      archive = snapshot.archive;
      boards = snapshot.boards;
      snapshot = null;
    }
    $("#modal").hidden = true;
    $("#settings").hidden = true;
    showView({ name: "board", board: "web" });
    render();
    setState("playing");
  }
  function restart() {
    runToken += 1;
    clearTimeout(autostartTimer);
    pendingChoice = null;
    snapshot = null;
    step = 0;
    ghostHide();
    ghostX = innerWidth * 0.55; ghostY = innerHeight + 40;
    cards = INITIAL.map((c) => ({ ...c, people: [...c.people], agent: null }));
    archive = ARCHIVE_INITIAL.map((c) => ({ ...c }));
    boards = [{ id: "web", name: "Website design" }];
    $("#modal").hidden = true;
    $("#settings").hidden = true;
    state = "idle";
    showView({ name: "board", board: "web" });
    render();
    resetChat();
    setState("idle");
    autostartTimer = setTimeout(start, AUTOSTART_MS);
  }
  function toggle() {
    if (state === "idle") start();
    else if (state === "playing") pause();
    else if (state === "paused") resume();
    else if (state === "ended") restart();
  }

  /* ---------- visitor drag & drop (PointerSensor, 8px activation, like the board) ---------- */
  function takeSnapshot() {
    if (snapshot) return;
    snapshot = new Map(cards.map((c, i) => [c.id, { ...c, people: [...c.people], order: i }]));
    snapshot.archive = archive.map((c) => ({ ...c }));
    snapshot.boards = boards.map((b) => ({ ...b }));
  }
  board.addEventListener("pointerdown", (e) => {
    let el = e.target.closest(".card");
    if (!el || e.button > 0) return;
    const id = el.dataset.id;
    const sx = e.clientX, sy = e.clientY;
    let drag = null, over = null, dx = 0, dy = 0;

    const onMove = (ev) => {
      if (!drag) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return;
        const isStartDrag = state === "idle" && id === TARGET;
        if (!isStartDrag) interfere();
        // the board may have re-rendered since pointerdown (autoplay step or the pause itself):
        // a detached node measures 0×0 and the overlay collapses into a strip
        if (!el.isConnected) el = board.querySelector(`.card[data-id="${id}"]`);
        if (!el) { onUp(); return; }
        el.querySelector(".hint")?.remove();
        drag = liftCard(el);
        dx = sx - drag.rect.left; dy = sy - drag.rect.top;
      }
      drag.lift.style.left = `${ev.clientX - dx}px`;
      drag.lift.style.top = `${ev.clientY - dy}px`;
      const col = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".column");
      if (col !== over) { over?.classList.remove("is-over"); over = col; over?.classList.add("is-over"); }
    };
    const onUp = () => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
      removeEventListener("pointercancel", onUp);
      if (!drag) return;
      drag.lift.remove();       // dropAnimation: null — the card is simply there
      el.classList.remove("is-dragging");
      board.querySelector(`.card[data-id="${id}"]`)?.classList.remove("is-dragging");
      over?.classList.remove("is-over");
      const target = over?.dataset.col;
      if (target && target !== card(id).col) {
        move(id, target);
        if (state === "idle" && id === TARGET && target === "ready") start();
      } else {
        render();
      }
    };
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
    addEventListener("pointercancel", onUp);
  });


  /* ---------- navigation: boards, archive, agents, create (empty shells) ---------- */
  const app = $("#app");
  const AGENTS = [
    { who: "ac", name: "Architect (Claude)", handle: "architect", role: "architect", desc: "Plans tasks, dispatches the queue, reviews the Coder's work", conf: "Claude Code · High effort · on Website design" },
    { who: "cd", name: "Board Claude", handle: "coder", role: "coder", desc: "General-purpose coder: implements cards end to end", conf: "Standard tier · Claude Code · sonnet · Medium effort · on Website design" },
    { who: "fx", name: "Board Codex Fast", handle: "coder_fast", role: "coder", desc: "Small UI fixes and copy changes — fast and cheap", conf: "Fast tier · Codex CLI · Low effort · on no board" },
  ];
  PEOPLE.fx = { initials: "BF", name: "Board Codex Fast", short: "Coder", bg: "#ddf9e9", fg: "#48c77c" };
  const ARCHIVE_INITIAL = [
    { id: "a-seo", ref: "WEB-07", title: "SEO Metadata Implementation", desc: "Optimize page titles, meta descriptions, and image alt texts.", tag: "medium", comments: 2, files: 1, people: ["ac", "cd"] },
    { id: "a-feedback", ref: "WEB-05", title: "Feedback Form Implementation", desc: "Integrate user feedback forms on key pages to gather insights.", tag: "medium", comments: 2, files: 1, people: ["ac", "cd"] },
    { id: "a-security", ref: "WEB-03", title: "Security Review", desc: "Conduct a security review to identify and address potential vulnerabilities.", tag: "high", comments: 4, files: 1, people: ["ac", "cd"] },
  ];
  let boards = [];
  let archive = [];
  let view = { name: "board", board: "web" };
  let nextRef = 25;

  function showView(next) {
    view = next;
    app.dataset.view = next.name;
    const b = boards.find((x) => x.id === next.board);
    const crumbs = { board: `Workspace  /  ${b ? b.name : ""}`, newboard: `Workspace  /  ${b ? b.name : ""}`, archive: `Workspace  /  Archive  /  ${b ? b.name : ""}`, agents: "Workspace  /  Agents" };
    $("#crumbs").textContent = crumbs[next.name];
    renderNav();
    if (next.name === "archive") renderArchive();
  }
  function renderNav() {
    $("#boards").innerHTML = boards.map((b) => {
      const on = (view.name === "board" || view.name === "newboard") && view.board === b.id;
      return `<button type="button" class="nav-item${on ? " is-active" : ""}" data-board="${b.id}"><img src="assets/${on ? "grid-active" : "grid"}.svg" width="16" height="16" alt="">${b.name}</button>`;
    }).join("");
    const archOpen = view.name === "archive";
    $('[data-nav="archive"]').classList.toggle("is-open", archOpen);
    $('[data-nav="agents"]').classList.toggle("is-active", view.name === "agents");
    const sub = $("#archive-sub");
    sub.classList.toggle("is-open", archOpen);
    sub.innerHTML = boards.map((b) => `<button type="button" class="nav-item${archOpen && view.board === b.id ? " is-active" : ""}" data-archive="${b.id}">${b.name} Archive</button>`).join("");
  }
  function renderArchive() {
    const list = view.board === "web" ? archive : [];
    $("#archive-count").textContent = list.length;
    const host = $("#archive-cards");
    if (!list.length) { host.innerHTML = `<p class="col-empty">Nothing archived yet</p>`; return; }
    host.innerHTML = "";
    for (const c of list) {
      const wrap = document.createElement("div");
      const el = cardEl({ ...c, agent: null });
      el.classList.remove("is-selected");
      el.style.cursor = "default";
      wrap.append(el);
      wrap.insertAdjacentHTML("beforeend", `<div class="card-actions"><button type="button" data-restore="${c.id}">Restore</button><span class="sep">•</span><button type="button" data-delete="${c.id}">Delete</button></div>`);
      host.append(wrap);
    }
  }
  function renderAgents() {
    $("#agent-list").innerHTML = AGENTS.map((a) => `
      <div class="agent-row">${avatar(a.who, 36)}
        <div class="agent-info">
          <div class="agent-line"><span class="agent-name">${a.name}</span><span class="agent-handle">@${a.handle}</span><span class="role role-${a.role}">${a.role}</span></div>
          <span class="agent-desc">${a.desc}</span>
          <span class="agent-conf">${a.conf}</span>
        </div>
        <img src="assets/edit.svg" width="20" height="20" alt="" style="opacity:.6">
      </div>`).join("");
  }

  /* Anything the visitor does away from the scripted flow pauses it (and Play puts it back). */
  function interfere() {
    clearTimeout(autostartTimer);
    if (state === "playing" || state === "idle") { takeSnapshot(); setState("paused"); render(); }
  }

  $(".sidebar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-board]"), a = e.target.closest("[data-archive]"), n = e.target.closest("[data-nav]");
    if (b) { const id = b.dataset.board; if (!(view.name === "board" && id === "web")) interfere(); showView({ name: id === "web" ? "board" : "newboard", board: id }); }
    else if (a) { interfere(); showView({ name: "archive", board: a.dataset.archive }); }
    else if (n && n.dataset.nav === "agents") { interfere(); showView({ name: "agents", board: view.board }); }
    else if (n && n.dataset.nav === "archive") { interfere(); showView({ name: "archive", board: view.board }); }
    else if (n && n.dataset.nav === "settings") { interfere(); openSettings(); }
  });
  $("#archive-cards").addEventListener("click", (e) => {
    const r = e.target.closest("[data-restore]"), d = e.target.closest("[data-delete]");
    if (!r && !d) return;
    interfere();
    const id = (r || d).dataset.restore || (r || d).dataset.delete;
    const c = archive.find((x) => x.id === id);
    archive = archive.filter((x) => x !== c);
    if (r) cards.push({ ...c, col: "done", agent: null, restored: true });
    render(); renderArchive();
  });

  /* Settings (shell of the board's SettingsModal) */
  const settings = $("#settings");
  function openSettings() { settings.hidden = false; setTab("profile"); }
  function closeSettings() { settings.hidden = true; }
  function setTab(id) {
    settings.querySelectorAll(".stab").forEach((t) => t.classList.toggle("is-on", t.dataset.stab === id));
    settings.querySelectorAll(".spane").forEach((p) => (p.hidden = p.dataset.pane !== id));
  }
  settings.querySelectorAll(".stab").forEach((t) => t.addEventListener("click", () => setTab(t.dataset.stab)));
  settings.querySelectorAll("[data-close-settings]").forEach((b) => b.addEventListener("click", closeSettings));
  settings.addEventListener("click", (e) => { if (e.target === settings) closeSettings(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !settings.hidden) closeSettings(); });

  /* Create task / board (Figma: Create task modal 16:4) */
  const modal = $("#modal"), form = $("#modal-form");
  function setKind(kind) {
    form.dataset.kind = kind;
    form.querySelectorAll(".tab").forEach((t) => { const on = t.dataset.kind === kind; t.classList.toggle("is-on", on); t.setAttribute("aria-selected", on); });
    $("#modal-title").textContent = kind === "task" ? "Create new task" : "Create new board";
    $("#modal-submit").textContent = kind === "task" ? "Create task" : "Create board";
    validate();
    setTimeout(() => (kind === "task" ? $("#f-title") : $("#f-board")).focus(), 0);
  }
  function validate() { $("#modal-submit").disabled = form.dataset.kind === "task" ? !$("#f-title").value.trim() : !$("#f-board").value.trim(); }
  function openModal() { interfere(); form.reset(); modal.hidden = false; setKind("task"); }
  function closeModal() { modal.hidden = true; }
  $("#create").addEventListener("click", openModal);
  $("#modal-close").addEventListener("click", closeModal);
  $("#modal-cancel").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeModal(); });
  form.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setKind(t.dataset.kind)));
  form.addEventListener("input", validate);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if ($("#modal-submit").disabled) return;
    if (form.dataset.kind === "task") {
      const desc = $("#f-desc").value.trim();
      cards.push({ id: `new-${Date.now()}`, col: $("#f-col").value, ref: `WEB-${nextRef++}`, title: $("#f-title").value.trim(), desc, tag: $("#f-prio").value, comments: 0, files: 0, people: ["ms"], agent: null });
      closeModal();
      showView({ name: "board", board: "web" });
      render();
    } else {
      const id = `b-${Date.now()}`;
      boards.push({ id, name: $("#f-board").value.trim() });
      closeModal();
      showView({ name: "newboard", board: id }); // the new board opens right away
    }
  });

  /* ---------- host messages / standalone control ---------- */
  addEventListener("message", (e) => {
    const m = e.data;
    if (!m || m.source !== "cs-demo-host") return;
    if (m.type === "toggle") toggle();
    else if (m.type === "play") { if (state === "idle") start(); else if (state === "paused") resume(); else if (state === "ended") restart(); }
    else if (m.type === "pause") pause();
    else if (m.type === "restart") restart();
  });

  const ICONS = {
    play: `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z" fill="#fff"/></svg>`,
    pause: `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1.5" width="2.6" height="9" rx=".8" fill="#fff"/><rect x="7.4" y="1.5" width="2.6" height="9" rx=".8" fill="#fff"/></svg>`,
    replay: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 12a8 8 0 1 1-8-8c2.24 0 4.38.89 5.99 2.44L20 8.5" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 4v4.5h-4.5" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  };
  function updateStandalone() {
    if (embedded) return;
    const box = $("#standalone"), btn = $("#sa-toggle"), label = $("#sa-label");
    box.hidden = false;
    const map = { idle: ["play", "Play demo", "Play"], playing: ["pause", "Pause demo", "Playing"], paused: ["play", "Resume demo", "Paused"], ended: ["replay", "Replay demo", "Replay"] };
    const [icon, aria, text] = map[state];
    btn.innerHTML = ICONS[icon];
    btn.setAttribute("aria-label", aria);
    label.textContent = text;
  }
  $("#sa-toggle").addEventListener("click", toggle);

  renderAgents();
  restart();
})();
