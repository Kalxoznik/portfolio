// Layout check: opens index.html in headless Chromium at 1920x1080 (dark theme)
// and compares measured positions with the Figma "dark" page
// (file JtEfXEmJLKl2HL0BHe0Jie, page 31:5). Exits 1 if any check fails.
//
// Positions are page coordinates (rect + scrollY). Rows marked "text" use the
// top of the content box (rect.top + border-top + padding-top), since Figma
// places the text box, not the element's padding.

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOLERANCE = 3;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
};

function startServer() {
  const server = http.createServer(async (req, res) => {
    let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = path.join(ROOT, pathname);
    if (!file.startsWith(ROOT + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright is not installed. Run: npm install && npx playwright install chromium");
  process.exit(1);
}

// Measured in the page. `box` is the outer border box, `text` the content box.
function measure() {
  const one = (name, index = 0) => {
    const el = document.querySelectorAll(`[data-check="${name}"]`)[index];
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const top = rect.top + window.scrollY;
    return {
      top,
      left: rect.left + window.scrollX,
      height: rect.height,
      textTop: top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop),
      textLeft: rect.left + window.scrollX + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft),
    };
  };
  const fontLoaded = (family, weight) =>
    [...document.fonts].some(
      (f) => f.family.replace(/["']/g, "") === family && String(f.weight) === weight && f.status === "loaded"
    );
  // Cap height of the logo: ink ascent of "M" in the logo's computed font.
  const logoCapHeight = (() => {
    const el = document.querySelector('[data-check="logo"]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return ctx.measureText("M").actualBoundingBoxAscent;
  })();
  return {
    header: one("header"),
    logoCapHeight,
    logo: one("logo"),
    nav: one("nav-first"),
    heroTitle: one("hero-title"),
    heroLead: one("hero-lead"),
    case1Title: one("case-title", 0),
    case1Meta: one("case-meta", 0),
    case1Summary: one("case-summary", 0),
    case1Carousel: one("case-carousel", 0),
    case1Dots: one("case-dots", 0),
    case2Title: one("case-title", 1),
    about: one("about"),
    aboutTitle: one("about-title"),
    timelineDate: one("timeline-date"),
    footer: one("footer"),
    contactLabel: one("contact-label"),
    contactEmail: one("contact-email"),
    theme: document.documentElement.getAttribute("data-theme"),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    unbounded700: fontLoaded("Unbounded", "700"),
    inter400: fontLoaded("Inter", "400"),
    scrollY: window.scrollY,
  };
}

function overflowX() {
  return document.documentElement.scrollWidth - document.documentElement.clientWidth;
}

const rows = [];
let failed = 0;

const fmt = (n) => (n == null || !Number.isFinite(n) ? "missing" : String(Math.round(n * 100) / 100));

// `expected` is null when it is relative to an element that is missing.
function num(name, expected, actual, tolerance = TOLERANCE) {
  const ok = expected != null && actual != null && Math.abs(actual - expected) <= tolerance;
  if (!ok) failed++;
  rows.push([name, fmt(expected), fmt(actual), ok ? "OK" : "FAIL"]);
}

function flag(name, expected, actual, ok) {
  if (!ok) failed++;
  rows.push([name, String(expected), String(actual), ok ? "OK" : "FAIL"]);
}

const server = await startServer();
const url = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await chromium.launch();

try {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "load" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });

  // Experience timeline: each item's line touches the rings with no gap, as in
  // Figma (POR-15). Line and ring are ::before boxes: the item's or mark's rect
  // plus the pseudo's computed top, left, width and height.
  async function timelineChecks(width) {
    const items = await page.evaluate(() =>
      [...document.querySelectorAll(".timeline-item")].map((item) => {
        const mark = item.querySelector(".timeline-mark");
        const line = getComputedStyle(item, "::before");
        const ring = getComputedStyle(mark, "::before");
        const ir = item.getBoundingClientRect();
        const mr = mark.getBoundingClientRect();
        const hasLine = line.content !== "none" && line.content !== "normal";
        const ringTop = mr.top + parseFloat(ring.top);
        return {
          current: item.classList.contains("is-current"),
          hasLine,
          lineTop: ir.top + parseFloat(line.top),
          lineBottom: ir.top + parseFloat(line.top) + parseFloat(line.height),
          lineCenter: ir.left + parseFloat(line.left) + parseFloat(line.width) / 2,
          lineBg: line.backgroundImage,
          ringTop,
          ringBottom: ringTop + parseFloat(ring.height),
          ringCenter: mr.left + parseFloat(ring.left) + parseFloat(ring.width) / 2,
        };
      })
    );
    flag(`timeline items found @${width}`, "≥ 2", items.length, items.length >= 2);
    items.forEach((it, i) => {
      if (!it.hasLine) return;
      const next = items[i + 1];
      const n = i + 1;
      if (next) {
        flag(`timeline ${n}: line bottom ≥ next ring top @${width}`, `≥ ${fmt(next.ringTop)}`, fmt(it.lineBottom), it.lineBottom >= next.ringTop);
      }
      flag(`timeline ${n}: line top ≤ own ring bottom @${width}`, `≤ ${fmt(it.ringBottom)}`, fmt(it.lineTop), it.lineTop <= it.ringBottom);
      num(`timeline ${n}: line centre x = ring centre @${width}`, it.ringCenter, it.lineCenter, 0.25);
      if (it.current) {
        const ends = /rgb\(169, 157, 122\)\)$/.test(it.lineBg);
        flag(`timeline ${n}: current gradient ends in ring colour @${width}`, "rgb(169, 157, 122)", it.lineBg, ends);
      }
    });
  }

  // Case head (POR-32), first case. The picture is at 1.724 px per CSS px (its
  // 32px dot grid is 55.18 px): meta 18px under the title box, text 13px under
  // the meta row, pairs 24px apart, dt 7px before its dd. Line ends are read
  // from a Range per word.
  async function caseHeadChecks(width) {
    const c = await page.evaluate(() => {
      const head = document.querySelector(".case-head");
      const rect = (el) => el.getBoundingClientRect();
      const title = rect(head.querySelector("h3"));
      const meta = rect(head.querySelector(".case-meta"));
      const p = head.querySelector(".case-summary");
      const text = rect(p);
      const pairs = [...head.querySelectorAll(".case-meta div")].map((d) => {
        const dt = rect(d.querySelector("dt"));
        const dd = rect(d.querySelector("dd"));
        return { dt, dd, box: rect(d), name: d.querySelector("dt").textContent };
      });
      const node = p.firstChild;
      const range = document.createRange();
      const lineEnds = [];
      let lastTop = null;
      let lastWord = null;
      for (const match of node.data.matchAll(/\S+/g)) {
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const top = range.getBoundingClientRect().top;
        if (lastTop != null && top > lastTop + 1) lineEnds.push(lastWord);
        lastTop = top;
        lastWord = match[0];
      }
      lineEnds.push(lastWord);
      return {
        titleBottom: title.bottom,
        metaTop: meta.top,
        metaBottom: meta.bottom,
        textTop: text.top,
        pairs,
        lineEnds,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    const pairs = c.pairs;
    flag(`case meta pairs found @${width}`, "3", pairs.length, pairs.length === 3);
    if (width === 1920) {
      const tops = pairs.map((q) => fmt(q.box.top));
      flag("case meta: three pairs in one row", "one top", tops.join(" / "), new Set(tops).size === 1);
      num("case meta top = title bottom + 18", c.titleBottom + 18, c.metaTop, 0.5);
      num("case text top = meta bottom + 13", c.metaBottom + 13, c.textTop, 0.5);
      for (let i = 1; i < pairs.length; i++) {
        num(`case meta: pair ${i}→${i + 1} gap`, 24, pairs[i].box.left - pairs[i - 1].box.right, 0.5);
      }
      num("case meta: ROLE dt→dd gap", 7, pairs[0].dd.left - pairs[0].dt.right, 0.5);
      const ends = c.lineEnds.join(" | ");
      flag("case text: 3 lines, breaks after \"turns\" and \"and\"", "turns | and | place.", ends, ends === "turns | and | place.");
    }
    const sameLine = pairs.every((q) => Math.abs(q.dt.bottom - q.dd.bottom) <= 2 && q.dd.left >= q.dt.right && q.dt.height <= 17 && q.dd.height <= 18);
    flag(`case meta: each dt on one line with its dd @${width}`, "yes", sameLine ? "yes" : "no", sameLine);
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const overlaps = pairs.filter((q, i) => pairs.some((o, j) => j > i && hit(q.box, o.box))).length;
    flag(`case meta: pairs do not overlap @${width}`, "0", overlaps, overlaps === 0);
    flag(`case meta above text @${width}`, `≤ ${fmt(c.textTop)}`, fmt(c.metaBottom), c.metaBottom <= c.textTop);
    flag(`no horizontal scroll, case head @${width}`, "0", c.overflow, c.overflow <= 0);
  }

  const m = await page.evaluate(measure);
  const v =(box, key) => (box ? box[key] : null);
  const plus = (box, key, add) => (box ? box[key] + add : null);

  flag("theme: html[data-theme]", "dark", m.theme, m.theme === "dark");
  flag("font: Unbounded 700 loaded", "yes", m.unbounded700 ? "yes" : "no", m.unbounded700);
  flag("font: Inter 400 loaded", "yes", m.inter400 ? "yes" : "no", m.inter400);
  flag("scrolled to top (scrollY)", "0", m.scrollY, m.scrollY === 0);
  flag("body background", "rgb(22, 21, 20)", m.bodyBg, m.bodyBg === "rgb(22, 21, 20)");

  // +6: the header row sits 6px below Figma, as Max Shakurov asked (POR-9).
  // Figma: header 118, logo 48, nav 52.
  num("header height", 118, v(m.header, "height"));
  num("logo MAXSHAKUROV top (text)", 54, v(m.logo, "textTop"));
  // 19.5: Max Shakurov's Photoshop overlay is at 2x and the Figma logo M there is 39 px.
  num("logo cap height (M ink)", 19.5, m.logoCapHeight, 0.5);
  // 59: the nav line went from 22 to 20 (16px text, POR-26) and the row is
  // centred, so the text box starts 1px lower than Figma's 52 + 6.
  num("nav text top (text)", 59, v(m.nav, "textTop"));
  num("nav left x (text)", 77, v(m.nav, "textLeft"));
  num("hero title top (text)", 364, v(m.heroTitle, "textTop"));
  num("hero subline top (text)", 633, v(m.heroLead, "textTop"));
  num("case 1 title top (text)", 1198, v(m.case1Title, "textTop"));
  // The case head of Max Shakurov's picture (POR-32): title, a row of meta
  // pairs, then the text. The carousel keeps its 24px under the text, so the
  // dots and case 2 moved down by the meta row.
  num("case 1 carousel top = summary bottom + 24", m.case1Summary ? m.case1Summary.top + m.case1Summary.height + 24 : null, v(m.case1Carousel, "top"));
  num("case 1 dots top (POR-32)", 2141, v(m.case1Dots, "top"));
  num("case 2 title top (text, POR-32)", 2315, v(m.case2Title, "textTop"));
  num("Experience H2 top = about + 118 (text)", plus(m.about, "top", 118), v(m.aboutTitle, "textTop"));
  num("first timeline date = H2 + 100 (text)", plus(m.aboutTitle, "textTop", 100), v(m.timelineDate, "textTop"));
  num("footer height", 1080, v(m.footer, "height"));
  num("MESSAGE ME = footer + 464 (text)", plus(m.footer, "top", 464), v(m.contactLabel, "textTop"));
  num("email = footer + 508 (text)", plus(m.footer, "top", 508), v(m.contactEmail, "textTop"));

  const over1920 = await page.evaluate(overflowX);
  flag("no horizontal scroll @1920", "0", over1920, over1920 <= 0);
  await timelineChecks(1920);
  await caseHeadChecks(1920);

  // Experience links: the arrow never wraps away from the link's last word
  // (POR-19). Each paragraph is narrowed from its 1920 width to 240 in 1px
  // steps; at every width the arrow must be on the line of the link's last
  // character (a Range rect) and 3px after it. Transitions are off during the
  // sweep: reduced motion gives every property a 0.01ms transition, which
  // would keep the old width until the next frame.
  const arrowWraps = await page.evaluate(() =>
    [...document.querySelectorAll(".timeline-text")]
      .filter((p) => p.querySelector(".text-link-arrow"))
      .map((p) => {
        const link = p.querySelector(".text-link");
        const arrow = link.querySelector(".text-link-arrow");
        const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
        let last = null;
        while (walker.nextNode()) if (walker.currentNode.data.trim()) last = walker.currentNode;
        const end = last.data.trimEnd().length;
        const range = document.createRange();
        range.setStart(last, end - 1);
        range.setEnd(last, end);
        // The character after the link (a comma) must stay on the arrow's line
        // too. A word joiner before it is skipped; a space may wrap, so no check.
        let after = null;
        const next = link.nextSibling;
        if (next && next.nodeType === Node.TEXT_NODE) {
          const i = next.data.search(/[^⁠]/);
          if (i >= 0 && !/\s/.test(next.data[i])) {
            after = document.createRange();
            after.setStart(next, i);
            after.setEnd(next, i + 1);
          }
        }
        const full = Math.floor(p.getBoundingClientRect().width);
        const bad = [];
        const badAfter = [];
        p.style.transition = "none";
        for (let w = full; w >= 240; w--) {
          p.style.width = `${w}px`;
          const ch = range.getBoundingClientRect();
          const ar = arrow.getBoundingClientRect();
          const mid = (ar.top + ar.bottom) / 2;
          const sameLine = mid > ch.top && mid < ch.bottom;
          const gap = ar.left - ch.right;
          if (!sameLine || Math.abs(gap - 3) > 0.5) bad.push(w);
          if (after) {
            const nx = after.getBoundingClientRect();
            if (!(mid > nx.top && mid < nx.bottom)) badAfter.push(w);
          }
        }
        p.style.width = "";
        p.style.transition = "";
        return { name: link.textContent.trim(), full, bad, after: after && after.toString(), badAfter };
      })
  );
  flag("experience links with an arrow", "3", arrowWraps.length, arrowWraps.length === 3);
  for (const a of arrowWraps) {
    const shown = a.bad.length ? `${a.bad.length} (${a.bad.slice(0, 3).join(", ")}…)` : "0";
    flag(`"${a.name}" arrow on last char's line, 3px after, widths ${a.full}→240`, "0 failing", shown, a.bad.length === 0);
    if (a.after) {
      const shownAfter = a.badAfter.length ? `${a.badAfter.length} (${a.badAfter.slice(0, 3).join(", ")}…)` : "0";
      flag(`"${a.name}" "${a.after}" after the link on the arrow's line, widths ${a.full}→240`, "0 failing", shownAfter, a.badAfter.length === 0);
    }
  }
  // Link hover (POR-24): at rest no link shows an underline, neither the
  // drawn-in line (label background width 0) nor text-decoration. The logo
  // rolls too (11 letters); the big email is left whole, it copies on click.
  const linkRest = await page.evaluate(() => {
    const links = [...document.querySelectorAll("a:not(.skip-link)")];
    const underlined = links.filter((a) => {
      const label = a.querySelector(".link-label");
      const width = label ? getComputedStyle(label).backgroundSize.split(" ")[0] : "0px";
      const decorated = [a, ...a.querySelectorAll("*")].some((el) => getComputedStyle(el).textDecorationLine !== "none");
      return !/^0(px|%)?$/.test(width) || decorated;
    });
    const logo = document.querySelector('[data-check="logo"]');
    return {
      underlined: underlined.map((a) => a.textContent.trim()),
      logoChars: logo.querySelectorAll(".roll-char").length,
      emailSplit: document.querySelectorAll('[data-check="contact-email"] :is(.roll-char, .link-label)').length,
    };
  });
  flag("links at rest: underlined", "0", linkRest.underlined.length ? linkRest.underlined.join(", ") : "0", linkRest.underlined.length === 0);
  flag("logo: rolling letters", "11", linkRest.logoChars, linkRest.logoChars === 11);
  flag("email: rolling letters", "0", linkRest.emailSplit, linkRest.emailSplit === 0);
  // Hovered below the top of the page, where the logo is not current (so not
  // accent at rest): its letters roll but no line is drawn, and it takes the
  // accent. The email instead dims to --text-secondary. Wait for the
  // transitions: the last logo letter starts 180ms late (reduced motion cuts
  // only the duration). Reads frame by frame for up to 2s until all land; on
  // timeout the rows fail and show what was found.
  async function hoverColor(selector, labelSelector, colorVar, glyphSelector, glyphWant) {
    await page.hover(selector);
    const result = await page.evaluate(async ([sel, labelSel, cv, glyphSel, gw]) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${cv})`;
      document.body.append(probe);
      const want = getComputedStyle(probe).color;
      probe.remove();
      const end = performance.now() + 2000;
      for (;;) {
        const color = getComputedStyle(document.querySelector(sel)).color;
        const label = labelSel && document.querySelector(labelSel);
        const image = label ? getComputedStyle(label).backgroundImage : null;
        const glyph = glyphSel && document.querySelector(glyphSel);
        const transform = glyph ? getComputedStyle(glyph).transform : null;
        if ((color === want && (!gw || transform === gw)) || performance.now() > end) return { want, color, image, transform };
        await new Promise((r) => requestAnimationFrame(r));
      }
    }, [selector, labelSelector, colorVar, glyphSelector, glyphWant]);
    await page.mouse.move(0, 0);
    return result;
  }
  await page.evaluate(() => window.scrollTo({ top: 1080, behavior: "instant" }));
  const rolled = "matrix(1, 0, 0, 1, 0, -30)";
  const logoHover = await hoverColor(".wordmark", ".wordmark .link-label", "--accent", ".wordmark .roll-char:last-of-type > span", rolled);
  flag("hovered logo: no line", "none", logoHover.image, logoHover.image === "none");
  flag("hovered logo: letters rolled", rolled, logoHover.transform, logoHover.transform === rolled);
  flag("hovered logo: colour = accent", logoHover.want, logoHover.color, logoHover.color === logoHover.want);
  const emailHover = await hoverColor(".contact-email", null, "--text-secondary");
  flag("hovered email: colour = text-secondary", emailHover.want, emailHover.color, emailHover.color === emailHover.want);
  // A click on the email is cancelled (no mail app) and the line under it
  // turns "Copied ✓".
  // The copy is async, so the line is read frame by frame for up to 2s.
  const emailClick = await page.evaluate(async () => {
    const link = document.querySelector(".contact-email");
    const line = document.querySelector(".copy-email");
    const notCancelled = link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const end = performance.now() + 2000;
    while (line.textContent !== "Copied ✓" && performance.now() < end) {
      await new Promise((r) => requestAnimationFrame(r));
    }
    return { notCancelled, label: line.textContent };
  });
  flag("email click: default prevented", "false", emailClick.notCancelled, emailClick.notCancelled === false);
  flag("email click: line under it", "Copied ✓", emailClick.label, emailClick.label === "Copied ✓");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  // Hovered, the Experience link's line stops short of its arrow (12px + 3px).
  // Wait for the (reduced-motion) transition to land, as for the stroke below.
  await page.hover(".timeline-text .text-link");
  await page
    .waitForFunction(
      () => getComputedStyle(document.querySelector(".timeline-text .link-label")).backgroundSize.startsWith("calc"),
      null,
      { polling: "raf", timeout: 2000 }
    )
    .catch((e) => {
      if (e.name !== "TimeoutError") throw e;
    });
  const hoverLine = await page.evaluate(() =>
    getComputedStyle(document.querySelector(".timeline-text .link-label")).backgroundSize
  );
  flag("hovered experience link: line width", "calc(100% - 15px) …", hoverLine, hoverLine.startsWith("calc(100% - 15px) "));
  await page.mouse.move(0, 0);
  // Hovered, the arrow takes the accent colour with the text. :hover is on
  // as soon as page.hover returns, but the (reduced-motion, 0.01ms) colour
  // transition still takes about 3 frames, 33ms idle and up to 46ms with four
  // checks at once (POR-23), so a fixed 50ms wait failed now and then. Wait
  // for the colour itself, frame by frame, for up to 2s; on timeout the row
  // fails and shows the stroke it found.
  await page.hover(".timeline-text .text-link");
  await page
    .waitForFunction(
      () => {
        const probe = document.createElement("span");
        probe.style.color = "var(--accent)";
        document.body.append(probe);
        const accent = getComputedStyle(probe).color;
        probe.remove();
        const path = document.querySelector(".timeline-text .text-link-arrow path");
        return getComputedStyle(path).stroke === accent;
      },
      null,
      { polling: "raf", timeout: 2000 }
    )
    .catch((e) => {
      if (e.name !== "TimeoutError") throw e;
    });
  const hoverStroke = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    const path = document.querySelector(".timeline-text .text-link-arrow path");
    return { accent, stroke: getComputedStyle(path).stroke };
  });
  flag("hovered link: arrow stroke = accent", hoverStroke.accent, hoverStroke.stroke, hoverStroke.stroke === hoverStroke.accent);
  await page.mouse.move(0, 0);

  // The header is transparent until the hero title's top reaches its bottom,
  // then fills with the plain background, no dots, at once (POR-13). Read two
  // frames after the scroll: a fade would still be on its way there.
  const CLEAR = "rgba(0, 0, 0, 0) / none";
  const SOLID = "rgb(22, 21, 20) / none";
  async function headerBgAt(y) {
    return page.evaluate(async (y) => {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const cs = getComputedStyle(document.querySelector('[data-check="header"]'));
      return `${cs.backgroundColor} / ${cs.backgroundImage}`;
    }, y);
  }
  const top0Bg = await headerBgAt(0);
  flag("header transparent at scrollY 0", CLEAR, top0Bg, top0Bg === CLEAR);
  const solidAt = m.heroTitle && m.header ? Math.round(m.heroTitle.top - (m.header.top + m.header.height)) : null;
  if (solidAt == null) {
    flag("header fill threshold (title top − header bottom)", "measured", "missing", false);
  } else {
    const beforeBg = await headerBgAt(solidAt - 4);
    flag(`header transparent 4px before fill (scrollY ${solidAt - 4})`, CLEAR, beforeBg, beforeBg === CLEAR);
    const afterBg = await headerBgAt(solidAt + 4);
    flag(`header filled 4px after fill (scrollY ${solidAt + 4})`, SOLID, afterBg, afterBg === SOLID);
    // The check runs reduced-motion, which cuts every transition anyway, so
    // prove there is no fade with motion on: no in-between colour either way.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await headerBgAt(0);
    const instantOn = await headerBgAt(solidAt + 4);
    flag("motion on: header filled on the next frame", SOLID, instantOn, instantOn === SOLID);
    const instantOff = await headerBgAt(0);
    flag("motion on: header clear on the next frame", CLEAR, instantOff, instantOff === CLEAR);
    await page.emulateMedia({ reducedMotion: "reduce" });
  }

  // Theme switch with motion on: the new theme grows as a circle from the
  // toggle's centre (clip-path on ::view-transition-new(root)), then the page
  // is in the new theme with nothing left over. Reduced motion: at once.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const circle = await page.evaluate(async () => {
    const root = document.documentElement;
    const toggle = document.querySelector(".theme-toggle");
    const b = toggle.getBoundingClientRect();
    toggle.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const anim = document.getAnimations().find((a) => a.effect?.pseudoElement === "::view-transition-new(root)");
    const frames = anim ? anim.effect.getKeyframes().map((k) => k.clipPath) : [];
    const midBg = getComputedStyle(document.body).backgroundColor;
    await anim?.finished;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return {
      centre: `${b.left + b.width / 2}px ${b.top + b.height / 2}px`,
      from: frames[0] || "missing",
      to: frames[frames.length - 1] || "missing",
      duration: anim ? anim.effect.getTiming().duration : null,
      midBg,
      theme: root.getAttribute("data-theme"),
      leftover: root.classList.contains("is-theme-switching"),
    };
  });
  flag("motion on: circle starts at the toggle centre", `circle(0px at ${circle.centre})`, circle.from, circle.from === `circle(0px at ${circle.centre})`);
  flag("motion on: circle ends at the toggle centre", `… at ${circle.centre})`, circle.to, circle.to.endsWith(`at ${circle.centre})`) && circle.to !== circle.from);
  flag("motion on: circle runs 700ms", "700", fmt(circle.duration), circle.duration === 700);
  flag("motion on: new theme has no colour fade", "rgb(255, 248, 227)", circle.midBg, circle.midBg === "rgb(255, 248, 227)");
  flag("motion on: light theme after the circle", "light / clean", `${circle.theme} / ${circle.leftover ? "class left" : "clean"}`, circle.theme === "light" && !circle.leftover);
  // A second click while the circle grows: the browser skips the first
  // transition, and its end must not lift the no-fade class from the second.
  const twice = await page.evaluate(async () => {
    const root = document.documentElement;
    const toggle = document.querySelector(".theme-toggle");
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    toggle.click();
    await frames();
    toggle.click();
    await frames();
    // The skipped transition's circle keeps running and comes first; the
    // live one started a couple of frames later, so wait for the last.
    const circles = document.getAnimations().filter((a) => a.effect?.pseudoElement === "::view-transition-new(root)");
    const anim = circles.at(-1);
    const midBg = getComputedStyle(document.body).backgroundColor;
    await anim?.finished;
    await frames();
    return { midBg, theme: root.getAttribute("data-theme"), leftover: root.classList.contains("is-theme-switching") };
  });
  flag("motion on: second click mid-circle has no colour fade", "rgb(255, 248, 227)", twice.midBg, twice.midBg === "rgb(255, 248, 227)");
  flag("motion on: second click ends light and clean", "light / clean", `${twice.theme} / ${twice.leftover ? "class left" : "clean"}`, twice.theme === "light" && !twice.leftover);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const back = await page.evaluate(async () => {
    document.querySelector(".theme-toggle").click();
    const vt = document.getAnimations().some((a) => a.effect?.pseudoElement?.startsWith("::view-transition"));
    return `${document.documentElement.getAttribute("data-theme")} / ${vt ? "transition" : "instant"}`;
  });
  flag("reduced motion: theme switches at once", "dark / instant", back, back === "dark / instant");

  // Scrolled to the first case: the sticky header has not moved, the row is
  // still 6px below Figma. Viewport coordinates (page position minus scrollY).
  await page.evaluate(async () => {
    window.scrollTo(0, 1080);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const s = await page.evaluate(measure);
  const vp = (box, key) => (box ? box[key] - s.scrollY : null);
  flag("scrolled to first case (scrollY)", "1080", s.scrollY, s.scrollY === 1080);
  num("scrolled: header bottom (viewport)", 118, s.header ? s.header.top + s.header.height - s.scrollY : null);
  num("scrolled: logo top (text, viewport)", 54, vp(s.logo, "textTop"));
  num("scrolled: nav text top (text, viewport)", 59, vp(s.nav, "textTop"));
  const caseBg = await headerBgAt(1080);
  flag("header filled at first case (scrollY 1080)", SOLID, caseBg, caseBg === SOLID);
  const backBg = await headerBgAt(0);
  flag("header transparent again back at top", CLEAR, backBg, backBg === CLEAR);

  // The 16px nav row stays centred on the logo and the theme toggle (POR-26),
  // at the top of the page and scrolled alike.
  async function rowCentres(y) {
    return page.evaluate(async (y) => {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const mid = (sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return (r.top + r.bottom) / 2;
      };
      const nav = mid('[data-check="nav-first"]');
      return Math.max(Math.abs(nav - mid('[data-check="logo"]')), Math.abs(nav - mid(".theme-toggle")));
    }, y);
  }
  for (const y of [0, 1080]) {
    const off = await rowCentres(y);
    flag(`nav row centre = logo and toggle centres (scrollY ${y})`, "±1", fmt(off), off <= 1);
  }

  // Contact scrolls to the footer, the last screen with the email: footer top
  // at the top of the window, the email whole in it, the menu closed, and
  // Contact (not About Me) current there (POR-26). Scrolling is read frame by
  // frame until it stops, for up to 2s.
  async function contactClick(width, viaMenu) {
    if (viaMenu) await page.click('[data-check="menu-toggle"]');
    await page.click('.nav a[data-nav="contact"]');
    const r = await page.evaluate(async () => {
      let last = -1;
      const end = performance.now() + 2000;
      while (window.scrollY !== last && performance.now() < end) {
        last = window.scrollY;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }
      const footer = document.querySelector('[data-check="footer"]').getBoundingClientRect();
      const email = document.querySelector('[data-check="contact-email"]').getBoundingClientRect();
      const W = document.documentElement.clientWidth;
      const current = (key) => document.querySelector(`.nav a[data-nav="${key}"]`).getAttribute("aria-current") === "true";
      return {
        footerTop: footer.top,
        emailInside: email.top >= 0 && email.bottom <= window.innerHeight && email.left >= 0 && email.right <= W,
        email: [email.left, email.top, email.right, email.bottom].map(Math.round).join(", "),
        menuOpen: document.querySelector('[data-check="header"]').classList.contains("is-menu-open"),
        contact: current("contact"),
        about: current("about"),
      };
    });
    num(`Contact click: footer top (viewport) @${width}`, 0, r.footerTop, 1);
    flag(`Contact click: email whole in the window @${width}`, "inside", r.email, r.emailInside);
    flag(`Contact click: menu closed @${width}`, "closed", r.menuOpen ? "open" : "closed", !r.menuOpen);
    flag(`Contact click: Contact current, About Me not @${width}`, "contact / -", `${r.contact ? "contact" : "-"} / ${r.about ? "about" : "-"}`, r.contact && !r.about);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  }
  await contactClick(1920, false);

  // Under 1400 the nav folds into a MENU button, which must clear the centred
  // logo by the 26px nav gap; from 1400 the full nav row clears it (POR-12;
  // 1400 since Contact made the row longer, POR-26).
  // Edges: the logo's text via a Range, the button's or nav's border box.
  // Scrolled to the work section, so "Recent Work" is bold, its widest state;
  // 300ms lets the nav's visibility transition finish after the resize.
  async function headerGap(width, height = 900) {
    await page.setViewportSize({ width, height });
    return page.evaluate(async () => {
      window.scrollTo(0, document.getElementById("work").offsetTop);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 300));
      const button = document.querySelector('[data-check="menu-toggle"]');
      const nav = document.querySelector('[data-check="nav"]');
      const logo = document.querySelector('[data-check="logo"]');
      const range = document.createRange();
      range.selectNodeContents(logo);
      const menu = getComputedStyle(button).display !== "none";
      const left = menu ? button : nav;
      const logoText = range.getBoundingClientRect();
      const logoCs = getComputedStyle(logo);
      const buttonRect = button.getBoundingClientRect();
      const logoRect = logo.getBoundingClientRect();
      const toggleRect = document.querySelector(".theme-toggle").getBoundingClientRect();
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.font = `${logoCs.fontWeight} ${logoCs.fontSize} ${logoCs.fontFamily}`;
      return {
        menu,
        navVisible: getComputedStyle(nav).visibility === "visible",
        gap: logoText.left - left.getBoundingClientRect().right,
        // Viewport coordinates, the header being sticky.
        headerHeight: document.querySelector('[data-check="header"]').getBoundingClientRect().height,
        logoTop: logo.getBoundingClientRect().top + parseFloat(logoCs.borderTopWidth) + parseFloat(logoCs.paddingTop),
        buttonTop: buttonRect.top,
        logoCapHeight: ctx.measureText("M").actualBoundingBoxAscent,
        logoCenter: (logoText.left + logoText.right) / 2,
        logoRight: logoText.right,
        halfWidth: document.documentElement.clientWidth / 2,
        toggleLeft: toggleRect.left,
        buttonMid: (buttonRect.top + buttonRect.bottom) / 2,
        logoMid: (logoRect.top + logoRect.bottom) / 2,
        toggleMid: (toggleRect.top + toggleRect.bottom) / 2,
        labelWidth: document.querySelector(".menu-label").getBoundingClientRect().width,
      };
    });
  }
  const menuShown = (g) => g.menu && !g.navVisible;
  for (const width of [1081, 1201, 1299, 1399, 1080, 721]) {
    const g = await headerGap(width);
    flag(`menu button shown, nav hidden @${width}`, "yes", menuShown(g) ? "yes" : "no", menuShown(g));
    flag(`menu→logo gap ≥ 26 @${width}`, "≥ 26", fmt(g.gap), g.gap >= 26);
    flag(`menu label hidden, width ≤ 1 @${width}`, "≤ 1", fmt(g.labelWidth), g.labelWidth <= 1);
    // Across 1080 the header must not jump: same row as at 1081.
    if (width === 1080) {
      num("header height @1080 (viewport)", 118, g.headerHeight);
      num("logo top @1080 (text, viewport)", 54, g.logoTop);
    }
    if (width === 721) {
      num("header height @721 (viewport)", 118, g.headerHeight);
      num("logo cap height @721 (M ink)", 19.5, g.logoCapHeight, 0.5);
    }
  }
  // ≤720: the same one row; the logo is 16px and centred on the screen, and
  // the button shows only its icon at every width (POR-16).
  for (const [width, height] of [[720, 900], [481, 900], [480, 900], [375, 812]]) {
    const g = await headerGap(width, height);
    flag(`menu button shown, nav hidden @${width}`, "yes", menuShown(g) ? "yes" : "no", menuShown(g));
    const offRow = Math.max(Math.abs(g.buttonMid - g.logoMid), Math.abs(g.toggleMid - g.logoMid));
    flag(`button, logo, toggle centres in one row @${width}`, "±1", fmt(offRow), offRow <= 1);
    num(`logo top @${width} (text, viewport)`, 54, g.logoTop);
    flag(`menu→logo gap ≥ 26 @${width}`, "≥ 26", fmt(g.gap), g.gap >= 26);
    flag(`menu label hidden, width ≤ 1 @${width}`, "≤ 1", fmt(g.labelWidth), g.labelWidth <= 1);
    if (width !== 720 && width !== 375) continue;
    num(`header height @${width} (viewport)`, 118, g.headerHeight);
    num(`logo cap height @${width} (M ink)`, 12, g.logoCapHeight, 0.5);
    num(`logo text centre = clientWidth / 2 @${width}`, g.halfWidth, g.logoCenter, 1);
    if (width === 375) {
      const toToggle = g.toggleLeft - g.logoRight;
      flag("logo→theme toggle gap ≥ 26 @375", "≥ 26", fmt(toToggle), toToggle >= 26);
    }
  }
  // Still 375: the panel opens below the button and stays on screen.
  const phoneMenu = await page.evaluate(async () => {
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const button = document.querySelector('[data-check="menu-toggle"]');
    const nav = document.querySelector('[data-check="nav"]');
    const state = () => `${button.getAttribute("aria-expanded")}/${getComputedStyle(nav).visibility}`;
    button.click();
    await frames();
    const opened = state();
    const panel = nav.getBoundingClientRect();
    const buttonBottom = button.getBoundingClientRect().bottom;
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await new Promise((r) => setTimeout(r, 300));
    return { opened, panelTop: panel.top, panelRight: panel.right, buttonBottom, overflow, closed: state() };
  });
  flag("menu opens on click @375", "true/visible", phoneMenu.opened, phoneMenu.opened === "true/visible");
  flag("panel top below button @375", `> ${fmt(phoneMenu.buttonBottom)}`, fmt(phoneMenu.panelTop), phoneMenu.panelTop > phoneMenu.buttonBottom);
  flag("panel right edge ≤ 375", "≤ 375", fmt(phoneMenu.panelRight), phoneMenu.panelRight <= 375);
  flag("no horizontal scroll, menu open @375", "0", phoneMenu.overflow, phoneMenu.overflow <= 0);
  flag("menu closes on Escape @375", "false/hidden", phoneMenu.closed, phoneMenu.closed === "false/hidden");
  await contactClick(375, true);
  await headerGap(1399);
  const menuStates = await page.evaluate(async () => {
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const button = document.querySelector('[data-check="menu-toggle"]');
    const nav = document.querySelector('[data-check="nav"]');
    const state = () => `${button.getAttribute("aria-expanded")}/${getComputedStyle(nav).visibility}`;
    button.click();
    await frames();
    const opened = state();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await new Promise((r) => setTimeout(r, 300));
    return { opened, closed: state() };
  });
  flag("menu opens on click @1399", "true/visible", menuStates.opened, menuStates.opened === "true/visible");
  flag("menu closes on Escape @1399", "false/hidden", menuStates.closed, menuStates.closed === "false/hidden");
  for (const width of [1440, 1400]) {
    const g = await headerGap(width);
    flag(`nav row shown, no menu button @${width}`, "yes", !g.menu && g.navVisible ? "yes" : "no", !g.menu && g.navVisible);
    flag(`nav→logo gap ≥ 26 @${width}`, "≥ 26", fmt(g.gap), g.gap >= 26);
  }
  // Resizing into the range must hide the nav at once, with no fade-out:
  // two frames after 1400 → 1399, no 300ms wait.
  await page.setViewportSize({ width: 1399, height: 900 });
  const resizedNav = await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return getComputedStyle(document.querySelector('[data-check="nav"]')).visibility;
  });
  flag("nav hidden at once on resize 1400→1399", "hidden", resizedNav, resizedNav === "hidden");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const over375 = await page.evaluate(overflowX);
  flag("no horizontal scroll @375", "0", over375, over375 <= 0);
  await timelineChecks(375);
  for (const width of [375, 720, 721, 1080, 1081, 1200, 1201, 1399, 1400]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await caseHeadChecks(width);
  }

  // Current item's halo (POR-25). Reduced motion: the still 6px shadow at 32%,
  // no ::after. Motion on: ::after grows from the 12px dot to 48px and fades,
  // forever; the shadow is gone. Frames are read by pausing the animation and
  // seeking it, so the numbers do not depend on when the read lands.
  const halo = () =>
    page.evaluate(async () => {
      const mark = document.querySelector(".timeline-item.is-current .timeline-mark");
      const dot = getComputedStyle(mark, "::before");
      const ring = getComputedStyle(mark, "::after");
      const anim = document
        .getAnimations()
        .find((a) => a.effect?.target === mark && a.effect?.pseudoElement === "::after");
      const frame = (t) => {
        anim.pause();
        anim.currentTime = t;
        const mr = mark.getBoundingClientRect();
        const scale = new DOMMatrix(ring.transform).a;
        const size = parseFloat(ring.width) * scale;
        const centre = mr.left + parseFloat(ring.left) + parseFloat(ring.width) / 2;
        return { size, opacity: parseFloat(ring.opacity), left: centre - size / 2, right: centre + size / 2 };
      };
      const timing = anim?.effect.getComputedTiming();
      const out = {
        shadow: dot.boxShadow,
        ringContent: ring.content,
        hasAnim: !!anim,
        iterations: timing?.iterations,
        duration: timing?.duration,
        easing: ring.animationTimingFunction,
        start: anim ? frame(0) : null,
        end: anim ? frame(timing.duration - 0.1) : null,
        clientWidth: document.documentElement.clientWidth,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
      anim?.play();
      return out;
    });
  const reduced = await halo();
  const stillShadow = /\b6px$|0px 0px 0px 6px/.test(reduced.shadow) && /0\.32\)/.test(reduced.shadow);
  flag("reduced motion: current dot shadow 6px at 32%", "… 0px 0px 0px 6px, accent / 0.32", reduced.shadow, stillShadow);
  flag("reduced motion: no halo ::after", "none", reduced.ringContent, reduced.ringContent === "none" && !reduced.hasAnim);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  for (const width of [375, 720, 721, 1080, 1081, 1200, 1201, 1399, 1400, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const h = await halo();
    if (width === 1920) {
      flag("motion on: halo ::after animates forever", "Infinity", String(h.iterations), h.iterations === Infinity);
      flag("motion on: halo runs 1.2s, ease-out", "1200 / cubic-bezier(0, 0, 0.2, 1)", `${fmt(h.duration)} / ${h.easing}`, h.duration === 1200 && h.easing === "cubic-bezier(0, 0, 0.2, 1)");
      flag("motion on: dot has no shadow", "none", h.shadow, h.shadow === "none");
      flag("motion on: halo first frame ≤ 12px", "≤ 12", fmt(h.start?.size), h.start != null && h.start.size <= 12.01);
      num("motion on: halo last frame size", 48, h.end?.size, 0.5);
      num("motion on: halo last frame opacity", 0, h.end?.opacity, 0.01);
    }
    const inside = h.end != null && h.end.left >= 0 && h.end.right <= h.clientWidth;
    flag(`motion on: halo at 48px inside the window @${width}`, `0 … ${h.clientWidth}`, h.end ? `${fmt(h.end.left)} … ${fmt(h.end.right)}` : "missing", inside);
    flag(`motion on: no horizontal scroll, halo at max @${width}`, "0", h.overflow, h.overflow <= 0);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });

  // CV links, icons and link previews (POR-30). https://DOMAIN/ is the
  // placeholder in the head; files under it are loaded from this server. The
  // CV PDF is not in cv/ yet, so only the links are checked, not the file.
  const head = await page.evaluate(async () => {
    const attr = (sel, name) => document.querySelector(sel)?.getAttribute(name) ?? "missing";
    const local = (href) => href.replace("https://DOMAIN/", "/");
    const status = async (href) => (href === "missing" ? "missing" : (await fetch(local(href))).status);
    const size = (href) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(`${img.naturalWidth}x${img.naturalHeight}`);
        img.onerror = () => resolve("missing");
        img.src = local(href);
      });
    const cv = (sel) => {
      const a = document.querySelector(sel);
      return a ? `${a.getAttribute("href")}${a.hasAttribute("download") ? " download" : ""}` : "missing";
    };
    const icon = attr('link[rel="icon"]', "href");
    const touch = attr('link[rel="apple-touch-icon"]', "href");
    const ogImage = attr('meta[property="og:image"]', "content");
    return {
      cvHeader: cv(".nav a[download]"),
      cvFooter: cv(".footer-cv"),
      iconType: attr('link[rel="icon"]', "type"),
      icon,
      iconStatus: await status(icon),
      touch,
      touchSize: await size(touch),
      canonical: attr('link[rel="canonical"]', "href"),
      description: attr('meta[name="description"]', "content"),
      ogType: attr('meta[property="og:type"]', "content"),
      ogUrl: attr('meta[property="og:url"]', "content"),
      ogTitle: attr('meta[property="og:title"]', "content"),
      ogDescription: attr('meta[property="og:description"]', "content"),
      ogImage,
      ogImageSize: await size(ogImage),
      ogImageWh: `${attr('meta[property="og:image:width"]', "content")}x${attr('meta[property="og:image:height"]', "content")}`,
      twitterCard: attr('meta[name="twitter:card"]', "content"),
    };
  });
  const cvHref = "cv/Max_Shakurov_Product_Designer_CV.pdf download";
  flag("header CV link: href + download", cvHref, head.cvHeader, head.cvHeader === cvHref);
  flag("footer CV link: href + download", cvHref, head.cvFooter, head.cvFooter === cvHref);
  flag("favicon link: favicon.svg, image/svg+xml", "favicon.svg image/svg+xml", `${head.icon} ${head.iconType}`, head.icon === "favicon.svg" && head.iconType === "image/svg+xml");
  flag("favicon.svg loads", 200, head.iconStatus, head.iconStatus === 200);
  flag("apple-touch-icon link", "apple-touch-icon.png", head.touch, head.touch === "apple-touch-icon.png");
  flag("apple-touch-icon.png loads, 180x180", "180x180", head.touchSize, head.touchSize === "180x180");
  flag("canonical", "https://DOMAIN/", head.canonical, head.canonical === "https://DOMAIN/");
  flag("og:url", "https://DOMAIN/", head.ogUrl, head.ogUrl === "https://DOMAIN/");
  flag("og:type", "website", head.ogType, head.ogType === "website");
  flag("og:title", "Max Shakurov — Product Designer", head.ogTitle, head.ogTitle === "Max Shakurov — Product Designer");
  flag("og:description = meta description", head.description, head.ogDescription, head.ogDescription === head.description && head.description !== "missing");
  flag("og:image: full URL", "https://DOMAIN/assets/og-image.png", head.ogImage, head.ogImage === "https://DOMAIN/assets/og-image.png");
  flag("og-image.png loads, 1200x630", "1200x630", head.ogImageSize, head.ogImageSize === "1200x630");
  flag("og:image:width x height", "1200x630", head.ogImageWh, head.ogImageWh === "1200x630");
  flag("twitter:card", "summary_large_image", head.twitterCard, head.twitterCard === "summary_large_image");

  // Profile links (POR-34): header LinkedIn (inside the open MENU under 1400)
  // and the footer row LinkedIn · Dribbble · GitHub · CV, at 1920 and 375.
  const LINKEDIN = "https://www.linkedin.com/in/max-shakurov/";
  const DRIBBBLE = "https://dribbble.com/max_shakurov";
  const GITHUB = "https://github.com/Kalxoznik";
  for (const width of [1920, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 1080 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const menu = await page.evaluate(async () => {
      const button = document.querySelector('[data-check="menu-toggle"]');
      if (!button || getComputedStyle(button).display === "none") return false;
      button.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return true;
    });
    const links = await page.evaluate(() => {
      const info = (a) => {
        if (!a) return null;
        const r = a.getBoundingClientRect();
        const visible = r.width > 0 && r.height > 0 && getComputedStyle(a).visibility === "visible";
        return {
          href: a.getAttribute("href"),
          target: a.getAttribute("target"),
          rel: a.getAttribute("rel"),
          visible,
          top: r.top + scrollY,
          left: r.left,
          right: r.right,
          text: a.textContent.replace(/\s+/g, " ").trim(),
        };
      };
      const footer = [...document.querySelectorAll(".footer-links a")].map(info);
      const row = document.querySelector(".footer-links").getBoundingClientRect();
      return {
        header: info(document.querySelector(".nav .nav-external")),
        footer,
        rowRight: row.right,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    if (menu) {
      await page.evaluate(async () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        await new Promise((r) => setTimeout(r, 300));
      });
    }
    const ext = (name, url, l) => {
      const actual = l ? `${l.href} ${l.target} ${l.rel} ${l.visible ? "visible" : "hidden"}` : "missing";
      flag(`${name}: href, _blank, noopener, visible @${width}`, `${url} _blank noopener visible`, actual, !!l && l.href === url && l.target === "_blank" && l.rel === "noopener" && l.visible);
    };
    ext("header LinkedIn link", LINKEDIN, links.header);
    const f = links.footer;
    ext("footer LinkedIn link", LINKEDIN, f[0]);
    ext("footer Dribbble link", DRIBBBLE, f[1]);
    ext("footer GitHub link", GITHUB, f[2]);
    const order = f.map((l) => l?.text).join(" · ");
    flag(`footer order @${width}`, "LinkedIn · Dribbble · GitHub · CV", order, order === "LinkedIn · Dribbble · GitHub · CV");
    const tops = f.map((l) => l.top);
    const oneRow = Math.max(...tops) - Math.min(...tops) < 2;
    flag(`footer links in one row @${width}`, "same top", tops.map(fmt).join(" / "), oneRow);
    const inside = f.every((l) => l.left >= 0 && l.right <= width);
    flag(`footer links inside the window, no scroll @${width}`, `0 … ${width}, 0`, `${fmt(Math.min(...f.map((l) => l.left)))} … ${fmt(Math.max(...f.map((l) => l.right)))}, ${links.overflow}`, inside && links.overflow <= 0);
  }
} finally {
  await browser.close();
  server.close();
}

const header = ["check", "expected", "actual", "result"];
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
console.log(`Layout check: 1920x1080, dark theme, tolerance ±${TOLERANCE}px\n`);
console.log(line(header));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const r of rows) console.log(line(r));
console.log(`\n${rows.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
