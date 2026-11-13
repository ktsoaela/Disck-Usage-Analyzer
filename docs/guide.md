# Disk Usage Analyzer — Guide

## 1. Scan something

- Click a **💾 drive** button, or **📂 Browse…** to pick a folder, or type a path and press **Enter** / **▶ Scan**.
- The status bar shows files, folders and bytes found so far. **Cancel** stops early and keeps the partial result.
- Folders Windows won't let you read are marked **⚠ access denied**. Run the app as administrator to include them.

## 2. Find what's big

- **Tree (left):** children are sorted largest first. The bar is the item's share of its parent folder.
- **Treemap (right):** each rectangle is a file, sized by bytes and colored by type (see the legend).
  Grey frames are folders. Hover for details, click to select, double-click to zoom in.
  Use **⬆ Up** or the breadcrumb to zoom back out.
- **📊 Largest files:** the 500 biggest files under the folder you are viewing. Double-click one to find it in the treemap.

## 3. Clean up

Right-click any file or folder (tree, treemap or list):

| Menu item | Key | What happens |
| --- | --- | --- |
| Move to Recycle Bin | `Del` | Restorable from the Recycle Bin |
| Delete permanently | `Shift+Del` | Gone for good, no undo |
| Open | | Opens with the default program |
| Show in Explorer | | Opens Explorer with the item selected |
| Copy path | | Puts the full path on the clipboard |

A confirmation dialog always shows the name, path and size first. You can switch between Recycle Bin and
permanent delete in that dialog. After deleting, every parent folder's size updates right away, and the status
bar keeps a running total of space freed this session.

Safety rules: the scanned root folder can't be deleted, and symlinks/junctions are never followed.

## 4. Keyboard

`↑ ↓` select · `← →` collapse/expand · `Enter` zoom in · `Backspace` zoom out · `Del` / `Shift+Del` delete · `Esc` cancel.

## 5. Build from source

```sh
cargo build --release
target/release/disk-usage-analyzer.exe [folder]
```

## 6. 3D diagrams

The studio in `web/` draws the same kind of scan as an explosion diagram and three other views. It runs locally and reads a folder on this computer. `cargo run --bin studio` opens it in a Rust window. You can also run `npm run dev` from `web/`.

```sh
cd web
npm install
npm run dev
```

Open http://localhost:3000 while `npm run dev` is running. The Start menu item **Disk Usage Analyzer 3D** (or `web\launch.cmd`) opens the built app at http://127.0.0.1:3847. Pick a drive or type a path, then scan.

| View | What you see |
| --- | --- |
| Explosion | The folder splits into pieces. The slider pulls them apart, with leader lines back to the hub. |
| Rings | Nested shares. The outer ring is the inside of the ring it sits on. |
| City | Blocks whose footprint and height follow the bytes. |
| File types | A column for video, audio, images, documents, code, programs, archives, and everything else. |

Click a folder piece to open it. **Back** and **Forward** on the diagram move through the folders you opened (`Alt+Left`, `Alt+Right`, or the mouse back and forward buttons). `Esc` or `Backspace` steps up to the parent. The path above the diagram, and under Folder, is the folder you are viewing. `Del` moves the folder under the pointer to the Recycle Bin. `Shift+Del` deletes it permanently. Files listed under the folder have the same two actions. **Uninstall** appears when that folder is an installed program, and it starts the program's own uninstaller. The drawing lists each file in the folder you open, next to its subfolders. Open a folder to go further in. A very large folder keeps the biggest files and folders on screen and groups the rest as Smaller items. Sizes still include every file underneath. Symlinks and junctions stay put, so a target is counted once. Folders Windows will not open show up in the scan line as folders that could not be read.
