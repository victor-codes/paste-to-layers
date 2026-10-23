# Paste to Layers

A Figma plugin that converts pasted React JSX (Tailwind classes and/or inline `style`) into Figma layers with auto layout.

## Install and build

```sh
npm install
npm run build      # outputs dist/
npm test
npm run typecheck
```

## Import into Figma

Figma desktop: Plugins → Development → Import plugin from manifest → select `manifest.json`. Then run it from Plugins → Development → Paste to Layers, paste a component, and convert.

## Supported

- Elements: div/section/nav/ul/li/button/etc. as frames, text elements as text layers, inline `<svg>` as vector, `<img>` as placeholder
- Tailwind: flex layout, gap, padding, sizing (incl. arbitrary values like `w-[960px]`), colors, radius, borders, shadows, opacity, typography, rotation, linear gradients
- Tailwind v4 syntax: `text-sm/6`, `size-*`, `font-['Inter_Tight']`, `tracking-[-0.02em]`, arbitrary properties like `[border-width:1.5px]`
- JSX copied from Paper (Tailwind or inline styles)
- Inline `style` objects (camelCase properties, px/rem values, hex/rgb colors)
- Class helpers (`clsx`, `cn`, etc.) with static strings
- Default export, named components, or arrow components

See `examples/` for samples.

## Known limitations

- No runtime props, state, or hooks; only static markup is read
- Variants (`hover:`, `md:`, `dark:`) are skipped with warnings
- A `.map` renders only one item
- Images become gray placeholders
- Only linear gradients are supported (radial/conic and background images are skipped)
- Rotation is supported; other transforms (scale, skew, translate) are not
- Mixed inline content (`<p>text <b>bold</b></p>`) becomes one text layer with styled ranges (weight, italic, color, size, decoration, case). An inline child with its own box (background, padding, border) or layout still splits the text into separate layers
