# Torus Drawing Pane

A minimalist object-based drawing app for drawing on a configurable repeated surface.

The app supports:

- Pen, line, pan, and two eraser modes.
- One shared Size input that remembers pen/line size and eraser size separately.
- Default eraser size: **20**.
- Infinite panning and bounded zoom.
- Custom surface vectors `v1 = (a1, b1)` and `v2 = (a2, b2)`, where positive `a` goes right and positive `b` goes up.
- Torus, cylinder, or plane behavior through Repeat v1 / Repeat v2.
- Image backgrounds inside each cell, with Crop or Stretch fitting.
- Image opacity, defaulting to **90%**.
- Prompt to fit the surface dimensions to the image when uploading.
- PNG export, editable project save/load, autosave, undo/redo.
- A visible **3D** preview button showing the surface, drawing, and uploaded image mapped onto the model.
- A **Hom** tool for selecting a stroke and reading its homology displacement `(m, n)`.

## Run

Use a local server because the project is split into clean JavaScript modules.

```bash
npm install
npm run start
```

Then open the URL shown by Vite, usually:

```text
http://localhost:5173
```

## Project structure

The project deliberately avoids numbered filenames and tiny one-purpose folders. Files are grouped by responsibility:

```text
index.html
package.json
README.md
src/css/base.css       page and shared element styling
src/css/toolbar.css    toolbar, zoom rail, status, shortcuts button
src/css/panels.css     floating panels and panel-specific controls
src/js/state.js        central app state and object cloning
src/js/math.js         vector math, cell coordinates, repeat offsets
src/js/dom.js          DOM lookup, panels, status, angle hint
src/js/render2d.js     main 2D canvas drawing
src/js/drawing.js      pointer input, tools, line snapping, eraser
src/js/history.js      undo/redo and clear history
src/js/surface.js      surface settings, image settings, export, zoom
src/js/storage.js      save/load project and browser autosave
src/js/preview3d.js    3D surface preview and drawing projection
src/js/main.js         app startup and event wiring
```

## Surface model

The Surface panel uses mathematical direction: positive `a` means right, and positive `b` means up. Internally the canvas still uses browser coordinates, but users never need to think about that conversion.

The base cell is the parallelogram spanned by:

```text
v1 = (a1, b1)
v2 = (a2, b2)
```

Each repeated copy is shifted by an integer combination of those vectors:

```text
i * v1 + j * v2
```

- Repeat v1 + Repeat v2 = torus.
- Repeat v1 only = cylinder along v1.
- Repeat v2 only = cylinder along v2.
- Neither repeat = ordinary plane.

Typed surface changes do not apply while typing. Click **Update** to apply them. Updating keeps the origin/anchor fixed and does not automatically recenter the view; use **Center** or **Fit cell** when you explicitly want the camera to move. **Reset surface** applies immediately and asks before clearing an existing drawing if necessary.

## 3D preview accuracy

The 3D preview maps the drawing through the same surface coordinates used by the 2D canvas:

1. A drawing point is converted into `(u, v)` coordinates relative to `v1` and `v2`.
2. Repeated coordinates wrap according to the active topology.
3. The point is placed on the 3D torus, cylinder, or plane preview.

This makes the preview topologically accurate: wrapping direction, cylinder direction, skewed/parallelogram coordinates, background texture placement, and drawing placement all follow the active surface parameters. The 3D model is a readable visual embedding of that topology, not a claim that every possible flat torus lattice can be isometrically embedded in ordinary 3D space.

The **Enhanced visibility** toggle is on by default. It makes preview strokes easier to see by enlarging their displayed thickness and adding a subtle lift/halo. Position, wrapping, background texture mapping, and occlusion remain accurate, but the preview line thickness is visually enlarged.

## Homology tool

Choose **Hom** or press `5`, then click a stroke. The main value `(m, n)` counts the net integer grid crossings along the actual path: the first number is crossings along `v1`, and the second is crossings along `v2`. Under it, the label also shows the raw endpoint displacement rounded to two decimals. On cylinders, non-repeating directions are shown as `—`; on a plane there is no homology class.

## Image workflow

Click **Image** to open the image panel.

- Upload / replace image.
- Remove image.
- Choose Crop or Stretch.
- Adjust opacity.
- Fit the surface to the image aspect ratio.

When you upload an image, the app asks whether to set the surface dimensions to match the image aspect ratio, because that is usually the desired setup.

Manual image placement has been removed to keep the workflow simple and predictable.

## Shortcuts

- `1` or `P`: Pen
- `2` or `L`: Line
- `3` or `E`: Erase
- `Shift + 3` or `Shift + E`: toggle Object/Rub eraser
- `4` or `V`: Pan
- `5`: Homology tool
- `Shift`: line snap, 15° increments
- `Alt`: draw line from center
- `Space`: temporary pan
- `C`: clear
- `Shift+C`: full reset after confirmation
- `F`: fit one cell
- `G`: surface panel
- `I`: image panel
- `?`: help panel
- `Ctrl/Cmd + S`: save project
- `Ctrl/Cmd + Z`: undo
- `Ctrl/Cmd + Shift + Z` or `Ctrl/Cmd + Y`: redo

## Refactored structure notes

No source file is numbered. The project is intentionally kept to 16 actual files with a small, clear structure and no tiny one-purpose folders.


## Full reset

Press `Shift+C` to reset the entire app to a blank default state. The app asks first because this clears the drawing, image, surface settings, history, and autosave, and it cannot be undone.

## 3D preview readability

The 3D preview uses a mostly white model with subtle depth. With **Enhanced visibility** on, strokes are drawn thicker and clearer in the preview with a note that preview thickness is visually enlarged. With it off, stroke width stays closer to the calculated surface size.

## Latest 3D preview update

The 3D preview renderer was restored to the earlier cleaner model style while keeping the current app features around it. The toolbar order is now Pen, Line, Erase, Pan, Hom. Surface updates keep the currently viewed cell origin anchored on screen, so changes such as a2 feel more stable when panned around repeated cells.

## 3D renderer accuracy update

The 3D preview now uses a WebGL parameter-surface renderer. The single surface cell is mapped to the full torus/cylinder/plane, and the grid, uploaded image texture, and drawing strokes all use the same `(u, v)` cell coordinates. Strokes are rendered as small lifted ribbons on the surface, with depth testing so far-side strokes are hidden by the torus instead of appearing through it or floating in the air. Enhanced visibility still enlarges preview stroke thickness for readability, but the stroke position and wrapping remain tied to the surface coordinates.
