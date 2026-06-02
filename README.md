# Torus Drawing Pane

A minimalist object-based web drawing app with infinite pan, bounded zoom, customizable torus/cylinder repeats, subtle pen polish, erasing, project save/load, autosave, and PNG export.

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
- Use a subtle pressure-aware pen when a stylus reports pressure.
- Erase in two ways:
  - **Object** eraser removes whole strokes/lines when touched.
  - **Rub** eraser cuts through strokes more like a normal eraser.
- Pan forever in any direction.
- Zoom with the vertical slider, +/- buttons, or mouse/trackpad wheel.
- Use two displacement vectors:
  - `v1 = (a1, b1)`
  - `v2 = (a2, b2)`
- Choose which vectors repeat from the Surface panel:
  - Repeat v1 + Repeat v2 = torus.
  - Repeat v1 only = cylinder along v1.
  - Repeat v2 only = cylinder along v2.
  - Neither = ordinary non-repeating drawing plane.
- Default surface is a clean rectangle:
  - `v1 = (600, 0)`
  - `v2 = (0, 420)`
- Hide or show the grid. The **Hide grid** option is off by default, so the grid is visible initially.
- Upload an image as a fixed full-screen background. It does not scroll with the torus.
- Save/load editable project files.
- Export the current viewport as PNG.
- Autosave to the browser and restore on reload.
- Undo, redo, and clear.

## Important behavior

Surface settings do **not** update while typing. Edit the numbers or repeat checkboxes, then click **Update surface**.

**Reset fields** is different: it immediately resets and applies the default rectangular surface. If there is an existing drawing and the reset would change the surface, the app asks before clearing it.

If you already have a drawing and change the surface, the app asks for confirmation before clearing the drawing. If you cancel, nothing changes and the fields return to the active surface.

## Line modifiers

These apply only to the Line tool:

- **Shift** snaps to 15° increments and shows the snapped angle.
- **Alt/Option** draws equally on both sides of the start point.
- **Shift + Alt/Option** combines both behaviors.

Pen drawing is unaffected by Shift and Alt/Option.

## Shortcuts

- `1` or `P`: Pen
- `2` or `L`: Line
- `4` or `E`: Erase
- `3` or `V`: Pan
- `C`: clear drawing
- `Space`: temporary pan
- `+` / `-`: zoom in/out
- `0`: center view
- `F`: fit one cell to view
- `G`: show/hide surface panel
- `U`: update surface
- `H`: toggle Hide grid
- `I`: upload image
- `?`: show/hide shortcut help
- `Esc`: close panels
- `Ctrl/Cmd + S`: save editable project
- `Ctrl/Cmd + Z`: undo
- `Ctrl/Cmd + Shift + Z` or `Ctrl/Cmd + Y`: redo

## Architecture

The app stores drawings as objects, not permanent pixels. Each object contains:

- unique id
- type (`pen` or `line`)
- color
- stroke size
- world-space points
- subtle pressure values when available

Rendering is camera-based:

- The viewport has a center point and zoom level.
- Panning changes only the camera center; it is unbounded.
- Zooming is bounded for usability and performance.
- Repeated copies are generated from integer offsets of active displacement vectors.
- The grid is rendered as line families when both repeats are active, so very small cells still cover the whole viewport instead of stopping halfway across the screen.
