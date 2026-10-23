# Step 00 — Orchestrator

Project: Figma plugin that converts pasted React JSX (Tailwind classes and/or inline `style`) into Figma layers. Repo root: `paste-to-layers/`.

## Context
The user wants a Figma plugin: paste a React component (JSX using Tailwind classes and/or `style={{}}`) and get real Figma layers (auto-layout frames, text, fills, borders, radii, shadows). This is a new standalone project at `/Users/eva/Dev/thecodecafe/paste-to-layers/` with no existing code to reuse.

The work is split into an **orchestrator** plan plus **self-contained worker steps**, so smaller or cheaper agents can each take one step without reading the others. Once this plan is approved, the first action is writing these sections out as files:

```
paste-to-layers/plans/
  00-orchestrator.md
  01-scaffold-and-contracts.md
  02-colors.md
  03-tailwind.md
  04-inline-style.md
  05-jsx-parser.md
  06-figma-renderer.md
  07-ui-and-wiring.md
  08-examples-and-qa.md
```

Each step file includes the shared contract below **in full**, so a worker never needs another step's file.

## 00 — Orchestrator

**Goal:** coordinate the workers, enforce the contract, and integrate the results.

**Dependency graph**
```
01 scaffold+contracts
 ├─► 02 colors ─► 03 tailwind ─┐
 ├─► 04 inline-style ──────────┼─► 05 parser ─► 07 ui+wiring ─► 08 QA
 └─► 06 figma renderer ────────┘                    ▲
                                  06 ───────────────┘
```

**Waves**
1. Wave 1: step 01, done by the orchestrator itself (it's small and it fixes the contract).
2. Wave 2, in parallel: 02, 04, 06.
3. Wave 3: 03 (needs 02).
4. Wave 4: 05 (needs 03, 04).
5. Wave 5: 07.
6. Wave 6: 08.

**Rules for the orchestrator**
- Give each worker only its step file and tell it to touch only the files listed under "Owns".
- Nobody except the orchestrator edits `src/types.ts`. If a worker needs a contract change, it reports that rather than editing the file.
- After each wave, run `npm run typecheck && npm test`. If anything fails, send it back to the owning worker with the error output.
- Done when step 08's checklist passes.

## Shared contract (copied verbatim into every step file)

`src/types.ts`:
```ts
export type RGBA = { r: number; g: number; b: number; a: number }; // 0..1
export type Sizing = 'HUG' | 'FILL' | 'FIXED';

export interface NormalizedStyle {
  // layout
  display?: 'flex' | 'block' | 'none';
  direction?: 'row' | 'column';
  gap?: number;
  padding?: { top: number; right: number; bottom: number; left: number };
  justify?: 'start' | 'center' | 'end' | 'between';
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  wrap?: boolean;
  width?: number; height?: number;
  widthSizing?: Sizing; heightSizing?: Sizing;
  minWidth?: number; maxWidth?: number;
  position?: 'absolute' | 'relative';
  top?: number; left?: number;
  // box
  background?: RGBA;
  radius?: number | [number, number, number, number]; // tl,tr,br,bl
  border?: { width: number; color: RGBA };
  shadows?: { x: number; y: number; blur: number; spread: number; color: RGBA }[];
  opacity?: number;
  overflowHidden?: boolean;
  // text
  color?: RGBA;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  lineHeight?: number | 'auto';   // px
  letterSpacing?: number;         // px
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textTransform?: 'upper' | 'lower' | 'none';
  textDecoration?: 'underline' | 'line-through' | 'none';
}

export type IRNode =
  | { kind: 'frame'; name: string; tag: string; style: NormalizedStyle; children: IRNode[] }
  | { kind: 'text'; name: string; text: string; style: NormalizedStyle; spans?: TextSpan[] }
  | { kind: 'image'; name: string; style: NormalizedStyle }
  | { kind: 'svg'; name: string; svg: string; style: NormalizedStyle };

/** Styled character range inside a text node; `style` is the full text style for that range. */
export interface TextSpan { start: number; end: number; style: NormalizedStyle }

export interface ConvertResult { root: IRNode; warnings: string[] }

// UI → sandbox
export type ToSandbox = { type: 'render'; payload: ConvertResult };
// sandbox → UI
export type ToUI = { type: 'done'; nodeCount: number; warnings?: string[] } | { type: 'error'; message: string };
```

**Conventions:**
- All lengths are in px numbers, with `1rem = 16px`.
- Pure modules (02–05) must not import from `figma`.
- Tests sit next to each module as `*.test.ts` and use vitest.

## Verification
1. `cd paste-to-layers && npm install && npm run typecheck && npm test && npm run build`.
2. In Figma desktop: import `manifest.json`, paste each file from `examples/`, and confirm the layer structure, auto layout, and styles look right. Also confirm warnings show up for `hover:` classes.
