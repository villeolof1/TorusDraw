# Torus Drawing Pane

A minimalist object-based web drawing app with infinite pan, bounded zoom, and customizable torus/cylinder repeats.

## Run

The app is dependency-free at runtime. You can open `index.html` directly in a browser.

For a local dev server:

```bash
npm install
npm run start
```

Then open the local URL shown by Vite, usually:

```text
http://localhost:5173
```

## What it does

- Draw freehand pen strokes and straight lines.
- Pan forever in any direction.
- Zoom with the vertical slider, +/- buttons, or mouse/trackpad wheel.
- Use two displacement vectors:
  - `v1 = (a1, b1)`
  - `v2 = (a2, b2)`
- Choose which vectors repeat:
  - Repeat v1 + Repeat v2 = torus.
  - Repeat v1 only = cylinder along v1.
  - Repeat v2 only = cylinder along v2.
  - Neither = ordinary non-repeating drawing plane.
- Default surface is a clean rectangle:
  - `v1 = (600, 0)`
  - `v2 = (0, 420)`
- Hide or show the grid. The **Hide grid** option is off by default, so the grid is visible initially.
- Upload an image as a fixed full-screen background. It does not scroll with the torus.
- Undo, redo, and clear.

## Important behavior

Surface settings do **not** update while typing. Edit the numbers or repeat checkboxes, then click **Update surface**.

If you already have a drawing and change the surface, the app asks for confirmation before clearing the drawing. If you cancel, nothing changes and the fields return to the active surface.

## Line modifiers

These apply only to the Line tool:

- **Shift** snaps to 0°, 45°, 90°, etc.
- **Alt/Option** draws equally on both sides of the start point.
- **Shift + Alt/Option** combines both behaviors.

Pen drawing is unaffected by Shift and Alt/Option.

## Shortcuts

- `1` or `P`: Pen
- `2` or `L`: Line
- `3` or `V`: Pan
- `Space`: temporary pan
- `+` / `-`: zoom in/out
- `0`: center view
- `G`: show/hide surface panel
- `U`: update surface
- `H`: toggle Hide grid
- `I`: upload image
- `Esc`: close surface panel
- `Ctrl/Cmd + Z`: undo
- `Ctrl/Cmd + Shift + Z` or `Ctrl/Cmd + Y`: redo

## Architecture

The app stores drawings as objects, not permanent pixels. Each object contains:

- unique id
- type (`pen` or `line`)
- color
- stroke size
- world-space points

Rendering is camera-based:

- The viewport has a center point and zoom level.
- Panning changes only the camera center; it is unbounded.
- Zooming is bounded for usability and performance.
- Repeated copies are generated from integer offsets of active displacement vectors.
- The grid is rendered as line families when both repeats are active, so very small cells still cover the whole viewport instead of stopping halfway across the screen.
