# STYLE.md — LS-Marker UI & Visual Design System

> **Design Paradigm:**  
> LS-Marker is designed as an ultra-dense, multi-pane desktop workspace inspired by professional creative and industrial software (Adobe Premiere Pro, DaVinci Resolve, AutoCAD). It is built for paid annotators and QA reviewers working at high velocity on high-resolution industrial part photos.

---

## 1. Viewport & Layout Architecture

* **Strict Viewport Lock (`100vh / 100vw`):** The entire application is locked to `h-screen w-screen overflow-hidden`. Document-level (body) scrolling is strictly forbidden.
* **Internal Pane Scrolling:** Every deck, filmstrip, table, inspector, and sidebar scrolls independently via internal `overflow-y-auto` or `overflow-x-auto`.
* **Zero Marketing Boilerplate:** No hero sections, marketing banners, or decorative whitespace. Every pixel of screen real estate is reserved for workspace tooling, image canvas, and metadata inspection.
* **Resizable Panes:** Collapsible and resizable sidebars and shape decks must use subtle, non-intrusive splitters (3–4px) with standard cursors (`cursor-col-resize`, `cursor-row-resize`).

---

## 2. Color Palette & Semantic Tokens

LS-Marker operates in a high-contrast, low-fatigue **Light Mode** desktop theme.

| Token / Element | Tailwind / Hex Code | Usage Notes |
| :--- | :--- | :--- |
| **Canvas Background** | `#f0f0f0` (`bg-[#f0f0f0]`) | Neutral, low-strain canvas behind the image viewport. Bright white part photos stay distinct. |
| **Workspace Panes** | `#ffffff` (`bg-white`) | Filmstrips, tool palettes, inspector panels, modal dialogue boxes. |
| **Pane Sub-Surfaces** | `#f9f9f9` (`bg-[#f9f9f9]`) | Inner cards, table alternating rows, secondary grouping sections. |
| **Borders & Dividers** | `#c8c8c8` (`border-[#c8c8c8]`) | Strictly 1px solid lines dividing panes, panels, and controls. |
| **Primary Text** | `#282828` (`text-[#282828]`) | Deep charcoal for headings, body copy, and data values. High legibility. |
| **Secondary / Muted Text** | `#6e6e6e` (`text-[#6e6e6e]`) | Medium neutral gray for subtitles, helper labels, empty states, and field descriptions. |
| **Border Highlights / Active** | `#e0e0e0` (`bg-[#e0e0e0]`) | Hover states, active neutral button fills, subtle dividers. |
| **Accent / Selected** | `#1473e6` (`#1473e6`) | Adobe Blue. Used **only** for active tools, selected states, primary action buttons, and active focus rings. |
| **AI Tooling Accent** | `#9333ea` / `#7e22ce` | Purple accents used specifically for SAM 2.1 Segment Anything tools and status chips. |

### Semantic Status Colors
Status badges, alerts, and notifications must always maintain crisp contrast with dark, legible text:

* **Success / Approved / Idle:**
  * Background: `bg-emerald-50`
  * Border: `border-emerald-300`
  * Title / Icon: `text-emerald-800` / `text-emerald-600`
  * Body: `text-[#282828]` or `text-[#444444]`
* **Warning / Active Leases / Maintenance:**
  * Background: `bg-amber-50`
  * Border: `border-amber-300`
  * Title / Icon: `text-amber-800` / `text-amber-600`
  * Body: `text-[#282828]` or `text-[#444444]`
* **Danger / Error / Delete / Missing:**
  * Background: `bg-red-50`
  * Border: `border-red-300`
  * Title / Icon: `text-red-700` / `text-red-600`
  * Button Action: `bg-red-600 hover:bg-red-700 text-white`
* **Terminal / Console Output:**
  * Background: `#1e1e1e`
  * Border: `#333333`
  * Text: `#d4d4d4` (IBM Plex Mono `text-[11px]`)

---

## 3. Typography & Information Density

LS-Marker uses a compact typography scale anchored between **10px and 13px**:

* **Fonts:**
  * **Sans-serif (`font-sans`):** Inter / IBM Plex Sans for general UI, labels, tooltips, dialogs.
  * **Monospace (`font-mono`):** IBM Plex Mono for part codes, image dimensions, coordinate tokens, bounding box counts, class indices (`#0`), and SHA hashes.
* **Type Scale:**
  * `text-[10px]` – Micro tags, class index badges, table footer indicators.
  * `text-[11px]` – Secondary metrics, helper hints, breadcrumb paths, keyboard hints.
  * `text-xs` (12px) – Standard UI labels, inputs, table cell data, button labels, list items.
  * `text-sm` (14px) – Modal and pane section headers (`font-semibold`).
  * `text-base` (16px) – Reserved for top-level modal titles or primary application headers only.

---

## 4. Geometry & Elevation Rules

* **Corners:**
  * Panes, filmstrips, toolbars, splitters: `rounded-none`.
  * Buttons, inputs, chips, badges, keycaps, and dialog containers: **`rounded-[2px]`** (strictly max 2px).
  * **Never** use `rounded-lg`, `rounded-xl`, or `rounded-full` for panes or desktop control surfaces.
* **Elevation & Shadows:**
  * Standard panels & controls: `shadow-none`.
  * Floating context menus and dropdowns: `shadow-md border border-[#c8c8c8]`.
  * Modal dialog overlays: `shadow-lg border border-[#c8c8c8]`.
* **Overlays & Backdrops:**
  * Modal backdrops: `bg-black/50 p-4` (clean dim without blur filters).
  * Do not use heavy `backdrop-blur-md` or `backdrop-blur-xs` filters that degrade 60 FPS canvas rendering.

---

## 5. Standard Component Specs

### 5.1 Top Menu Bar (28px)
* Height: Exactly `h-7` (28px).
* Background: `bg-white border-b border-[#c8c8c8]`.
* Contents: Project selector, active lease countdown timers, mode badges (Admin, QA, Maintenance), and navigation shortcuts.

### 5.2 Toolbox Strip (36px)
* Width: `w-9` (36px).
* Buttons: `size-7 rounded-[2px]`.
* Active State: `bg-[#1473e6] text-white`.
* Inactive State: `text-[#282828] hover:bg-[#e0e0e0]`.

### 5.3 Buttons & Form Controls
* **Heights:**
  * Standard toolbar buttons & inputs: `h-7` (28px) or `h-8` (32px).
  * Micro buttons (inside table rows / shape list): `h-6` (24px).
* **Button Variants:**
  * **Primary (Adobe Blue):** `bg-[#1473e6] hover:bg-[#0d62c9] text-white font-semibold rounded-[2px] px-3`.
  * **Secondary / Neutral:** `bg-white hover:bg-[#e0e0e0] text-[#282828] border border-[#c8c8c8] font-semibold rounded-[2px] px-3`.
  * **Danger / Destructive:** `bg-red-600 hover:bg-red-700 text-white font-semibold rounded-[2px] px-3`.
* **Inputs & Selects:**
  * Style: `border border-[#c8c8c8] bg-white text-[#282828] rounded-[2px] px-2 text-xs outline-none focus:border-[#1473e6]`.

### 5.4 Modal Dialog Pattern
All modals must follow this exact template:

```tsx
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
  <div
    role="dialog"
    aria-modal="true"
    className="flex w-full max-w-lg flex-col gap-4 rounded-[2px] border border-[#c8c8c8] bg-white p-5 text-[#282828] shadow-lg"
  >
    {/* Header */}
    <div className="flex items-start justify-between gap-4 border-b border-[#c8c8c8] pb-3">
      <div className="flex items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-[2px] border border-blue-200 bg-blue-50 text-[#1473e6]">
          <Icon className="size-4" />
        </div>
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-[#282828]">Title</h2>
          <p className="text-xs text-[#6e6e6e]">Subtitle / description</p>
        </div>
      </div>
      <button className="inline-flex size-7 items-center justify-center rounded-[2px] text-[#6e6e6e] hover:bg-[#e0e0e0] hover:text-[#282828]">
        <X className="size-4" />
      </button>
    </div>

    {/* Content Body */}
    <div className="flex flex-col gap-3 text-xs leading-relaxed">
      {/* Cards, lists, and form controls */}
    </div>

    {/* Footer */}
    <div className="flex items-center justify-end gap-2 border-t border-[#c8c8c8] pt-3">
      <button className="inline-flex h-8 items-center justify-center rounded-[2px] border border-[#c8c8c8] bg-white px-3 text-xs font-semibold text-[#282828] hover:bg-[#e0e0e0]">
        Cancel
      </button>
      <button className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[2px] bg-[#1473e6] px-3.5 text-xs font-semibold text-white hover:bg-[#0d62c9]">
        Confirm
      </button>
    </div>
  </div>
</div>
```

### 5.5 Canvas Annotations & Precision Mode
* **Strokes:** 1.5px stroke width with a sharp high-contrast drop outline so bounding boxes stay visible against any part surface color.
* **Precision Filled Mode:** When toggled ON, the active shape outline must suppress outer highlight rings/borders to ensure annotators inspect the exact perimeter pixels without obstruction.
* **SAM 2.1 Trace Crosshairs:**
  * Foreground prompt (label = 1): Tiny green crosshair dot.
  * Background prompt (label = 0): Tiny red crosshair dot.

---

## 6. Pre-Commit Checklist for UI Changes

1. Is viewport scrolling strictly disabled (`100vh / 100vw`, no body scrollbars)?
2. Do all panel borders use `border-[#c8c8c8]` and `bg-white`?
3. Are all corner radii constrained to `rounded-none` (panes) or `rounded-[2px]` (controls)?
4. Is text set to `#282828` (primary) and `#6e6e6e` (secondary) without low-contrast muddy text?
5. Did `npm run lint` (`biome check .`) pass with **0 errors**?
6. Did `npm run typecheck` pass with **0 errors**?

