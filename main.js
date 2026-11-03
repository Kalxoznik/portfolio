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
// leaves the canvas and the ring is not cut off at the seam. Up top it starts
// at the top of the page: at 1080 and below the hero sits under the header,
// whose see-through strip would otherwise show still body dots.
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
  let offset = 0;
  let pointer = null;
  let frame = 0;
  let lastTime = 0;
  let themeUntil = 0;
  let displaced = false;

  function build() {
    const ratio = window.devicePixelRatio || 1;
    const rect = hero.getBoundingClientRect();
    const left = rect.left + window.scrollX;
    // The canvas starts at the top of the page, so its height counts from there.
    offset = Math.max(0, rect.top + window.scrollY);
    width = hero.offsetWidth;
    height = offset + hero.offsetHeight;
    canvas.style.top = `${-offset}px`;
    canvas.style.height = `${height + RADIUS}px`;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round((height + RADIUS) * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    dots.length = 0;
    const startX = (((GRID / 2 - left) % GRID) + GRID) % GRID;
    const startY = GRID / 2;
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
    const py = pointer ? pointer.y - rect.top + offset : 0;
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
    const py = pointer.y - hero.getBoundingClientRect().top + offset;
    if (!displaced && py >= height + RADIUS) return;
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

  // The hero's top moves at the 1080 breakpoint, which a size change may miss.
  function rebuild() {
    build();
    draw();
  }

  new ResizeObserver(rebuild).observe(hero);
  window.addEventListener("resize", rebuild);
}

// First screen: the title swirls under the cursor as if seen through warped
// glass (POR-20). A WebGL canvas over the h1 shows the title, drawn letter by
// letter where the DOM puts each letter, and turns each sample point around
// the lens centre. At rest it matches the DOM text, which then goes
// see-through but stays for screen readers and selection. Same conditions as
// the dots, plus WebGL; otherwise the title stays as it is.
const lensCanvas = document.createElement("canvas");
const gl = hero && heroTitle && motionOk
  && window.matchMedia("(hover: hover) and (pointer: fine)").matches
  ? lensCanvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false })
  : null;

if (gl) {
  const RADIUS = 2; // × the title's font size
  const TWIST = Math.PI;
  const RISE = 0.3; // s, strength 0 → 1
  const FALL = 0.5; // s, strength 1 → 0

  lensCanvas.className = "hero-lens";
  lensCanvas.setAttribute("aria-hidden", "true");
  hero.append(lensCanvas);
  const text = document.createElement("canvas");
  const tctx = text.getContext("2d");

  const program = gl.createProgram();
  [
    [gl.VERTEX_SHADER, `
      attribute vec2 a_pos;
      void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`],
    [gl.FRAGMENT_SHADER, `
      #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
      #else
      precision mediump float;
      #endif
      uniform sampler2D u_text;
      uniform vec2 u_pixels;
      uniform vec2 u_size;
      uniform vec2 u_center;
      uniform float u_radius;
      uniform float u_angle;
      uniform vec4 u_color;
      void main() {
        // CSS px from the canvas's top left; at rest this hits texel centres.
        vec2 uv = vec2(gl_FragCoord.x / u_pixels.x, 1.0 - gl_FragCoord.y / u_pixels.y);
        vec2 o = uv * u_size - u_center;
        float d = length(o);
        if (u_angle != 0.0 && d < u_radius) {
          float t = 1.0 - d / u_radius;
          float a = u_angle * t * t;
          o = vec2(cos(a) * o.x - sin(a) * o.y, sin(a) * o.x + cos(a) * o.y);
          uv = (u_center + o) / u_size;
        }
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        float alpha = texture2D(u_text, uv).a * inside;
        gl_FragColor = vec4(u_color.rgb * u_color.a, u_color.a) * alpha;
      }`],
  ].forEach(([type, source]) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  });
  gl.linkProgram(program);
  gl.useProgram(program);
  const u = {};
  ["u_text", "u_pixels", "u_size", "u_center", "u_radius", "u_angle", "u_color"].forEach((name) => {
    u[name] = gl.getUniformLocation(program, name);
  });
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.uniform1i(u.u_text, 0);

  let fontReady = false;
  let ready = false;
  let radius = 0;
  let width = 0;
  let height = 0;
  let pointer = null;
  let center = null;
  let strength = 0;
  let frame = 0;
  let lastTime = 0;
  let themeUntil = 0;

  function fontSpec(styles) {
    return `${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
  }

  // The canvas covers the title plus the lens radius on every side, cut to the
  // hero's width so it never adds a horizontal scroll.
  function build() {
    if (!fontReady) return;
    const styles = getComputedStyle(heroTitle);
    tctx.font = fontSpec(styles);
    const ascent = tctx.measureText("M").fontBoundingBoxAscent;
    if (ascent == null) return;
    const ratio = window.devicePixelRatio || 1;
    const heroRect = hero.getBoundingClientRect();
    const box = heroTitle.getBoundingClientRect();
    radius = RADIUS * parseFloat(styles.fontSize);
    const left = Math.max(0, Math.floor(box.left - heroRect.left - radius));
    const right = Math.min(hero.clientWidth, Math.ceil(box.right - heroRect.left + radius));
    const top = Math.floor(box.top - heroRect.top - radius);
    width = right - left;
    height = Math.ceil(box.bottom - heroRect.top + radius) - top;
    lensCanvas.style.left = `${left}px`;
    lensCanvas.style.top = `${top}px`;
    lensCanvas.style.width = `${width}px`;
    lensCanvas.style.height = `${height}px`;
    lensCanvas.width = text.width = Math.round(width * ratio);
    lensCanvas.height = text.height = Math.round(height * ratio);

    // Each letter goes where the DOM puts it, so letter-spacing, kerning and
    // line breaks match the DOM text.
    const origin = lensCanvas.getBoundingClientRect();
    tctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    tctx.clearRect(0, 0, width, height);
    tctx.font = fontSpec(styles);
    tctx.fillStyle = "#fff";
    const range = document.createRange();
    const walker = document.createTreeWalker(heroTitle, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.nodeValue;
      for (let i = 0; i < value.length; i++) {
        const size = value.codePointAt(i) > 0xffff ? 2 : 1;
        const char = value.slice(i, i + size);
        if (!/\s/.test(char)) {
          range.setStart(node, i);
          range.setEnd(node, i + size);
          const rect = range.getClientRects()[0];
          if (rect) tctx.fillText(char, rect.left - origin.left, rect.top - origin.top + ascent);
        }
        i += size - 1;
      }
    }
    gl.viewport(0, 0, lensCanvas.width, lensCanvas.height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, text);
    ready = true;
  }

  function color() {
    const value = getComputedStyle(heroTitle).color;
    const parts = (value.match(/[\d.]+/g) || []).map(Number);
    const scale = value.startsWith("color(") ? 1 : 255;
    return [parts[0] / scale, parts[1] / scale, parts[2] / scale, parts.length > 3 ? parts[3] : 1];
  }

  function render() {
    if (!ready) return;
    const origin = lensCanvas.getBoundingClientRect();
    const eased = strength * strength * (3 - 2 * strength);
    gl.uniform2f(u.u_pixels, lensCanvas.width, lensCanvas.height);
    gl.uniform2f(u.u_size, width, height);
    gl.uniform2f(u.u_center, center ? center.x - origin.left : 0, center ? center.y - origin.top : 0);
    gl.uniform1f(u.u_radius, radius);
    gl.uniform1f(u.u_angle, center ? TWIST * eased : 0);
    gl.uniform4fv(u.u_color, color());
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    heroTitle.classList.add("is-lensed");
  }

  // The lens wakes once the cursor is within the radius of the title's box.
  function near() {
    if (!pointer) return false;
    const box = heroTitle.getBoundingClientRect();
    const dx = Math.max(box.left - pointer.x, 0, pointer.x - box.right);
    const dy = Math.max(box.top - pointer.y, 0, pointer.y - box.bottom);
    return Math.hypot(dx, dy) < radius;
  }

  function step(time) {
    frame = 0;
    const dt = Math.min(0.05, lastTime ? (time - lastTime) / 1000 : 1 / 60);
    lastTime = time;
    const target = near() ? 1 : 0;
    if (!strength && pointer) center = { ...pointer };
    strength = target > strength
      ? Math.min(1, strength + dt / RISE)
      : Math.max(0, strength - dt / FALL);
    let moving = false;
    if (pointer && center) {
      const ease = 1 - Math.pow(0.7, dt * 60);
      center.x += (pointer.x - center.x) * ease;
      center.y += (pointer.y - center.y) * ease;
      if (Math.abs(pointer.x - center.x) < 0.1 && Math.abs(pointer.y - center.y) < 0.1) {
        center = { ...pointer };
      } else {
        moving = strength > 0;
      }
    }
    render();
    if (strength !== target || moving || time < themeUntil) frame = requestAnimationFrame(step);
    else lastTime = 0;
  }

  function wake() {
    if (ready && !frame) frame = requestAnimationFrame(step);
  }

  window.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    pointer = { x: event.clientX, y: event.clientY };
    if (strength || near()) wake();
  }, { passive: true });

  document.documentElement.addEventListener("mouseleave", () => {
    pointer = null;
    wake();
  });

  // The title slides under a still cursor.
  window.addEventListener("scroll", () => {
    if (pointer && (strength || near())) wake();
  }, { passive: true });

  // The h1 takes the new colour at once: redraw now, then for 0.4s as the dots.
  new MutationObserver(() => {
    themeUntil = performance.now() + 400;
    render();
    wake();
  }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });

  // Unbounded comes with display=swap: nothing is drawn before it is in, so the
  // canvas never shows the fallback font. fonts.check() is no gate here: it
  // says true while the face is still loading.
  function rebuild() {
    build();
    render();
  }

  document.fonts.load(fontSpec(getComputedStyle(heroTitle)), heroTitle.textContent).then((faces) => {
    fontReady = faces.length > 0 && faces.every((face) => face.status === "loaded");
    rebuild();
  }, () => {});
  document.fonts.addEventListener("loadingdone", rebuild);
  new ResizeObserver(rebuild).observe(heroTitle);
  window.addEventListener("resize", rebuild);
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
