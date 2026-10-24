# Paste to Layers

A Figma plugin that converts pasted React JSX (Tailwind classes and/or inline `style`) into Figma layers with auto layout.

## Install and build

```sh
npm install
npm run build      # outputs dist/
npm test
npm run typecheck
```

## Calibration checks

Some mappings can't be read from Figma's API, only measured: whether skew survives in auto layout, where an angular gradient starts, how Figma's blur radius and image adjustments compare with CSS. Type `/checks` in the plugin and press Create layers (in the Figma desktop app). The plugin builds test layers off-screen, exports them, draws the CSS version of each in its own window (which is a browser), and reports which variant matches best. The values live in `CALIBRATION` in `src/render.ts`. Measured so far: skew is kept both inside and outside auto layout (Figma moves the stretch into the layer's size), Figma's blur radius is about 2.2× CSS `blur()`, conic gradients match CSS (start angle and direction), and image adjustments only roughly follow CSS filters.

## Network access

The plugin fetches the images referenced in pasted code, so `manifest.json` allows network access to any domain. Nothing else is sent anywhere; conversion runs locally.

## Import into Figma

Figma desktop: Plugins → Development → Import plugin from manifest → select `manifest.json`. Then run it from Plugins → Development → Paste to Layers, paste a component, and convert.

## Supported

### Elements and sources

- div/section/nav/ul/li/button/etc. as frames, text elements as text layers, inline `<svg>` as vector, `<img>` as an image fill loaded from its `src`
- Tailwind v3 and v4, including arbitrary values (`w-[960px]`), arbitrary properties (`[border-width:1.5px]`) and v4 syntax (`text-sm/6`, `size-*`, `w-7xl`, `font-['Inter_Tight']`)
- Inline `style` objects (camelCase properties, px/rem/em/% values, hex, rgb, hsl, oklch and oklab colors)
- JSX copied from Paper (Tailwind or inline styles)
- Class helpers (`clsx`, `cn`, etc.) with static strings; default export, named or arrow components

### Layout

- Flexbox as auto layout: direction, gap, padding, alignment, wrap, `flex-1`/`grow` (fill), `basis-*`, `self-stretch`. `justify-around`/`justify-evenly` are reproduced with invisible zero-size spacers in a space-between layout
- CSS default stretching: children of a flex column (or block parent) with a known width fill it, as in the browser
- Sizes: px, the spacing scale, `min-w`/`max-w`/`min-h`/`max-h`, `aspect-*` (ratio locked in Figma), and percentages (`w-1/2`, `h-[calc(100%-20px)]`, `width: '50%'`) resolved against the parent once its size is known
- Margins (`m-*`, `mx-auto`, `margin`): a box with margin is wrapped in a frame padded by the margin; `mx-auto` centres it. On an absolutely positioned box the margin moves it instead
- `space-x-*` / `space-y-*` become the gap
- CSS grid (`grid-cols-*`, `grid-rows-*`, `col-start-*`, `col-span-*`, `gridTemplateColumns`, `gridColumn`) as a Figma grid layout with the same tracks, gaps and spans; items without a position flow into the next free cell
- Absolute positioning with px, `%` and `calc(% ± px)` insets and `inset-*`, plus `translate` (`left-1/2 -translate-x-1/2`). A box with both insets on an axis (`inset-x-0`, `left-12 right-12`) stretches between them

### Visuals

- Colors, opacity, corner radius
- Transforms: rotation and uniform scale use Figma's own rotation and rescale; skew (`skew-x-*`, `skewX()`), uneven scale (`scale-x-*`) and `matrix()` set the layer's transform matrix. 3D `rotateX`/`rotateY` without perspective flatten to the 2D shape they produce
- Gradients: linear, radial (`bg-radial`, `radial-gradient(circle at …)`, all size keywords) and conic (`bg-conic`, `conic-gradient(from …)`), from classes or CSS
- Gradient text (`bg-clip-text` / `background-clip: text`)
- Images: `<img src>`, `background-image: url(...)` and `bg-[url(...)]` load as image fills. `bg-cover`/`object-cover`, `contain`, `object-fill`, `background-size` and `background-position`/`object-position` (keywords, %, px) are matched with Figma's fill, fit or crop; `bg-repeat` tiles at the background size. A gray placeholder is used if the image can't be fetched
- Several background layers (`background-image: linear-gradient(...), url(...)`) stack as several fills in the same order
- Image filters: `brightness`, `contrast`, `saturate` and `grayscale` adjust image fills (Figma's exposure, contrast and saturation; approximate). `opacity()` sets layer opacity
- Borders, including per side (`border-t`, `border-x-2`, `border-b-[#0000001A]`, `borderBottom`) as one stroke with per-side weights; transparent sides are dropped. Dashed and dotted borders become dashed strokes
- `divide-x-*` / `divide-y-*` become a border on every child after the first
- Shadows: drop and inset (`shadow-*`, `shadow-inner`, `inset-shadow-*`, `box-shadow: inset …`), `text-shadow` and `drop-shadow` filters
- `blur` / `backdrop-blur` (classes, `filter: blur()`, `backdrop-filter: blur()`) as layer and background blur
- `mix-blend-*` / `mix-blend-mode` as the layer's blend mode

### Text

- Font family, size, weight, style, line height, letter spacing, alignment, case, decoration
- Font stacks: each family in `font-family` is tried in order, and weight names are matched however the font spells them (`SemiBold`, `Semi Bold`); PostScript names like `CooperBT-Medium` resolve to their family
- Mixed inline content (`<p>text <b>bold</b></p>`) becomes one text layer with styled ranges (weight, italic, color, size, decoration, case). An inline child with its own box (background, padding, border, margin) or layout still splits the text into separate layers
- `line-clamp-*`, `truncate` and `text-overflow: ellipsis` cut text off with an ellipsis (when the text has a set or filled width)

See `examples/` for samples.

## Not supported

Most of these show a warning after converting; the last group is dropped silently.

### Layout

- `justify-around` / `justify-evenly` in a wrapping row or a grid (drawn as space-between, with a warning); `align-self` other than `self-stretch` in flex layouts (it works in grids)
- Negative margins, and `ml-auto`/`mr-auto` used to push items apart in a row
- Margins don't collapse between siblings as they do in block layout
- `scale` changes the space a layer takes in auto layout, where CSS leaves layout untouched
- Grid areas, named lines and `grid-auto-flow: dense`; implicit grid rows always hug their content
- Percentage sizes inside a parent whose size depends on its content (sized to content, with a warning)
- `z-index`; stacking follows source order (ignored silently)
- Text in a row doesn't shrink and wrap like the browser's `flex-shrink`, so it can overflow
- A root with no width/height whose children are all absolute gets a guessed size (with a warning); add a size to the root for an exact match

### Visuals

- Different border colors per side (Figma strokes have one color; the first visible side's color is used, with a warning)
- `double`, `groove` and other border styles (rendered solid)
- Shadow spread on a frame without a background (Figma needs a fill and clipping for spread)
- `brightness`, `contrast`, `saturate` and `grayscale` on anything other than an image (Figma only has these adjustments for image fills); `hue-rotate`, `invert` and `sepia` anywhere; backdrop filters other than `blur`
- `perspective` (3D rotations are flattened without it)
- Tiles always start at the top left (`background-position` is ignored for repeating backgrounds), and `repeat-x`/`repeat-y` tile both ways
- Text shadows on part of a text layer (the shadow applies to the whole layer)

### Tailwind

- Variants (`hover:`, `md:`, `dark:`); only the base style is drawn
- Custom theme values from a project's Tailwind config; only the default scale and arbitrary `[...]` values are recognized

### React

- Runtime props, state, hooks and conditionals; only static markup is read
- A `.map` renders only one item
- Custom components (`<Button>`) render as plain frames with a warning

### Fonts

- Fonts not installed in Figma fall back to the next family in the stack, then Inter, with a warning

### Ignored silently

- `flex-shrink`, `z-index`, `font-variation-settings`, `cursor`, transitions, `will-change`, font smoothing and other interaction or rendering hints with no visual effect in Figma
