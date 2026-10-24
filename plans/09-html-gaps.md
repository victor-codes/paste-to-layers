# Step 09 — Closing the HTML gaps

HTML support (`src/html.ts`) parses the page with the plugin UI's DOMParser, runs its own cascade over the `<style>` rules, turns the result into JSX with `style="..."` strings, and passes that to `convert()` in `src/parse.ts`. Every gap below is therefore in one of two places:

- **The cascade** (`html.ts`): which rules apply to which element.
- **The style mapping** (`inlineStyle.ts`, `parse.ts`): what a declaration turns into in Figma.

The full list of limits is in the README under *Not supported → HTML*. This plan covers groups 2–4 (skipped CSS, layout differences, small approximations). Group 1 is out of scope: it would need network access to stylesheets, or running scripts.

Each item lists what happens now, the fix, where the change goes, and how to test it. Items are in suggested order: biggest effect on real pages first.

Tests run in happy-dom (`src/html.test.ts`, with JS and file loading disabled). happy-dom has no layout engine, so anything that needs computed sizes has to be done by hand rather than read back from the DOM.

---

## Group 2 — CSS that's skipped

### 2.1 `@media` rules (top priority)

**Now:** `readCss` counts every `@media` block that has a condition as skipped (`html.ts` around line 108). Mobile-first pages come out with their phone layout.

**Fix:** evaluate media queries against a target viewport.
- Viewport: 1440 × 900, screen, light colour scheme. Make it a constant (`VIEWPORT`), so a width picker can be added to the UI later.
- Write `matchesMedia(prelude)`:
  - Comma-separated query lists: any part may match.
  - Support `screen`, `all`, `print` (never matches) and `not`/`only`.
  - Features: `min-width`, `max-width`, `width >= …` range syntax, `min-height`/`max-height`, `orientation`, `prefers-color-scheme`, `prefers-reduced-motion` (no-preference), `hover: hover`, `pointer: fine`.
  - Units: px, em/rem (16px).
  - Anything unrecognised doesn't match and is counted for the warning.
- Matching blocks recurse with the same base rank, so source order is kept, as in a browser.
- Warning: report only the blocks that were *not* applied, e.g. "Applied @media rules for a 1440px-wide screen; skipped 3 (print, dark mode)".
- Do the same for `@container`, treating each container as the viewport width (rough, but better than skipping). Skip it if that gets complicated.

**Test:** mobile-first CSS with `.grid{display:flex;flex-direction:column}` plus `@media (min-width: 768px){.grid{flex-direction:row}}` should come out as a row. A `max-width: 600px` rule should not apply. A `print` rule should not apply. Check the warning text.

### 2.2 `::before` / `::after`

**Now:** skipped with a warning, so icons, quote marks, counters and decorative bars disappear.

**Fix:** in the cascade, collect `::before`/`::after` rules separately, keyed by the selector without the pseudo-element. For each element with matching rules whose `content` isn't `none`/`normal`, insert a synthetic child before or after its children:
- `content: "text"`: a `<span>` with that text, carrying the pseudo's declarations.
- `content: ""` with a size or background (a decorative bar or dot): a `<div>` with those declarations. Default it to `display: inline` unless it is absolutely positioned or has a display set.
- `content: url(...)`: an `<img>`.
- `attr(x)`: substitute the attribute. Treat `counter()` and `open-quote` as unsupported (drop the pseudo and warn).
- The pseudo inherits from its element (it's a child for inheritance purposes).

Specificity of `a::before` is the specificity of `a` plus one tag.

Note: the `content` value must be unquoted and CSS-unescaped (`"\201C"` → `"`).

**Test:**
- `.quote::before{content:"“"}` gives text starting with “.
- `.badge::after{content:"";width:8px;height:8px;background:red;border-radius:50%}` gives an 8px dot frame.
- `content: none` gives nothing.

### 2.3 `:hover`, `:focus` and other states

**Now:** skipped with a warning. This is the right behaviour, since the design shows the resting state. Two adjustments:
- `:focus-within` and `:hover` rules should stay skipped. `:checked`, `:disabled` and `[open]` should be matched with `querySelectorAll`, because they describe the page's current state. Add `checked|disabled|enabled|required|optional|read-only|read-write|placeholder-shown|default|defined|link|any-link` to `STRUCTURAL`. `:link`/`:any-link` match `a[href]`, which a querySelectorAll will do on its own.
- `::placeholder`: apply it to the placeholder text, once inputs render their placeholder (see 3.5).

**Test:** `input:disabled{opacity:.5}` applies to `<input disabled>`. `a:hover` is still skipped and listed in the warning.

### 2.4 Tailwind-only CSS in `<style>`

**Now:** `@apply`, `@theme`, `@tailwind`, `@config` and the CDN's `<style type="text/tailwindcss">` are ignored.

**Fix:**
- `@apply a b c;` inside a rule: expand it by running the classes through the existing Tailwind mapping and merging the result into the rule's declarations (same position in source order).
- `@theme { --color-brand: … }` (v4): read the variables into the `:root` scope. Then teach the Tailwind mapping to resolve theme-named classes (`bg-brand`, `text-brand`, `font-display`, `spacing`) from those variables. The second part is the larger piece of work. Do the variables first; they already help with `var(--color-brand)` in plain CSS.
- `tailwind.config = {...}` in a CDN script: out of scope (it means evaluating JS).

**Test:** `.btn{@apply px-4 py-2 rounded-lg bg-blue-500}` gives the same layer as `<div class="px-4 py-2 rounded-lg bg-blue-500">`.

### 2.5 Values the converter doesn't understand

These are fixed in `inlineStyle.ts` and also benefit JSX `style={{}}`.

- **`vw`, `vh`, `vmin`, `vmax`, `dvh`, `svh`, `lvh`:** resolve against `VIEWPORT` from 2.1. The value has to reach the length parser. Find where px/rem/em/% are parsed and add a viewport case.
- **`clamp(a, b, c)`, `min(...)`, `max(...)`:**
  - If every argument resolves to px, compute the result.
  - If one argument is a %, it depends on the parent. Resolve the others, and pick the px value when it's the clamp bound that wins at the target viewport. Otherwise fall back to the preferred value and warn.
  - Common case: `clamp(2rem, 5vw, 4rem)` at 1440px is 4rem. These get evaluated by the same evaluator as `calc()`, so extend that one rather than writing a second.
- **`currentColor` everywhere:** borders already handle it. The cascade knows each element's computed `color`, so the simplest place is `html.ts`: after cascading, replace `currentcolor` in any value with the element's inherited `color`. Do the same for SVG `fill="currentColor"` (check whether the SVG path already does this). For JSX, do it in `parse.ts`, where text colour is inherited.
- **`inherit`:** in `html.ts`, replace it with the parent's computed value for that property (the parent's merged declarations, which the cascade already has, walking up if the parent doesn't set it).
- **`initial` / `unset` / `revert`:** drop the declaration. This is close enough: the default is what we'd produce anyway, and dropping it also removes any lower-ranked value, which is the right outcome.

**Test:** one test per keyword or function, at the inlineStyle level where possible.

---

## Group 3 — Layout that comes out different

### 3.1 `display` decided by the tag name

**Now:** `parse.ts` around line 555 marks known inline tags as inline only when `display` is undefined. But the HTML cascade's UA defaults don't set `display`, and `inline-block`/`inline` both become `display: block` + `inline: true`. As a result:
- A `<span style="display:block">` works.
- A `<div style="display:inline-block">` sits in a row only if the parent's inline-flow logic picks it up.
- A `<li style="display:inline">` nav pattern probably stacks vertically.

**Fix:**
- Trace how `inline: true` flows into the parent's layout decision (`inlineFlow`, around line 659). Make an explicitly inline child of a block parent join a horizontal wrapping row with its siblings, whatever its tag.
- When an inline-block run sits between block siblings, wrap the run in a horizontal wrap frame (the browser's anonymous line box).
- Explicit `display: block` on a known inline tag must win. It already does, but add a test.

**Test:**
- `<ul><li style="display:inline">A</li><li style="display:inline">B</li></ul>` gives one row.
- `<span style="display:block">` stacks.
- Two inline-block cards between two paragraphs sit side by side.

### 3.2 Tables

**Now:** `<table>` → frames stacked in a column. Cells don't line up across rows.

**Fix:** map the table to a Figma grid layout, which already exists for CSS grid.
- Walk `thead`/`tbody`/`tfoot` → `tr` → `td`/`th`, and build a grid with one column per max cell count. Respect `colspan` and `rowspan` as spans.
- Columns are auto ("hug"), unless `<col width>` or a cell width is set.
- Drop the row and section elements from the tree; keep their backgrounds by copying them onto their cells (a row background on each of its cells).
- `border-collapse: collapse` with cell borders: draw each cell's border and set the grid gap to 0. Overlapping 1px borders will look 2px thick; fix that later by dropping each cell's top and left border when it has a neighbour.
- `border-spacing` → grid gap. Use the browser default of 2px when there's no CSS.
- `<caption>` goes above the grid in a wrapping column frame.
- UA defaults to add: `th { text-align: center; font-weight: bold }`, `td, th { padding: 1px }`, `table { border-spacing: 2px }`.

Where: the HTML → JSX step can rewrite the table into a `<div style="display:grid;grid-template-columns:repeat(n, auto)">` with cells carrying `grid-column`/`grid-row` spans. That keeps `parse.ts` unchanged. Check first that `repeat(n, auto)` and `span` are supported in `gridTemplateColumns`/`gridColumn`.

`display: table` / `table-cell` set in CSS on divs: same treatment, keyed on display instead of the tag. Do it second.

**Test:**
- A 3×3 table gives a grid with 3 columns and aligned cells.
- `colspan=2` spans.
- A row background reaches its cells.

### 3.3 Floats

**Now:** ignored, so a floated image stacks above the text instead of beside it.

**Fix (approximate):** a parent whose first child(ren) are `float: left`/`right` followed by flow content becomes a horizontal frame:
- `[floated child, wrapper of the rest]`, with the rest set to fill.
- For `float: right`, reverse the order.
- Gap: the float's margin.

Text won't wrap around the float's bottom edge; note that in the README.

Common float uses, which this covers:
- an image beside a paragraph
- a nav pushed right
- old clearfix grids, i.e. several floats in a row: a horizontal wrapping frame

A `clear` element ends the float group.

**Test:** `<img style="float:left;width:100px">` + `<p>` gives a row with the image first and the text filling.

### 3.4 `position: fixed` and `sticky`

**Fix:**
- `sticky` → treat as static (its resting position on the static design), with no warning.
- `fixed` → treat as `absolute` relative to the root frame, not the nearest positioned ancestor. Find where absolute children are attached to their containing block in `parse.ts`. For fixed elements, attach them to the root, with insets resolved against `VIEWPORT` if the root has no height.

**Test:**
- A fixed header with `top:0;left:0;right:0` ends up at the root's top, full width.
- A sticky element stays in flow.

### 3.5 Missing browser defaults

Add to `UA_CSS`, or to the HTML → JSX step where it needs markup:

- **List markers:** the browser draws them; we have nothing. In the HTML → JSX step, prepend a marker to each `<li>` whose computed `list-style-type` isn't `none`:
  - `ul` → "•", nested `ul ul` → "◦".
  - `ol` → "1." etc., respecting `start` and `reversed`.
  - Put the marker in an inline `<span>`, with `margin-right` ≈ 0.5em and the text colour, so it stays in the same text layer.
  - Resets (`list-style: none`, which is very common) already turn it off, as long as `list-style`/`list-style-type` is read from the cascade.
- **Form controls:** default look per control:
  - `input`, `textarea`, `select`: 1px #767676 border, 2px radius, 1px 2px padding, white background, ~150px wide.
  - `button`: #efefef background, 1px border, 1px 6px padding.
  - Show `placeholder` text in grey (#757575) when there's no value, and `value` text otherwise.
  - Checkboxes and radios: 13px boxes, the radio fully rounded.
  - `select`: its first selected option's text, plus a "▾".

  Check how `INLINE_BOX_TAGS` renders `input`/`button` now, and whether text content is supported in them.
- **Tables:** covered in 3.2.
- **Other defaults:**
  - `hr`: 1px border-top, #ccc-ish, 8px vertical margin.
  - `small`: 0.83em; `sub`/`sup`: 0.83em.
  - `code`/`kbd`/`pre`/`samp`: monospace.
  - `mark`: yellow background.
  - `strong`/`b`: bold; `em`/`i`: italic. These probably exist in the inline-tag mapping already.
  - `body`: 8px margin.

  Careful with the body margin: it changes every page that doesn't reset it. That's what a browser does, so it's correct, but note it in a test.

### 3.6 Margin collapsing

**Now:** adjacent vertical margins add up (each box is wrapped in a frame padded by its margin). Plain HTML, which leans on UA margins, ends up roomier than in a browser.

**Fix:** in the HTML → JSX step, for block siblings in normal (non-flex, non-grid) flow, collapse the gap between two siblings to `max(prev.margin-bottom, next.margin-top)` instead of the sum: set the previous one's margin-bottom to 0 and the next one's margin-top to the max. Parent/first-child collapsing (a child's top margin escaping its parent) applies only when the parent has no padding, border or height. Do it second; it's rarer in designed pages and fiddly.

This needs computed margins per element, which the cascade has as declarations. Parse `margin` shorthands with the existing `inlineStyle` helpers rather than writing new ones.

**Test:** `<h1>` (margin-bottom .67em) followed by `<p>` (margin-top 1em) gives a gap of 16px, not 16 + 21.

---

## Group 4 — Small approximations

### 4.1 Specificity

**Now:** `specificity()` (`html.ts` around line 60) counts by regex. It gets these wrong:
- `:where(...)`, which should count zero.
- `:is()`/`:not()`/`:has()`, which should count their most specific argument.
- `::pseudo` counted as a class.
- Attribute selectors containing `#` or `.` inside quotes.

**Fix:** a small tokenizer that:
- strips attribute selectors first and counts each as one class;
- handles `:is`/`:not`/`:has`/`:where` arguments recursively, using the parenthesis matcher (`closing()`);
- counts `::x` as a tag.

Keep the result as one number (ids × 1e4 + classes × 1e2 + tags), so ranking stays the same.

**Test:**
- `:where(.a) p` < `p.b`.
- `:is(#x, .y) p` > `.z p`.
- `[href="#top"]` counts as one class, not an id.

### 4.2 Variables defined inside `@media`

This comes free with 2.1: matching `@media` blocks apply their custom properties like any other rule. Check that variable scoping uses the cascaded declarations (it should) and that nothing reads variables from the raw CSS.

### 4.3 Tailwind detection heuristic

**Now:** Tailwind mode (no UA defaults) is chosen when the source mentions "tailwind" or has no `<style>` and no `style=` attributes. A plain unstyled HTML page with no CSS at all gets no browser defaults, so headings come out at body size.

**Fix:** choose Tailwind mode only when the source mentions tailwind, or when more than about 30% of the elements' class names are recognised by `tailwindToStyle`. A page with no classes gets UA defaults.

**Test:**
- A bare `<h1>Hi</h1><p>…</p>` page gets a 32px heading.
- A Tailwind fragment with `class="text-lg font-bold"` and no mention of "tailwind" stays in Tailwind mode.

---

## Order and size

| # | Item | Size | Why this order |
|---|------|------|----------------|
| 1 | 2.1 `@media` (+ 4.2) | M | Silently wrong layout on most real pages |
| 2 | 2.5 vw/clamp/currentColor/inherit | S–M | Common in modern CSS; shared with JSX |
| 3 | 3.1 display by CSS, not by tag | M | Nav and inline-block patterns |
| 4 | 3.5 list markers and form controls | M | Visible on almost every plain page |
| 5 | 2.2 `::before`/`::after` | M | Icons and decorations vanish |
| 6 | 3.2 tables | M–L | Pricing and data tables |
| 7 | 4.3 detection, 4.1 specificity | S | Cheap correctness |
| 8 | 3.6 margin collapsing | M | Spacing polish |
| 9 | 3.3 floats, 3.4 fixed/sticky | S–M | Older pages |
| 10 | 2.3 states, 2.4 `@apply`/`@theme` | S / L | Niche; `@theme` classes are the big one |

After each item:
- `npm test` and `npm run typecheck` pass.
- Add a case to `examples/` when it shows a whole-page effect.
- Remove the item from the README's *Not supported → HTML* list.
