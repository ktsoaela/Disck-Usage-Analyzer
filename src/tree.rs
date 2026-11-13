//! Arena-based file tree. Node ids stay valid after deletions (removed
//! nodes are just detached), so the UI can safely hold on to ids.

use crate::scan::ScanNode;
use std::path::PathBuf;

pub struct Node {
    pub name: String,
    pub size: u64,
    pub files: u64,
    pub is_dir: bool,
    pub error: bool,
    pub parent: Option<usize>,
    pub children: Vec<usize>,
}

pub struct Tree {
    pub nodes: Vec<Node>,
    pub root_path: PathBuf,
}

impl Tree {
    pub fn from_scan(root: ScanNode, root_path: PathBuf) -> Tree {
        let mut t = Tree {
            nodes: Vec::new(),
            root_path,
        };
        t.add(root, None);
        for i in 0..t.nodes.len() {
            t.sort_children(i);
        }
        t
    }

    fn add(&mut self, n: ScanNode, parent: Option<usize>) -> usize {
        let id = self.nodes.len();
        self.nodes.push(Node {
            name: n.name,
            size: n.size,
            files: n.files,
            is_dir: n.is_dir,
            error: n.error,
            parent,
            children: Vec::with_capacity(n.children.len()),
        });
        for c in n.children {
            let cid = self.add(c, Some(id));
            self.nodes[id].children.push(cid);
        }
        id
    }

    fn sort_children(&mut self, id: usize) {
        let mut ch = std::mem::take(&mut self.nodes[id].children);
        ch.sort_unstable_by(|a, b| self.nodes[*b].size.cmp(&self.nodes[*a].size));
        self.nodes[id].children = ch;
    }

    pub fn path_of(&self, id: usize) -> PathBuf {
        let mut names = Vec::new();
        let mut cur = id;
        while let Some(p) = self.nodes[cur].parent {
            names.push(self.nodes[cur].name.as_str());
            cur = p;
        }
        let mut path = self.root_path.clone();
        for n in names.iter().rev() {
            path.push(n);
        }
        path
    }

    pub fn display_name(&self, id: usize) -> String {
        if id == 0 {
            self.root_path.display().to_string()
        } else {
            self.nodes[id].name.clone()
        }
    }

    /// True if `id` is `ancestor` or lies somewhere below it.
    pub fn is_within(&self, id: usize, ancestor: usize) -> bool {
        let mut cur = Some(id);
        while let Some(c) = cur {
            if c == ancestor {
                return true;
            }
            cur = self.nodes[c].parent;
        }
        false
    }

    /// Detach a node after it was deleted on disk and update ancestor totals.
    pub fn remove(&mut self, id: usize) {
        let Some(parent) = self.nodes[id].parent else { return };
        let (size, files) = (self.nodes[id].size, self.nodes[id].files);
        self.nodes[parent].children.retain(|&c| c != id);
        self.nodes[id].parent = None;
        let mut cur = Some(parent);
        while let Some(p) = cur {
            let n = &mut self.nodes[p];
            n.size = n.size.saturating_sub(size);
            n.files = n.files.saturating_sub(files);
            cur = n.parent;
        }
        let mut cur = Some(parent);
        while let Some(p) = cur {
            self.sort_children(p);
            cur = self.nodes[p].parent;
        }
    }

    pub fn largest_files(&self, root: usize, limit: usize) -> Vec<usize> {
        let mut out = Vec::new();
        let mut stack = vec![root];
        while let Some(id) = stack.pop() {
            let n = &self.nodes[id];
            if n.is_dir {
                stack.extend(n.children.iter().copied());
            } else {
                out.push(id);
            }
        }
        out.sort_unstable_by(|a, b| self.nodes[*b].size.cmp(&self.nodes[*a].size));
        out.truncate(limit);
        out
    }
}

pub fn human(b: u64) -> String {
    const UNITS: [&str; 6] = ["B", "KB", "MB", "GB", "TB", "PB"];
    let mut v = b as f64;
    let mut i = 0;
    while v >= 1024.0 && i < UNITS.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{b} B")
    } else {
        format!("{v:.1} {}", UNITS[i])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str, size: u64) -> ScanNode {
        ScanNode { name: name.into(), size, files: 1, is_dir: false, error: false, children: vec![] }
    }

    #[test]
    fn remove_updates_ancestors() {
        let sub = ScanNode { name: "sub".into(), size: 30, files: 2, is_dir: true, error: false,
            children: vec![file("a", 10), file("b", 20)] };
        let root = ScanNode { name: "root".into(), size: 35, files: 3, is_dir: true, error: false,
            children: vec![sub, file("c", 5)] };
        let mut t = Tree::from_scan(root, PathBuf::from("R"));
        let b = t.nodes.iter().position(|n| n.name == "b").unwrap();
        assert_eq!(t.path_of(b), PathBuf::from("R").join("sub").join("b"));
        t.remove(b);
        assert_eq!(t.nodes[0].size, 15);
        assert_eq!(t.nodes[0].files, 2);
        assert!(!t.is_within(b, 0));
        assert_eq!(human(1536), "1.5 KB");
    }
}
