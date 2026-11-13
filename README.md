# Disck-Usage-Analyzer

A fast, graphical disk usage analyzer for Windows (and Linux/macOS), written in Rust.
See what is filling your drive, then clean it up without leaving the app.

**Website:** https://ktsoaela.github.io/Disck-Usage-Analyzer/

## Features

- **Scan** any drive or folder. Scanning is parallel and runs in the background with live progress and a Cancel button.
- **Tree view** sorted by size, with a "% of parent" bar, size, and file count for every item.
- **Treemap**: every file is a rectangle sized by bytes and colored by type (video, images, archives…). Double-click to zoom in.
- **Largest files** list for whatever folder you are looking at.
- **Delete from inside the app**: move to the Recycle Bin (`Del`) or delete permanently (`Shift+Del`), always behind a confirmation dialog. Sizes update instantly, no rescan needed.
- Open, Show in Explorer, and Copy path from the right-click menu.
- Never follows symlinks or junctions, and refuses to delete the scanned root folder.

## Build and run

Requires [Rust](https://rustup.rs) (and on Windows the MSVC C++ build tools).

```sh
cargo run --release                 # opens the app
cargo run --release -- "D:\Games"   # opens and scans a folder straight away
```

The built program is `target/release/disk-usage-analyzer.exe`.

## Keys

| Key | Action |
| --- | --- |
| `↑` `↓` | Move the selection |
| `←` `→` | Collapse / expand a folder |
| `Enter` | Zoom the treemap into the folder |
| `Backspace` | Zoom out one level |
| `Del` | Move to Recycle Bin |
| `Shift+Del` | Delete permanently |
| `Esc` | Cancel the delete dialog |

Tip: run as administrator to scan system folders that normal users can't read.

## Project layout

| File | What it does |
| --- | --- |
| `src/scan.rs` | Parallel directory scanner (rayon) |
| `src/tree.rs` | Size tree and delete bookkeeping |
| `src/treemap.rs` | Squarified treemap layout |
| `src/app.rs` | The egui user interface |
| `docs/` | The GitHub Pages website |

## License

MIT. See [LICENSE](LICENSE).
