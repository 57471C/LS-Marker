# LS-Marker

Draw bounding boxes and segmentation polygons on part photos, run QA review, audit dataset health, and stream YOLO / COCO training exports.

## Windows Setup

1. Install [Node.js 22](https://nodejs.org/).
2. In this folder run `npm install`.  
   `better-sqlite3` ships a prebuild. If install tries to compile and fails, install the Visual Studio Build Tools workload “Desktop development with C++”, then run `npm install` again.
3. *(Optional — for AI Auto-Trace)* Place the binary SAM2.1 Hiera Tiny ONNX models in `public/models/` (gitignored):
   - `public/models/sam2_hiera_tiny_encoder.onnx` (~104 MB)
   - `public/models/sam2_hiera_tiny_decoder.onnx` (~16 MB)
4. Run `npm run dev`.
5. Open the address it prints. The app listens on port **8080**.
6. Sign in, then pick a project or create one. A project is a name plus a photo folder that already exists (`C:/Users/you/Pictures/parts` is fine). Each project has its own parts catalogue.

`labelling.config.json` only names the first project’s folder (`samples` unless you change it before the first run). After that, projects live in the SQLite database (`data/labels.db`).

## Canvas & Labelling Tools

- **Box ↔ Polygon Mode**: Toggle between standard rectangle bounding boxes (`5` tokens: `class_id cx cy w h`) and multi-vertex segmentation polygons (`class_id x1 y1 x2 y2 ... xn yn`). Click the convert button (`Repeat` icon) to convert a selected box to a 4-point polygon or vice versa.
- **Outline ↔ Precision Filled Mode**: Toggle between standard outline mode (with visible corner/vertex handles) and precision filled mode (semi-transparent fill, thin 1px border, and invisible grab handles for unobstructed nudging and resizing).
- **Crosshairs & `(0,0)` Pixel Readout**: Toggle full-canvas horizontal and vertical tracking lines with a floating pixel coordinate readout. Left-clicking on the canvas zeros the origin to `(0, 0)` at that point to measure relative pixel offsets `(Δx, Δy) px`. Press `Esc` to reset the origin.
- **SAM2.1 Auto-Trace (`Trace`)**: Client-side interactive segmentation powered by `onnxruntime-web` (uses **WebGPU** when available and falls back automatically to **WASM/CPU**):
  - **Persistent Browser Cache (`ls-marker-sam2-cache-v1`)**: Models are streamed once with a 0–100% progress bar and stored in the browser’s native Cache Storage API (`src/services/samCache.ts`), loading directly from local disk in `<50 ms` on subsequent visits. Use **Settings → Clear Model Cache** to refresh cached weights if updated on disk.
  - **Multi-Point Interactive Prompting**:
    - **Left-Click**: Add a positive/foreground point (`label = 1`, green indicator).
    - **Right-Click / `Shift + Left-Click`**: Add a negative/background point (`label = 0`, red indicator) to exclude bench background halos or adjacent parts in real time.
    - **`Enter` or Double-Click**: Commit the traced polygon to the active annotations and clear prompt markers.
    - **`Escape`**: Cancel the current prompt session and clear indicators.
    - **`Ctrl + Left-Click` / `Ctrl + Right-Click`**: Add positive (`+`) or negative (`-`) refinement points to an already-selected polygon.
  - **Tighter Boundary Thresholding**: Uses `0.25` logit (`0.58` probability) thresholding, discards internal holes and micro-islands (`< 15 px²`), and simplifies contours with high-quality Douglas-Peucker (`0.9 px` tolerance) to hug physical part boundaries without background halos.
  - **`Ctrl + Z`**: Multi-step undo stack that reverts the last prompt point, selection refinement, move, resize, nudge, or shape creation/deletion.
- **Duplicate (`Ctrl+D`) & Previous Boxes**: Copy the selected (or last) shape, or copy all shapes from the previous photo onto an empty photo.
- **Arrow Keys**: Nudge the selected box or polygon (`Shift + Arrow` for larger steps). With nothing selected, `Left` and `Right` navigate between photos.
- **No Parts (`N`)**: Saves an empty `.txt` label file (clean bench negative sample) and advances to the next open photo.

## Classes & Part Dimensions Metadata

- **Classes** manages item codes (`ic`), descriptions (`des`), and colours. Numeric class IDs are permanently anchored (`max(id) + 1`) and never reused or re-sorted.
- **Part Dimensions (Optional Reference Metadata)**: Each class can optionally specify a `part_type` (`bolt`, `nut`, `washer`, `cable_tie`, or `other`) and measurement values in `mm`, complete with an interactive **`? How to measure`** SVG diagram popover and a status icon next to **Edit** (red ruler when unset/incomplete, green part icon when complete).
- **Dataset Health**: Audits class balance ($\ge 15$ samples/class target), negative samples, and missing part dimensions without blocking training readiness.

## People, Claims & QA Workflow

- Labellers sign in with a username and password. **Settings** is locked with the shared password `admin`.
- Opening or saving a free image claims an atomic 15-minute lease. Queue filters are **All**, **Open**, **Complete**, **Approved**, **Mine**, and **Free**.
- **QA Review & Approved Freeze**: Once a reviewer approves a photo (`status = 'approved'`), it is frozen in read-only mode on the canvas and excluded from the `Free` queue to protect ground truth. Admins and reviewers can click **Unlock to Edit** to revoke approval and reopen the photo if needed.
- **Maintenance Mode & Database Backups**: Admins can enable Maintenance Mode from **Settings**, download consistent SQLite `.db` backups, and trigger **Git Pull & Update** with automatic Vite server reload.
- **Streaming Exports**: Export **YOLO** (`data.yaml` + `.txt` labels) or **COCO JSON** (`instances_train.json` / `instances_val.json`) as a **Labels Only** or **Full Dataset** `.tar` stream, with an optional **Include part dimensions (`dimensions.json`)** metadata checkbox.

## Scripts

- `npm run dev` — start Vite dev server on port 8080
- `npm run typecheck` — TypeScript check (`tsc --noEmit`)
- `npm run lint` — Biome check
- `npm run format` — Biome format
