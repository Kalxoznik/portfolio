"use strict";

const root = document.documentElement;
const toggle = document.querySelector(".theme-toggle");
const navLinks = document.querySelectorAll("[data-nav]");
const wordmark = document.querySelector(".wordmark");
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

// The demo column and the demo are copies on the same origin (POR-46): a theme
// switched in one of them follows in the others.
window.addEventListener("storage", (event) => {
  if (event.key !== "theme" || (event.newValue !== "light" && event.newValue !== "dark")) return;
  root.setAttribute("data-theme", event.newValue);
  syncToggleLabel();
});

// The new theme opens as a circle from the toggle's centre over the old one
// (View Transitions). Without the API or with reduced motion it switches at
// once. Colour transitions are cut while the new state is drawn, so the
// circle holds the final colours instead of a fade.
const motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
let switching = null;

toggle?.addEventListener("click", () => {
  const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
  if (!document.startViewTransition || motionMedia.matches) {
    applyTheme(next);
    return;
  }
  const box = toggle.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  root.classList.add("is-theme-switching");
  const transition = document.startViewTransition(() => applyTheme(next));
  switching = transition;
  transition.ready
    .then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 700, easing: "cubic-bezier(0.65, 0, 0.35, 1)", pseudoElement: "::view-transition-new(root)" }
      );
    })
    .catch(() => {});
  // A click mid-circle skips this transition; only the latest one lifts the class.
  transition.finished.finally(() => {
    if (switching === transition) root.classList.remove("is-theme-switching");
  });
});

const menuToggle = document.querySelector(".menu-toggle");
const nav = document.querySelector(".nav");
const menuMedia = window.matchMedia("(width < 1400px)");

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
  if (current === null) wordmark?.setAttribute("aria-current", "true");
  else wordmark?.removeAttribute("aria-current");
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
// (POR-17). A canvas under the hero tracks the body's 32px grid and draws only
// the dots that are pushed off it, so at rest the page shows through untouched.
// Mouse only, motion on only;
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

  // Only pushed dots are drawn: the body shows the resting ones, so at rest the
  // canvas is empty. A patch of the page background hides a pushed dot's home;
  // over the last pixel of its way back the patch and the dot fade out together,
  // handing the dot over to the body without a blink. The patch fades as the
  // square: the dot is drawn over it, not over the body's dot, so with equal
  // alphas a faint hole would be left where the dot lands.
  function draw() {
    const styles = getComputedStyle(root);
    const color = styles.getPropertyValue("--dots").trim();
    const lit = styles.getPropertyValue("--text-muted").trim();
    const bg = getComputedStyle(document.body).backgroundColor;
    ctx.clearRect(0, 0, width, height + RADIUS);
    const pushed = dots.filter((dot) => dot.ox || dot.oy);
    // An empty canvas still nudges the text antialiasing above it: hide it.
    canvas.style.visibility = pushed.length ? "" : "hidden";

    ctx.fillStyle = bg;
    pushed.forEach((dot) => {
      ctx.globalAlpha = Math.min(1, Math.hypot(dot.ox, dot.oy)) ** 2;
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, 2, 0, Math.PI * 2);
      ctx.fill();
    });

    // Pushed dots grow a little and brighten towards the muted text colour.
    pushed.forEach((dot) => {
      const shift = Math.hypot(dot.ox, dot.oy);
      const fade = Math.min(1, shift);
      const push = Math.min(1, shift / (RADIUS * 0.5));
      const r = DOT + push * 0.6;
      const x = dot.x + dot.ox;
      const y = dot.y + dot.oy;
      ctx.globalAlpha = fade;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = fade * push * 0.45;
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

// First screen: the title and the lead swirl under the cursor as if seen
// through warped glass (POR-20). A WebGL canvas over them holds both texts,
// drawn letter by letter where the DOM puts each letter, and inside the lens
// circle turns each sample point around the lens centre. At rest the canvas is
// empty and the DOM text shows; while the lens is on, a mask cuts the same
// circle out of the DOM text. Same conditions as the dots, plus WebGL;
// otherwise the text stays as it is.
const heroLead = document.querySelector(".hero-lead");
const lensCanvas = document.createElement("canvas");
const gl = hero && heroTitle && heroLead && motionOk
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
      uniform vec4 u_title;
      uniform vec4 u_lead;
      // Over DOM text the mask has dimmed to x·m, alpha x(1 − m)/(1 − x·m)
      // lands back on x, so the 1px edge leaves no seam.
      vec4 lensed(vec4 color, float cover, float m) {
        if (color.a == 0.0) return vec4(0.0);
        float x = cover * color.a;
        float a = x * (1.0 - m) / (1.0 - x * m);
        return vec4(color.rgb / color.a * a, a);
      }
      void main() {
        // CSS px from the canvas's top left; with no turn this hits texel centres.
        vec2 uv = vec2(gl_FragCoord.x / u_pixels.x, 1.0 - gl_FragCoord.y / u_pixels.y);
        vec2 o = uv * u_size - u_center;
        float d = length(o);
        // Only the circle; m is the mask's ramp across its 1px edge.
        float m = clamp(d - u_radius + 0.5, 0.0, 1.0);
        if (m == 1.0) {
          gl_FragColor = vec4(0.0);
          return;
        }
        float t = max(0.0, 1.0 - d / u_radius);
        float a = u_angle * t * t;
        o = vec2(cos(a) * o.x - sin(a) * o.y, sin(a) * o.x + cos(a) * o.y);
        uv = (u_center + o) / u_size;
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        // Red holds the title's coverage, green the lead's.
        vec4 texel = texture2D(u_text, uv) * inside;
        gl_FragColor = lensed(u_title, texel.r, m) + lensed(u_lead, texel.g, m);
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
  ["u_text", "u_pixels", "u_size", "u_center", "u_radius", "u_angle", "u_title", "u_lead"].forEach((name) => {
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

  const texts = [heroTitle, heroLead];
  let fontReady = false;
  let ready = false;
  let lost = false;
  let open = false;
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

  // Each letter goes where the DOM puts it, so letter-spacing, kerning and
  // line breaks match the DOM text.
  function drawText(element, fill, origin) {
    const styles = getComputedStyle(element);
    tctx.font = fontSpec(styles);
    tctx.fillStyle = fill;
    const ascent = tctx.measureText("M").fontBoundingBoxAscent;
    const range = document.createRange();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
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
  }

  // The canvas covers the title and the lead plus the lens radius on every
  // side, cut to the hero's width so it never adds a horizontal scroll.
  function build() {
    if (!fontReady || lost) return;
    tctx.font = fontSpec(getComputedStyle(heroTitle));
    if (tctx.measureText("M").fontBoundingBoxAscent == null) return;
    const ratio = window.devicePixelRatio || 1;
    const heroRect = hero.getBoundingClientRect();
    const title = heroTitle.getBoundingClientRect();
    const lead = heroLead.getBoundingClientRect();
    radius = RADIUS * parseFloat(getComputedStyle(heroTitle).fontSize);
    const left = Math.max(0, Math.floor(Math.min(title.left, lead.left) - heroRect.left - radius));
    const right = Math.min(hero.clientWidth, Math.ceil(Math.max(title.right, lead.right) - heroRect.left + radius));
    const top = Math.floor(Math.min(title.top, lead.top) - heroRect.top - radius);
    width = right - left;
    height = Math.ceil(Math.max(title.bottom, lead.bottom) - heroRect.top + radius) - top;
    lensCanvas.style.left = `${left}px`;
    lensCanvas.style.top = `${top}px`;
    lensCanvas.style.width = `${width}px`;
    lensCanvas.style.height = `${height}px`;
    lensCanvas.width = text.width = Math.round(width * ratio);
    lensCanvas.height = text.height = Math.round(height * ratio);

    const origin = lensCanvas.getBoundingClientRect();
    tctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    tctx.clearRect(0, 0, width, height);
    drawText(heroTitle, "#f00", origin);
    drawText(heroLead, "#0f0", origin);
    gl.viewport(0, 0, lensCanvas.width, lensCanvas.height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, text);
    ready = true;
  }

  // Premultiplied; the lead's opacity goes into its alpha.
  function color(element) {
    const styles = getComputedStyle(element);
    const value = styles.color;
    const parts = (value.match(/[\d.]+/g) || []).map(Number);
    const scale = value.startsWith("color(") ? 1 : 255;
    const alpha = (parts.length > 3 ? parts[3] : 1) * parseFloat(styles.opacity);
    return [parts[0] / scale * alpha, parts[1] / scale * alpha, parts[2] / scale * alpha, alpha];
  }

  // The hole in each text's mask, in the element's own coordinates. The mask
  // is painted from the box snapped to device pixels.
  function setHole(x, y, r) {
    const ratio = window.devicePixelRatio || 1;
    texts.forEach((element) => {
      const box = element.getBoundingClientRect();
      element.style.setProperty("--lens-x", `${x - Math.round(box.left * ratio) / ratio}px`);
      element.style.setProperty("--lens-y", `${y - Math.round(box.top * ratio) / ratio}px`);
      element.style.setProperty("--lens-r", `${r}px`);
    });
  }

  // The canvas draws and the mask opens in the same frame; with no lens both
  // close together.
  function render() {
    if (!ready) return;
    if (gl.isContextLost()) {
      shutDown();
      return;
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!strength || !center) {
      if (open) setHole(0, 0, -1);
      open = false;
      return;
    }
    const origin = lensCanvas.getBoundingClientRect();
    const eased = strength * strength * (3 - 2 * strength);
    gl.uniform2f(u.u_pixels, lensCanvas.width, lensCanvas.height);
    gl.uniform2f(u.u_size, width, height);
    gl.uniform2f(u.u_center, center.x - origin.left, center.y - origin.top);
    gl.uniform1f(u.u_radius, radius);
    gl.uniform1f(u.u_angle, TWIST * eased);
    gl.uniform4fv(u.u_title, color(heroTitle));
    gl.uniform4fv(u.u_lead, color(heroLead));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    setHole(center.x, center.y, radius);
    open = true;
  }

  // A lost context takes the lens away until the page reloads.
  function shutDown() {
    lost = true;
    ready = false;
    cancelAnimationFrame(frame);
    frame = 0;
    texts.forEach((element) => {
      ["--lens-x", "--lens-y", "--lens-r"].forEach((name) => element.style.removeProperty(name));
    });
    lensCanvas.remove();
  }

  lensCanvas.addEventListener("webglcontextlost", shutDown);

  // The lens wakes once the cursor is within the radius of either text's box.
  function near() {
    if (!pointer) return false;
    return texts.some((element) => {
      const box = element.getBoundingClientRect();
      const dx = Math.max(box.left - pointer.x, 0, pointer.x - box.right);
      const dy = Math.max(box.top - pointer.y, 0, pointer.y - box.bottom);
      return Math.hypot(dx, dy) < radius;
    });
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
    if (!ready) return;
    if (strength !== target || moving || (strength && time < themeUntil)) frame = requestAnimationFrame(step);
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

  // The text slides under a still cursor.
  window.addEventListener("scroll", () => {
    if (pointer && (strength || near())) wake();
  }, { passive: true });

  // The texts take the new colour at once: redraw now, then for 0.4s as the
  // dots. At rest the canvas is empty and has nothing to redraw.
  new MutationObserver(() => {
    if (!strength) return;
    themeUntil = performance.now() + 400;
    render();
    wake();
  }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });

  // Both fonts come with display=swap: the lens waits for both, so the canvas
  // never shows a fallback font. fonts.check() is no gate here: it says true
  // while the face is still loading.
  function rebuild() {
    build();
    render();
  }

  function loadFonts() {
    Promise.all(texts.map((element) => (
      document.fonts.load(fontSpec(getComputedStyle(element)), element.textContent)
    ))).then((loads) => {
      fontReady = loads.every((faces) => faces.length > 0 && faces.every((face) => face.status === "loaded"));
      rebuild();
    }, () => {});
  }

  loadFonts();
  document.fonts.addEventListener("loadingdone", loadFonts);
  const observer = new ResizeObserver(rebuild);
  texts.forEach((element) => observer.observe(element));
  window.addEventListener("resize", rebuild);
}

// The pill that stands in for the cursor over slides. One for the page; each
// carousel says what it reads and where. It eases after the pointer, with
// reduced motion it jumps. Near the window's edge it stays inside, so the
// "← PREV" over a sliver of the previous slide can still be read. The lightbox
// uses the same pill (POR-47): its look is .cursor-label in styles.css, its
// words are here.
const CURSOR_TEXT = { next: "NEXT →", prev: "← PREV", zoom: "ZOOM", demo: "OPEN DEMO", close: "CLOSE" };
const fineHover = window.matchMedia("(hover: hover) and (pointer: fine)");
const cursorLabel = document.createElement("div");
cursorLabel.className = "cursor-label";
cursorLabel.setAttribute("aria-hidden", "true");
document.body.appendChild(cursorLabel);
let cursorX = 0;
let cursorY = 0;
let cursorTargetX = 0;
let cursorTargetY = 0;
let cursorFrame = 0;

function drawCursorLabel() {
  cursorLabel.style.transform = `translate(${cursorX}px, ${cursorY}px) translate(-50%, -50%)`;
}

function easeCursorLabel() {
  cursorX += (cursorTargetX - cursorX) * 0.25;
  cursorY += (cursorTargetY - cursorY) * 0.25;
  if (Math.abs(cursorTargetX - cursorX) < 0.1 && Math.abs(cursorTargetY - cursorY) < 0.1) {
    cursorX = cursorTargetX;
    cursorY = cursorTargetY;
    cursorFrame = 0;
  } else {
    cursorFrame = requestAnimationFrame(easeCursorLabel);
  }
  drawCursorLabel();
}

function showCursorLabel(text, x, y) {
  if (cursorLabel.textContent !== text) cursorLabel.textContent = text;
  const half = cursorLabel.offsetWidth / 2;
  cursorTargetX = Math.min(Math.max(x, half + 4), innerWidth - half - 4);
  cursorTargetY = y;
  if (!cursorLabel.classList.contains("is-visible") || motionMedia.matches) {
    cancelAnimationFrame(cursorFrame);
    cursorFrame = 0;
    cursorX = cursorTargetX;
    cursorY = cursorTargetY;
    drawCursorLabel();
    cursorLabel.classList.add("is-visible");
  } else if (!cursorFrame) {
    cursorFrame = requestAnimationFrame(easeCursorLabel);
  }
}

function hideCursorLabel() {
  cancelAnimationFrame(cursorFrame);
  cursorFrame = 0;
  cursorLabel.classList.remove("is-visible");
}

// Lightbox: a modal <dialog>, so Esc and the inert page come with it. Every way
// out goes through its close event. The slide's whole box is cloned; a real
// image takes its data-full file, or else the largest of its srcset, and a
// video plays muted on a loop. Browsing it (POR-47): the arrow buttons, ← / →,
// a swipe, or a click on either half of the image; each step moves the
// carousel underneath along and crossfades the image.
const lightbox = document.querySelector(".lightbox");
const lightboxClose = lightbox?.querySelector(".lightbox-close");
const lightboxPrev = lightbox?.querySelector(".lightbox-prev");
const lightboxNext = lightbox?.querySelector(".lightbox-next");
const lightboxFigure = lightbox?.querySelector(".lightbox-figure");
const lightboxMedia = lightbox?.querySelector(".lightbox-media");
const lightboxText = lightbox?.querySelector(".lightbox-text");
const lightboxCounter = lightbox?.querySelector(".lightbox-counter");
const LIGHTBOX_MS = 250;
let lightboxSlides = [];
let lightboxIndex = 0;
let lightboxStep = null;
let lightboxDone = null;
let lightboxPointer = null;
let swipeStart = null;
let swiped = false;

function lightboxSource(media) {
  return media.dataset.full
    || media.getAttribute("srcset")?.split(",").pop().trim().split(/\s+/)[0]
    || media.getAttribute("src");
}

// The figure stops at the file's own width, so it is never shown larger than
// it is. A vector has no such width.
function capToFile(box, media, src) {
  if (/\.svg(?:[?#]|$)/i.test(src || "")) return;
  const fit = () => {
    const width = media.naturalWidth || media.videoWidth;
    if (width && lightboxMedia.firstElementChild === box) lightboxFigure.style.maxWidth = `${width}px`;
  };
  if (media.naturalWidth) fit();
  else media.addEventListener(media.tagName === "VIDEO" ? "loadedmetadata" : "load", fit, { once: true });
}

function preloadLightbox(index) {
  const image = lightboxSlides[index]?.querySelector(".placeholder img");
  if (image) new Image().src = lightboxSource(image);
}

// direction is the step that led here: the old image fades out that way while
// the new one comes in. Opening and reduced motion swap at once.
function showLightboxSlide(index, direction = 0) {
  lightboxIndex = index;
  const slide = lightboxSlides[index];
  const box = slide.querySelector(".placeholder").cloneNode(true);
  const media = box.querySelector("img, video");
  lightboxFigure.style.removeProperty("max-width");
  if (media) {
    const src = lightboxSource(media);
    if (src) media.setAttribute("src", src);
    media.removeAttribute("srcset");
    media.removeAttribute("loading");
    if (media.tagName === "VIDEO") {
      media.muted = true;
      media.loop = true;
      media.autoplay = true;
      media.playsInline = true;
    }
  }

  lightboxMedia.querySelectorAll(".is-leaving").forEach((el) => el.remove());
  const old = lightboxMedia.firstElementChild;
  lightboxMedia.prepend(box);
  if (media) capToFile(box, media, media.getAttribute("src"));
  if (old && direction && !motionMedia.matches) {
    const options = { duration: LIGHTBOX_MS, easing: "ease" };
    old.classList.add("is-leaving");
    old.animate({ opacity: [1, 0], transform: ["none", `translateX(${-24 * direction}px)`] }, options)
      .finished.then(() => old.remove(), () => {});
    box.animate({ opacity: [0, 1], transform: [`translateX(${24 * direction}px)`, "none"] }, options);
  } else {
    old?.remove();
  }
  if (media?.tagName === "VIDEO") media.play()?.catch(() => {});

  lightboxText.replaceChildren(...[...slide.querySelector(".caption").children].map((part) => part.cloneNode(true)));
  lightboxCounter.textContent = `${index + 1} / ${lightboxSlides.length}`;
  lightboxPrev.hidden = index === 0;
  lightboxNext.hidden = index === lightboxSlides.length - 1;
  preloadLightbox(index - 1);
  preloadLightbox(index + 1);
}

// A button that hides at the end hands the focus on to the other one.
function stepLightbox(step) {
  const next = lightboxIndex + step;
  if (next < 0 || next >= lightboxSlides.length) return;
  const focused = document.activeElement;
  showLightboxSlide(next, step);
  lightboxStep?.(lightboxSlides[next]);
  if (focused?.hidden) {
    const other = focused === lightboxNext ? lightboxPrev : lightboxNext;
    (other.hidden ? lightboxClose : other).focus();
  }
  refreshLightboxCursor();
}

// What a click at this point does: the halves of the image step (with a fine
// pointer, and where there is a slide that way), the buttons do their own
// thing, anywhere else closes.
function lightboxZone(x, y) {
  const hit = document.elementFromPoint(x, y);
  if (!hit || hit.closest(".lightbox-button")) return null;
  const box = lightboxMedia.getBoundingClientRect();
  if (x < box.left || x > box.right || y < box.top || y > box.bottom) return "close";
  if (!fineHover.matches) return null;
  const step = x < box.left + box.width / 2 ? -1 : 1;
  const next = lightboxIndex + step;
  if (next < 0 || next >= lightboxSlides.length) return null;
  return step < 0 ? "prev" : "next";
}

// The same pill as over the carousel; it moves into the dialog, which sits in
// the top layer over everything else.
function refreshLightboxCursor() {
  if (!lightboxPointer || !lightbox.open || !fineHover.matches) return;
  const zone = lightboxZone(lightboxPointer.x, lightboxPointer.y);
  lightbox.classList.toggle("has-cursor-label", !!zone);
  if (zone) showCursorLabel(CURSOR_TEXT[zone], lightboxPointer.x, lightboxPointer.y);
  else hideCursorLabel();
}

function openLightbox(slides, index, step, done) {
  if (!lightbox) return;
  lightboxSlides = slides;
  lightboxStep = step;
  lightboxDone = done;
  lightboxPointer = null;
  showLightboxSlide(index);
  const scrollbar = innerWidth - root.clientWidth;
  if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`;
  root.classList.add("is-lightbox-open");
  lightbox.append(cursorLabel);
  lightbox.showModal();
  lightboxClose.focus();
}

lightbox?.addEventListener("close", () => {
  root.classList.remove("is-lightbox-open");
  root.style.removeProperty("padding-right");
  hideCursorLabel();
  lightbox.classList.remove("has-cursor-label");
  document.body.append(cursorLabel);
  // Takes a playing video with it.
  lightboxMedia.replaceChildren();
  lightboxDone?.(lightboxSlides[lightboxIndex]);
});

lightboxClose?.addEventListener("click", () => lightbox.close());
lightboxPrev?.addEventListener("click", () => stepLightbox(-1));
lightboxNext?.addEventListener("click", () => stepLightbox(1));

lightbox?.addEventListener("click", (event) => {
  if (swiped) {
    swiped = false;
    return;
  }
  if (event.target.closest(".lightbox-button")) return;
  const zone = lightboxZone(event.clientX, event.clientY);
  if (zone === "close") lightbox.close();
  else if (zone) stepLightbox(zone === "next" ? 1 : -1);
});

lightbox?.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch") return;
  lightboxPointer = { x: event.clientX, y: event.clientY };
  refreshLightboxCursor();
});

lightbox?.addEventListener("pointerleave", () => {
  lightboxPointer = null;
  lightbox.classList.remove("has-cursor-label");
  hideCursorLabel();
});

// A sideways swipe steps; the tap that may follow it does not close.
lightbox?.addEventListener("pointerdown", (event) => {
  swiped = false;
  swipeStart = event.pointerType === "touch" ? { x: event.clientX, y: event.clientY } : null;
});

lightbox?.addEventListener("pointerup", (event) => {
  if (!swipeStart || event.pointerType !== "touch") return;
  const dx = event.clientX - swipeStart.x;
  const dy = event.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
  swiped = true;
  stepLightbox(dx < 0 ? 1 : -1);
});

lightbox?.addEventListener("pointercancel", () => {
  swipeStart = null;
});

// On the document: a click on the image leaves the focus on the body. Tab goes
// round the buttons that show.
document.addEventListener("keydown", (event) => {
  if (!lightbox?.open) return;
  if (event.key === "Tab") {
    event.preventDefault();
    const buttons = [lightboxClose, lightboxPrev, lightboxNext].filter((button) => !button.hidden);
    const at = buttons.indexOf(document.activeElement);
    const step = event.shiftKey ? -1 : 1;
    buttons[at < 0 ? 0 : (at + step + buttons.length) % buttons.length].focus();
  } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    event.preventDefault();
    stepLightbox(event.key === "ArrowRight" ? 1 : -1);
  }
});

// Demo mode (POR-46). A case opts in with data-demo="<url of its demo>". From
// 1200 the site moves into a 375px column, a copy of itself loaded as
// ?embed=column so its mobile layout applies, and the demo panel takes the rest;
// narrower, the panel alone fills the window. The copy never opens demo mode
// itself: it asks this page to. Open, the URL ends in #demo=<case>, so Back
// closes it and the address opens it again. The page under it is inert, which
// keeps the focus in the column and the panel.
const embedded = new URLSearchParams(location.search).get("embed") === "column";
const demo = document.querySelector(".demo");
const demoColumn = demo?.querySelector(".demo-column");
const demoPanel = demo?.querySelector(".demo-panel");
const demoFrame = demo?.querySelector(".demo-frame");
const demoExit = demo?.querySelector(".demo-exit");
const demoWide = window.matchMedia("(min-width: 1200px)");
const DEMO_MS = 450;
let demoCase = null;
let demoTrigger = null;
let demoClosing = null;
let demoGoingBack = false;
let demoColumnLoaded = false;

function demoCaseEl(caseId) {
  const caseEl = caseId ? document.querySelector(`.case[data-case="${CSS.escape(caseId)}"]`) : null;
  return caseEl?.dataset.demo ? caseEl : null;
}

function hashDemo() {
  const match = location.hash.match(/^#demo=([\w-]+)$/);
  return match ? match[1] : null;
}

// A folder URL does not open its index.html from disk.
function demoUrl(src) {
  const target = new URL(src, location.href);
  if (target.protocol === "file:" && target.pathname.endsWith("/")) target.pathname += "index.html";
  return target.href;
}

// Setting src would add each load to the page's history, and Back would step
// the frame back instead of closing: the frames are only ever replaced.
function loadFrame(frame, href) {
  frame.contentWindow.location.replace(href);
}

function loadDemoColumn() {
  if (!demoCase || !demoWide.matches || demoColumnLoaded) return;
  const target = new URL(location.href);
  target.search = "?embed=column";
  target.hash = demoCase.id;
  loadFrame(demoColumn, target.href);
  demoColumnLoaded = true;
}

function pageParts() {
  return [...document.body.children].filter((el) => el !== demo && el.tagName !== "SCRIPT");
}

// The page shrinks towards the column's side and fades; the column fades in
// over it and the panel comes in from the right. Closing plays it backwards.
function animateDemo(opening) {
  const easing = "cubic-bezier(0.22, 1, 0.36, 1)";
  const options = { duration: DEMO_MS, easing, direction: opening ? "normal" : "reverse", fill: "both" };
  const runs = [demoPanel.animate({ transform: ["translateX(100%)", "none"] }, options)];
  if (demoWide.matches) {
    runs.push(demoColumn.animate({ opacity: [0, 1] }, options));
    pageParts().forEach((el) => {
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height) return;
      el.style.transformOrigin = `${-box.left}px ${innerHeight / 2 - box.top}px`;
      runs.push(el.animate({ transform: ["none", "scale(0.85)"], opacity: [1, 0] }, options));
    });
  }
  return Promise.all(runs.map((run) => run.finished)).then(() => runs);
}

function startDemo(caseId, animate) {
  const caseEl = demoCaseEl(caseId);
  if (!demo || !caseEl || demoCase) return false;
  demoCase = caseEl;
  demoTrigger = document.activeElement;
  hideCursorLabel();
  setMenuOpen(false);
  const scrollbar = innerWidth - root.clientWidth;
  if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`;
  root.classList.add("is-demo-open");
  loadFrame(demoFrame, demoUrl(caseEl.dataset.demo));
  loadDemoColumn();
  demo.hidden = false;
  pageParts().forEach((el) => { el.inert = true; });
  demoExit.focus({ preventScroll: true });
  if (animate && !motionMedia.matches) animateDemo(true).then((runs) => runs.forEach((run) => run.cancel()));
  return true;
}

function endDemo() {
  demoGoingBack = false;
  if (!demoCase || demoClosing) return;
  const finish = (runs = []) => {
    pageParts().forEach((el) => {
      el.inert = false;
      el.style.removeProperty("transform-origin");
    });
    demo.hidden = true;
    runs.forEach((run) => run.cancel());
    loadFrame(demoFrame, "about:blank");
    if (demoColumnLoaded) loadFrame(demoColumn, "about:blank");
    demoColumnLoaded = false;
    root.classList.remove("is-demo-open");
    root.style.removeProperty("padding-right");
    const trigger = demoTrigger?.isConnected && demoTrigger !== document.body ? demoTrigger : demoCase.querySelector(".demo-trigger");
    demoCase = null;
    demoTrigger = null;
    demoClosing = null;
    trigger?.focus({ preventScroll: true });
  };
  if (motionMedia.matches) {
    finish();
    return;
  }
  demoClosing = animateDemo(false).then(finish);
}

// The entry openDemo added goes back off the history; one the page was opened
// with is replaced, so closing never leaves the site.
function closeDemo() {
  if (!demoCase || demoClosing || demoGoingBack) return;
  if (history.state?.demo) {
    demoGoingBack = true;
    history.back();
    return;
  }
  history.replaceState(null, "", location.pathname + location.search);
  endDemo();
}

function openDemo(caseId) {
  if (embedded) {
    window.parent.postMessage({ type: "demo-open", caseId }, "*");
    return;
  }
  if (startDemo(caseId, true)) history.pushState({ demo: caseId }, "", `#demo=${caseId}`);
}

if (demo && !embedded) {
  demoExit.addEventListener("click", closeDemo);
  demo.querySelector(".demo-refresh").addEventListener("click", () => {
    loadFrame(demoFrame, demoUrl(demoCase.dataset.demo));
  });

  // Tab past either end comes back round: from the last edge to the column
  // (or the exit button), from the first to the demo.
  demo.querySelector(".demo-edge-end").addEventListener("focus", () => {
    (demoWide.matches ? demoColumn : demoExit).focus();
  });
  demo.querySelector(".demo-edge-start").addEventListener("focus", () => demoFrame.focus());

  window.addEventListener("message", (event) => {
    if (event.source === demoColumn.contentWindow && event.data?.type === "demo-open") openDemo(event.data.caseId);
  });

  function onDemoKey(event) {
    if (event.key === "Escape" && demoCase) closeDemo();
  }

  document.addEventListener("keydown", onDemoKey);

  // Esc pressed inside either frame, where the page can reach it. In the column
  // its own menu or lightbox closes first.
  [demoColumn, demoFrame].forEach((frame) => {
    frame.addEventListener("load", () => {
      try {
        const win = frame.contentWindow;
        win.addEventListener("keydown", (event) => {
          if (win.document.querySelector(".lightbox[open], .site-header.is-menu-open")) return;
          onDemoKey(event);
        }, true);
      } catch (error) {}
    });
  });

  window.addEventListener("popstate", () => {
    const caseId = hashDemo();
    if (!caseId) endDemo();
    else if (!demoCase) startDemo(caseId, true);
  });

  demoWide.addEventListener("change", loadDemoColumn);

  // Opened from the address: the page waits on the case underneath, with an
  // entry of its own below the demo's, so Back closes the demo, not the site.
  // A reload keeps the entries it already has.
  const initialDemo = demoCaseEl(hashDemo());
  if (initialDemo) {
    window.scrollTo({ top: initialDemo.getBoundingClientRect().top + scrollY, behavior: "instant" });
    if (startDemo(initialDemo.dataset.case, false) && !history.state?.demo) {
      history.replaceState(null, "", location.pathname + location.search);
      history.pushState({ demo: initialDemo.dataset.case }, "", `#demo=${initialDemo.dataset.case}`);
    }
  }
}

document.querySelectorAll(".case").forEach((caseEl) => {
  const scroller = caseEl.querySelector(".carousel");
  const slides = [...caseEl.querySelectorAll(".slide")];
  const dotsEl = caseEl.querySelector(".carousel-dots");
  if (!scroller || !slides.length) return;

  // One dot per slide, built from the slides, so a new screen needs only HTML.
  const dots = slides.map((slide, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.setAttribute("aria-label", `Show screen ${index + 1}`);
    if (index === 0) dot.setAttribute("aria-current", "true");
    dotsEl?.appendChild(dot);
    return dot;
  });

  // The active slide is the tab stop, Enter on it acts like a click.
  slides.forEach((slide, index) => {
    slide.tabIndex = index === 0 ? 0 : -1;
    slide.setAttribute("aria-label", `${slide.querySelector(".eyebrow")?.textContent ?? `Screen ${index + 1}`}, open`);
  });

  let dragging = false;
  let moved = false;
  let startX = 0;
  let startScroll = 0;
  let pressedSlide = null;
  let pointerX = null;
  let pointerY = null;

  scroller.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragging = true;
    moved = false;
    startX = event.clientX;
    startScroll = scroller.scrollLeft;
    pressedSlide = event.target.closest(".slide");
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
    refreshCursor();
  }

  scroller.addEventListener("pointerup", endDrag);
  scroller.addEventListener("pointercancel", endDrag);
  scroller.addEventListener("click", (event) => {
    if (!moved) return;
    event.preventDefault();
    event.stopPropagation();
    moved = false;
  }, true);

  // Under pointer capture the click lands on the carousel, not on the slide.
  scroller.addEventListener("click", (event) => {
    const slide = event.target.closest(".slide") || pressedSlide;
    pressedSlide = null;
    if (slide) activateSlide(slide);
  });

  function slideScrollLeft(slide) {
    const pad = parseFloat(getComputedStyle(scroller).paddingLeft) || 0;
    return slide.offsetLeft - scroller.offsetLeft - pad;
  }

  // The last slides cannot reach the start: they rest at the end of the scroll.
  function restingScrollLeft(slide) {
    return Math.min(slideScrollLeft(slide), scroller.scrollWidth - scroller.clientWidth);
  }

  function nearestIndex() {
    const left = scroller.scrollLeft;
    let best = 0;
    let bestDistance = Infinity;
    slides.forEach((slide, index) => {
      const distance = Math.abs(restingScrollLeft(slide) - left);
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
    slides.forEach((slide, index) => {
      slide.tabIndex = index === current ? 0 : -1;
    });
  }

  // The tolerance covers the nudge of up to 4px a press makes before it is a drag.
  function hasArrived(slide) {
    return Math.abs(scroller.scrollLeft - restingScrollLeft(slide)) <= 8;
  }

  // A slide cut by the carousel's edge is a step towards it; a whole one opens.
  // In mid-step nothing opens yet, even a slide that already shows whole.
  function slideZone(slide) {
    const box = slide.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    const whole = box.left >= view.left - 1 && box.right <= view.right + 1;
    if (hasArrived(slide) || (whole && slides.some(hasArrived))) return slide.hasAttribute("data-demo") ? "demo" : "zoom";
    return box.left > view.left ? "next" : "prev";
  }

  function activateSlide(slide) {
    const zone = slideZone(slide);
    if (zone === "next" || zone === "prev") {
      goTo(slides.indexOf(slide));
    } else if (zone === "demo") {
      openDemo(caseEl.dataset.case);
    } else {
      leaveCursor();
      const shown = slides.filter((item) => !item.hasAttribute("data-demo"));
      const follow = (current) => scroller.scrollTo({ left: restingScrollLeft(current), behavior: "instant" });
      openLightbox(shown, shown.indexOf(slide), follow, (last) => {
        if (slides[nearestIndex()] !== last) scroller.scrollTo({ left: restingScrollLeft(last), behavior: "auto" });
        last.focus({ preventScroll: true });
      });
    }
  }

  // Read from the point, not the event: under pointer capture every move
  // targets the carousel, and a scroll changes the zone under a still pointer.
  function refreshCursor() {
    if (pointerX === null || !fineHover.matches) return;
    const over = document.elementFromPoint(pointerX, pointerY)?.closest(".slide");
    const slide = slides.includes(over) && !(dragging && moved) ? over : null;
    scroller.classList.toggle("has-cursor-label", !!slide);
    if (slide) showCursorLabel(CURSOR_TEXT[slideZone(slide)], pointerX, pointerY);
    else hideCursorLabel();
  }

  function trackPointer(event) {
    if (event.pointerType === "touch") return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    refreshCursor();
  }

  function leaveCursor() {
    pointerX = null;
    scroller.classList.remove("has-cursor-label");
    hideCursorLabel();
  }

  scroller.addEventListener("pointerdown", trackPointer);
  scroller.addEventListener("pointermove", trackPointer);
  scroller.addEventListener("pointerleave", leaveCursor);
  root.addEventListener("mouseleave", leaveCursor);
  scroller.addEventListener("scroll", refreshCursor, { passive: true });

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
    if (event.key === "Enter" && slides.includes(event.target)) {
      event.preventDefault();
      activateSlide(event.target);
      return;
    }
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const current = nearestIndex();
    const next = event.key === "ArrowRight"
      ? Math.min(slides.length - 1, current + 1)
      : Math.max(0, current - 1);
    goTo(next);
    if (slides.includes(event.target)) slides[next].focus({ preventScroll: true });
  });
});

// "Try the demo" opens the demo wherever its slide is, even half in view. Under
// pointer capture the click lands on the carousel, so the press says whether it
// was on the button; a drag (prevented above) opens nothing.
document.querySelectorAll(".demo-trigger").forEach((button) => {
  const scroller = button.closest(".carousel");
  const caseId = button.closest(".case")?.dataset.case;
  let pressed = false;
  scroller?.addEventListener("pointerdown", (event) => {
    pressed = event.target.closest(".demo-trigger") === button;
  }, true);
  scroller?.addEventListener("click", (event) => {
    const onButton = pressed || event.target.closest(".demo-trigger") === button;
    pressed = false;
    if (!onButton || event.defaultPrevented) return;
    event.stopImmediatePropagation();
    openDemo(caseId);
  }, true);
});

// Link hover (POR-24): every letter rolls up and its copy rolls in from below,
// one after another from the left, while the underline draws in. Each letter
// sits in a clip box one line tall; the copy is its text-shadow one line down.
// Words keep their letters together. The logo rolls too, without the line
// (styles.css); the big email does not, it copies on click (below). The link's name stays its plain text for
// screen readers.
document.querySelectorAll(".wordmark, .nav a, .text-link, .footer-links a").forEach((link) => {
  if (!link.hasAttribute("aria-label")) link.setAttribute("aria-label", link.textContent.replace(/\s+/g, " ").trim());
  let label = link.querySelector(":scope > span");
  if (!label) {
    label = document.createElement("span");
    const text = [...link.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.data.trim());
    text.replaceWith(label);
    label.appendChild(document.createTextNode(text.data.trim()));
  }
  label.classList.add("link-label");
  const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  let index = 0;
  texts.forEach((node) => {
    const parts = document.createDocumentFragment();
    node.data.split(/(\s+)/).forEach((part) => {
      if (!part) return;
      if (/^\s/.test(part)) {
        parts.appendChild(document.createTextNode(part));
        return;
      }
      const word = document.createElement("span");
      word.className = "roll-word";
      for (const char of part) {
        const box = document.createElement("span");
        const glyph = document.createElement("span");
        box.className = "roll-char";
        box.style.setProperty("--i", index++);
        glyph.textContent = char;
        box.appendChild(glyph);
        word.appendChild(box);
      }
      parts.appendChild(word);
    });
    node.replaceWith(parts);
  });
});

const copyButton = document.querySelector(".copy-email");
const emailLink = document.querySelector(".contact-email");
const email = "max.shakurov@gmail.com";
let copyTimer = 0;

async function copyEmail() {
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
}

copyButton?.addEventListener("click", copyEmail);

// A click on the email copies it too, instead of opening the mail app; the
// mailto: href stays for when the script does not run.
emailLink?.addEventListener("click", (event) => {
  event.preventDefault();
  copyEmail();
});
