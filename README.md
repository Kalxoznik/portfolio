# Portfolio

Plain HTML, CSS and JavaScript: open `index.html` straight from disk.
`npm run check` measures the layout in headless Chromium against Figma.

## How to add a case screen

1. **Files.** Put the screens in `assets/cases/<case-slug>/`, numbered in slide
   order, each as a 1x and a 2x WebP:

   | 1x (`01.webp`) | 2x (`01@2x.webp`) |
   |----------------|-------------------|
   | 953 × 675      | 1906 × 1350       |

   Every slide has this one size. Other sizes are cropped to the box
   (`object-fit: cover`).

2. **Markup.** In `index.html`, inside the slide's `<div class="placeholder">`,
   replace the icon and label spans with the image. Width and height are the 1x
   size (`953`/`675`), so nothing jumps while it loads:

   ```html
   <article class="slide">
     <div class="placeholder">
       <img src="assets/cases/creative-vision/02.webp"
            srcset="assets/cases/creative-vision/02.webp 1x, assets/cases/creative-vision/02@2x.webp 2x"
            width="953" height="675" alt="Short caption describing what this screen shows."
            loading="lazy" decoding="async" draggable="false">
     </div>
     <p class="caption"><span class="eyebrow">Screen 02</span><span class="caption-text">Short caption describing what this screen shows.</span></p>
   </article>
   ```

3. **Caption.** The text goes in `.caption-text` under the image, and the same
   text goes in the image's `alt`. `.eyebrow` is the screen number.

4. **Big lightbox image (optional).** A click on the active slide opens it
   in the lightbox, which shows the 2x file by default. For a sharper one, export
   the screen once more at **2880 px wide** as WebP (`02@full.webp`) and name it in
   `data-full` on the same `<img>`:

   ```html
   <img src="assets/cases/creative-vision/02.webp"
        srcset="assets/cases/creative-vision/02.webp 1x, assets/cases/creative-vision/02@2x.webp 2x"
        data-full="assets/cases/creative-vision/02@full.webp"
        width="953" height="675" alt="…" loading="lazy" decoding="async" draggable="false">
   ```

   It loads only in the lightbox (and when a neighbouring slide is open there).
   The lightbox fits it to the window and never shows a file larger than its own
   width. A `<video>` in the box works the same way and plays there muted, on a loop.

5. **Video slide.** Put a `<video>` in the box instead of the image and mark the
   slide with `data-video`. Export **1920 × 1360, MP4 (H.264), no sound**, 10–15 s,
   with a first frame as `NN-poster.jpg`:

   ```html
   <article class="slide" data-video>
     <div class="placeholder">
       <video src="assets/cases/creative-space/02.mp4" poster="assets/cases/creative-space/02-poster.jpg"
              width="953" height="675" muted loop playsinline preload="metadata" disablepictureinpicture aria-label="…"></video>
       <span class="video-badge" aria-hidden="true"><svg viewBox="0 0 14 14"><path d="M4 2.5v9l7.5-4.5z" fill="currentColor"/></svg></span>
     </div>
     <p class="caption">…</p>
   </article>
   ```

   It has no controls: it plays while its slide is in place and on screen, the
   middle pauses and plays, the left and right quarters step to the neighbours.
   Full-size sources (PNG screens, raw video) live in `design-source/`, which is
   not committed or deployed.

6. **New slide.** Copy a whole `<article class="slide">`. The dots under the
   carousel are built from the slides by `main.js`, so there is nothing else to
   add. A slide without an image keeps the placeholder spans.
