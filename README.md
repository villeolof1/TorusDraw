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


## Latest 3D metric geometry update

The 3D preview now uses metric-driven geometry for the surface shape itself, not only for the texture. The preview derives lengths, area, angle, perpendicular heights, and skew from `v1 = (a1, b1)` and `v2 = (a2, b2)`.

- Plane remains an exact affine view of the cell.
- Cylinder now uses an exact metric cylinder model up to global preview scale: linked direction becomes circumference, open perpendicular height becomes cylinder height, and parallelogram skew becomes a helical shift.
- Torus, Möbius, Klein, and double-reversed previews now use metric-driven immersions: the shape responds to the true cell lengths and skew rather than fixed generic formulas.
- The paint-texture 3D path is preserved, so the drawing content and background are still mapped from the actual fundamental cell.

## Latest robustness update

This version adds a geometry-quality guard and safer rendering for extreme/narrow/skewed cells.

- Surface validation now uses relative cell quality, not only the raw determinant, so almost-parallel huge vectors are detected correctly.
- Extremely narrow/skewed but still valid cells use safer rendering instead of silently breaking.
- The main 2D grid switches to line-family rendering in dense cases, avoiding incomplete or randomly capped cell outlines.
- Visible repeat offsets are now capped deliberately around the viewed region rather than by taking the first arbitrary offsets.
- New strokes store canonical cell coordinates (`u`, `v`) alongside world coordinates, reducing repeated unstable basis inversion.
- 3D paint texture rasterization uses a conservative metric scale for large strokes on skewed cells.

## 3D preview notice for reversed links

When a surface uses orientation-reversing edge links, opening the 3D preview now shows a short accuracy notice first. The user can choose **View anyway** to open the coordinate-faithful preview or **Close** to keep it hidden.

## Latest 3D notice behavior

If the 3D preview is already open and a surface/topology update introduces an orientation-reversing edge link, the preview now closes and the 3D accuracy notice opens automatically. This also applies when flipping edge arrows while the 3D preview is visible.

## Latest 3D opacity update

The 3D preview surface mesh now renders at about 80% opacity, giving all 3D models a subtle translucent feel while keeping grid and stroke overlays fully readable.

## Latest 3D opacity slider update

The 3D preview now includes a Model opacity slider inside the 3D panel. It defaults to 100%. Lowering opacity makes the surface translucent; when translucency is active, the surface avoids depth-writing so overlapping transparent walls are less likely to look abruptly cut off.


## Latest layers, presets, and cleaner complex previews update

This version adds a fast Layers panel in place of the old Image panel. The uploaded image is now represented as the Image layer, drawing layers can be added in front, layers can be hidden/shown, reordered, removed, and adjusted for opacity. Drawing objects now store a `layerId`, and the 2D canvas plus 3D preview composite visible layers in layer order.

The Surface panel now includes a compact preset row:
- Default rectangle
- Square
- 60° rhombus / triangular lattice cell
- Golden rectangle

The complex reversed-link 3D previews now use cleaner presentation maps for Möbius/Klein-style surfaces, reducing visually chaotic self-intersection while keeping the same coordinate-based texture/grid pipeline.
## Latest layer-drag and dot-tool update

This version makes layer reordering feel much smoother: a drawing layer can be grabbed from anywhere on its row, follows the pointer as a floating card, and shows a live drop placeholder before release. The image layer is now a fixed background section under the drawing-layer stack instead of a draggable drawing layer.

A new Dot tool has been added. It remembers its own size separately from pen and eraser, defaults small, and stamps outline-only circles wherever you press or drag. The 3D preview line rendering was also densified before seam splitting so straight lines are less likely to miss segments on the model.
## Latest refinement

This version refines the Layers and Dot workflows:

- The fixed Image/background section has its own opacity control again.
- Drawing layers can be dragged from anywhere on the card.
- During layer dragging, the whole card follows the pointer and a same-sized shadow placeholder shows the drop position.
- The Dot tool is visible between Erase and Pan.
- Dot mode is available with `6`.
- Holding `D` temporarily stamps one outline circle without switching tools.
- A dot press always creates exactly one outline circle, even if the pointer moves before release.

## Latest background-opacity and layer-drag fix

This version fixes the background opacity slider so it can be dragged normally. It also makes layer reordering more physical: the original card no longer stays in place while dragging; a floating card follows the pointer, and a same-size shadow placeholder shows where the card will snap on release. Dot default size is now 20.

## Latest image opacity fix

This version fixes the image/background opacity control so it updates the fixed image layer directly and redraws both the 2D canvas and 3D preview immediately. The slider no longer depends on rebuilding the Layers panel while being dragged.

## Latest 3D transparency toggle update

The 3D preview now uses a simple Transparent model toggle instead of the opacity slider. The toggle is on by default. When it is off, the model is fully opaque; when it is on, the model uses the app's subtle transparent preview setting.

## Latest layout and shortcut update

Export, Save, and Open now live in their own top-right file bar, separate from Undo, Redo, and Clear. Pan and Hom are now in a separate small bottom tool bar to the right of the main drawing tool bar.

Tool shortcuts now follow the visible order:
- `1` Pen
- `2` Line
- `3` Dot
- `4` Erase
- `5` Pan
- `6` Hom

## Latest dot seam fix

This version moves the main bottom toolbar slightly left and improves 3D dot rendering. Dot outlines are now rendered as surface-following rings, lifted above the surface to avoid z-fighting, and duplicated across linked seams before splitting so dots that cross cell borders are less likely to appear cut off or buried.

## Latest rub eraser fix

Rub eraser now samples line objects into dense paths before cutting, so it can remove a middle section of a straight line instead of failing or behaving like object erase. Dot objects are converted to an outline path when rubbed, so touching a dot removes only the touched part of its circular outline.

## Latest dot rub eraser fix

Dot rub erasing now treats dots as circular outline paths rather than filled disks. Each sampled outline point gets its own surface coordinates, preventing the strange collapsed/warped behavior from the previous version. Object erasing still removes a whole dot when desired.

## Latest 3D depth/layer fix

The 3D preview now separates image/background texture from drawing overlays. Drawing layers are rendered as true 3D stroke geometry, layer by layer, with depth writing enabled. This preserves layer order when marks are on the same surface area, but lets actual 3D depth win when one mark is on the far side of a transparent model.

## Latest 3D shortcut update

The 3D model preview now uses `M` as its shortcut. The 3D transparent/opaque mode can be toggled with `T`. Tooltips and the Help panel list both shortcuts.

## Latest 3D overlap/order fix

Thick overlapping strokes in the 3D preview now get tiny layer/object lift offsets along the surface normal. This reduces z-fighting and visual squashing when colored strokes intersect on the same surface area, while still preserving true 3D depth for far-side marks on transparent models.

## Latest layer-card controls and save/restore update

The Layers panel now puts show/hide, delete, and opacity directly on each drawing-layer card. The old separate selected-layer control area has been removed to save space. The visibility control now uses an eye-style icon, hidden layers use a closed-eye style, and each card has its own trash button and opacity slider.

Project save/open now preserves the full layer state: layer order, layer visibility, layer opacity, active layer, and each object's `layerId`, so reopening a saved project should restore the drawing stack exactly.

## Latest save/open layer restore fix

Opening a saved project now restores the saved layer list before loading the background image. This prevents the image-loading normalization step from seeing unknown saved `layerId`s and incorrectly moving all objects into one default layer. Saved projects should now reopen with every object on its original layer.
