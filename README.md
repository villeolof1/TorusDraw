# Torus Drawing Pane

A minimalist object-based web drawing app with infinite pan, bounded zoom, customizable torus/cylinder repeats, subtle pen polish, erasing, image-in-cell backgrounds, project save/load, autosave, PNG export, and a lightweight 3D surface preview.

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

## Core drawing

- Draw freehand pen strokes and straight lines.
- Use a subtle pressure-aware pen when a stylus reports pressure.
- Erase in two ways, with the Object/Rub choice shown next to the Erase button:
  - **Object** eraser removes whole strokes/lines when touched.
  - **Rub** eraser cuts through strokes more like a normal eraser.
- The single Size input is context-sensitive:
  - Pen/Line remember their drawing size.
  - Erase remembers its eraser size separately.
- Pan forever in any direction.
- Zoom with the vertical slider, +/- buttons, or mouse/trackpad wheel.
- Save/load editable project files.
- Export the current viewport as PNG.
- Autosave to the browser and restore on reload.
- Undo, redo, and clear.

## Surface model

The surface uses two displacement vectors:

- `v1 = (a1, b1)`
- `v2 = (a2, b2)`

From the Surface panel you can choose which vectors repeat:

- Repeat v1 + Repeat v2 = torus.
- Repeat v1 only = cylinder along v1.
- Repeat v2 only = cylinder along v2.
- Neither = ordinary non-repeating drawing plane.

The default surface is a clean rectangle:

- `v1 = (600, 0)`
- `v2 = (0, 420)`

Surface settings do **not** update while typing. Edit the numbers or repeat checkboxes, then click **Update surface**.

**Reset surface** immediately applies the default rectangular surface. If an existing drawing would be cleared, the app asks first.

## Images

Click **Image** to open the Image panel. Uploaded images are part of the repeated surface, not fixed wallpaper. Each cell gets its own clipped copy of the image.

The Image panel includes:

- Upload / replace image
- Remove image
- Crop / Stretch / Manual fit modes
- Image opacity
- Fit surface to image
- Edit image placement

Fit modes:

- **Crop**: preserves image proportions, zooming/cropping as needed to cover each cell.
- **Stretch**: forces the image to fill the cell, including skewed parallelogram cells.
- **Manual**: lets you place the image exactly inside the base cell. Anything outside the cell is cropped.

Manual placement:

- Drag the image rectangle to move it.
- Drag the corner dot to resize it.
- Use **Keep proportions** to switch between normal proportional scaling and free stretching.
- Click **Done** to save placement, or **Cancel** to discard.

Use **Fit surface to image** to create a clean rectangular surface with the image’s aspect ratio. If a drawing already exists, fitting the surface asks before clearing it.

## 3D preview

Use the floating **3D** button to show the current surface dimensions as a simplified 3D object:

- torus when both repeat directions are enabled
- cylinder when one repeat direction is enabled
- plane when repeats are off

The preview is interactive: drag to rotate and use the mouse wheel to zoom. It shows the surface dimensions only, not the pencil strokes.

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
- `I`: show/hide image panel
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
- Uploaded images, grid lines, and strokes all render through the same surface/cell system.
