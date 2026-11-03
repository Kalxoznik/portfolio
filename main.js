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
const menuMedia = window.matchMedia("(1080px < width < 1300px)");

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

const motionOk = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
