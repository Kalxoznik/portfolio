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

4. **New slide.** Copy a whole `<article class="slide">`. The dots under the
   carousel are built from the slides by `main.js`, so there is nothing else to
   add. A slide without an image keeps the placeholder spans.
