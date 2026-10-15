# LS-Marker

Draw bounding boxes on part photos and save YOLO `.txt` files next to each image.

## Windows

1. Install [Node.js 22](https://nodejs.org/).
2. In this folder run `npm install`.  
   `better-sqlite3` ships a prebuild. If install tries to compile and fails, install the Visual Studio Build Tools workload “Desktop development with C++”, then run `npm install` again.
3. Run `npm run dev`.
4. Open the address it prints. The app listens on port **8080**.
5. Sign in, then pick a project or create one. A project is a name plus a photo folder that already exists (`C:/Users/you/Pictures/parts` is fine). Each project has its own parts list.

`labelling.config.json` only names the first project’s folder (`samples` unless you change it before the first run). After that, projects live in the database.

The `samples` folder is a small stand-in so the app is usable before you add a real project.

## Labelling

- Pick a class, drag a box, press **Save**. Previous and Next also save unsaved work.
- The header shows **image X of Y** and how many photos in the project are labelled.
- Select a box and change **Class** to retitle it. With nothing selected, that menu is the class for the next box.
- **Duplicate** (or Ctrl+D) copies the selected box. **Previous boxes** copies the photo before this one onto an empty photo.
- Arrows move a selected box. Shift is a bigger step. With nothing selected, Left and Right change photo.
- **No parts** (or N) writes an empty label and moves to the next unfinished photo. **Open** in the queue limits Previous and Next to those photos.
- `photo.jpg` gets `photo.txt` in the same folder:

  ```text
  0 0.512000 0.430000 0.180000 0.220000
  ```

  Values are `class_id x_center y_center width height`, all normalised 0–1.
- `classes.txt` in the image folder lists item codes. Line order matches the class id (blank lines keep a retired id).
- **Classes** adds or renames codes. Ids are not reused. A CSV with columns `ic` and `des` can be uploaded; codes already stored are skipped.
- On an image, paste the item codes you are labelling. The class menu only lists those, so a catalogue of thousands stays usable.
- Only the chosen folder is read. Nested folders are included, up to 5000 images.

## People

Labellers sign in with a username and password. There is no email check.

**Settings** is locked with the shared password `admin`. From there you add people. A new install has no labellers until you add one. Photo folders are chosen per project, not here. Users are shared across projects.

Opening a free image and saving claims it (`claimed_by`, `claimed_at`). Release it when you are finished. If someone else holds it, take over before editing. The queue filters are All, Open, Mine, and Free.

**Photos** lists the folder, and **Export YOLO** downloads a zip of the photos, their `.txt` files, and `classes.txt`.

## Scripts

- `npm run dev` — app on port 8080
- `npm run lint` — Biome
- `npm run format` — Biome
