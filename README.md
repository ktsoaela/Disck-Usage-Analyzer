<div align="center">
  <img src="docs/logo.svg" alt="Disk Usage Analyzer" width="128" style="background:#ffffff;padding:16px;border-radius:12px" />

  <h1>Disk Usage Analyzer</h1>

  <p><strong>See what fills a drive, then remove it from the same window.</strong></p>

  <p>
    <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-375348?style=flat-square" /></a>
    <a href="docs/guide.md"><img alt="Docs" src="https://img.shields.io/badge/docs-guide-547f72?style=flat-square" /></a>
    <img alt="Stack" src="https://img.shields.io/badge/Rust-Next.js-436659?style=flat-square" />
  </p>
</div>

**Author:** [Khotso Tsoaela](https://github.com/ktsoaela) (`@ktsoaela`)

---

**Disk Usage Analyzer** scans a drive or folder and shows where the bytes went. The desktop app is a tree, a treemap, and a largest-files list, and it can move items to the Recycle Bin. The 3D studio in `web/` draws that same scan as an explosion diagram, rings, a city, and file-type columns.

Website: https://ktsoaela.github.io/Disck-Usage-Analyzer/

---

## Why Disk Usage Analyzer

- **Scan** runs in parallel in the background, with live progress and a Cancel button.
- **Tree** lists each folder largest-first, with a share-of-parent bar, size, and file count.
- **Treemap** draws every file as a rectangle sized by bytes and colored by type. Double-click a folder to zoom in.
- **Largest files** lists the 500 biggest files under the folder you are viewing.
- **Delete** moves an item to the Recycle Bin (`Del`) or deletes it permanently (`Shift+Del`), after a confirmation that shows the name, path, and size.
- **3D studio** pulls the folder apart into an explosion diagram, then shows rings, city blocks, and file-type columns.
- **Safety:** the scanned root stays put. Symlinks and junctions stay put, so a target is counted once. Open, Show in Explorer, and Copy path are on the right-click menu.

---

## Quick start

**Requirements:** [Rust](https://rustup.rs), and the MSVC C++ build tools on Windows. Node.js for the 3D studio.

```sh
cargo run --release
```

| Goal | Command |
| --- | --- |
| Open the desktop app | `cargo run --release` |
| Scan a folder on launch | `cargo run --release -- "D:\Games"` |
| Built program | `target/release/disk-usage-analyzer.exe` |
| Install the 3D studio | `cd web` then `npm install` |
| Open the 3D studio in a Rust window | `cargo run --bin studio` |
| Installed Windows app | Start menu **Disk Usage Analyzer 3D**, or `web\launch.cmd` → http://127.0.0.1:3847 |

Run the desktop app as administrator when you need folders a normal user cannot read.

---

## Keys

| Key | Action |
| --- | --- |
| `↑` `↓` | Move the selection |
| `←` `→` | Collapse or expand a folder |
| `Enter` | Zoom the treemap into the folder |
| `Backspace` | Zoom out one level |
| `Del` | Move to the Recycle Bin |
| `Shift+Del` | Delete permanently |
| `Esc` | Close the delete dialog |

---

## 3D studio

| View | What it shows |
| --- | --- |
| Explosion | Folder and file-type pieces. A slider pulls them apart, with leader lines back to the hub. |
| Rings | Nested shares. The outer ring is the inside of the ring it sits on. |
| City | Blocks whose footprint and height follow the bytes. |
| File types | Columns for video, audio, images, documents, code, programs, archives, and other files. |

The drawing lists the files inside the folder you open, and the folders next to them. Byte totals still include everything underneath. Click a folder to see its files. `Del` moves the hovered file or folder to the Recycle Bin, and `Shift+Del` deletes it permanently. A folder that is an installed program can start that program's uninstaller. `cargo run --bin studio` opens this studio in a Rust window.

---

## Project layout

| Path | What it does |
| --- | --- |
| `src/scan.rs` | Parallel directory scanner (rayon) |
| `src/tree.rs` | Size tree and delete bookkeeping |
| `src/treemap.rs` | Squarified treemap layout |
| `src/app.rs` | The egui desktop interface |
| `web/` | Next.js 3D studio |
| `docs/` | The GitHub Pages website and the guide |

---

## Documentation map

| Doc | Purpose |
| --- | --- |
| [docs/guide.md](docs/guide.md) | Scan, read the views, delete, and open the 3D studio |
| [docs/index.html](docs/index.html) | Project website |

---

## License

MIT. Copyright 2026 Khotso Tsoaela.
