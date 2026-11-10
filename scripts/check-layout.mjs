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

// Small uppercase labels (POR-44): ROLE/YEAR/PLATFORM and SCREEN 0X.
function labelStyle(page) {
  return page.evaluate(() => {
    const st = (sel) => {
      const c = getComputedStyle(document.querySelector(sel));
      return { color: c.color, weight: c.fontWeight, spacing: c.letterSpacing, opacity: c.opacity, font: c.fontFamily };
    };
    return {
      theme: document.documentElement.getAttribute("data-theme") || "dark",
      meta: st(".case-meta dt"),
      eyebrow: st(".eyebrow"),
      // check() would pass on the loaded 600 face as the closest match, so look for a real 700 face.
      boldLoaded: [...document.fonts].some((f) => f.family.includes("Inter") && f.weight === "700" && f.status === "loaded"),
    };
  });
}

function labelRows(where, l, metaColour, eyebrowColour) {
  flag(`${where}: case meta label colour`, metaColour, l.meta.color, l.meta.color === metaColour);
  flag(`${where}: slide caption label colour`, eyebrowColour, l.eyebrow.color, l.eyebrow.color === eyebrowColour);
  const style = `${l.meta.weight}/${l.meta.spacing}/${l.meta.opacity}, ${l.eyebrow.weight}/${l.eyebrow.spacing}/${l.eyebrow.opacity}`;
  // letter-spacing: 0 serialises as "normal" in Chrome; both mean no tracking.
  flag(`${where}: labels bold, no tracking, opacity 1`, "700/normal/1, 700/normal/1", style,
    [l.meta, l.eyebrow].every((x) => x.weight === "700" && (x.spacing === "normal" || x.spacing === "0px") && x.opacity === "1"));
  flag(`${where}: Inter 700 face loaded`, "true", l.boldLoaded, l.boldLoaded === true);
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

  labelRows("dark theme", await labelStyle(page), "rgb(255, 248, 227)", "rgb(255, 248, 227)");
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
  labelRows("light theme", await labelStyle(page), "rgb(43, 39, 34)", "rgb(62, 58, 50)");
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
  // Light theme at 375: same label style and colours (POR-44).
  await page.evaluate(async () => {
    document.querySelector(".theme-toggle").click();
    // Even cut to 0.01ms, the colour transitions may outlast two frames.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await Promise.all(document.getAnimations().filter((a) => a.transitionProperty).map((a) => a.finished.catch(() => {})));
  });
  const light375 = await labelStyle(page);
  flag("light theme @375: theme is light", "light", light375.theme, light375.theme === "light");
  labelRows("light theme @375", light375, "rgb(43, 39, 34)", "rgb(62, 58, 50)");
  const dark375 = await page.evaluate(async () => {
    document.querySelector(".theme-toggle").click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})));
    return document.documentElement.getAttribute("data-theme");
  });
  flag("light theme @375: back to dark after the rows", "dark", dark375, dark375 === "dark");
  labelRows("dark theme @375", await labelStyle(page), "rgb(255, 248, 227)", "rgb(255, 248, 227)");
  // System light (no data-theme, prefers-color-scheme: light) is its own CSS
  // block, which the toggle never reaches. Restore dark afterwards.
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})));
  });
  const sysAttr = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  flag("system light @375: no data-theme", "null", String(sysAttr), sysAttr === null);
  labelRows("system light @375", await labelStyle(page), "rgb(43, 39, 34)", "rgb(62, 58, 50)");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await timelineChecks(375);
  for (const width of [375, 720, 721, 1080, 1081, 1200, 1201, 1399, 1400]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await caseHeadChecks(width);
  }

  // Every carousel slide is one size (POR-42, widened to 5:3 in POR-51): 1127×675 at
  // 1920, the same aspect at every narrower width, min(1127, 86vw) below 1081.
  for (const width of [1920, 1400, 1081, 1080, 721, 720, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const sizes = await page.evaluate(() =>
      [...document.querySelectorAll(".slide .placeholder")].map((el) => {
        const r = el.getBoundingClientRect();
        return [r.width, r.height];
      })
    );
    const expectedW = width <= 1080 ? Math.min(1127, width * 0.86) : 1127;
    const expectedH = (expectedW * 675) / 1127;
    // Creative Space: five screens (one of them a video) and the demo slide; three in the other case.
    flag(`slides: ${sizes.length} found @${width}`, "9", sizes.length, sizes.length === 9);
    const allW = sizes.every(([w]) => Math.abs(w - expectedW) <= TOLERANCE);
    const allH = sizes.every(([, h]) => Math.abs(h - expectedH) <= TOLERANCE);
    flag(`slides all ${fmt(expectedW)} wide @${width}`, fmt(expectedW), [...new Set(sizes.map(([w]) => fmt(w)))].join(","), allW);
    flag(`slides all ${fmt(expectedH)} high @${width}`, fmt(expectedH), [...new Set(sizes.map(([, h]) => fmt(h)))].join(","), allH);
    if (width === 1920) flag("slides 1127×675 @1920", "1127×675", `${fmt(sizes[0]?.[0])}×${fmt(sizes[0]?.[1])}`, allW && allH && Math.abs(expectedH - 675) <= TOLERANCE);
    const over = await page.evaluate(overflowX);
    flag(`no horizontal scroll with slides @${width}`, "0", over, over <= 0);
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

  // CV links, icons and link previews (POR-30). The canonical origin is
  // https://maxshakurov.com/; files under it are loaded from this server. The
  // CV PDF is not in cv/ yet, so only the links are checked, not the file.
  const head = await page.evaluate(async () => {
    const attr = (sel, name) => document.querySelector(sel)?.getAttribute(name) ?? "missing";
    const local = (href) => href.replace("https://maxshakurov.com/", "/");
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
  flag("canonical", "https://maxshakurov.com/", head.canonical, head.canonical === "https://maxshakurov.com/");
  flag("og:url", "https://maxshakurov.com/", head.ogUrl, head.ogUrl === "https://maxshakurov.com/");
  flag("og:type", "website", head.ogType, head.ogType === "website");
  flag("og:title", "Max Shakurov — Product Designer", head.ogTitle, head.ogTitle === "Max Shakurov — Product Designer");
  flag("og:description = meta description", head.description, head.ogDescription, head.ogDescription === head.description && head.description !== "missing");
  flag("og:image: full URL", "https://maxshakurov.com/assets/og-image.png", head.ogImage, head.ogImage === "https://maxshakurov.com/assets/og-image.png");
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

  // Carousel clicks, lightbox and cursor label (POR-45). Each run has its own
  // page, so the slides the rows change do not reach the rows above.
  async function openCarouselPage(options) {
    const ctx = await browser.newContext({ deviceScaleFactor: 1, colorScheme: "dark", ...options });
    const p = await ctx.newPage();
    await p.goto(url, { waitUntil: "load" });
    await p.evaluate(async () => {
      await document.fonts.ready;
      const top = document.querySelector(".carousel").getBoundingClientRect().top + scrollY;
      window.scrollTo({ top: top - 160, behavior: "instant" });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    return p;
  }
  const settle = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const activeDot = (p, c = 0) =>
    p.evaluate((c) => [...document.querySelectorAll(".carousel-dots")[c].children].findIndex((d) => d.getAttribute("aria-current") === "true"), c);
  // The middle of the part of a slide's box that shows in the window.
  const slidePoint = (p, i, c = 0) =>
    p.evaluate(({ i, c }) => {
      const r = document.querySelectorAll(".carousel")[c].querySelectorAll(".placeholder")[i].getBoundingClientRect();
      const left = Math.max(0, r.left);
      const right = Math.min(innerWidth, r.right);
      return { x: (left + right) / 2, y: r.top + r.height / 2, visible: right - left };
    }, { i, c });
  const hoverSlide = async (p, i, c = 0) => {
    const at = await slidePoint(p, i, c);
    await p.mouse.move(at.x, at.y);
    await settle(p);
    return at;
  };
  const clickSlide = async (p, i, c = 0) => {
    const at = await hoverSlide(p, i, c);
    await p.mouse.click(at.x, at.y);
    await settle(p);
  };
  const labelState = (p) =>
    p.evaluate(() => {
      const el = document.querySelector(".cursor-label");
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        text: el.textContent,
        visible: el.classList.contains("is-visible"),
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        left: r.left,
        right: r.right,
        bg: cs.backgroundColor,
        color: cs.color,
        font: `${cs.fontSize} ${cs.fontWeight} ${cs.textTransform} ${cs.fontFamily.split(",")[0].replace(/"/g, "")}`,
        type: `${cs.fontSize} ${cs.fontWeight} ${cs.letterSpacing}`,
      };
    });
  // The same three values on a slide label, for the pill to match.
  const eyebrowType = (p) =>
    p.evaluate(() => {
      const cs = getComputedStyle(document.querySelector(".carousel .eyebrow"));
      return `${cs.fontSize} ${cs.fontWeight} ${cs.letterSpacing}`;
    });
  const lightboxState = (p) =>
    p.evaluate(() => {
      const box = document.querySelector(".lightbox");
      const media = box.querySelector(".lightbox-media").getBoundingClientRect();
      const caption = box.querySelector(".lightbox-caption");
      const active = document.activeElement;
      return {
        open: box.open,
        media: [media.left, media.top, media.right, media.bottom],
        captionBottom: caption.getBoundingClientRect().bottom,
        eyebrow: caption.querySelector(".eyebrow")?.textContent,
        counter: caption.querySelector(".lightbox-counter")?.textContent,
        prev: !box.querySelector(".lightbox-prev").hidden,
        next: !box.querySelector(".lightbox-next").hidden,
        boxes: box.querySelectorAll(".lightbox-media > .placeholder").length,
        text: caption.querySelector(".caption-text")?.textContent,
        textColor: caption.querySelector(".caption-text") ? getComputedStyle(caption.querySelector(".caption-text")).color : null,
        eyebrowColor: caption.querySelector(".eyebrow") ? getComputedStyle(caption.querySelector(".eyebrow")).color : null,
        dialogBg: getComputedStyle(box).backgroundColor,
        focusInside: box.contains(active),
        focusOnSlide: active.classList.contains("slide"),
        focusEyebrow: active.querySelector?.(".eyebrow")?.textContent,
        rootOverflow: getComputedStyle(document.documentElement).overflow,
      };
    });

  for (const [theme, width, height] of [["dark", 1920, 1080], ["light", 1920, 1080], ["dark", 375, 812], ["light", 375, 812]]) {
    const tag = `${theme} @${width}`;
    const p = await openCarouselPage({ viewport: { width, height }, reducedMotion: "reduce" });
    const logs = [];
    p.on("console", (m) => logs.push(m.text()));
    if (theme === "light") await p.evaluate(() => document.querySelector(".theme-toggle").click());
    const accent = theme === "dark" ? "rgb(255, 175, 46)" : "rgb(255, 138, 0)";
    flag(`carousel ${tag}: theme`, theme, await p.evaluate(() => document.documentElement.dataset.theme), (await p.evaluate(() => document.documentElement.dataset.theme)) === theme);

    // Next, then back.
    await hoverSlide(p, 1);
    let label = await labelState(p);
    flag(`cursor ${tag}: partial slide on the right reads NEXT`, "NEXT → visible", `${label.text} ${label.visible ? "visible" : "hidden"}`, label.text === "NEXT →" && label.visible);
    flag(`cursor ${tag}: pill in --accent`, accent, label.bg, label.bg === accent);
    flag(`cursor ${tag}: dark text`, "rgb(22, 21, 20)", label.color, label.color === "rgb(22, 21, 20)");
    flag(`cursor ${tag}: 13px Inter Bold uppercase`, "13px 700 uppercase Inter", label.font, label.font === "13px 700 uppercase Inter");
    const slideLabelType = await eyebrowType(p);
    flag(`cursor ${tag}: pill type matches the slide labels`, slideLabelType, label.type, label.type === slideLabelType);
    flag(`cursor ${tag}: pill stays inside the window`, `0 … ${width}`, `${fmt(label.left)} … ${fmt(label.right)}`, label.left >= 0 && label.right <= width);
    const hidden = await p.evaluate(() => getComputedStyle(document.querySelector(".carousel .placeholder")).cursor);
    flag(`cursor ${tag}: native cursor hidden over slides`, "none", hidden, hidden === "none");
    await clickSlide(p, 1);
    flag(`click ${tag}: partial next slide moves the dot by 1`, 1, await activeDot(p), (await activeDot(p)) === 1);
    await clickSlide(p, 2);
    flag(`click ${tag}: the third slide moves the dot to it`, 2, await activeDot(p), (await activeDot(p)) === 2);
    // At 375 the demo slide (POR-46) is one more step: the end of the scroll,
    // where the slide before shows a sliver on the left.
    if (width === 375) for (const i of [3, 4, 5]) await clickSlide(p, i);
    const atEnd = await activeDot(p);
    const prevPoint = await hoverSlide(p, atEnd - 1);
    label = await labelState(p);
    flag(`cursor ${tag}: partial slide on the left reads PREV`, "← PREV", label.text, label.text === "← PREV" && prevPoint.visible > 0);
    flag(`cursor ${tag}: PREV pill stays inside the window`, `0 … ${width}`, `${fmt(label.left)} … ${fmt(label.right)}`, label.left >= 0 && label.right <= width);
    await clickSlide(p, atEnd - 1);
    flag(`click ${tag}: partial previous slide moves the dot back by 1`, atEnd - 1, await activeDot(p), (await activeDot(p)) === atEnd - 1);
    await p.evaluate(() => document.querySelectorAll(".carousel-dots")[0].children[0].click());
    await settle(p);

    // Lightbox.
    const before = await p.evaluate(() => scrollY);
    const logoLeft = () => p.evaluate(() => document.querySelector('[data-check="logo"]').getBoundingClientRect().left);
    const logoBefore = await logoLeft();
    await hoverSlide(p, 0);
    label = await labelState(p);
    flag(`cursor ${tag}: active slide reads ZOOM`, "ZOOM", label.text, label.text === "ZOOM");
    await clickSlide(p, 0);
    let lb = await lightboxState(p);
    flag(`lightbox ${tag}: click on the active slide opens it`, "open", lb.open ? "open" : "closed", lb.open);
    flag(`lightbox ${tag}: caption of that slide`, "Screen 01", lb.eyebrow, lb.eyebrow === "Screen 01");
    flag(`lightbox ${tag}: counter under the image`, "1 / 5", lb.counter, lb.counter === "1 / 5");
    flag(`lightbox ${tag}: first slide shows next only`, "prev hidden, next shown", `prev ${lb.prev ? "shown" : "hidden"}, next ${lb.next ? "shown" : "hidden"}`, !lb.prev && lb.next);
    flag(`lightbox ${tag}: caption text is light`, "rgb(211, 207, 195)", lb.textColor, lb.textColor === "rgb(211, 207, 195)");
    flag(`lightbox ${tag}: caption label is light`, "rgb(255, 248, 227)", lb.eyebrowColor, lb.eyebrowColor === "rgb(255, 248, 227)");
    const fits = lb.media[0] >= 0 && lb.media[1] >= 0 && lb.media[2] <= width && lb.captionBottom <= height;
    flag(`lightbox ${tag}: image and caption fit the window`, `0 … ${width}, ≤ ${height}`, `${lb.media.map(fmt).join(" ")}, caption ${fmt(lb.captionBottom)}`, fits);
    flag(`lightbox ${tag}: image larger than the slide`, width === 1920 ? "> 1127" : "> 322.5", fmt(lb.media[2] - lb.media[0]), lb.media[2] - lb.media[0] > (width === 1920 ? 1127 : 322.5));
    flag(`lightbox ${tag}: cursor pill gone`, "hidden", (await labelState(p)).visible ? "visible" : "hidden", !(await labelState(p)).visible);
    flag(`lightbox ${tag}: page scroll locked`, "hidden", lb.rootOverflow, lb.rootOverflow === "hidden");
    num(`lightbox ${tag}: the page does not shift sideways`, logoBefore, await logoLeft(), 0.5);
    const covers = await p.evaluate(() => {
      const r = document.querySelector(".lightbox").getBoundingClientRect();
      return r.left <= 0 && r.right >= innerWidth && r.top <= 0 && r.bottom >= innerHeight;
    });
    flag(`lightbox ${tag}: dim covers the whole window`, "yes", covers ? "yes" : "no", covers);
    await p.mouse.wheel(0, 400);
    await settle(p);
    const after = await p.evaluate(() => scrollY);
    flag(`lightbox ${tag}: wheel does not scroll the page`, fmt(before), fmt(after), Math.abs(after - before) < 1);
    await p.keyboard.press("Tab");
    await p.keyboard.press("Tab");
    lb = await lightboxState(p);
    flag(`lightbox ${tag}: focus trapped under Tab`, "inside", lb.focusInside ? "inside" : "outside", lb.focusInside);
    await p.keyboard.press("ArrowLeft");
    lb = await lightboxState(p);
    flag(`lightbox ${tag}: ← stops at the first slide`, "Screen 01", lb.eyebrow, lb.eyebrow === "Screen 01");
    await p.keyboard.press("ArrowRight");
    lb = await lightboxState(p);
    flag(`lightbox ${tag}: → shows the next slide`, "Screen 02", lb.eyebrow, lb.eyebrow === "Screen 02");
    await settle(p);
    flag(`lightbox ${tag}: → advances the counter and the carousel dot`, "2 / 5, dot 1", `${lb.counter}, dot ${await activeDot(p)}`, lb.counter === "2 / 5" && (await activeDot(p)) === 1);

    // Browsing inside it (POR-47): the next button, the cursor halves, hovers.
    await p.click(".lightbox-next");
    await settle(p);
    lb = await lightboxState(p);
    flag(`lightbox ${tag}: next button advances the counter and the dot`, "Screen 03, 3 / 5, dot 2", `${lb.eyebrow}, ${lb.counter}, dot ${await activeDot(p)}`, lb.eyebrow === "Screen 03" && lb.counter === "3 / 5" && (await activeDot(p)) === 2);
    // On to the last of the five screens.
    for (let i = 0; i < 2; i++) {
      await p.click(".lightbox-next");
      await settle(p);
    }
    lb = await lightboxState(p);
    flag(`lightbox ${tag}: next reaches the last screen`, "Screen 05, 5 / 5, dot 4", `${lb.eyebrow}, ${lb.counter}, dot ${await activeDot(p)}`, lb.eyebrow === "Screen 05" && lb.counter === "5 / 5" && (await activeDot(p)) === 4);
    flag(`lightbox ${tag}: last slide shows prev only`, "prev shown, next hidden", `prev ${lb.prev ? "shown" : "hidden"}, next ${lb.next ? "shown" : "hidden"}`, lb.prev && !lb.next);
    flag(`lightbox ${tag}: focus stays in it when next hides`, "inside", lb.focusInside ? "inside" : "outside", lb.focusInside);
    flag(`lightbox ${tag}: reduced motion swaps at once`, 1, lb.boxes, lb.boxes === 1);
    const arrows = await p.evaluate(() => {
      const m = document.querySelector(".lightbox-media").getBoundingClientRect();
      const prev = document.querySelector(".lightbox-prev").getBoundingClientRect();
      return { m, prevLeft: prev.left, prevMid: prev.top + prev.height / 2 };
    });
    flag(`lightbox ${tag}: prev button on the left edge, mid-height`, `left < 30, ${fmt(height / 2)}`, `${fmt(arrows.prevLeft)}, ${fmt(arrows.prevMid)}`, arrows.prevLeft < 30 && Math.abs(arrows.prevMid - height / 2) < 1);
    await p.hover(".lightbox-prev");
    await settle(p);
    const navHover = await p.evaluate(() => getComputedStyle(document.querySelector(".lightbox-prev")).color);
    flag(`hover ${tag}: lightbox prev goes to --accent`, "rgb(255, 175, 46)", navHover, navHover === "rgb(255, 175, 46)");
    flag(`cursor ${tag}: no pill over a lightbox button`, "hidden", (await labelState(p)).visible ? "visible" : "hidden", !(await labelState(p)).visible);
    const mid = arrows.m.top + arrows.m.height / 2;
    await p.mouse.move(arrows.m.left + arrows.m.width * 0.25, mid);
    await settle(p);
    label = await labelState(p);
    flag(`cursor ${tag}: left half of the image reads PREV`, "← PREV visible", `${label.text} ${label.visible ? "visible" : "hidden"}`, label.text === "← PREV" && label.visible);
    const inDialog = await p.evaluate(() => document.querySelector(".cursor-label").parentElement.classList.contains("lightbox"));
    flag(`cursor ${tag}: pill drawn in the dialog's top layer`, "yes", inDialog ? "yes" : "no", inDialog);
    await p.mouse.move(arrows.m.left + arrows.m.width * 0.75, mid);
    await settle(p);
    flag(`cursor ${tag}: right half on the last slide shows no pill`, "hidden", (await labelState(p)).visible ? "visible" : "hidden", !(await labelState(p)).visible);
    await p.mouse.move(width / 2, 8);
    await settle(p);
    label = await labelState(p);
    flag(`cursor ${tag}: outside the image reads CLOSE`, "CLOSE visible", `${label.text} ${label.visible ? "visible" : "hidden"}`, label.text === "CLOSE" && label.visible);
    await p.mouse.click(arrows.m.left + arrows.m.width * 0.25, mid);
    await settle(p);
    lb = await lightboxState(p);
    flag(`lightbox ${tag}: click on the left half steps back`, "Screen 04, 4 / 5, dot 3", `${lb.eyebrow}, ${lb.counter}, dot ${await activeDot(p)}`, lb.eyebrow === "Screen 04" && lb.counter === "4 / 5" && (await activeDot(p)) === 3);
    await p.mouse.move(arrows.m.left + arrows.m.width * 0.75, mid);
    await settle(p);
    flag(`cursor ${tag}: right half reads NEXT`, "NEXT →", (await labelState(p)).text, (await labelState(p)).text === "NEXT →");
    await p.keyboard.press("Tab");
    const ring = await p.evaluate(() => {
      const a = document.activeElement;
      const cs = getComputedStyle(a);
      return { button: a.classList.contains("lightbox-button"), visible: a.matches(":focus-visible"), outline: `${cs.outlineStyle} ${cs.outlineColor}` };
    });
    flag(`focus ${tag}: lightbox button shows a ring`, "solid rgb(255, 175, 46)", ring.outline, ring.button && ring.visible && ring.outline === "solid rgb(255, 175, 46)");
    await p.keyboard.press("Escape");
    await settle(p);
    lb = await lightboxState(p);
    flag(`lightbox ${tag}: Esc closes it`, "closed", lb.open ? "open" : "closed", !lb.open);
    flag(`lightbox ${tag}: focus returns to the slide last shown`, "slide Screen 04", `${lb.focusOnSlide ? "slide" : "other"} ${lb.focusEyebrow}`, lb.focusOnSlide && lb.focusEyebrow === "Screen 04");
    flag(`lightbox ${tag}: carousel follows the slide last shown`, 3, await activeDot(p), (await activeDot(p)) === 3);
    flag(`lightbox ${tag}: scroll lock lifted`, "not hidden", lb.rootOverflow, lb.rootOverflow !== "hidden");

    // Enter on the focused active slide, then the × and a click outside.
    await p.keyboard.press("Enter");
    lb = await lightboxState(p);
    flag(`keyboard ${tag}: Enter on the active slide opens it`, "open Screen 04", `${lb.open ? "open" : "closed"} ${lb.eyebrow}`, lb.open && lb.eyebrow === "Screen 04");
    await p.click(".lightbox-close");
    await settle(p);
    lb = await lightboxState(p);
    flag(`lightbox ${tag}: × closes it, focus returns`, "closed, slide", `${lb.open ? "open" : "closed"}, ${lb.focusOnSlide ? "slide" : "other"}`, !lb.open && lb.focusOnSlide);
    await p.keyboard.press("Enter");
    await p.mouse.click(4, Math.floor(height / 2));
    await settle(p);
    lb = await lightboxState(p);
    flag(`lightbox ${tag}: click outside closes it`, "closed", lb.open ? "open" : "closed", !lb.open);

    // A drag never opens anything, and shows the grabbing cursor, not the pill.
    await p.evaluate(() => document.querySelectorAll(".carousel-dots")[0].children[0].click());
    await settle(p);
    const from = await hoverSlide(p, 0);
    await p.mouse.down();
    await p.mouse.move(from.x - 60, from.y, { steps: 4 });
    await settle(p);
    label = await labelState(p);
    const grabbing = await p.evaluate(() => getComputedStyle(document.querySelector(".carousel .placeholder")).cursor);
    flag(`drag ${tag}: pill hidden while dragging`, "hidden", label.visible ? "visible" : "hidden", !label.visible);
    flag(`drag ${tag}: grabbing cursor`, "grabbing", grabbing, grabbing === "grabbing");
    await p.mouse.up();
    await settle(p);
    lb = await lightboxState(p);
    flag(`drag ${tag}: does not open the lightbox`, "closed", lb.open ? "open" : "closed", !lb.open);
    await p.evaluate(() => document.querySelectorAll(".carousel-dots")[0].children[0].click());
    await settle(p);

    // Off the slides the pill goes, and the native cursor comes back.
    await hoverSlide(p, 0);
    const gap = await p.evaluate(() => {
      const r = document.querySelector(".carousel .placeholder").getBoundingClientRect();
      return { x: r.right + 10, y: r.top + 20 };
    });
    await p.mouse.move(gap.x, gap.y);
    await settle(p);
    flag(`cursor ${tag}: hidden in the gap between slides`, "hidden", (await labelState(p)).visible ? "visible" : "hidden", !(await labelState(p)).visible);
    await hoverSlide(p, 0);
    await p.mouse.move(width / 2, 5);
    await settle(p);
    flag(`cursor ${tag}: hidden off the carousel`, "hidden", (await labelState(p)).visible ? "visible" : "hidden", !(await labelState(p)).visible);
    await hoverSlide(p, 0);
    await p.evaluate(() => document.documentElement.dispatchEvent(new MouseEvent("mouseleave")));
    await settle(p);
    flag(`cursor ${tag}: hidden when the pointer leaves the window`, "hidden", (await labelState(p)).visible ? "visible" : "hidden", !(await labelState(p)).visible);

    // A demo slide, marked the way the later card will mark it.
    await p.evaluate(() => {
      // openDemo is real since POR-46 and this case has no demo: log the call.
      const realOpenDemo = window.openDemo;
      window.openDemo = (caseId) => {
        console.log("openDemo", caseId);
        realOpenDemo(caseId);
      };
      const carousel = document.querySelectorAll(".carousel")[1];
      carousel.querySelector(".slide").setAttribute("data-demo", "");
      const top = carousel.getBoundingClientRect().top + scrollY;
      window.scrollTo({ top: top - 160, behavior: "instant" });
    });
    await settle(p);
    await hoverSlide(p, 0, 1);
    label = await labelState(p);
    flag(`cursor ${tag}: demo slide reads OPEN DEMO`, "OPEN DEMO", label.text, label.text === "OPEN DEMO");
    await clickSlide(p, 0, 1);
    lb = await lightboxState(p);
    const demoLog = logs.includes("openDemo second-project");
    flag(`click ${tag}: demo slide calls openDemo(caseId)`, "openDemo second-project", logs.join(" | ") || "nothing", demoLog);
    flag(`click ${tag}: demo slide opens no lightbox`, "closed", lb.open ? "open" : "closed", !lb.open);
    const noDemo = await p.evaluate(() => document.querySelector(".demo").hidden);
    flag(`click ${tag}: a case without data-demo opens no demo`, "hidden", noDemo ? "hidden" : "open", noDemo);

    // A real image: the largest file, whole, in the same box.
    await p.evaluate(() => {
      const box = document.querySelectorAll(".carousel")[1].querySelectorAll(".placeholder")[1];
      box.replaceChildren();
      const img = new Image(1127, 675);
      img.src = "assets/og-image.png";
      img.srcset = "assets/og-image.png 1x, favicon.svg 2x";
      img.alt = "Test image";
      img.loading = "lazy";
      img.draggable = false;
      box.appendChild(img);
      const next = document.querySelectorAll(".carousel")[1].querySelectorAll(".placeholder")[2];
      const big = new Image(1127, 675);
      big.src = "assets/og-image.png";
      big.dataset.full = "apple-touch-icon.png";
      big.alt = "Test image";
      next.replaceChildren(big);
    });
    await clickSlide(p, 1, 1);
    await settle(p);
    await clickSlide(p, 1, 1);
    const image = await p.evaluate(() => {
      const img = document.querySelector(".lightbox-media img");
      return img ? { src: img.getAttribute("src"), fit: getComputedStyle(img).objectFit, slides: document.querySelector(".carousel .placeholder") !== null } : null;
    });
    flag(`lightbox ${tag}: real image at its largest file, fit whole`, "favicon.svg contain", image ? `${image.src} ${image.fit}` : "missing", image?.src === "favicon.svg" && image.fit === "contain");
    await p.keyboard.press("ArrowLeft");
    lb = await lightboxState(p);
    flag(`lightbox ${tag}: ← skips the demo slide`, "Screen 02", lb.eyebrow, lb.eyebrow === "Screen 02");

    // data-full (POR-47): the big file, preloaded from the slide before, never
    // shown wider than it is (apple-touch-icon.png is 180 wide). A video plays
    // muted on a loop.
    const preloaded = await p.evaluate(() => performance.getEntriesByType("resource").some((e) => e.name.endsWith("/apple-touch-icon.png")));
    flag(`lightbox ${tag}: next slide's data-full preloaded`, "yes", preloaded ? "yes" : "no", preloaded);
    await p.keyboard.press("ArrowRight");
    await p.waitForFunction(() => document.querySelector(".lightbox-media img")?.complete, null, { timeout: 3000 }).catch(() => {});
    await settle(p);
    const full = await p.evaluate(() => {
      const img = document.querySelector(".lightbox-media img");
      return { src: img?.getAttribute("src"), width: document.querySelector(".lightbox-media").getBoundingClientRect().width };
    });
    flag(`lightbox ${tag}: data-full is the file shown`, "apple-touch-icon.png", full.src, full.src === "apple-touch-icon.png");
    flag(`lightbox ${tag}: never wider than the file`, "≤ 180", fmt(full.width), full.width <= 180.5);
    await p.evaluate(() => {
      const box = document.querySelectorAll(".carousel")[1].querySelectorAll(".placeholder")[1];
      const video = document.createElement("video");
      video.src = "missing.mp4";
      box.replaceChildren(video);
    });
    await p.keyboard.press("ArrowLeft");
    const video = await p.evaluate(() => {
      const v = document.querySelector(".lightbox-media video");
      return v ? `${v.muted ? "muted" : "sound"} ${v.loop ? "loop" : "once"} ${v.autoplay ? "autoplay" : "still"}` : "missing";
    });
    flag(`lightbox ${tag}: a video slide plays in it`, "muted loop autoplay", video, video === "muted loop autoplay");
    await p.keyboard.press("Escape");
    await settle(p);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    flag(`carousel ${tag}: no horizontal scroll`, "0", over, over <= 0);
    await p.context().close();
  }

  // System light with no data-theme: its own block sets the label colour. The
  // script in index.html always sets the attribute, so it is taken off here.
  for (const [width, height] of [[1920, 1080], [375, 812]]) {
    const tag = `system light @${width}`;
    const p = await openCarouselPage({ viewport: { width, height }, reducedMotion: "reduce", colorScheme: "light" });
    await p.evaluate(() => document.documentElement.removeAttribute("data-theme"));
    await settle(p);
    const theme = await p.evaluate(() => document.documentElement.getAttribute("data-theme"));
    flag(`lightbox ${tag}: no data-theme`, "null", String(theme), theme === null);
    await clickSlide(p, 0);
    const lb = await lightboxState(p);
    flag(`lightbox ${tag}: opens`, "open", lb.open ? "open" : "closed", lb.open);
    flag(`lightbox ${tag}: caption label is light`, "rgb(255, 248, 227)", lb.eyebrowColor, lb.eyebrowColor === "rgb(255, 248, 227)");
    await p.context().close();
  }

  // Motion on: the pill eases after the pointer and the step is a smooth scroll.
  // Reduced motion: the pill is already there on the next frame.
  {
    const p = await openCarouselPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "no-preference" });
    await p.mouse.move(300, 400);
    await settle(p);
    await p.mouse.move(800, 500);
    const lag = await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => {
      const b = document.querySelector(".cursor-label").getBoundingClientRect();
      r(b.left + b.width / 2);
    })));
    flag("motion on: pill eases after the pointer", "300 < x < 800", fmt(lag), lag > 300 && lag < 790);
    await p.waitForTimeout(600);
    const landed = await labelState(p);
    num("motion on: pill lands on the pointer", 800, landed.x, 0.5);
    const at = await slidePoint(p, 1);
    await p.mouse.click(at.x, at.y);
    const mid = await p.evaluate(() => {
      const c = document.querySelector(".carousel");
      return new Promise((r) => requestAnimationFrame(() => r(c.scrollLeft)));
    });
    flag("motion on: the step scrolls smoothly", "< 973", fmt(mid), mid < 972);
    await p.waitForTimeout(1200);
    flag("motion on: the step ends one dot on", 1, await activeDot(p), (await activeDot(p)) === 1);
    const left = await p.evaluate(() => document.querySelector(".carousel").scrollLeft);
    num("motion on: the step snaps to the next slide", 1147, left, 1);

    // Inside the lightbox a step crossfades over ~250ms (POR-47).
    await p.evaluate(() => document.querySelectorAll(".carousel-dots")[0].children[0].click());
    await p.waitForTimeout(1200);
    await p.evaluate(() => document.querySelector(".carousel .slide").focus({ preventScroll: true }));
    await p.keyboard.press("Enter");
    await p.waitForTimeout(300);
    await p.keyboard.press("ArrowRight");
    const fade = await p.evaluate(() => new Promise((r) => setTimeout(() => {
      const leaving = document.querySelector(".lightbox-media > .is-leaving");
      r({ boxes: document.querySelectorAll(".lightbox-media > .placeholder").length, opacity: leaving ? Number(getComputedStyle(leaving).opacity) : null });
    }, 100)));
    flag("motion on: lightbox step crossfades", "2 boxes, 0 < old opacity < 1", `${fade.boxes} boxes, ${fmt(fade.opacity)}`, fade.boxes === 2 && fade.opacity > 0 && fade.opacity < 1);
    await p.waitForTimeout(300);
    const faded = await p.evaluate(() => ({
      boxes: document.querySelectorAll(".lightbox-media > .placeholder").length,
      opacity: getComputedStyle(document.querySelector(".lightbox-media > .placeholder")).opacity,
      eyebrow: document.querySelector(".lightbox-caption .eyebrow").textContent,
    }));
    flag("motion on: crossfade done by 400ms", "1 box, 1, Screen 02", `${faded.boxes} box, ${faded.opacity}, ${faded.eyebrow}`, faded.boxes === 1 && faded.opacity === "1" && faded.eyebrow === "Screen 02");
    const hovers = await p.evaluate(() => [".lightbox-close", ".lightbox-next", ".demo-exit", ".demo-play", ".demo-trigger"]
      .map((sel) => `${sel.slice(1)} ${getComputedStyle(document.querySelector(sel)).transitionDuration.split(",")[0]}`).join(", "));
    const want = "lightbox-close 0.15s, lightbox-next 0.15s, demo-exit 0.15s, demo-play 0.15s, demo-trigger 0.15s";
    flag("motion on: new controls fade their colour in 150ms", want, hovers, hovers === want);
    await p.context().close();

    const still = await openCarouselPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
    await still.mouse.move(300, 400);
    await settle(still);
    await still.mouse.move(800, 500);
    await settle(still);
    num("reduced motion: pill jumps to the pointer", 800, (await labelState(still)).x, 0.5);
    await still.context().close();
  }

  // A click in mid-step is still a step: nothing opens before the slide arrives.
  // The press is real; every frame of the step records what the pill says.
  for (const [width, height] of [[1920, 1080], [375, 812]]) {
    const tag = `@${width}`;
    const p = await openCarouselPage({ viewport: { width, height }, reducedMotion: "no-preference" });
    const at = await p.evaluate(() => {
      const c = document.querySelector(".carousel");
      const slide = c.querySelectorAll(".slide")[1];
      const pad = parseFloat(getComputedStyle(c).paddingLeft);
      const r = slide.querySelector(".placeholder").getBoundingClientRect();
      const end = Math.min(innerWidth, r.right);
      return {
        x: Math.min(r.left + 100, (r.left + end) / 2),
        y: r.top + r.height / 2,
        rest: Math.min(slide.offsetLeft - c.offsetLeft - pad, c.scrollWidth - c.clientWidth),
      };
    });
    await p.mouse.move(at.x, at.y);
    await settle(p);
    await p.evaluate(() => {
      const c = document.querySelector(".carousel");
      const label = document.querySelector(".cursor-label");
      window.__step = { frames: [], press: null };
      c.addEventListener("pointerdown", () => { window.__step.press = c.scrollLeft; }, true);
      const read = () => {
        window.__step.frames.push({ left: c.scrollLeft, text: label.textContent });
        requestAnimationFrame(read);
      };
      read();
    });
    await p.mouse.click(at.x, at.y);
    await p.waitForFunction((half) => document.querySelector(".carousel").scrollLeft > half, at.rest / 2, { polling: "raf" });
    await p.evaluate(() => { window.__step.press = null; });
    await p.mouse.click(at.x, at.y);
    const open = await lightboxState(p);
    const press = await p.evaluate(() => window.__step.press);
    flag(`mid-step ${tag}: second click lands in mid-step`, `${fmt(at.rest / 2)} < left < ${fmt(at.rest - 8)}`, fmt(press), press > at.rest / 2 && press < at.rest - 8);
    flag(`mid-step ${tag}: second click opens nothing`, "closed", open.open ? "open" : "closed", !open.open);
    await p.waitForTimeout(1200);
    const steps = await p.evaluate(() => window.__step.frames);
    const moving = steps.filter((f) => f.left > 0 && f.left < at.rest - 8);
    const texts = [...new Set(moving.map((f) => f.text))].join(", ");
    flag(`mid-step ${tag}: pill says NEXT all the way`, `NEXT → (> 5 frames)`, `${texts} (${moving.length} frames)`, moving.length > 5 && texts === "NEXT →");
    flag(`mid-step ${tag}: carousel ends on that slide`, 1, await activeDot(p), (await activeDot(p)) === 1);
    num(`mid-step ${tag}: at rest on it`, at.rest, await p.evaluate(() => document.querySelector(".carousel").scrollLeft), 1);
    flag(`mid-step ${tag}: nothing opened on arrival`, "closed", (await lightboxState(p)).open ? "open" : "closed", !(await lightboxState(p)).open);
    await p.context().close();
  }

  // Sideways on a phone and in a short window: the height limits the image.
  for (const [width, height] of [[812, 375], [667, 375], [568, 320], [1280, 480]]) {
    const tag = `${width}x${height}`;
    const p = await openCarouselPage({ viewport: { width, height }, reducedMotion: "reduce" });
    await p.evaluate(() => document.querySelector(".carousel .slide").focus({ preventScroll: true }));
    await p.keyboard.press("Enter");
    const box = await p.evaluate(() => {
      const dialog = document.querySelector(".lightbox");
      const media = dialog.querySelector(".lightbox-media").getBoundingClientRect();
      const close = dialog.querySelector(".lightbox-close").getBoundingClientRect();
      const noOverlap = media.right <= close.left || media.left >= close.right || media.bottom <= close.top || media.top >= close.bottom;
      dialog.scrollTop = dialog.scrollHeight;
      return {
        open: dialog.open,
        width: media.width,
        height: media.height,
        left: media.left,
        right: media.right,
        noOverlap,
        captionBottom: dialog.querySelector(".lightbox-caption").getBoundingClientRect().bottom,
      };
    });
    flag(`lightbox ${tag}: opens`, "open", box.open ? "open" : "closed", box.open);
    flag(`lightbox ${tag}: image at least 60% of the window height`, `≥ ${fmt(height * 0.6)}`, `${fmt(box.width)}x${fmt(box.height)}`, box.height >= height * 0.6);
    flag(`lightbox ${tag}: image inside the window width`, `0 … ${width}`, `${fmt(box.left)} … ${fmt(box.right)}`, box.left >= 0 && box.right <= width);
    flag(`lightbox ${tag}: caption can be reached`, `≤ ${height}`, fmt(box.captionBottom), box.captionBottom <= height);
    flag(`lightbox ${tag}: × clear of the image`, "yes", box.noOverlap ? "yes" : "no", box.noOverlap);
    await p.context().close();
  }

  // A scrollbar that takes up room, which Playwright's default browser hides:
  // the page is padded by its width, so nothing moves when the lightbox opens.
  {
    const wide = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
    try {
      const ctx = await wide.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: "dark", reducedMotion: "reduce" });
      const p = await ctx.newPage();
      await p.goto(url, { waitUntil: "load" });
      const read = () => p.evaluate(() => ({
        bar: innerWidth - document.documentElement.clientWidth,
        logo: document.querySelector('[data-check="logo"]').getBoundingClientRect().left,
        carouselRight: document.querySelector(".carousel").getBoundingClientRect().right,
      }));
      await p.evaluate(async () => {
        await document.fonts.ready;
        const top = document.querySelector(".carousel").getBoundingClientRect().top + scrollY;
        window.scrollTo({ top: top - 160, behavior: "instant" });
      });
      await settle(p);
      const shut = await read();
      flag("scrollbar: takes up room in this browser", "> 0", shut.bar, shut.bar > 0);
      await p.evaluate(() => document.querySelector(".carousel .slide").focus({ preventScroll: true }));
      await p.keyboard.press("Enter");
      await settle(p);
      const opened = await read();
      const padding = await p.evaluate(() => document.documentElement.style.paddingRight);
      flag("scrollbar: page padded by its width", `${shut.bar}px`, padding, padding === `${shut.bar}px`);
      num("scrollbar: logo stays put with the lightbox open", shut.logo, opened.logo, 0.5);
      num("scrollbar: carousel's right edge stays put", shut.carouselRight, opened.carouselRight, 0.5);
    } finally {
      await wide.close();
    }
  }

  // Touch: no pill; a tap does what a click does.
  {
    const p = await openCarouselPage({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" });
    const fine = await p.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches);
    flag("touch @375: not a fine pointer", "false", String(fine), !fine);
    const a = await slidePoint(p, 1);
    await p.touchscreen.tap(a.x, a.y);
    await settle(p);
    flag("touch @375: tap on the partial slide moves the dot", 1, await activeDot(p), (await activeDot(p)) === 1);
    flag("touch @375: no pill", "hidden", (await labelState(p)).visible ? "visible" : "hidden", !(await labelState(p)).visible);
    // Screen 02 is a video (POR-49): a tap plays it (reduced motion kept it still),
    // a second tap pauses it, and it stays in the carousel.
    const b = await slidePoint(p, 1);
    const videoPaused = () => p.evaluate(() => document.querySelectorAll(".carousel .slide")[1].querySelector("video")?.paused);
    await p.touchscreen.tap(b.x, b.y);
    await settle(p);
    const played = await videoPaused();
    await p.touchscreen.tap(b.x, b.y);
    await settle(p);
    const paused = await videoPaused();
    flag("touch @375: tap on the video slide plays it, a second tap pauses", "playing, paused", `${played ? "paused" : "playing"}, ${paused ? "paused" : "playing"}`, played === false && paused === true);
    await p.evaluate(() => document.querySelectorAll(".carousel .slide")[1].focus({ preventScroll: true }));
    await p.keyboard.press("Enter");
    await settle(p);
    const lb = await lightboxState(p);
    flag("touch @375: Enter on the video slide opens it large", "open Screen 02", `${lb.open ? "open" : "closed"} ${lb.eyebrow}`, lb.open && lb.eyebrow === "Screen 02");

    // A real swipe across the image (POR-47); Playwright's touchscreen only taps.
    const cdp = await p.context().newCDPSession(p);
    const swipe = async (from, to) => {
      const y = 400;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from, y }] });
      for (let i = 1; i <= 6; i++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from + ((to - from) * i) / 6, y }] });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await settle(p);
    };
    await swipe(300, 80);
    let swiped = await lightboxState(p);
    flag("touch @375: swipe left shows the next slide", "open Screen 03, 3 / 5, dot 2", `${swiped.open ? "open" : "closed"} ${swiped.eyebrow}, ${swiped.counter}, dot ${await activeDot(p)}`, swiped.open && swiped.eyebrow === "Screen 03" && swiped.counter === "3 / 5" && (await activeDot(p)) === 2);
    flag("touch @375: next button still there mid-way", "shown", swiped.next ? "shown" : "hidden", swiped.next);
    await swipe(80, 300);
    swiped = await lightboxState(p);
    flag("touch @375: swipe right steps back, stays open", "open Screen 02, 2 / 5", `${swiped.open ? "open" : "closed"} ${swiped.eyebrow}, ${swiped.counter}`, swiped.open && swiped.eyebrow === "Screen 02" && swiped.counter === "2 / 5");
    const imgMid = await p.evaluate(() => {
      const r = document.querySelector(".lightbox-media").getBoundingClientRect();
      return { x: r.left + r.width * 0.75, y: r.top + r.height / 2 };
    });
    await p.touchscreen.tap(imgMid.x, imgMid.y);
    await settle(p);
    swiped = await lightboxState(p);
    flag("touch @375: a tap on the image keeps it open", "open Screen 02", `${swiped.open ? "open" : "closed"} ${swiped.eyebrow}`, swiped.open && swiped.eyebrow === "Screen 02");
    await p.keyboard.press("Escape");
    await settle(p);
    flag("touch @375: closes on the slide reached", "dot 1", `dot ${await activeDot(p)}`, (await activeDot(p)) === 1);
    await p.context().close();
  }

  // Demo mode (POR-46): the site in a 375 column from 1200, the panel beside it
  // or, narrower, over the whole window.
  const demoState = (p) =>
    p.evaluate(() => {
      const box = (sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      const column = document.querySelector(".demo-column");
      const active = document.activeElement;
      return {
        open: !document.querySelector(".demo").hidden,
        column: box(".demo-column"),
        columnShown: getComputedStyle(column).display !== "none",
        columnSrc: column.contentWindow.location.href,
        frameSrc: document.querySelector(".demo-frame").contentWindow.location.href,
        panel: box(".demo-panel"),
        bar: box(".demo-bar"),
        pill: box(".demo-pill"),
        pillText: document.querySelector(".demo-pill").textContent,
        play: box(".demo-play"),
        exit: box(".demo-exit"),
        dialog: `${document.querySelector(".demo-panel").getAttribute("role")} ${document.querySelector(".demo-panel").getAttribute("aria-modal")}`,
        exitLabel: document.querySelector(".demo-exit").getAttribute("aria-label"),
        hash: location.hash,
        scrollY,
        rootOverflow: getComputedStyle(document.documentElement).overflow,
        mainInert: document.querySelector("main").inert,
        focusInPanel: document.querySelector(".demo-panel").contains(active),
        focusTrigger: active?.classList.contains("demo-trigger") ?? false,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        panelBg: getComputedStyle(document.querySelector(".demo-panel")).backgroundColor,
        pageBg: getComputedStyle(document.body).backgroundColor,
      };
    });
  const frameReady = (p, sel, search) =>
    p.waitForFunction(({ sel, search }) => {
      const w = document.querySelector(sel).contentWindow;
      try {
        return w.location.href.includes(search) && w.document.readyState === "complete";
      } catch {
        return false;
      }
    }, { sel, search }, { polling: 50, timeout: 10000 });
  // Closing may go through history.back(), which lands a task later.
  const demoClosed = async (p) => {
    await p.waitForFunction(() => document.querySelector(".demo").hidden, null, { timeout: 3000 }).catch(() => {});
    await settle(p);
  };
  const openFromButton = async (p) => {
    await p.evaluate(() => document.querySelector(".demo-trigger").focus({ preventScroll: true }));
    await p.keyboard.press("Enter");
    await settle(p);
  };

  {
    const p = await openCarouselPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
    const opt = await p.evaluate(() => ({
      withDemo: [...document.querySelectorAll(".case[data-demo]")].map((c) => c.dataset.case).join(","),
      trigger: document.querySelectorAll(".case[data-demo] .demo-trigger").length,
      triggerText: document.querySelector(".case[data-demo] .demo-trigger")?.textContent,
      lastSlide: document.querySelector(".case[data-demo] .slide:last-child")?.hasAttribute("data-demo"),
      sameSize: (() => {
        const s = [...document.querySelectorAll(".case[data-demo] .placeholder")].map((el) => `${el.offsetWidth}x${el.offsetHeight}`);
        return new Set(s).size === 1 ? s[0] : s.join(" ");
      })(),
      others: document.querySelectorAll(".case:not([data-demo]) .demo-trigger, .case:not([data-demo]) .slide[data-demo]").length,
    }));
    flag("demo: only Creative Space has data-demo", "creative-space", opt.withDemo, opt.withDemo === "creative-space");
    flag("demo: its last slide is the demo slide, with the button", "true, 1, Try the demo", `${opt.lastSlide}, ${opt.trigger}, ${opt.triggerText}`, opt.lastSlide && opt.trigger === 1 && opt.triggerText === "Try the demo");
    flag("demo: the demo slide is the size of the others", "1127x675", opt.sameSize, opt.sameSize === "1127x675");
    flag("demo: cases without data-demo show nothing new", 0, opt.others, opt.others === 0);
    await p.context().close();
  }

  for (const theme of ["dark", "light"]) {
    const tag = `${theme} @1920`;
    const p = await openCarouselPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce", colorScheme: theme });
    const messages = [];
    await p.exposeFunction("__demoMessage", (m) => messages.push(m));
    await p.evaluate(() => window.addEventListener("message", (e) => window.__demoMessage(JSON.stringify(e.data))));
    const scrollBefore = await p.evaluate(() => scrollY);
    await openFromButton(p);
    let s = await demoState(p);
    flag(`demo ${tag}: the button opens it`, "open #demo=creative-space", `${s.open ? "open" : "closed"} ${s.hash}`, s.open && s.hash === "#demo=creative-space");
    num(`demo ${tag}: column left`, 0, s.column.left, 0.5);
    num(`demo ${tag}: column width 375`, 375, s.column.width, 0.5);
    num(`demo ${tag}: column full height`, 1080, s.column.height, 0.5);
    num(`demo ${tag}: panel starts at the column`, 375, s.panel.left, 0.5);
    num(`demo ${tag}: panel fills the rest`, 1920, s.panel.right, 0.5);
    num(`demo ${tag}: panel full height`, 1080, s.panel.height, 0.5);
    num(`demo ${tag}: top bar 50px`, 50, s.bar.height, 0.5);
    flag(`demo ${tag}: pill text`, "Demo version — some features are limited", s.pillText, s.pillText === "Demo version — some features are limited");
    num(`demo ${tag}: pill 784 wide`, 784, s.pill.width, 0.5);
    num(`demo ${tag}: pill centred in the panel`, (375 + 1920) / 2, s.pill.left + s.pill.width / 2, 1);
    flag(`demo ${tag}: play right of the pill, exit at the left`, "pill < play, exit < pill", `${fmt(s.pill.right)} < ${fmt(s.play.left)}, ${fmt(s.exit.right)} < ${fmt(s.pill.left)}`, s.play.left > s.pill.right && s.exit.right < s.pill.left && s.exit.left < s.panel.left + 20);
    flag(`demo ${tag}: a modal dialog, exit labelled`, "dialog true, Close demo", `${s.dialog}, ${s.exitLabel}`, s.dialog === "dialog true" && s.exitLabel === "Close demo");
    flag(`demo ${tag}: focus moves into the panel`, "inside", s.focusInPanel ? "inside" : "outside", s.focusInPanel);
    flag(`demo ${tag}: page scroll locked, page inert`, "hidden, inert", `${s.rootOverflow}, ${s.mainInert ? "inert" : "live"}`, s.rootOverflow === "hidden" && s.mainInert);
    flag(`demo ${tag}: panel in the theme's background`, s.pageBg, s.panelBg, s.panelBg === s.pageBg);
    flag(`demo ${tag}: no horizontal scroll`, "0", s.overflowX, s.overflowX <= 0);

    await frameReady(p, ".demo-column", "embed=column");
    await frameReady(p, ".demo-frame", "/demo/creative-space/");
    s = await demoState(p);
    flag(`demo ${tag}: column is the site, embedded, on the case`, "index.html?embed=column#creative-space", s.columnSrc, /index\.html\?embed=column#creative-space$/.test(s.columnSrc || ""));
    flag(`demo ${tag}: demo src from data-demo`, "demo/creative-space/", s.frameSrc, /\/demo\/creative-space\/$/.test(s.frameSrc || ""));
    const inner = await p.evaluate(() => {
      const w = document.querySelector(".demo-column").contentWindow;
      const d = w.document;
      const demoDoc = document.querySelector(".demo-frame").contentDocument;
      const board = demoDoc.querySelector(".app .board");
      return {
        width: w.innerWidth,
        mobile: getComputedStyle(d.querySelector(".menu-toggle")).display !== "none",
        overflow: d.documentElement.scrollWidth - d.documentElement.clientWidth,
        theme: d.documentElement.dataset.theme,
        caseTop: d.getElementById("creative-space").getBoundingClientRect().top,
        ownDemo: !d.querySelector(".demo").hidden,
        demoCards: board ? board.querySelectorAll(".card").length : 0,
        demoOverflow: demoDoc.documentElement.scrollWidth - demoDoc.documentElement.clientWidth,
      };
    });
    flag(`demo ${tag}: column page is 375 wide, mobile header`, "375, menu button", `${inner.width}, ${inner.mobile ? "menu button" : "nav row"}`, inner.width === 375 && inner.mobile);
    flag(`demo ${tag}: column has no horizontal scroll`, "0", inner.overflow, inner.overflow <= 0);
    flag(`demo ${tag}: column in the same theme`, theme, inner.theme, inner.theme === theme);
    num(`demo ${tag}: column opens on the case, under its header`, 118, inner.caseTop, 3);
    // The scripted Creative Space demo (replaced the "Demo coming soon" page): the board renders, no sideways scroll.
    flag(`demo ${tag}: demo board renders its cards`, "6 cards", `${inner.demoCards} cards`, inner.demoCards === 6);
    flag(`demo ${tag}: demo has no horizontal scroll`, "0", inner.demoOverflow, inner.demoOverflow <= 0);

    // The column scrolls on its own; the page under it does not.
    const columnBefore = await p.evaluate(() => document.querySelector(".demo-column").contentWindow.scrollY);
    await p.mouse.move(187, 600);
    await p.mouse.wheel(0, 500);
    await p.waitForTimeout(150);
    const scrolled = await p.evaluate(() => ({ column: document.querySelector(".demo-column").contentWindow.scrollY, page: scrollY }));
    flag(`demo ${tag}: wheel scrolls the column`, `> ${fmt(columnBefore)}`, fmt(scrolled.column), scrolled.column > columnBefore);
    num(`demo ${tag}: wheel leaves the page where it was`, scrollBefore, scrolled.page, 0.5);
    await p.mouse.move(1000, 25);
    await p.mouse.wheel(0, 500);
    await p.waitForTimeout(150);
    num(`demo ${tag}: wheel over the bar leaves the page too`, scrollBefore, await p.evaluate(() => scrollY), 0.5);

    // The copy in the column asks this page instead of opening demo mode itself.
    await p.evaluate(() => document.querySelector(".demo-column").contentWindow.openDemo("creative-space"));
    await p.waitForTimeout(100);
    const own = await p.evaluate(() => !document.querySelector(".demo-column").contentDocument.querySelector(".demo").hidden);
    flag(`demo ${tag}: column's Try the demo posts to the page`, '{"type":"demo-open","caseId":"creative-space"}', messages.join(" | ") || "nothing", messages.includes('{"type":"demo-open","caseId":"creative-space"}'));
    flag(`demo ${tag}: column never opens demo mode itself`, "closed", own || inner.ownDemo ? "open" : "closed", !own && !inner.ownDemo);

    // Play control (POR-48): it drives the demo and shows the state the demo reports.
    await p.waitForFunction(() => document.querySelector(".demo-frame").contentWindow.document.readyState === "complete", null, { polling: 50, timeout: 10000 });
    const playStates = [];
    for (let i = 0; i < 2; i++) {
      const before = await p.getAttribute(".demo-play", "data-state");
      await p.click(".demo-play");
      await p.waitForFunction((b) => document.querySelector(".demo-play").dataset.state !== b, before, { polling: 50, timeout: 5000 }).catch(() => {});
      playStates.push(await p.getAttribute(".demo-play", "data-state"));
    }
    flag(`demo ${tag}: play control plays, then pauses`, "playing, paused", playStates.join(", "), playStates.join(", ") === "playing, paused");

    // Hover (POR-47): the bar's icons go to --accent.
    const accentRgb = theme === "dark" ? "rgb(255, 175, 46)" : "rgb(255, 138, 0)";
    for (const sel of [".demo-exit", ".demo-play"]) {
      await p.hover(sel);
      await settle(p);
      const c = await p.evaluate((sel) => getComputedStyle(document.querySelector(sel)).color, sel);
      flag(`hover ${tag}: ${sel.slice(1)} goes to --accent`, accentRgb, c, c === accentRgb);
    }

    // Focus stays in the dialog and the column: the page under it is inert.
    for (let i = 0; i < 4; i++) await p.keyboard.press("Tab");
    const trapped = await p.evaluate(() => {
      const a = document.activeElement;
      return document.querySelector(".demo").contains(a);
    });
    flag(`demo ${tag}: Tab stays in demo mode`, "inside", trapped ? "inside" : "outside", trapped);

    // Esc closes from anywhere: the bar, then inside the demo frame.
    await p.evaluate(() => document.querySelector(".demo-exit").focus());
    await p.keyboard.press("Escape");
    await demoClosed(p);
    s = await demoState(p);
    flag(`demo ${tag}: Esc closes it`, "closed, no hash", `${s.open ? "open" : "closed"}, ${s.hash || "no hash"}`, !s.open && s.hash === "");
    num(`demo ${tag}: Esc restores the scroll`, scrollBefore, s.scrollY, 0.5);
    flag(`demo ${tag}: focus back on the trigger`, "Try the demo", s.focusTrigger ? "Try the demo" : "elsewhere", s.focusTrigger);
    flag(`demo ${tag}: scroll lock lifted, page live`, "not hidden, live", `${s.rootOverflow}, ${s.mainInert ? "inert" : "live"}`, s.rootOverflow !== "hidden" && !s.mainInert);
    const unloaded = await p.waitForFunction(() => [".demo-column", ".demo-frame"].every((sel) => document.querySelector(sel).contentWindow.location.href === "about:blank"), null, { timeout: 3000 }).then(() => true, () => false);
    flag(`demo ${tag}: frames unloaded on close`, "yes", unloaded ? "yes" : "no", unloaded);

    // Back closes it with no extra history entry; a click on the slide opens it.
    const historyBefore = await p.evaluate(() => history.length);
    await p.evaluate(() => document.querySelectorAll(".carousel-dots")[0].lastElementChild.click());
    await settle(p);
    const slideCorner = await p.evaluate(() => {
      const r = document.querySelector(".slide[data-demo] .placeholder").getBoundingClientRect();
      return { x: r.left + 60, y: r.top + 60 };
    });
    await p.mouse.move(slideCorner.x, slideCorner.y);
    await settle(p);
    await p.mouse.click(slideCorner.x, slideCorner.y);
    await settle(p);
    s = await demoState(p);
    flag(`demo ${tag}: a click on the demo slide opens it`, "open", s.open ? "open" : "closed", s.open);
    // Same-document entries: goBack() would wait for a load that never comes.
    await p.evaluate(() => history.back());
    await p.waitForFunction(() => document.querySelector(".demo").hidden, null, { timeout: 3000 }).catch(() => {});
    await settle(p);
    s = await demoState(p);
    flag(`demo ${tag}: Back closes it`, "closed, no hash", `${s.open ? "open" : "closed"}, ${s.hash || "no hash"}`, !s.open && s.hash === "");
    num(`demo ${tag}: Back restores the scroll`, scrollBefore, s.scrollY, 0.5);
    const after = await p.evaluate(() => ({ length: history.length, url: location.pathname }));
    flag(`demo ${tag}: Back stays on the page`, "/index.html", after.url, after.url === "/index.html");
    await p.evaluate(() => history.forward());
    await p.waitForFunction(() => !document.querySelector(".demo").hidden, null, { timeout: 3000 }).catch(() => {});
    await settle(p);
    s = await demoState(p);
    flag(`demo ${tag}: Forward opens it again`, "open", s.open ? "open" : "closed", s.open);
    await p.click(".demo-exit");
    await demoClosed(p);
    s = await demoState(p);
    flag(`demo ${tag}: the exit button closes it`, "closed, no hash", `${s.open ? "open" : "closed"}, ${s.hash || "no hash"}`, !s.open && s.hash === "");
    const finalLength = await p.evaluate(() => history.length);
    flag(`demo ${tag}: open and close add one entry at most`, `≤ ${historyBefore + 1}`, finalLength, finalLength <= historyBefore + 1);

    // Esc inside the demo frame.
    await openFromButton(p);
    await frameReady(p, ".demo-frame", "/demo/creative-space/");
    await p.evaluate(() => document.querySelector(".demo-frame").focus());
    await p.frameLocator(".demo-frame").locator("body").press("Escape");
    await demoClosed(p);
    s = await demoState(p);
    flag(`demo ${tag}: Esc inside the demo closes it`, "closed", s.open ? "open" : "closed", !s.open);
    await p.context().close();
  }

  // Opened from the address: demo mode at once, the page on the case; closing
  // keeps the visitor on the site. The embedded copy ignores the hash.
  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: "dark", reducedMotion: "reduce" });
    const p = await ctx.newPage();
    await p.goto(`${url}#demo=creative-space`, { waitUntil: "load" });
    await settle(p);
    let s = await demoState(p);
    flag("demo direct: #demo=creative-space opens it", "open", s.open ? "open" : "closed", s.open);
    num("demo direct: column 375", 375, s.column.width, 0.5);
    const caseTop = await p.evaluate(() => document.getElementById("creative-space").getBoundingClientRect().top);
    num("demo direct: the page waits on the case", 0, caseTop, 1);
    await p.keyboard.press("Escape");
    await settle(p);
    s = await demoState(p);
    flag("demo direct: Esc closes it, stays on the page", "closed, no hash, /index.html", `${s.open ? "open" : "closed"}, ${s.hash || "no hash"}, ${await p.evaluate(() => location.pathname)}`, !s.open && s.hash === "" && (await p.evaluate(() => location.pathname)) === "/index.html");
    num("demo direct: still on the case", 0, await p.evaluate(() => document.getElementById("creative-space").getBoundingClientRect().top), 1);
    {
      const b = await ctx.newPage();
      await b.goto(`${url}#demo=creative-space`, { waitUntil: "load" });
      await settle(b);
      await b.goBack();
      await settle(b);
      const bs = await demoState(b);
      const path = await b.evaluate(() => location.pathname);
      const top = await b.evaluate(() => document.getElementById("creative-space").getBoundingClientRect().top);
      flag("demo direct: Back closes it, stays on the page", "closed, no hash, /index.html, on the case", `${bs.open ? "open" : "closed"}, ${bs.hash || "no hash"}, ${path}, top ${Math.round(top)}`, !bs.open && bs.hash === "" && path === "/index.html" && Math.abs(top) <= 1);
      await b.close();
    }
    await p.goto(`${url.replace("index.html", "index.html?embed=column")}#demo=creative-space`, { waitUntil: "load" });
    await settle(p);
    s = await demoState(p);
    flag("demo embedded: ?embed=column ignores #demo=", "closed", s.open ? "open" : "closed", !s.open);
    await ctx.close();
  }

  // Under 1200 there is no column: the panel fills the window, same bar.
  for (const [width, height] of [[1199, 900], [1024, 768], [375, 812]]) {
    const tag = `@${width}`;
    const p = await openCarouselPage({ viewport: { width, height }, reducedMotion: "reduce" });
    await openFromButton(p);
    const s = await demoState(p);
    flag(`demo ${tag}: opens`, "open", s.open ? "open" : "closed", s.open);
    await frameReady(p, ".demo-frame", "/demo/creative-space/");
    await p.waitForTimeout(100);
    const columnSrc = (await demoState(p)).columnSrc;
    flag(`demo ${tag}: no column, nothing loaded in it`, "hidden, about:blank", `${s.columnShown ? "shown" : "hidden"}, ${columnSrc}`, !s.columnShown && columnSrc === "about:blank");
    flag(`demo ${tag}: panel full screen`, `0 0 ${width} ${height}`, [s.panel.left, s.panel.top, s.panel.width, s.panel.height].map(fmt).join(" "), s.panel.left === 0 && s.panel.top === 0 && s.panel.width === width && s.panel.height === height);
    num(`demo ${tag}: top bar 50px`, 50, s.bar.height, 0.5);
    const pillW = Math.min(784, width - 112);
    num(`demo ${tag}: pill shrinks to fit`, pillW, s.pill.width, 0.5);
    flag(`demo ${tag}: bar buttons inside the window`, `0 … ${width}`, `${fmt(s.exit.left)} … ${fmt(s.play.right)}`, s.exit.left >= 0 && s.play.right <= width);
    flag(`demo ${tag}: no horizontal scroll`, "0", s.overflowX, s.overflowX <= 0);
    await p.keyboard.press("Escape");
    await demoClosed(p);
    flag(`demo ${tag}: Esc closes it`, "closed",(await demoState(p)).open ? "open" : "closed", !(await demoState(p)).open);
    await p.context().close();
  }

  // Motion on: the panel slides in over ~450ms and back out; nothing is left
  // moved once it is done.
  {
    const p = await openCarouselPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "no-preference" });
    await openFromButton(p);
    const mid = await p.evaluate(() => new Promise((r) => setTimeout(() => {
      const panel = document.querySelector(".demo-panel").getBoundingClientRect().left;
      const main = Number(getComputedStyle(document.querySelector("main")).opacity);
      r({ panel, main });
    }, 150)));
    flag("demo motion: panel on its way in", "375 < left < 1920", fmt(mid.panel), mid.panel > 380 && mid.panel < 1920);
    flag("demo motion: page fading out", "0 < opacity < 1", fmt(mid.main), mid.main > 0 && mid.main < 1);
    await p.waitForTimeout(600);
    let end = await p.evaluate(() => ({
      panel: document.querySelector(".demo-panel").getBoundingClientRect().left,
      running: document.getAnimations().filter((a) => a instanceof CSSAnimation === false && a.effect?.target?.closest?.(".demo, main, header, footer")).length,
    }));
    num("demo motion: panel lands at the column", 375, end.panel, 0.5);
    flag("demo motion: no animation left on", 0, end.running, end.running === 0);
    await p.keyboard.press("Escape");
    const closing = await p.evaluate(() => new Promise((r) => setTimeout(() => r(!document.querySelector(".demo").hidden), 150)));
    flag("demo motion: closing plays out", "still shown", closing ? "still shown" : "gone", closing);
    await p.waitForTimeout(600);
    end = await p.evaluate(() => ({
      hidden: document.querySelector(".demo").hidden,
      main: getComputedStyle(document.querySelector("main")).opacity,
      transform: getComputedStyle(document.querySelector("main")).transform,
    }));
    flag("demo motion: closed, page back whole", "hidden, 1, none", `${end.hidden ? "hidden" : "shown"}, ${end.main}, ${end.transform}`, end.hidden && end.main === "1" && end.transform === "none");
    await p.context().close();
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
