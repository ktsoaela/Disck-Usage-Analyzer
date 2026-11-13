//! Parallel directory scanner. Runs on a background thread and reports
//! progress through atomics so the UI stays responsive.

use crate::tree::Tree;
use rayon::prelude::*;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

#[derive(Default)]
pub struct Progress {
    pub files: AtomicU64,
    pub dirs: AtomicU64,
    pub bytes: AtomicU64,
    pub errors: AtomicU64,
    pub cancel: AtomicBool,
    pub current: Mutex<String>,
}

pub struct ScanNode {
    pub name: String,
    pub size: u64,
    pub files: u64,
    pub is_dir: bool,
    pub error: bool,
    pub children: Vec<ScanNode>,
}

pub fn scan_tree(path: &Path, p: &Progress) -> Tree {
    let root_name = path.display().to_string();
    let node = match rayon::ThreadPoolBuilder::new().stack_size(32 << 20).build() {
        Ok(pool) => pool.install(|| scan_dir(path, root_name.clone(), p)),
        Err(_) => scan_dir(path, root_name, p),
    };
    Tree::from_scan(node, path.to_path_buf())
}

fn scan_dir(path: &Path, name: String, p: &Progress) -> ScanNode {
    let mut node = ScanNode {
        name,
        size: 0,
        files: 0,
        is_dir: true,
        error: false,
        children: Vec::new(),
    };
    if p.cancel.load(Ordering::Relaxed) {
        return node;
    }
    p.dirs.fetch_add(1, Ordering::Relaxed);
    if let Ok(mut cur) = p.current.try_lock() {
        *cur = path.display().to_string();
    }

    let rd = match fs::read_dir(path) {
        Ok(rd) => rd,
        Err(_) => {
            p.errors.fetch_add(1, Ordering::Relaxed);
            node.error = true;
            return node;
        }
    };

    let mut subdirs: Vec<(PathBuf, String)> = Vec::new();
    for entry in rd.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        // Never follow symlinks / junctions: avoids loops and double counting.
        if ft.is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if ft.is_dir() {
            subdirs.push((entry.path(), name));
        } else {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            p.files.fetch_add(1, Ordering::Relaxed);
            p.bytes.fetch_add(size, Ordering::Relaxed);
            node.children.push(ScanNode {
                name,
                size,
                files: 1,
                is_dir: false,
                error: false,
                children: Vec::new(),
            });
        }
    }

    let subs: Vec<ScanNode> = subdirs
        .into_par_iter()
        .map(|(sub_path, sub_name)| scan_dir(&sub_path, sub_name, p))
        .collect();
    node.children.extend(subs);

    node.size = node.children.iter().map(|c| c.size).sum();
    node.files = node.children.iter().map(|c| c.files).sum();
    node
}
