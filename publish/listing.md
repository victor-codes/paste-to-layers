# Figma Community listing — Paste to Layers

## Name
Paste to Layers

## Tagline (≤ 100 chars)
Paste React, Tailwind or HTML and get editable Figma layers with real auto layout.

## Description

Turn code back into design. Paste a React component or an HTML page, whether you wrote it, an AI generated it, or you exported it from a tool like Paper, and Paste to Layers rebuilds it as clean, editable Figma layers. You can also drop an .html, .jsx or .tsx file onto the plugin.

**What you get**
- Frames with auto layout that match flexbox: direction, gap, padding, alignment, wrap, fill and hug sizing
- CSS grids as Figma grid layouts, with the same columns, rows, gaps and spans
- Text layers with the right font, size, weight, line height, letter spacing and case, and mixed styles in one layer (`<b>`, `<em>`, colored spans)
- Colors, gradients (including gradient text), borders, corner radius, shadows, opacity and rotation
- Absolutely positioned elements, including `%`, `calc()` and centered `translate` tricks
- Images from `<img src>` and `background-image` loaded as image fills
- Inline SVG icons as vectors

**Works with**
- Tailwind CSS v3 and v4, including arbitrary values (`w-[960px]`, `text-[#0C0C0C]`, `[letter-spacing:-0.6px]`)
- Inline `style={{ ... }}` objects
- `clsx` / `cn` class helpers, `.map` lists and conditionals (static markup is read; one list item is rendered)
- JSX copied from Paper
- Plain HTML with `<style>` blocks, CSS variables and `style="..."` attributes

**How to use**
1. Run Paste to Layers.
2. Paste your component's JSX or HTML, or drop the file onto the plugin.
3. Click Create layers (or press ⌘↵). The layers appear on the canvas, with a short list of anything that couldn't be converted exactly.

Fonts come from the CSS font stack. If a family isn't installed, the next one in the stack is used, then Inter, and you're told which.

**Privacy**
Conversion runs entirely inside Figma. The only network requests are downloads of the images referenced in the code you paste.

**Limitations**
Hover, responsive and dark-mode variants (`@media` in CSS), runtime state, external stylesheets, scripts and custom Tailwind themes aren't supported. Custom components (`<Button>`) become plain frames. The full list is in the README.

## Tags (5 max)
code to design, react, tailwind, auto layout, html to figma

## Category
Design tools / Import & export

## Network access reasoning (shown to reviewers and users)
Loads the images referenced by pasted code (img src and background-image URLs). No other data leaves the file.

## Assets
- Icon: `publish/icon-128.png` (128×128)
- Cover: `publish/cover-1920x1080.png` (1920×1080)
- Carousel (1920×1080, in this order after the cover):
  1. `slide-02-auto-layout.png`: flexbox classes → auto layout settings
  2. `slide-03-grid.png`: CSS grid → Figma grid
  3. `slide-04-text.png`: mixed text as one layer, font fallback
  4. `slide-05-sources.png`: Tailwind, inline styles, Paper, AI-generated code
  5. `slide-06-feedback.png`: the plugin window with its warnings
- Sources: `publish/src/*.html`. To re-render, run headless Chrome with `--window-size` set to the image size and `--screenshot`.

## Support contact
<your email or support URL>
