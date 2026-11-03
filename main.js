"use strict";

const root = document.documentElement;
const toggle = document.querySelector(".theme-toggle");
const navLinks = document.querySelectorAll("[data-nav]");
const header = document.querySelector(".site-header");

function themeLabel(theme) {
  return theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
}

function syncToggleLabel() {
  if (!toggle) return;
  toggle.setAttribute("aria-label", themeLabel(root.getAttribute("data-theme") || "dark"));
}

function applyTheme(theme) {
  root.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("theme", theme);
  } catch (e) {}
  syncToggleLabel();
}

syncToggleLabel();

toggle?.addEventListener("click", () => {
  const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
  applyTheme(next);
});

const menuToggle = document.querySelector(".menu-toggle");
const nav = document.querySelector(".nav");
const menuMedia = window.matchMedia("(width < 1300px)");

function setMenuOpen(open) {
  if (!menuToggle || !header) return;
  header.classList.toggle("is-menu-open", open);
  menuToggle.setAttribute("aria-expanded", String(open));
}

menuToggle?.addEventListener("click", () => {
  setMenuOpen(menuToggle.getAttribute("aria-expanded") !== "true");
});

nav?.addEventListener("click", (event) => {
  if (event.target.closest("a")) setMenuOpen(false);
});

document.addEventListener("click", (event) => {
  if (header?.classList.contains("is-menu-open") && !event.target.closest(".menu-toggle, .nav")) {
    setMenuOpen(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !header?.classList.contains("is-menu-open")) return;
  setMenuOpen(false);
  menuToggle.focus();
});

// Crossing into or out of the range swaps the nav's styles at once: only the
// button, a link, a click outside or Escape fade the dropdown.
menuMedia.addEventListener("change", () => {
  setMenuOpen(false);
  if (!nav) return;
  nav.style.transition = "none";
  requestAnimationFrame(() => requestAnimationFrame(() => nav.style.removeProperty("transition")));
});

function setActiveNav() {
  if (!navLinks.length) return;
  const offset = (header ? header.getBoundingClientRect().bottom : 0) + 24;
  const marker = window.scrollY + offset;
  let current = null;

  navLinks.forEach((link) => {
    const id = (link.getAttribute("href") || "").slice(1);
    const section = document.getElementById(id);
    if (section && section.offsetTop <= marker) current = id;
  });

  navLinks.forEach((link) => {
    const id = (link.getAttribute("href") || "").slice(1);
    if (id && id === current) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });
}

window.addEventListener("scroll", setActiveNav, { passive: true });
setActiveNav();

const heroTitle = document.getElementById("hero-title");

// The header stays transparent until the hero title's top reaches its bottom,
// then fills at once. Its background-color transition is kept for the theme
// switch only, so it is suspended while the class flips.
function syncHeaderSolid() {
  if (!header || !heroTitle) return;
  const solid = heroTitle.getBoundingClientRect().top <= header.getBoundingClientRect().bottom;
  if (solid === header.classList.contains("is-solid")) return;
  header.style.transition = "none";
  header.classList.toggle("is-solid", solid);
  getComputedStyle(header).backgroundColor;
  header.style.transition = "";
}

window.addEventListener("scroll", syncHeaderSolid, { passive: true });
window.addEventListener("resize", syncHeaderSolid);
syncHeaderSolid();

const motionOk = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// First screen: the dots run from the cursor and spring back once it leaves
// (POR-17). A canvas under the hero redraws the body's 32px grid in place, so
// the dots line up with the rest of the page. Mouse only, motion on only;
// otherwise the body's own dots stay as they are. The canvas runs RADIUS past
// the hero's bottom edge and the reach shrinks below it, so a pushed dot never
// leaves the canvas and the ring is not cut off at the seam.
const hero = document.querySelector(".hero");

if (hero && motionOk && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
  const canvas = document.createElement("canvas");
  canvas.className = "hero-dots";
  canvas.setAttribute("aria-hidden", "true");
  hero.prepend(canvas);
  const ctx = canvas.getContext("2d");

  const GRID = 32;
  const DOT = 1;
  const RADIUS = 100;
  const dots = [];
  let width = 0;
  let height = 0;
  let pointer = null;
  let frame = 0;
  let lastTime = 0;
  let themeUntil = 0;
  let displaced = false;

  function build() {
    const ratio = window.devicePixelRatio || 1;
    width = hero.offsetWidth;
    height = hero.offsetHeight;
    canvas.style.height = `${height + RADIUS}px`;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round((height + RADIUS) * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    dots.length = 0;
    const rect = hero.getBoundingClientRect();
    const left = rect.left + window.scrollX;
    const top = rect.top + window.scrollY;
    const startX = (((GRID / 2 - left) % GRID) + GRID) % GRID;
    const startY = (((GRID / 2 - top) % GRID) + GRID) % GRID;
    for (let y = startY; y < height + RADIUS + GRID; y += GRID) {
      for (let x = startX; x < width + GRID; x += GRID) {
        dots.push({ x, y, ox: 0, oy: 0 });
      }
    }
  }

  function draw() {
    const styles = getComputedStyle(root);
    const color = styles.getPropertyValue("--dots").trim();
    const lit = styles.getPropertyValue("--text-muted").trim();
    ctx.clearRect(0, 0, width, height + RADIUS);
    ctx.fillStyle = color;
    ctx.beginPath();
    dots.forEach((dot) => {
      if (dot.ox || dot.oy) return;
      ctx.moveTo(dot.x + DOT, dot.y);
      ctx.arc(dot.x, dot.y, DOT, 0, Math.PI * 2);
    });
    ctx.fill();

    // Pushed dots grow a little and brighten towards the muted text colour.
    dots.forEach((dot) => {
      if (!dot.ox && !dot.oy) return;
      const push = Math.min(1, Math.hypot(dot.ox, dot.oy) / (RADIUS * 0.5));
      const r = DOT + push * 0.6;
      const x = dot.x + dot.ox;
      const y = dot.y + dot.oy;
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = push * 0.45;
      ctx.fillStyle = lit;
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function step(time) {
    frame = 0;
    const dt = Math.min(0.05, lastTime ? (time - lastTime) / 1000 : 1 / 60);
    lastTime = time;
    const ease = 1 - Math.pow(0.82, dt * 60);
    const rect = hero.getBoundingClientRect();
    const px = pointer ? pointer.x - rect.left : 0;
    const py = pointer ? pointer.y - rect.top : 0;
    // Below the hero the circle shrinks, so pushed dots stay on the canvas.
    const reach = pointer ? Math.min(RADIUS, height + RADIUS - py) : 0;
    let moving = false;
    displaced = false;

    dots.forEach((dot) => {
      let tx = 0;
      let ty = 0;
      if (reach > 0) {
        const dx = dot.x - px;
        const dy = dot.y - py;
        const d = Math.hypot(dx, dy);
        if (d < reach) {
          // Closest dots travel furthest, out to about the edge of the circle.
          const t = 1 - d / reach;
          const push = reach * t * t * 0.9;
          const nx = d ? dx / d : 1;
          const ny = d ? dy / d : 0;
          tx = nx * push;
          ty = ny * push;
        }
      }
      dot.ox += (tx - dot.ox) * ease;
      dot.oy += (ty - dot.oy) * ease;
      if (Math.abs(tx - dot.ox) < 0.05 && Math.abs(ty - dot.oy) < 0.05) {
        dot.ox = tx;
        dot.oy = ty;
      } else {
        moving = true;
      }
      if (dot.ox || dot.oy) displaced = true;
    });

    draw();
    if (moving || time < themeUntil) frame = requestAnimationFrame(step);
    else lastTime = 0;
  }

  function wake() {
    if (!frame) frame = requestAnimationFrame(step);
  }

  // A cursor below the canvas over resting dots needs no frame.
  function wakeNear() {
    if (!displaced && pointer.y - hero.getBoundingClientRect().top >= height + RADIUS) return;
    wake();
  }

  window.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    pointer = { x: event.clientX, y: event.clientY };
    wakeNear();
  }, { passive: true });

  document.documentElement.addEventListener("mouseleave", () => {
    pointer = null;
    wake();
  });

  window.addEventListener("scroll", () => {
    if (pointer) wakeNear();
  }, { passive: true });

  // The dot colour fades with the theme switch: redraw for its 0.35s.
  new MutationObserver(() => {
    themeUntil = performance.now() + 400;
    wake();
  }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });

  new ResizeObserver(() => {
    build();
    draw();
  }).observe(hero);
}

document.querySelectorAll(".case").forEach((caseEl) => {
  const scroller = caseEl.querySelector(".carousel");
  const slides = [...caseEl.querySelectorAll(".slide")];
  const dots = [...caseEl.querySelectorAll(".carousel-dots button")];
  if (!scroller || !slides.length) return;

  let dragging = false;
  let moved = false;
  let startX = 0;
  let startScroll = 0;

  scroller.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragging = true;
    moved = false;
    startX = event.clientX;
    startScroll = scroller.scrollLeft;
    scroller.setPointerCapture(event.pointerId);
    scroller.classList.add("is-dragging");
  });

  scroller.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const delta = event.clientX - startX;
    if (Math.abs(delta) > 4) moved = true;
    scroller.scrollLeft = startScroll - delta;
  });

  function endDrag() {
    dragging = false;
    scroller.classList.remove("is-dragging");
  }

  scroller.addEventListener("pointerup", endDrag);
  scroller.addEventListener("pointercancel", endDrag);
  scroller.addEventListener("click", (event) => {
    if (!moved) return;
    event.preventDefault();
    event.stopPropagation();
    moved = false;
  }, true);

  function slideScrollLeft(slide) {
    const pad = parseFloat(getComputedStyle(scroller).paddingLeft) || 0;
    return slide.offsetLeft - scroller.offsetLeft - pad;
  }

  function nearestIndex() {
    const left = scroller.scrollLeft;
    let best = 0;
    let bestDistance = Infinity;
    slides.forEach((slide, index) => {
      const distance = Math.abs(slideScrollLeft(slide) - left);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }

  function syncDots() {
    const current = nearestIndex();
    dots.forEach((dot, index) => {
      if (index === current) dot.setAttribute("aria-current", "true");
      else dot.removeAttribute("aria-current");
    });
  }

  function goTo(index) {
    const slide = slides[index];
    if (!slide) return;
    scroller.scrollTo({
      left: slideScrollLeft(slide),
      behavior: motionOk ? "smooth" : "auto",
    });
  }

  scroller.addEventListener("scroll", syncDots, { passive: true });

  dots.forEach((dot, index) => {
    dot.addEventListener("click", () => goTo(index));
  });

  scroller.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const current = nearestIndex();
    const next = event.key === "ArrowRight"
      ? Math.min(slides.length - 1, current + 1)
      : Math.max(0, current - 1);
    goTo(next);
  });
});

const copyButton = document.querySelector(".copy-email");
const email = "max.shakurov@gmail.com";
let copyTimer = 0;

copyButton?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(email);
  } catch (error) {
    const field = document.createElement("textarea");
    field.value = email;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.left = "-999px";
    document.body.appendChild(field);
    field.select();
    document.execCommand("copy");
    field.remove();
  }
  copyButton.textContent = "Copied ✓";
  window.clearTimeout(copyTimer);
  copyTimer = window.setTimeout(() => {
    copyButton.textContent = "Click to copy";
  }, 1600);
});
