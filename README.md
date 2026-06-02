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
- Erase in two ways, with the Object/Rub choice shown next to the Erase button:
  - **Object** eraser removes whole strokes/lines when touched.
  - **Rub** eraser cuts through strokes more like a normal eraser.
  - The eraser uses the same Size input as the pen.
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
- Upload an image into every surface cell. The image repeats with the boxes, clips to parallelogram cells, and can use Crop or Stretch fit mode.
- Save/load editable project files.
- Export the current viewport as PNG.
- Autosave to the browser and restore on reload.
- Undo, redo, and clear.

## Important behavior

Surface settings do **not** update while typing. Edit the numbers or repeat checkboxes, then click **Update surface**.

**Reset surface** is different: it immediately resets and applies the default rectangular surface. It also restores the default repeat/grid/image-fit settings. If there is an existing drawing and the reset would change the surface, the app asks before clearing it.

If you already have a drawing and change the surface, the app asks for confirmation before clearing the drawing. If you cancel, nothing changes and the fields return to the active surface.


## Images in cells

Uploaded images are part of the repeated surface, not fixed wallpaper. Each cell gets its own clipped copy of the image. In the Surface panel you can choose:

- **Crop**: preserve the image proportions, zooming/cropping as needed to cover each cell.
- **Stretch**: force the image to fill the cell, including skewed parallelogram cells.

Use **Fit surface to image** to create a clean rectangular surface with the same aspect ratio as the uploaded image. The app keeps the longest side reasonably sized so the cells do not become enormous. If a drawing already exists, fitting the surface to the image asks before clearing it.

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
- `Shift + E`: toggle Object/Rub eraser mode
- `3` or `V`: Pan
- `C`: clear drawing
- `Space`: temporary pan
- `+` / `-`: zoom in/out
- `0`: center view
- `F`: fit one cell to view
- `G`: show/hide surface panel
- `U`: update surface
- `H`: toggle Hide grid
- `I`: upload image into cells
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
