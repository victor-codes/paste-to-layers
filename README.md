# Paste to Layers

A Figma plugin that converts pasted React JSX (Tailwind classes and/or inline `style`) into Figma layers with auto layout.

## Install and build

```sh
npm install
npm run build      # outputs dist/
npm test
npm run typecheck
```

## Network access

The plugin fetches the images referenced in pasted code, so `manifest.json` allows network access to any domain. Nothing else is sent anywhere; conversion runs locally.

## Import into Figma

Figma desktop: Plugins → Development → Import plugin from manifest → select `manifest.json`. Then run it from Plugins → Development → Paste to Layers, paste a component, and convert.

## Supported

- Elements: div/section/nav/ul/li/button/etc. as frames, text elements as text layers, inline `<svg>` as vector, `<img>` as an image fill loaded from its `src`
- Tailwind: flex layout, gap, padding, sizing (incl. arbitrary values like `w-[960px]`, `min-h-*`, `basis-*`), colors, radius, borders, shadows, opacity, typography, rotation, translate, linear gradients
- Tailwind v4 syntax: `text-sm/6`, `size-*`, container widths like `w-7xl`, `font-['Inter_Tight']`, `tracking-[-0.02em]`, arbitrary properties like `[border-width:1.5px]`
- JSX copied from Paper (Tailwind or inline styles)
- Inline `style` objects (camelCase properties, px/rem/em values, `%` line height, hex/rgb colors)
- Absolute positioning with px, `%` and `calc(% ± px)` insets on `left`/`top`/`right`/`bottom` and `inset-*`, plus `translate` (`left-1/2 -translate-x-1/2`). A box with both insets on an axis (`inset-x-0`, `left-12 right-12`) stretches between them
- CSS grid (`grid-cols-*`, `grid-rows-*`, `col-start-*`, `col-span-*`, `gridTemplateColumns`, `gridColumn`) becomes a Figma grid layout with the same tracks, gaps and spans; items without a position flow into the next free cell
- Images: `<img src>` and `background-image: url(...)` load as image fills (cropped to fill); a gray placeholder is used if the image can't be fetched
- Gradient text (`bg-clip-text` / `background-clip: text`) and `drop-shadow` filters
- CSS default stretching: children of a flex column (or block parent) with a known width fill it, as in the browser
- Font stacks: each family in `font-family` is tried in order, and weight names are matched however the font spells them (`SemiBold`, `Semi Bold`); PostScript names like `CooperBT-Medium` resolve to their family
- Mixed inline content (`<p>text <b>bold</b></p>`) becomes one text layer with styled ranges (weight, italic, color, size, decoration, case). An inline child with its own box (background, padding, border) or layout still splits the text into separate layers
- Class helpers (`clsx`, `cn`, etc.) with static strings
- Default export, named components, or arrow components

See `examples/` for samples.

## Not supported

Most of these show an "Unsupported…" warning after converting; the last group is dropped silently.

### Layout

- Grid areas, named lines and `grid-auto-flow: dense`; implicit grid rows always hug their content
- Margin (`m-*`, `mx-auto`, `margin`); use `gap` and padding
- `space-x-*` / `space-y-*`
- `justify-around` / `justify-evenly`; `align-self` other than `self-stretch` in flex layouts (it works in grids)
- `max-height`, `aspect-ratio`
- Percentage sizes other than `100%` (`w-1/2`, `calc(100% - 20px)`); percentages work for positioning only
- `z-index`; stacking follows source order (ignored silently)
- Text in a row doesn't shrink and wrap like the browser's `flex-shrink`, so it can overflow
- A root with no width/height whose children are all absolute gets a guessed size (with a warning); add a size to the root for an exact match

### Visuals

- Radial/conic gradients
- `background-size` / `background-position` / `object-fit`: images always crop to fill (ignored silently)
- Per-side borders (`border-t`, `borderTop`) and `divide-*`
- Dashed/dotted borders (rendered solid)
- Inset shadows and `text-shadow`
- Shadow spread on a frame without a background (Figma needs a fill and clipping for spread)
- `filter` other than `drop-shadow`, `blur`, `backdrop-blur`, `mix-blend-mode`
- `scale` and `skew` transforms
- `line-clamp`, `truncate`, `text-ellipsis`

### Tailwind

- Variants (`hover:`, `md:`, `dark:`)
- Custom theme values from a project's Tailwind config; only the default scale and arbitrary `[...]` values are recognized

### React

- Runtime props, state, hooks and conditionals; only static markup is read
- A `.map` renders only one item
- Custom components (`<Button>`) render as plain frames with a warning

### Fonts

- Fonts not installed in Figma fall back to the next family in the stack, then Inter, with a warning

### Ignored silently

- `flex-shrink`, `z-index`, `font-variation-settings`, `cursor`, transitions, `will-change`, font smoothing and other interaction or rendering hints with no visual effect in Figma
