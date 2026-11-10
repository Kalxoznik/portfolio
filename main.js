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
  // While the column's copy is being squeezed (is-resizing) this waits: the
  // work is heavy, and nobody is looking at the hero.
  let rebuildLater = 0;
  function rebuild() {
    if (root.classList.contains("is-resizing")) {
      clearTimeout(rebuildLater);
      rebuildLater = setTimeout(rebuild, 300);
      return;
    }
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
  let rebuildLater = 0;
  function rebuild() {
    if (root.classList.contains("is-resizing")) {
      clearTimeout(rebuildLater);
      rebuildLater = setTimeout(rebuild, 300);
      return;
    }
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
const CURSOR_TEXT = { next: "NEXT →", prev: "← PREV", zoom: "ZOOM", demo: "OPEN LIVE PREVIEW", close: "CLOSE", pause: "PAUSE", play: "PLAY" };
// The cursor is a round disc with an icon and no words (POR-53): it inverts
// whatever is under it (styles.css), and the icon is cut out of it. The words
// above stay as its data-label, for the checks and for whoever reads the DOM.
const cursorIcon = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const CURSOR_ICONS = {
  [CURSOR_TEXT.next]: cursorIcon('<path d="M4 12h16M13 5l7 7-7 7"/>'),
  [CURSOR_TEXT.prev]: cursorIcon('<path d="M20 12H4M11 5l-7 7 7 7"/>'),
  [CURSOR_TEXT.zoom]: cursorIcon('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M10.5 7.5v6M7.5 10.5h6"/>'),
  // The demo slides in beside the site, it does not leave it: an arrow pushing against a panel's edge.
  [CURSOR_TEXT.demo]: cursorIcon('<path d="M16.5 12H3.5M9.5 6l-6 6 6 6M20.5 4v16"/>'),
  [CURSOR_TEXT.close]: cursorIcon('<path d="M6 6l12 12M18 6L6 18"/>'),
  [CURSOR_TEXT.pause]: cursorIcon('<path d="M8.5 5v14M15.5 5v14" stroke-width="3"/>'),
  [CURSOR_TEXT.play]: cursorIcon('<path d="M8 5v14l11-7z" fill="currentColor"/>'),
};
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
  if (cursorLabel.dataset.label !== text) {
    cursorLabel.dataset.label = text;
    cursorLabel.innerHTML = CURSOR_ICONS[text] || "";
  }
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
  // The clone still carries the slide's small file until the big one arrives:
  // measure only what has finished loading.
  const video = media.tagName === "VIDEO";
  if (video ? media.readyState >= 1 : media.complete && media.naturalWidth) fit();
  else media.addEventListener(video ? "loadedmetadata" : "load", fit, { once: true });
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
  // Where there is nothing further that way, the half closes instead.
  if (next < 0 || next >= lightboxSlides.length) return "close";
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
const DEMO_SQUEEZE_MS = 700;
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
// The demo panel squeezes the site (POR-58). The site's copy in the column
// starts as wide as the window, drawn exactly over the page, and narrows to
// 375 while the panel follows its edge in from the right; being a real page in
// a frame, the copy reflows into its mobile layout on the way. Closing runs the
// same thing backwards and ends on the page itself. Nothing fades. Opening
// waits (briefly) until both frames have loaded, so nothing blank slides in.
// Without the column (a narrow window) the panel simply slides in.
function anchorColumn(closing) {
  if (!demoWide.matches || !demoCase) return;
  demoColumn.contentWindow.postMessage({
    type: "column-anchor",
    caseId: demoCase.dataset.case,
    offset: demoCase.getBoundingClientRect().top,
    full: innerWidth,
    slideLeft: demoCase.querySelector(".carousel")?.scrollLeft ?? 0,
    closing,
  }, "*");
}

const twoFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

function animateDemo(opening, ready) {
  // The squeeze eases in and out and takes a little longer than a plain slide:
  // the site is re-laid out on the way, and an abrupt start would hide that.
  const squeeze = demoWide.matches;
  const easing = squeeze ? "cubic-bezier(0.65, 0, 0.35, 1)" : "cubic-bezier(0.22, 1, 0.36, 1)";
  const options = { duration: squeeze ? DEMO_SQUEEZE_MS : DEMO_MS, easing, direction: opening ? "normal" : "reverse", fill: "both" };
  if (squeeze) demo.classList.add("is-squeezing");
  const runs = squeeze
    ? [demoColumn.animate({ width: ["100vw", "375px"] }, options)]
    : [demoPanel.animate({ transform: ["translateX(100%)", "none"] }, options)];
  runs.forEach((run) => run.pause());
  if (ready) demo.style.visibility = "hidden";
  return Promise.resolve(ready)
    .then(() => {
      anchorColumn(!opening);
      return twoFrames();
    })
    .then(() => {
      demo.style.removeProperty("visibility");
      // Hidden things cannot take focus: now that it shows, the panel does.
      if (opening) demoPanel.focus({ preventScroll: true });
      runs.forEach((run) => run.play());
      return Promise.all(runs.map((run) => run.finished));
    })
    .then(() => {
      demo.classList.remove("is-squeezing");
      return runs;
    });
}

function framesLoaded(frames, patience) {
  const loaded = frames.map((frame) => new Promise((resolve) => frame.addEventListener("load", resolve, { once: true })));
  return Promise.race([Promise.all(loaded), new Promise((resolve) => setTimeout(resolve, patience))]);
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
  // Inside the demo there is no round cursor: its controls are the panel's bar.
  hideCursorLabel();
  document.querySelectorAll(".carousel.has-cursor-label").forEach((el) => el.classList.remove("has-cursor-label"));
  root.classList.add("is-demo-open");
  const ready = framesLoaded(demoWide.matches ? [demoFrame, demoColumn] : [demoFrame], 900);
  loadFrame(demoFrame, demoUrl(caseEl.dataset.demo));
  demo.querySelector(".demo-open")?.setAttribute("href", demoUrl(caseEl.dataset.demo));
  // The case says where its source and its app live; without them the bar has no such buttons.
  for (const [selector, href] of [[".demo-repo", caseEl.dataset.repo], [".demo-download", caseEl.dataset.download]]) {
    const link = demo.querySelector(selector);
    if (!link) continue;
    link.hidden = !href;
    if (href) link.setAttribute("href", href);
  }
  loadDemoColumn();
  demo.hidden = false;
  pageParts().forEach((el) => { el.inert = true; });
  // Focus goes to the panel itself, not to a button: Esc and Tab work from
  // there, and no button lights up as if it had been chosen.
  demoPanel.focus({ preventScroll: true });
  if (animate && !motionMedia.matches) animateDemo(true, ready).then((runs) => runs.forEach((run) => run.cancel()));
  return true;
}

function endDemo() {
  demoGoingBack = false;
  if (!demoCase || demoClosing) return;
  // Left by a click in the column (POR-57): the page comes back at the section clicked.
  if (demoLeaveTo) {
    window.scrollTo({ top: demoLeaveTo.getBoundingClientRect().top + scrollY, behavior: "instant" });
    demoLeaveTo = null;
  }
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
  // Left by a click in the column: going back in history would scroll the page
  // to where it was, so the demo's entry is rewritten instead. Back from there
  // returns to the case the demo was opened from.
  // Opened from disk, going back also unloads the frames mid-animation: rewrite there too.
  if (history.state?.demo && !demoLeaveTo && location.protocol !== "file:") {
    demoGoingBack = true;
    history.back();
    return;
  }
  history.replaceState(null, "", location.pathname + location.search);
  endDemo();
}

// The column beside the demo is the way back to the site: a click anywhere in
// it closes the demo and lands on the section that was clicked (POR-57). The
// copy only reports the click; a drag or a scroll in it is not one.
const DEMO_SECTIONS = ".hero, .case, .about, .site-footer";
let demoLeaveTo = null;

if (embedded) {
  root.classList.add("is-column");
  // The copy opens on its case at once, with no scroll to watch.
  root.style.scrollBehavior = "auto";
  const jump = () => document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "instant", block: "start" });
  jump();
  window.addEventListener("load", jump);
  // While the frame is being squeezed or let out, the copy keeps the demo's
  // case in step with the page it stands in for: at full width the case sits
  // where it sits on the page, at 375 it is at the top (or, closing, wherever
  // the column had been scrolled to).
  let anchor = null;
  // Being resized, the copy switches layouts at once: a menu fading out or a
  // header easing its colour mid-squeeze would only smear.
  let resizeQuiet = 0;
  const holdStill = (ms) => {
    root.classList.add("is-resizing");
    clearTimeout(resizeQuiet);
    resizeQuiet = setTimeout(() => root.classList.remove("is-resizing"), ms);
  };
  window.addEventListener("resize", () => holdStill(200));
  const holdAnchor = () => {
    if (!anchor) return;
    const span = anchor.full - 375;
    const narrow = span > 0 ? Math.min(1, Math.max(0, (anchor.full - innerWidth) / span)) : 1;
    // Opening ends with the case under the column's header, where its anchor puts it.
    const atColumn = anchor.narrow ?? (parseFloat(getComputedStyle(anchor.el).scrollMarginTop) || 0);
    const offset = anchor.wide + (atColumn - anchor.wide) * narrow;
    window.scrollTo({ top: anchor.el.getBoundingClientRect().top + scrollY - offset, behavior: "instant" });
  };
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.data?.type !== "column-anchor") return;
    const el = document.querySelector(`.case[data-case="${event.data.caseId}"]`);
    if (!el) return;
    if (!event.data.closing) {
      const carousel = el.querySelector(".carousel");
      if (carousel) carousel.scrollTo({ left: event.data.slideLeft, behavior: "instant" });
    }
    // The squeeze is about to start: be still before its first frame, not after it.
    holdStill(1000);
    anchor = { el, full: event.data.full, wide: event.data.offset, narrow: event.data.closing ? el.getBoundingClientRect().top : null };
    holdAnchor();
  });
  // Both: the observer runs after layout and before the paint of the same
  // frame, so no frame is drawn with the case out of place.
  window.addEventListener("resize", holdAnchor);
  new ResizeObserver(holdAnchor).observe(document.body);
  let downX = 0;
  let downY = 0;
  document.addEventListener("pointerdown", (event) => {
    downX = event.clientX;
    downY = event.clientY;
  }, true);
  document.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (Math.hypot(event.clientX - downX, event.clientY - downY) > 6) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY) || event.target;
    const section = [...document.querySelectorAll(DEMO_SECTIONS)].indexOf(hit.closest(DEMO_SECTIONS));
    window.parent.postMessage({ type: "demo-leave", section }, "*");
  }, true);
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
  // The bar's play control drives the scripted demo: it sends "toggle" and shows
  // whatever state the demo reports back (idle, playing, paused, ended).
  const demoPlay = demo.querySelector(".demo-play");
  const PLAY_LABELS = { idle: "Play the live preview", playing: "Pause the live preview", paused: "Resume the live preview", ended: "Replay the live preview" };
  function setDemoPlay(state) {
    if (!PLAY_LABELS[state]) return;
    demoPlay.dataset.state = state;
    demoPlay.setAttribute("aria-label", PLAY_LABELS[state]);
  }
  demoPlay.addEventListener("click", () => {
    demoFrame.contentWindow.postMessage({ source: "cs-demo-host", type: "toggle" }, "*");
  });
  demoFrame.addEventListener("load", () => setDemoPlay("idle"));
  // Refresh starts the demo over from a clean board: only its frame loads again.
  demo.querySelector(".demo-refresh").addEventListener("click", () => {
    loadFrame(demoFrame, demoUrl(demoCase.dataset.demo));
  });
  window.addEventListener("message", (event) => {
    if (event.source === demoFrame.contentWindow && event.data?.source === "cs-demo" && event.data.type === "state") {
      setDemoPlay(event.data.state);
    }
  });

  // Tab past either end comes back round: from the last edge to the column
  // (or the exit button), from the first to the demo.
  demo.querySelector(".demo-edge-end").addEventListener("focus", () => {
    (demoWide.matches ? demoColumn : demoExit).focus();
  });
  demo.querySelector(".demo-edge-start").addEventListener("focus", () => demoFrame.focus());

  window.addEventListener("message", (event) => {
    if (event.source !== demoColumn.contentWindow) return;
    if (event.data?.type === "demo-open") openDemo(event.data.caseId);
    if (event.data?.type === "demo-leave") {
      // A click on the case the demo belongs to is just "close": the page is
      // still where you left it. Any other section opens at its start.
      const target = document.querySelectorAll(DEMO_SECTIONS)[event.data.section] ?? null;
      demoLeaveTo = target === demoCase ? null : target;
      closeDemo();
    }
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
    // A link in a caption is a plain link: no drag starts on it, so its click stays its own.
    if (event.target.closest(".caption a")) return;
    dragging = true;
    moved = false;
    startX = event.clientX;
    startScroll = scroller.scrollLeft;
    // Only the picture acts on a click; the caption under it is text (POR-55).
    pressedSlide = event.target.closest(".placeholder")?.closest(".slide") ?? null;
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
    const slide = event.target.closest(".placeholder")?.closest(".slide") || pressedSlide;
    pressedSlide = null;
    if (slide) activateSlide(slide);
  });

  function slideScrollLeft(slide) {
    const pad = parseFloat(getComputedStyle(scroller).paddingLeft) || 0;
    // After the first, a slide rests further right, so a quarter of the one
    // before it stays in view (its scroll-margin-left in styles.css).
    const inset = parseFloat(getComputedStyle(slide).scrollMarginLeft) || 0;
    return slide.offsetLeft - scroller.offsetLeft - pad - inset;
  }

  // The last slides cannot reach the start: they rest at the end of the scroll.
  // And a stop that would leave only a short hop to the end is no stop at all
  // (POR-54): once the last slide is more than half in view, that slide rests at
  // the end too, so there is never a small leftover step. Slides that share a
  // resting place share one dot.
  function restingScrollLeft(slide) {
    const max = scroller.scrollWidth - scroller.clientWidth;
    return slide.hasAttribute("data-merged") ? max : Math.min(slideScrollLeft(slide), max);
  }

  function layoutStops() {
    const max = scroller.scrollWidth - scroller.clientWidth;
    const half = slides[0].offsetWidth / 2;
    slides.forEach((slide, index) => {
      const merged = index < slides.length - 1 && max - slideScrollLeft(slide) < half;
      slide.toggleAttribute("data-merged", merged);
    });
    let before = null;
    slides.forEach((slide, index) => {
      const rest = restingScrollLeft(slide);
      dots[index].hidden = before !== null && Math.abs(rest - before) < 1;
      before = rest;
    });
    syncDots();
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
    // The demo slide opens the demo from wherever it stands, like its button.
    if (slide.hasAttribute("data-demo")) return "demo";
    if (hasArrived(slide) || (whole && slides.some(hasArrived))) {
      const edge = edgeZone(slide, box);
      if (edge) return edge;
      if (videoOf(slide)) return videoOf(slide).paused ? "play" : "pause";
      return "zoom";
    }
    return box.left > view.left ? "next" : "prev";
  }

  // The slide in place has three zones (POR-49, POR-52): its left and right
  // quarters step to the neighbours (when there are any), the middle opens an
  // image large or pauses and plays a video, which has no player controls. A
  // press without a pointer position (keyboard, touch) is the middle.
  function videoOf(slide) {
    return slide.querySelector(".placeholder video");
  }

  function edgeZone(slide, box) {
    if (pointerX === null) return null;
    const index = slides.indexOf(slide);
    const at = (pointerX - box.left) / box.width;
    // A step only while there is somewhere to go that way: on a wide screen the
    // second slide shows whole beside the first, and its left quarter has no
    // step back to offer, so it opens the picture like the middle does.
    if (at < 0.25 && index > 0 && stopBeside(-1) !== -1) return "step-prev";
    if (at > 0.75 && index < slides.length - 1 && stopBeside(1) !== -1) return "step-next";
    return null;
  }

  // The nearest resting place before (-1) or after (1) where the carousel
  // stands now, as a slide index; -1 when there is none.
  function stopBeside(direction) {
    const left = scroller.scrollLeft;
    if (direction > 0) return slides.findIndex((slide) => restingScrollLeft(slide) > left + 1);
    for (let index = slides.length - 1; index >= 0; index -= 1) {
      if (restingScrollLeft(slides[index]) < left - 1) return index;
    }
    return -1;
  }

  // A video plays only while its slide is the one in place and the carousel is
  // on screen; it pauses as soon as you step away. A pause by click holds until
  // you leave the slide. Reduced motion: nothing starts by itself.
  const userPaused = new Set();
  const userPlayed = new Set();
  let carouselSeen = false;

  function syncVideos() {
    const current = slides[nearestIndex()];
    const settled = hasArrived(current);
    slides.forEach((slide) => {
      const video = videoOf(slide);
      if (!video) return;
      if (slide !== current && settled) {
        userPaused.delete(slide);
        userPlayed.delete(slide);
      }
      const play = slide === current && settled && carouselSeen && !document.hidden && !lightbox?.open
        && !userPaused.has(slide) && (!motionMedia.matches || userPlayed.has(slide));
      if (play && video.paused) video.play().catch(() => {});
      else if (!play && !video.paused) video.pause();
    });
  }

  function toggleVideo(slide) {
    const video = videoOf(slide);
    if (video.paused) {
      userPaused.delete(slide);
      userPlayed.add(slide);
      video.play().catch(() => {});
    } else {
      userPlayed.delete(slide);
      userPaused.add(slide);
      video.pause();
    }
    refreshCursor();
  }

  slides.forEach((slide) => {
    const video = videoOf(slide);
    if (!video) return;
    video.muted = true;
    video.playsInline = true;
    video.addEventListener("play", refreshCursor);
    video.addEventListener("pause", refreshCursor);
  });

  if (slides.some(videoOf)) {
    new IntersectionObserver(([entry]) => {
      carouselSeen = entry.isIntersecting;
      syncVideos();
    }, { threshold: 0.5 }).observe(scroller);
    document.addEventListener("visibilitychange", syncVideos);
    lightbox?.addEventListener("close", syncVideos);
    let settle = 0;
    scroller.addEventListener("scroll", () => {
      cancelAnimationFrame(settle);
      settle = requestAnimationFrame(syncVideos);
    }, { passive: true });
  }

  function activateSlide(slide) {
    const zone = slideZone(slide);
    if (zone === "next" || zone === "prev") {
      goTo(slides.indexOf(slide));
    } else if (zone === "step-next" || zone === "step-prev") {
      goTo(stopBeside(zone === "step-next" ? 1 : -1));
    } else if (zone === "pause" || zone === "play") {
      toggleVideo(slide);
    } else if (zone === "demo") {
      openDemo(caseEl.dataset.case);
    } else {
      zoomSlide(slide);
    }
  }

  function zoomSlide(slide) {
    leaveCursor();
    slides.forEach((item) => videoOf(item)?.pause());
    const shown = slides.filter((item) => !item.hasAttribute("data-demo"));
    const follow = (current) => scroller.scrollTo({ left: restingScrollLeft(current), behavior: "instant" });
    openLightbox(shown, shown.indexOf(slide), follow, (last) => {
      if (slides[nearestIndex()] !== last) scroller.scrollTo({ left: restingScrollLeft(last), behavior: "auto" });
      last.focus({ preventScroll: true });
    });
  }

  // Read from the point, not the event: under pointer capture every move
  // targets the carousel, and a scroll changes the zone under a still pointer.
  function refreshCursor() {
    if (pointerX === null || !fineHover.matches) return;
    // The round cursor belongs to the picture, not to the caption under it.
    const over = document.elementFromPoint(pointerX, pointerY)?.closest(".placeholder")?.closest(".slide");
    const slide = slides.includes(over) && !(dragging && moved) ? over : null;
    scroller.classList.toggle("has-cursor-label", !!slide);
    if (slide) showCursorLabel(CURSOR_TEXT[slideZone(slide).replace("step-", "")], pointerX, pointerY);
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
      left: restingScrollLeft(slide),
      behavior: motionOk ? "smooth" : "auto",
    });
  }

  layoutStops();
  new ResizeObserver(layoutStops).observe(scroller);

  scroller.addEventListener("scroll", syncDots, { passive: true });

  dots.forEach((dot, index) => {
    dot.addEventListener("click", () => goTo(index));
  });

  scroller.addEventListener("keydown", (event) => {
    // On a video slide the keyboard has no edges to aim at: Enter opens it large
    // like any screen, Space pauses and plays it.
    if (event.key === "Enter" && slides.includes(event.target)) {
      event.preventDefault();
      const zone = slideZone(event.target);
      if (videoOf(event.target) && zone !== "next" && zone !== "prev") zoomSlide(event.target);
      else activateSlide(event.target);
      return;
    }
    if (event.key === " " && slides.includes(event.target) && videoOf(event.target)) {
      event.preventDefault();
      toggleVideo(event.target);
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

// "Open live preview" opens the demo wherever its slide is, even half in view. Under
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
  link.style.setProperty("--n", index);
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

// Section paging (POR-50). With a mouse wheel or a trackpad one scroll takes you
// a whole screen: hero → each case → Experience → Contact, and back. A section
// only a little taller than the window (a case on a laptop) pages in two steps,
// its top and then its bottom. A long one (Experience) scrolls freely inside and
// pages on from its end. Keyboard, scrollbar, touch and anchor links are left
// alone, and so is anything open on top of the page.
(() => {
  const pagingMedia = window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 1081px)");
  const sections = [...document.querySelectorAll(".hero, .case, .about, .site-footer")];
  if (embedded || sections.length < 2) return;

  const PAGE_MS = 650;
  const FREE_FROM = 1.5; // a section taller than this many windows scrolls freely
  let run = 0;           // the running page animation
  let coasting = false;  // a trackpad's inertia after a page is not a new scroll
  let lastTime = 0;
  let lastSize = 0;

  const maxScroll = () => root.scrollHeight - innerHeight;
  const topOf = (el) => Math.min(Math.round(el.getBoundingClientRect().top + scrollY), maxScroll());

  function pageTo(top) {
    cancelAnimationFrame(run);
    const from = scrollY;
    const distance = top - from;
    if (Math.abs(distance) < 1) return;
    if (motionMedia.matches) {
      window.scrollTo({ top, behavior: "instant" });
      coasting = true;
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / PAGE_MS);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      window.scrollTo({ top: from + distance * eased, behavior: "instant" });
      if (t < 1) run = requestAnimationFrame(step);
      else {
        run = 0;
        coasting = true;
      }
    };
    run = requestAnimationFrame(step);
  }

  window.addEventListener("wheel", (event) => {
    if (!pagingMedia.matches || event.ctrlKey || event.defaultPrevented) return;
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || !event.deltaY) return;
    if (root.classList.contains("is-demo-open") || document.querySelector("dialog[open], .site-header.is-menu-open")) return;

    const now = performance.now();
    const size = Math.abs(event.deltaY);
    const sameGesture = now - lastTime < 140 && size <= lastSize * 1.3;
    lastTime = now;
    lastSize = size;

    if (run) {
      event.preventDefault();
      return;
    }
    if (coasting) {
      if (sameGesture) {
        event.preventDefault();
        return;
      }
      coasting = false;
    }

    const y = scrollY;
    const view = innerHeight;
    const tops = sections.map(topOf);
    let index = 0;
    tops.forEach((top, i) => {
      if (top <= y + 1) index = i;
    });
    const top = tops[index];
    const end = index + 1 < tops.length ? tops[index + 1] : root.scrollHeight;
    const free = end - top > view * FREE_FROM;
    const down = event.deltaY > 0;

    if (down) {
      const below = end - (y + view);  // of this section, still under the window
      if (below > 1) {
        if (!free) {
          event.preventDefault();
          pageTo(end - view);
        } else if (size >= below) {
          // Stop at the section's end; the next scroll pages on.
          event.preventDefault();
          window.scrollTo({ top: end - view, behavior: "instant" });
          coasting = true;
        }
        return;
      }
      if (index + 1 >= tops.length) return;
      event.preventDefault();
      pageTo(tops[index + 1]);
    } else {
      const above = y - top;           // of this section, already over the window
      if (above > 1) {
        if (!free) {
          event.preventDefault();
          pageTo(top);
        } else if (size >= above) {
          event.preventDefault();
          window.scrollTo({ top, behavior: "instant" });
          coasting = true;
        }
        return;
      }
      if (index === 0) return;
      event.preventDefault();
      // Back into a taller section you arrive at its end, where you left it.
      const prevTop = tops[index - 1];
      pageTo(top - prevTop > view + 1 ? top - view : prevTop);
    }
  }, { passive: false });
})();
