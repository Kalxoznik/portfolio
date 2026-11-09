/* Creative Space — scripted demo (no server, no real agents).
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

  const AUTOSTART_MS = 8000;   // idle → autoplay
  const AUTO_APPROVE_MS = 8000; // "ship it?" → autoplay presses Approve
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const embedded = window.parent !== window;

  /* ---------- data ---------- */
  const TARGET = "dark-mode";
  const INITIAL = [
    { id: TARGET, col: "backlog", title: "Dark Mode Toggle", desc: "Add a light / dark theme toggle to the site header.", tag: "medium", people: ["ms"] },
    { id: "404", col: "backlog", title: "404 Page Design", desc: "Create a custom and user-friendly 404 error page with helpful links.", tag: "low", people: ["ms"] },
    { id: "loading", col: "backlog", title: "Loading Animation Design", desc: "Design a loading animation to keep users engaged while content loads.", tag: "new", people: ["ms"] },
    { id: "nav", col: "review", title: "Navigation Menu Optimization", desc: "Review and optimize the navigation menu for clarity and ease of use.", tag: "low", people: ["ac", "cd"], status: "review" },
    { id: "img", col: "done", title: "Image Optimization", desc: "Optimize images for web use to improve page load times.", tag: "new", people: ["ac", "cd"], status: "done" },
    { id: "type", col: "done", title: "Typography Selection", desc: "Choose fonts for headings, subheadings, and body text.", tag: "medium", people: ["ac", "cd"], status: "done" },
  ];
  const PEOPLE = {
    ms: { initials: "MS", name: "Max (owner)", cls: "av-ms" },
    ac: { initials: "AC", name: "Architect", cls: "av-ac" },
    cd: { initials: "CD", name: "Coder", cls: "av-cd" },
  };
  const TAGS = { new: "NEW", low: "LOW", medium: "MEDIUM", high: "HIGH" };

  /* ---------- state ---------- */
  let cards = [];             // { ...card, col }
  let state = "idle";         // idle | playing | paused | ended
  let step = 0;               // index of the next scenario step
  let runToken = 0;           // bumps on restart: stale async steps stop
  let snapshot = null;        // card columns before the visitor interfered
  let autostartTimer = 0;
  let pendingChoice = null;   // resolver for the "ship it?" question

  const $ = (s, r = document) => r.querySelector(s);
  const board = $("#board");
  const messages = $("#messages");
  const ghost = $("#ghost");

  /* ---------- rendering ---------- */
  function avatar(key, size = "") {
    const p = PEOPLE[key];
    return `<span class="avatar ${size} ${p.cls}" title="${p.name}">${p.initials}</span>`;
  }
  function statusHtml(c) {
    if (c.status === "working") return `<span class="status"><span class="spin"></span><span class="status-text">Coder · working</span></span>`;
    if (c.status === "review") return `<span class="status"><span class="status-text">In review</span></span>`;
    if (c.status === "done") return `<span class="status"><span class="ok">✓</span></span>`;
    if (c.status === "queued") return `<span class="status"><span class="spin"></span><span class="status-text">Architect · planning</span></span>`;
    return "";
  }
  function cardEl(c) {
    const el = document.createElement("article");
    el.className = "card";
    el.dataset.id = c.id;
    el.innerHTML = `
      <p class="card-title">${c.title}</p>
      <p class="card-desc">${c.desc}</p>
      <div class="card-meta">
        <span class="tag tag-${c.tag}">${TAGS[c.tag]}</span>
        <span class="activity">${statusHtml(c)}<span class="assignees">${c.people.map((p) => avatar(p)).join("")}</span></span>
      </div>`;
    if (c.id === TARGET) el.classList.add("is-selected");
    if (c.id === TARGET && state === "idle") {
      el.classList.add("pulse");
      el.insertAdjacentHTML("beforeend", `<span class="hint">Drag me to Ready</span>`);
    }
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
  /* Animate cards to their new places (FLIP). */
  function renderAnimated() {
    const before = new Map([...board.querySelectorAll(".card")].map((el) => [el.dataset.id, el.getBoundingClientRect()]));
    render();
    if (reduceMotion) return;
    for (const el of board.querySelectorAll(".card")) {
      const a = before.get(el.dataset.id);
      if (!a) continue;
      const b = el.getBoundingClientRect();
      const dx = a.left - b.left, dy = a.top - b.top;
      if (!dx && !dy) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 450, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
  }
  function card(id) { return cards.find((c) => c.id === id); }
  function move(id, col, patch = {}) {
    const c = card(id);
    Object.assign(c, patch, { col });
    // moved cards go to the top of their new column
    cards = [c, ...cards.filter((x) => x !== c)];
    renderAnimated();
  }

  /* ---------- chat ---------- */
  function stamp() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function scrollChat() { messages.scrollTop = messages.scrollHeight; }
  function sys(text) {
    $("#chat-empty")?.remove();
    messages.insertAdjacentHTML("beforeend", `<p class="sys">${text} · ${stamp()}</p>`);
    scrollChat();
  }
  function bubble(who, html, extra = "") {
    $("#chat-empty")?.remove();
    const row = document.createElement("div");
    row.className = "msg" + (who === "ms" ? " is-owner" : "");
    row.innerHTML = `${avatar(who, "")}<div class="stack"><div class="bubble">${html}</div>${extra}<span class="stamp">${PEOPLE[who].name} · ${stamp()}</span></div>`;
    messages.append(row);
    scrollChat();
    return row;
  }
  function addParticipant(key) {
    const meta = $("#chat-people");
    if (meta.querySelector(`.${PEOPLE[key].cls}`)) return;
    meta.querySelector("#chat-count").insertAdjacentHTML("beforebegin", avatar(key, "avatar-xs"));
    const n = meta.querySelectorAll(".avatar").length;
    $("#chat-count").textContent = `${n} participants`;
  }
  async function typing(who, ms, token) {
    $("#chat-empty")?.remove();
    const row = document.createElement("div");
    row.className = "msg";
    row.innerHTML = `${avatar(who)}<div class="stack"><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>`;
    messages.append(row);
    scrollChat();
    await wait(ms, token);
    row.remove();
  }
  function resetChat() {
    messages.innerHTML = `<p class="empty" id="chat-empty">No messages yet. Move the card to <b>Ready</b> — the Architect picks it up.</p>`;
    const meta = $("#chat-people");
    meta.innerHTML = `${avatar("ms", "avatar-xs")}<span id="chat-count">1 participant</span>`;
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

  /* Ghost drags the target card into Ready. */
  async function ghostDragToReady(token) {
    const el = board.querySelector(`.card[data-id="${TARGET}"]`);
    if (!el) return;
    const [cx, cy] = center(el);
    await ghostTo(cx, cy, 900, token);
    ghost.classList.add("is-down");
    await wait(250, token);
    const ready = board.querySelector('.column[data-col="ready"] .cards');
    const rr = ready.getBoundingClientRect();
    const tx = rr.left + rr.width / 2, ty = rr.top + 62;
    // lift the real card and carry it with the cursor
    const r = el.getBoundingClientRect();
    const lift = el.cloneNode(true);
    lift.querySelector(".hint")?.remove();
    lift.classList.remove("pulse");
    lift.classList.add("is-dragging");
    Object.assign(lift.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, margin: 0, pointerEvents: "none" });
    document.body.append(lift);
    el.classList.add("is-placeholder");
    board.querySelector('.column[data-col="ready"]').classList.add("is-drop");
    const dx = cx - r.left, dy = cy - r.top;
    const follow = () => { lift.style.left = `${ghostX - dx}px`; lift.style.top = `${ghostY - dy}px`; if (lift.isConnected) requestAnimationFrame(follow); };
    follow();
    try {
      await ghostTo(tx, ty, 1100, token);
    } finally {
      lift.remove();
      board.querySelector('.column[data-col="ready"]').classList.remove("is-drop");
    }
    ghost.classList.remove("is-down");
    move(TARGET, "ready", { status: "queued" });
    await wait(200, token);
    ghostTo(ghostX + 40, innerHeight + 40, 700, token).then(ghostHide, () => {});
  }

  /* ---------- the scenario ---------- */
  const STEPS = [
    async (t) => { // 0 — the card reaches Ready (ghost drags it unless the visitor already did)
      if (card(TARGET).col !== "ready") await ghostDragToReady(t);
      sys("Moved to Ready — the Architect picks it up");
      addParticipant("ac");
      await wait(700, t);
    },
    async (t) => { // 1 — architect writes the brief
      await typing("ac", 1500, t);
      bubble("ac", `Brief for <span class="mention">@coder</span>: add a light / dark toggle to the header. Remember the choice, follow the system theme by default. Done when both themes pass the check.`);
      await wait(1300, t);
    },
    async (t) => { // 2 — card goes to In progress with the coder on it
      sys("Architect assigned this to Coder");
      addParticipant("cd");
      move(TARGET, "progress", { status: "working", people: ["ac", "cd"] });
      await wait(900, t);
    },
    async (t) => { // 3 — coder works
      await typing("cd", 1200, t);
      bubble("cd", "On it. Adding the toggle to the header and theme tokens.");
      await wait(1800, t);
      await typing("cd", 1600, t);
      bubble("cd", "Toggle works, the choice is saved, both themes pass the check <b>✓</b>");
      await wait(900, t);
    },
    async (t) => { // 4 — to Review
      sys("Coder finished — the Architect reviews it");
      move(TARGET, "review", { status: "review" });
      await wait(900, t);
    },
    async (t) => { // 5 — architect asks the owner
      await typing("ac", 1400, t);
      const row = bubble("ac", `Reviewed: matches the brief. <span class="mention">@Max</span> — ship it?`,
        `<div class="choices"><button type="button" class="choice primary" data-choice="approve">Approve</button><button type="button" class="choice" data-choice="changes">Request changes</button></div>`);
      const choice = await askOwner(row, t);
      if (choice === "changes") {
        bubble("ms", "Make the toggle icon a bit bigger, please.");
        await wait(700, t);
        await typing("ac", 1100, t);
        bubble("ac", `Noted. <span class="mention">@coder</span>, icon 20px instead of 16px.`);
        move(TARGET, "progress", { status: "working" });
        await wait(800, t);
        await typing("cd", 1300, t);
        bubble("cd", "Done — icon is 20px, check passes <b>✓</b>");
        move(TARGET, "review", { status: "review" });
        await wait(700, t);
        await typing("ac", 1000, t);
        const again = bubble("ac", `Looks right now. <span class="mention">@Max</span> — ship it?`,
          `<div class="choices"><button type="button" class="choice primary" data-choice="approve">Approve</button></div>`);
        await askOwner(again, t);
      }
      bubble("ms", "Approved — ship it.");
      await wait(600, t);
    },
    async (t) => { // 6 — Done
      sys("Owner approved — moved to Done");
      move(TARGET, "done", { status: "done" });
      await wait(1400, t);
    },
  ];

  /* The owner's decision: the visitor clicks, or autoplay clicks Approve. */
  function askOwner(row, token) {
    return new Promise((resolve, reject) => {
      const buttons = [...row.querySelectorAll(".choice")];
      let left = AUTO_APPROVE_MS, last = performance.now(), auto = false;
      const finish = (value, btn) => {
        buttons.forEach((b) => (b.disabled = true));
        btn?.classList.add("is-pressed");
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
      if (token !== runToken) return;
      setState("ended");
      $("#finale").hidden = false;
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
    const c = board.querySelector(`.card[data-id="${TARGET}"]`);
    c?.classList.remove("pulse");
    c?.querySelector(".hint")?.remove();
    setState("playing");
    runScenario(runToken);
  }
  function pause() {
    if (state === "playing") setState("paused");
  }
  function resume() {
    if (state !== "paused") return;
    if (snapshot) { // put the board back the way it was before the visitor's drags
      for (const c of cards) Object.assign(c, snapshot.get(c.id));
      cards.sort((a, b) => snapshot.get(a.id).order - snapshot.get(b.id).order);
      snapshot = null;
      renderAnimated();
    }
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
    $("#finale").hidden = true;
    cards = INITIAL.map((c) => ({ ...c, people: [...c.people] }));
    state = "idle";
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

  /* ---------- visitor drag & drop (pointer events: mouse + touch) ---------- */
  function takeSnapshot() {
    if (snapshot) return;
    snapshot = new Map(cards.map((c, i) => [c.id, { col: c.col, status: c.status, people: [...c.people], order: i }]));
  }
  board.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".card");
    if (!el || e.button > 0) return;
    const id = el.dataset.id;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    let lift = null, over = null;
    const sx = e.clientX, sy = e.clientY;

    const onMove = (ev) => {
      if (!lift) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        // the visitor is interfering — unless this is the "start" drag
        const isStartDrag = state === "idle" && id === TARGET;
        if (!isStartDrag) {
          clearTimeout(autostartTimer);
          if (state === "playing" || state === "idle") { takeSnapshot(); setState(state === "idle" ? "paused" : "paused"); }
        }
        lift = el.cloneNode(true);
        lift.querySelector(".hint")?.remove();
        lift.classList.remove("pulse");
        lift.classList.add("is-dragging");
        Object.assign(lift.style, { position: "fixed", width: `${r.width}px`, margin: 0, pointerEvents: "none" });
        document.body.append(lift);
        el.classList.add("is-placeholder");
      }
      lift.style.left = `${ev.clientX - dx}px`;
      lift.style.top = `${ev.clientY - dy}px`;
      const col = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".column");
      if (col !== over) { over?.classList.remove("is-drop"); over = col; over?.classList.add("is-drop"); }
    };
    const onUp = () => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
      removeEventListener("pointercancel", onUp);
      if (!lift) return;
      lift.remove();
      el.classList.remove("is-placeholder");
      over?.classList.remove("is-drop");
      const target = over?.dataset.col;
      if (target && target !== card(id).col) {
        if (state === "idle" && id === TARGET && target === "ready") {
          move(id, "ready", { status: "queued" });
          start();
        } else {
          move(id, target);
        }
      } else {
        render();
      }
    };
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
    addEventListener("pointercancel", onUp);
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
  $("#replay").addEventListener("click", restart);

  restart();
})();
