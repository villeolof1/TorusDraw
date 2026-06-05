# Torus Drawing App

A minimalist, object-based drawing app for surfaces built from one fundamental cell. The same drawing can be viewed as a plane, cylinder, torus, Möbius strip, Klein bottle, or projective plane depending on how the cell edges are glued.

## What it does

- Draws on a single editable cell defined by two vectors, `v1 = (a1, b1)` and `v2 = (a2, b2)`.
- Repeats the cell according to the selected edge links.
- Supports preserved and reversed edge directions.
- Shows a 3D preview generated from the same fundamental-cell coordinates.
- Saves and opens editable `.torusdraw` project files.
- Autosaves through IndexedDB so larger image projects are less likely to be lost.

## Tools

The bottom toolbar contains:

- **Pen** — freehand drawing.
- **Line** — straight line; Shift or Snap constrains angle.
- **Ellipse** — Shift or Constrain makes a circle; Alt or From center draws outward from the start point.
- **Rect** — Shift or Constrain makes a square; Alt or From center draws outward from the start point.
- **Dot** — circular point marker.
- **Select** — click/tap an object to move, delete, duplicate, recolor, or resize it.
- **Erase** — object delete or rub eraser.
- **Pan** — move the view.
- **Hom** — inspect cell displacement / homology-style crossings.

Rectangle and ellipse support three modes: **Outline**, **Fill**, and **Both**.

## Layers

The image layer is always behind drawing layers. Drawing layers can be added, reordered, hidden, deleted, and given their own opacity. Layer rows are created with DOM nodes and text content rather than raw HTML, so project-file layer names are displayed safely as text.

## Surface vectors and edge gluing

The Surface panel controls the cell vectors and edge links. Clicking edge arrows reverses an identification; removing a pair leaves that direction open.

Changing dimensions now keeps drawings attached to their existing cell coordinates by default. This means drawings remain in the same relative `u/v` location when the cell is reshaped.

## 3D preview

The 3D panel includes:

- drag to rotate,
- wheel/pinch-style zoom,
- a 0°–540° twist slider,
- Reset view,
- Export 3D PNG,
- 3D grid toggle,
- display modes: Solid, Transparent, X-ray, and Front,
- optional Silhouette readability aid,
- a Surface accuracy note with seam-error checks.

The 3D preview uses smooth immersions for closed and non-orientable surfaces. For Klein bottles and projective planes, self-intersection is mathematically unavoidable in ordinary 3D, so the preview aims to be seam-exact, smooth, readable, and dimension-responsive rather than an impossible perfect paper embedding.

Paint on non-orientable or self-intersecting previews is baked into the surface texture to avoid strokes being lifted onto the wrong local side and appearing cut off.

## Phone and touch use

The layout adapts using viewport size and pointer capability rather than user-agent sniffing.

- On compact screens, panels become bottom sheets.
- Toolbars are horizontally scrollable when space is tight.
- Touch modifier buttons replace keyboard-only Shift/Alt behavior.
- One finger draws; two fingers pan/zoom the canvas.
- Secondary actions are available through the More button.

## Keyboard shortcuts

- `1` / `P`: Pen
- `2` / `L`: Line
- `3` / `O`: Ellipse
- `4` / `R`: Rectangle
- `5`: Dot
- `6` / `S`: Select
- `7` / `E`: Erase
- `Shift+7` / `Shift+E`: Toggle eraser mode
- `8` / `V`: Pan
- `9`: Homology
- `Shift`: Snap/constrain
- `Alt`: Draw from center
- `Space`: Temporary pan
- `C`: Clear drawing
- `Shift+C`: Full reset
- `F`: Fit cell
- `M`: 3D preview
- `T`: Toggle transparent 3D mode
- `G`: Surface panel
- `U`: Update surface
- `H`: Toggle 2D grid
- `I`: Layers panel
- `?`: Help
- `Ctrl/Cmd+S`: Save project
- `Esc`: Close panels
- `Ctrl/Cmd+Z`: Undo
- `Ctrl/Cmd+Shift+Z` / `Ctrl/Cmd+Y`: Redo

## Development and tests

Run syntax and smoke tests with:

```bash
npm test
```

Current tests cover:

- seam identities for torus, cylinder, Möbius, Klein bottle, and projective plane,
- object clone / storage roundtrip smoke behavior,
- responsive layout CSS smoke checks.

## Known mathematical notes

- Planes and cylinders can be represented very directly in 3D.
- Tori, Klein bottles, and projective planes cannot all be shown as perfectly flat paper embeddings in ordinary 3D.
- The app prioritizes exact edge identity behavior, smooth immersions, readable drawing placement, and honest surface notes.
