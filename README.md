# Torus Drawing Pane

A minimalist object-based drawing app for drawing on a configurable repeated surface.

The app supports:

- Pen, line, pan, and two eraser modes.
- One shared Size input that remembers pen/line size and eraser size separately.
- Default eraser size: **20**.
- Infinite panning and bounded zoom.
- Custom surface vectors `v1 = (a1, b1)` and `v2 = (a2, b2)`, where positive `a` goes right and positive `b` goes up.
- Edge-gluing arrows in the Surface panel: open plane, cylinders, torus, Möbius-style bands, and Klein-style surfaces without presets.
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

The edge diagram controls how the cell sides are glued. Matching arrows are linked sides; removing a pair leaves those sides open. Clicking a linked side flips its arrow direction, which creates reversed gluings such as Möbius-style and Klein-style surfaces.

Changing only the edge arrows does not clear the drawing, because the drawing still lives in the same cell. Changing `v1`/`v2` geometry still asks before clearing existing drawing data.

Typed surface changes do not apply while typing. Click **Update** to apply them. Updating keeps the origin/anchor fixed and does not automatically recenter the view; use **Center** or **Fit cell** when you explicitly want the camera to move. **Reset surface** applies immediately and asks before clearing an existing drawing if necessary.

## Edge gluing

The Surface panel contains a small cell diagram. The blue `A` arrows link left/right edges; the orange `B` arrows link bottom/top edges. Use **Remove A** or **Remove B** to leave that pair open. Click an arrow to reverse that side of the identification.

Common results emerge from the arrows rather than presets:

- no links = plane
- one same-direction link = cylinder
- one reversed link = Möbius-style band
- two same-direction links = torus
- one same and one reversed link = Klein-style surface

## 3D preview accuracy

The 3D preview maps the drawing through the same surface coordinates used by the 2D canvas:

1. A drawing point is converted into `(u, v)` coordinates relative to `v1` and `v2`.
2. Repeated coordinates wrap according to the active topology.
3. The point is placed on the 3D torus, cylinder, Möbius-style, Klein-style, or plane preview.

This makes the preview topologically accurate: wrapping direction, cylinder direction, skewed/parallelogram coordinates, background texture placement, and drawing placement all follow the active surface parameters. The 3D model is a readable visual embedding of that topology, not a claim that every possible flat torus lattice can be isometrically embedded in ordinary 3D space.


## Homology tool

Choose **Hom** or press `5`, then click a stroke. The main value `(m, n)` counts the net integer grid crossings along the actual path: the first number is crossings along `v1`, and the second is crossings along `v2`. Under it, the label also shows the raw endpoint displacement rounded to two decimals. Open/non-linked directions are shown as `—`; on a plane there is no homology class.

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

The 3D preview uses a mostly white model with subtle depth and readable strokes rendered on the surface.

## Latest 3D preview update

The 3D preview renderer was restored to the earlier cleaner model style while keeping the current app features around it. The toolbar order is now Pen, Line, Erase, Pan, Hom. Surface updates keep the currently viewed cell origin anchored on screen, so changes such as a2 feel more stable when panned around repeated cells.

## 3D renderer accuracy update

The 3D preview now uses a WebGL parameter-surface renderer. The single surface cell is mapped to the full torus/cylinder/plane, and the grid, uploaded image texture, and drawing strokes all use the same `(u, v)` cell coordinates. Strokes are rendered as small lifted ribbons on the surface, with depth testing so far-side strokes are hidden by the torus instead of appearing through it or floating in the air.

## Latest gluing/seam fix

The 3D renderer now splits stroke segments at cell seams before mapping them to the surface, then applies the linked-edge flip logic before building lifted stroke ribbons. This prevents strokes from being drawn as chords through the torus or across Möbius/Klein seams. The edge diagram arrows were also made smaller and centered on each side.

## Latest layout update

The interface is now split into smaller floating control groups instead of one large toolbar:

- Bottom center: Color, Size, Pen, Line, Erase, Pan, Hom.
- Eraser Object/Rub controls animate in only while Erase is selected.
- Top center: Undo, Redo, Clear, Export, Save, Open.
- Right side: Image button above Surface button, each opening a right-side floating panel.
- Bottom left: ? above 3D; opening one closes the other.

## Latest layout adjustment

The 3D and help buttons are now in the bottom-right area, positioned to the left of the zoom rail so their panels do not overlap the zoom controls. The Image and Surface launcher buttons are now in the bottom-left area.

## Latest 3D coordinate-domain update

The 3D preview has been refactored so the rendered surface is generated strictly from the single fundamental cell domain. New `surfaceDomain.js` and `surfaceMap.js` modules define the cell coordinates, edge gluing, surface classification, and coordinate-to-3D mapping. Surface mesh triangles, grid ribbons, image texture coordinates, and stroke ribbons now all use the same map from valid `(u, v)` coordinates inside `[0,1] × [0,1]`, preventing grey/unreachable surface patches from being generated as separate fallback geometry.

## Latest non-orientable 3D preview fix

The 3D preview now distinguishes ordinary Klein-style single-reversal gluings from double-reversed edge schemes. Single-reversal cases use an immersed Klein coordinate map; double-reversed cases use a stable full-cell inspection map so every visible surface patch still comes from reachable `(u, v)` cell coordinates. Grid/stroke overlays are drawn after the surface with depth bias and much smaller lift, which prevents non-orientable normals from burying the grid/strokes inside the surface.

## Latest 3D grid/non-orientable update

The 3D preview grid now draws internal coordinate lines separately from linked seams and open boundaries, so linked surfaces no longer show duplicate boundary grids. Grid overlays now write depth before strokes, reducing the appearance of ghost grids on immersed/self-overlapping previews. Double-reversed A/B edge schemes are rendered as a closed Klein-like coordinate preview rather than as an open inspection sheet.
