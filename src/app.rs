use crate::scan::{self, Progress};
use crate::tree::{human, Tree};
use crate::treemap;
use eframe::egui::{
    self, ecolor::Hsva, pos2, vec2, Align, Align2, Button, Color32, Context, FontId, Key, Layout,
    Mesh, Painter, Pos2, Rect, RichText, ScrollArea, Sense, Shape, Stroke, Ui,
};
use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::sync::Arc;
use std::time::{Duration, Instant};

const ROW_H: f32 = 20.0;
const MAX_CHILD_ROWS: usize = 1000;
const TM_MIN_AREA: f64 = 6.0;

#[cfg(windows)]
const REVEAL_LABEL: &str = "📂 Show in Explorer";
#[cfg(not(windows))]
const REVEAL_LABEL: &str = "📂 Show in file manager";

#[derive(Clone, Copy)]
enum Action {
    Select(usize),
    SelectReveal(usize),
    Toggle(usize),
    Zoom(usize),
    Open(usize),
    Reveal(usize),
    CopyPath(usize),
    Delete(usize, bool),
}

struct Scanning {
    progress: Arc<Progress>,
    rx: Receiver<Tree>,
    started: Instant,
}

struct Confirm {
    id: usize,
    permanent: bool,
}

struct Deleting {
    id: usize,
    permanent: bool,
    rx: Receiver<Result<(), String>>,
    label: String,
}

#[derive(PartialEq, Clone, Copy)]
enum Tab {
    Treemap,
    TopFiles,
}

struct Row {
    id: usize,
    depth: usize,
    /// > 0 marks a "… N more items" placeholder row.
    more: usize,
}

pub struct App {
    path_input: String,
    drives: Vec<String>,
    tree: Option<Tree>,
    scanning: Option<Scanning>,
    expanded: HashSet<usize>,
    selected: Option<usize>,
    view_root: usize,
    confirm: Option<Confirm>,
    deleting: Option<Deleting>,
    status: String,
    tm_context: Option<usize>,
    scroll_to_sel: bool,
    tree_scroll: (f32, f32),
    tab: Tab,
    top_cache: Option<(usize, u64, Vec<usize>)>,
    generation: u64,
    freed_total: u64,
}

impl App {
    pub fn new(initial: Option<PathBuf>) -> Self {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_else(|_| ".".into());
        let mut app = Self {
            path_input: home,
            drives: list_drives(),
            tree: None,
            scanning: None,
            expanded: HashSet::new(),
            selected: None,
            view_root: 0,
            confirm: None,
            deleting: None,
            status: "Choose a folder or drive and press Scan.".into(),
            tm_context: None,
            scroll_to_sel: false,
            tree_scroll: (0.0, 0.0),
            tab: Tab::Treemap,
            top_cache: None,
            generation: 0,
            freed_total: 0,
        };
        if let Some(p) = initial {
            app.path_input = p.display().to_string();
            app.start_scan(p);
        }
        app
    }

    // ---------------------------------------------------------------- scanning

    fn start_scan(&mut self, path: PathBuf) {
        if self.scanning.is_some() || self.deleting.is_some() {
            return;
        }
        if !path.is_dir() {
            self.status = format!("'{}' is not a folder.", path.display());
            return;
        }
        let progress = Arc::new(Progress::default());
        let (tx, rx) = mpsc::channel();
        let (p2, path2) = (progress.clone(), path.clone());
        let spawned = std::thread::Builder::new()
            .name("scanner".into())
            .stack_size(64 << 20)
            .spawn(move || {
                let _ = tx.send(scan::scan_tree(&path2, &p2));
            });
        if let Err(e) = spawned {
            self.status = format!("Could not start scan: {e}");
            return;
        }
        self.status = format!("Scanning {} …", path.display());
        self.scanning = Some(Scanning { progress, rx, started: Instant::now() });
    }

    fn poll(&mut self, ctx: &Context) {
        if let Some(s) = &self.scanning {
            let res = s.rx.try_recv();
            let secs = s.started.elapsed().as_secs_f32();
            let cancelled = s.progress.cancel.load(Ordering::Relaxed);
            let errors = s.progress.errors.load(Ordering::Relaxed);
            match res {
                Ok(tree) => {
                    self.scanning = None;
                    let root = &tree.nodes[0];
                    self.status = format!(
                        "{}{} in {} files, scanned in {:.1}s{}",
                        if cancelled { "Scan cancelled (partial) — " } else { "" },
                        human(root.size),
                        root.files,
                        secs,
                        if errors > 0 {
                            format!(" — {errors} folders could not be read (try running as administrator)")
                        } else {
                            String::new()
                        }
                    );
                    self.expanded.clear();
                    self.expanded.insert(0);
                    self.selected = None;
                    self.view_root = 0;
                    self.top_cache = None;
                    self.generation += 1;
                    self.tree = Some(tree);
                }
                Err(TryRecvError::Empty) => ctx.request_repaint_after(Duration::from_millis(100)),
                Err(TryRecvError::Disconnected) => {
                    self.scanning = None;
                    self.status = "Scan failed unexpectedly.".into();
                }
            }
        }

        if let Some(d) = &self.deleting {
            let res = d.rx.try_recv();
            let (id, permanent) = (d.id, d.permanent);
            match res {
                Ok(result) => {
                    self.deleting = None;
                    self.finish_delete(id, permanent, result);
                }
                Err(TryRecvError::Empty) => ctx.request_repaint_after(Duration::from_millis(100)),
                Err(TryRecvError::Disconnected) => {
                    self.deleting = None;
                    self.status = "Delete failed unexpectedly. Rescan to refresh.".into();
                }
            }
        }
    }

    // ---------------------------------------------------------------- deleting

    fn start_delete(&mut self, id: usize, permanent: bool) {
        let Some(tree) = &self.tree else { return };
        let path = tree.path_of(id);
        let is_dir = tree.nodes[id].is_dir;
        let label = format!(
            "{} {}",
            if permanent { "Deleting" } else { "Moving to Recycle Bin:" },
            path.display()
        );
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let r = if permanent {
                delete_permanently(&path, is_dir)
            } else {
                trash::delete(&path).map_err(|e| e.to_string())
            };
            let _ = tx.send(r);
        });
        self.deleting = Some(Deleting { id, permanent, rx, label });
    }

    fn finish_delete(&mut self, id: usize, permanent: bool, result: Result<(), String>) {
        let Some(tree) = self.tree.as_mut() else { return };
        let name = tree.nodes[id].name.clone();
        match result {
            Ok(()) => {
                let size = tree.nodes[id].size;
                let parent = tree.nodes[id].parent.unwrap_or(0);
                if self.selected.is_some_and(|s| tree.is_within(s, id)) {
                    self.selected = Some(parent);
                }
                if tree.is_within(self.view_root, id) {
                    self.view_root = parent;
                }
                tree.remove(id);
                self.generation += 1;
                self.freed_total += size;
                self.status = format!(
                    "{} '{}' — freed {} (total freed this session: {})",
                    if permanent { "Deleted" } else { "Moved to Recycle Bin" },
                    name,
                    human(size),
                    human(self.freed_total)
                );
            }
            Err(e) => {
                self.status = format!("Could not delete '{name}': {e}. Rescan to refresh sizes.");
            }
        }
    }

    // ---------------------------------------------------------------- actions

    fn apply(&mut self, ctx: &Context, a: Action) {
        let Some(tree) = self.tree.as_ref() else { return };
        match a {
            Action::Select(id) => self.selected = Some(id),
            Action::SelectReveal(id) => {
                self.selected = Some(id);
                let mut cur = tree.nodes[id].parent;
                while let Some(p) = cur {
                    self.expanded.insert(p);
                    cur = tree.nodes[p].parent;
                }
                self.scroll_to_sel = true;
            }
            Action::Toggle(id) => {
                if !self.expanded.remove(&id) {
                    self.expanded.insert(id);
                }
            }
            Action::Zoom(id) => {
                let id = if tree.nodes[id].is_dir { id } else { tree.nodes[id].parent.unwrap_or(0) };
                self.view_root = id;
                let mut cur = Some(id);
                while let Some(p) = cur {
                    self.expanded.insert(p);
                    cur = tree.nodes[p].parent;
                }
            }
            Action::Open(id) => {
                if let Err(e) = open::that_detached(tree.path_of(id)) {
                    self.status = format!("Could not open: {e}");
                }
            }
            Action::Reveal(id) => reveal(&tree.path_of(id)),
            Action::CopyPath(id) => {
                let s = tree.path_of(id).display().to_string();
                self.status = format!("Copied: {s}");
                ctx.output_mut(|o| o.copied_text = s);
            }
            Action::Delete(id, permanent) => {
                if id == 0 || tree.nodes[id].parent.is_none() {
                    self.status = "The scanned root folder itself can't be deleted here.".into();
                } else if self.deleting.is_some() {
                    self.status = "Please wait for the current delete to finish.".into();
                } else {
                    self.confirm = Some(Confirm { id, permanent });
                }
            }
        }
    }

    // ---------------------------------------------------------------- panels

    fn top_bar(&mut self, ctx: &Context) {
        egui::TopBottomPanel::top("top").show(ctx, |ui| {
            ui.add_space(5.0);
            ui.horizontal(|ui| {
                let busy = self.scanning.is_some() || self.deleting.is_some();
                if ui.add_enabled(!busy, Button::new("📂 Browse…")).clicked() {
                    if let Some(p) = rfd::FileDialog::new().set_directory(&self.path_input).pick_folder() {
                        self.path_input = p.display().to_string();
                        self.start_scan(p);
                    }
                }
                let te = ui.add(
                    egui::TextEdit::singleline(&mut self.path_input)
                        .desired_width(360.0)
                        .hint_text("Folder to analyze"),
                );
                let enter = te.lost_focus() && ui.input(|i| i.key_pressed(Key::Enter));
                if (ui.add_enabled(!busy, Button::new("▶ Scan")).clicked() || enter) && !busy {
                    self.start_scan(normalize(&self.path_input));
                }
                if let Some(root) = self.tree.as_ref().map(|t| t.root_path.clone()) {
                    if ui.add_enabled(!busy, Button::new("🔄 Rescan")).clicked() {
                        self.start_scan(root);
                    }
                }
                ui.separator();
                ui.label("Drives:");
                for d in self.drives.clone() {
                    if ui.add_enabled(!busy, Button::new(format!("💾 {}", d.trim_end_matches('\\')))).clicked() {
                        self.path_input = d.clone();
                        self.start_scan(PathBuf::from(d));
                    }
                }
            });
            ui.add_space(5.0);
        });
    }

    fn status_bar(&mut self, ctx: &Context) {
        egui::TopBottomPanel::bottom("status").show(ctx, |ui| {
            ui.add_space(3.0);
            ui.horizontal(|ui| {
                if let Some(s) = &self.scanning {
                    let p = &s.progress;
                    ui.spinner();
                    ui.label(format!(
                        "Scanning… {} files, {} folders, {} — {:.0}s",
                        p.files.load(Ordering::Relaxed),
                        p.dirs.load(Ordering::Relaxed),
                        human(p.bytes.load(Ordering::Relaxed)),
                        s.started.elapsed().as_secs_f32()
                    ));
                    if ui.button("Cancel").clicked() {
                        p.cancel.store(true, Ordering::Relaxed);
                    }
                    let cur = p.current.lock().map(|c| c.clone()).unwrap_or_default();
                    ui.label(RichText::new(shorten(&cur, 110)).weak());
                } else if let Some(d) = &self.deleting {
                    ui.spinner();
                    ui.label(shorten(&d.label, 140));
                } else {
                    ui.label(&self.status);
                }
            });
            ui.add_space(2.0);
        });
    }

    fn welcome(&mut self, ctx: &Context) {
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.vertical_centered(|ui| {
                ui.add_space(ui.available_height() * 0.22);
                ui.heading(RichText::new("Disk Usage Analyzer").size(30.0));
                ui.add_space(8.0);
                ui.label("Find out what is using your disk space — and clean it up right here.");
                ui.add_space(20.0);
                let busy = self.scanning.is_some();
                ui.horizontal(|ui| {
                    let w = 140.0 * (self.drives.len() as f32 + 1.0);
                    ui.add_space(((ui.available_width() - w) / 2.0).max(0.0));
                    for d in self.drives.clone() {
                        let b = Button::new(RichText::new(format!("💾  Scan {}", d)).size(16.0)).min_size(vec2(130.0, 40.0));
                        if ui.add_enabled(!busy, b).clicked() {
                            self.path_input = d.clone();
                            self.start_scan(PathBuf::from(d));
                        }
                    }
                    let b = Button::new(RichText::new("📂  Folder…").size(16.0)).min_size(vec2(130.0, 40.0));
                    if ui.add_enabled(!busy, b).clicked() {
                        if let Some(p) = rfd::FileDialog::new().pick_folder() {
                            self.path_input = p.display().to_string();
                            self.start_scan(p);
                        }
                    }
                });
                ui.add_space(24.0);
                ui.label(RichText::new(
                    "Tips: click to select • double-click a folder to zoom the treemap • right-click for actions\n\
                     Del = move to Recycle Bin • Shift+Del = delete permanently • ↑↓←→ navigate • Enter = zoom • Backspace = up",
                ).weak());
            });
        });
    }

    fn tree_panel(&mut self, ui: &mut Ui, actions: &mut Vec<Action>) {
        let Some(tree) = self.tree.as_ref() else { return };
        let rows = visible_rows(tree, &self.expanded);

        // Keyboard navigation.
        if !ui.ctx().wants_keyboard_input() && self.confirm.is_none() {
            let (up, down, left, right, enter, back, del, shift) = ui.input(|i| {
                (
                    i.key_pressed(Key::ArrowUp),
                    i.key_pressed(Key::ArrowDown),
                    i.key_pressed(Key::ArrowLeft),
                    i.key_pressed(Key::ArrowRight),
                    i.key_pressed(Key::Enter),
                    i.key_pressed(Key::Backspace),
                    i.key_pressed(Key::Delete),
                    i.modifiers.shift,
                )
            });
            let idx = self.selected.and_then(|s| rows.iter().position(|r| r.more == 0 && r.id == s));
            if up || down {
                let mut new = match idx {
                    None => 0,
                    Some(i) if down => (i + 1).min(rows.len() - 1),
                    Some(i) => i.saturating_sub(1),
                };
                if rows[new].more > 0 {
                    new = if down { new.saturating_sub(1) } else { new };
                }
                self.selected = Some(rows[new].id);
                self.scroll_to_sel = true;
            }
            if let Some(sel) = self.selected {
                let n = &tree.nodes[sel];
                if right && n.is_dir {
                    self.expanded.insert(sel);
                }
                if left {
                    if n.is_dir && self.expanded.contains(&sel) {
                        self.expanded.remove(&sel);
                    } else if let Some(p) = n.parent {
                        self.selected = Some(p);
                        self.scroll_to_sel = true;
                    }
                }
                if enter {
                    actions.push(Action::Zoom(sel));
                }
                if del {
                    actions.push(Action::Delete(sel, shift));
                }
            }
            if back {
                if let Some(p) = tree.nodes[self.view_root].parent {
                    actions.push(Action::Zoom(p));
                }
            }
        }

        // Header.
        let (hrect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 18.0), Sense::hover());
        let cols = Cols::new(hrect);
        let hp = ui.painter();
        let hc = ui.visuals().weak_text_color();
        let hf = FontId::proportional(12.0);
        hp.text(pos2(cols.name_left, hrect.center().y), Align2::LEFT_CENTER, "Name", hf.clone(), hc);
        hp.text(pos2((cols.bar_l + cols.bar_r) / 2.0, hrect.center().y), Align2::CENTER_CENTER, "% of parent", hf.clone(), hc);
        hp.text(pos2(cols.size_r, hrect.center().y), Align2::RIGHT_CENTER, "Size", hf.clone(), hc);
        hp.text(pos2(cols.items_r, hrect.center().y), Align2::RIGHT_CENTER, "Files", hf, hc);
        ui.separator();

        let mut sa = ScrollArea::vertical().auto_shrink([false, false]);
        if self.scroll_to_sel {
            self.scroll_to_sel = false;
            if let Some(idx) = self.selected.and_then(|s| rows.iter().position(|r| r.more == 0 && r.id == s)) {
                let y = idx as f32 * ROW_H;
                let (off, h) = self.tree_scroll;
                if y < off || y + ROW_H > off + h {
                    sa = sa.vertical_scroll_offset((y - h / 2.0).max(0.0));
                }
            }
        }

        let selected = self.selected;
        ui.spacing_mut().item_spacing.y = 0.0;
        let out = sa.show_rows(ui, ROW_H, rows.len(), |ui, range| {
            for i in range {
                let r = &rows[i];
                let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), ROW_H), Sense::click());
                let painter = ui.painter();
                let cols = Cols::new(rect);
                let indent = rect.left() + 6.0 + r.depth as f32 * 16.0;
                if r.more > 0 {
                    painter.text(
                        pos2(indent + 20.0, rect.center().y),
                        Align2::LEFT_CENTER,
                        format!("… {} smaller items not shown", r.more),
                        FontId::proportional(12.0),
                        ui.visuals().weak_text_color(),
                    );
                    continue;
                }
                let n = &tree.nodes[r.id];
                let is_sel = selected == Some(r.id);
                if is_sel {
                    painter.rect_filled(rect, 2.0, ui.visuals().selection.bg_fill);
                } else if resp.hovered() {
                    painter.rect_filled(rect, 2.0, ui.visuals().widgets.hovered.weak_bg_fill);
                }
                let tc = if is_sel { ui.visuals().selection.stroke.color } else { ui.visuals().text_color() };

                let tri = pos2(indent + 5.0, rect.center().y);
                if n.is_dir && !n.children.is_empty() {
                    triangle(painter, tri, self.expanded.contains(&r.id), tc);
                }
                let icon = if n.is_dir { "📁" } else { "📄" };
                let name = if n.error { format!("{icon} {}  ⚠ access denied", tree.display_name(r.id)) } else { format!("{icon} {}", tree.display_name(r.id)) };
                let clip = Rect::from_min_max(pos2(indent + 12.0, rect.top()), pos2(cols.bar_l - 8.0, rect.bottom()));
                painter.with_clip_rect(clip).text(
                    pos2(indent + 14.0, rect.center().y),
                    Align2::LEFT_CENTER,
                    name,
                    FontId::proportional(13.5),
                    tc,
                );

                // Percentage bar.
                let parent_size = n.parent.map(|p| tree.nodes[p].size).unwrap_or(n.size).max(1);
                let frac = (n.size as f64 / parent_size as f64).clamp(0.0, 1.0) as f32;
                let bar = Rect::from_min_max(pos2(cols.bar_l, rect.top() + 4.0), pos2(cols.bar_r, rect.bottom() - 4.0));
                painter.rect_filled(bar, 2.0, Color32::from_gray(60));
                let mut fill = bar;
                fill.max.x = bar.left() + bar.width() * frac;
                painter.rect_filled(fill, 2.0, bar_color(frac));
                painter.text(bar.center(), Align2::CENTER_CENTER, format!("{:.1}%", frac * 100.0), FontId::proportional(10.5), Color32::WHITE);

                painter.text(pos2(cols.size_r, rect.center().y), Align2::RIGHT_CENTER, human(n.size), FontId::monospace(12.5), tc);
                painter.text(pos2(cols.items_r, rect.center().y), Align2::RIGHT_CENTER, n.files.to_string(), FontId::monospace(12.0), ui.visuals().weak_text_color());

                if resp.clicked() {
                    let on_tri = n.is_dir
                        && resp.interact_pointer_pos().is_some_and(|p| (p.x - tri.x).abs() < 9.0);
                    actions.push(if on_tri { Action::Toggle(r.id) } else { Action::Select(r.id) });
                }
                if resp.double_clicked() && n.is_dir {
                    actions.push(Action::Toggle(r.id));
                    actions.push(Action::Zoom(r.id));
                }
                if resp.secondary_clicked() {
                    actions.push(Action::Select(r.id));
                }
                let id = r.id;
                resp.context_menu(|ui| item_menu(ui, tree, id, actions));
            }
        });
        self.tree_scroll = (out.state.offset.y, out.inner_rect.height());
    }

    fn central(&mut self, ui: &mut Ui, actions: &mut Vec<Action>) {
        let Some(tree) = self.tree.as_ref() else { return };
        ui.horizontal_wrapped(|ui| {
            let parent = tree.nodes[self.view_root].parent;
            if ui.add_enabled(parent.is_some(), Button::new("⬆ Up")).clicked() {
                if let Some(p) = parent {
                    actions.push(Action::Zoom(p));
                }
            }
            let mut chain = Vec::new();
            let mut cur = Some(self.view_root);
            while let Some(c) = cur {
                chain.push(c);
                cur = tree.nodes[c].parent;
            }
            for (i, id) in chain.iter().rev().enumerate() {
                if i > 0 {
                    ui.label("›");
                }
                if ui.selectable_label(*id == self.view_root, tree.display_name(*id)).clicked() {
                    actions.push(Action::Zoom(*id));
                }
            }
            ui.label(RichText::new(format!("  {}", human(tree.nodes[self.view_root].size))).strong());
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                ui.selectable_value(&mut self.tab, Tab::TopFiles, "📊 Largest files");
                ui.selectable_value(&mut self.tab, Tab::Treemap, "▦ Treemap");
            });
        });
        ui.separator();
        match self.tab {
            Tab::Treemap => self.treemap_panel(ui, actions),
            Tab::TopFiles => self.top_files(ui, actions),
        }
    }

    fn treemap_panel(&mut self, ui: &mut Ui, actions: &mut Vec<Action>) {
        let Some(tree) = self.tree.as_ref() else { return };

        // Legend.
        ui.horizontal_wrapped(|ui| {
            for (label, hue) in CATEGORIES.iter().map(|c| (c.0, c.1)).chain([("other", -1.0)]) {
                let (r, _) = ui.allocate_exact_size(vec2(12.0, 12.0), Sense::hover());
                ui.painter().rect_filled(r, 2.0, category_color(hue));
                ui.label(RichText::new(label).small());
                ui.add_space(6.0);
            }
        });

        let (rect, resp) = ui.allocate_exact_size(ui.available_size(), Sense::click());
        let painter = ui.painter_at(rect);
        let mut hits: Vec<(Rect, usize)> = Vec::with_capacity(4096);
        if tree.nodes[self.view_root].size == 0 {
            painter.text(rect.center(), Align2::CENTER_CENTER, "This folder is empty", FontId::proportional(18.0), ui.visuals().weak_text_color());
        } else {
            draw_node(&painter, tree, self.view_root, rect, 0, &mut hits);
        }

        let hovered = resp
            .hover_pos()
            .and_then(|p| hits.iter().rev().find(|(r, _)| r.contains(p)).map(|&(_, id)| id));
        if let Some(sel) = self.selected {
            if let Some((r, _)) = hits.iter().find(|(_, id)| *id == sel) {
                painter.rect_stroke(*r, 0.0, Stroke::new(2.5_f32, Color32::YELLOW));
            }
        }
        if let Some(h) = hovered {
            if let Some((r, _)) = hits.iter().rev().find(|(_, id)| *id == h) {
                painter.rect_stroke(*r, 0.0, Stroke::new(1.5_f32, Color32::WHITE));
            }
        }

        if let Some(h) = hovered {
            if resp.clicked() {
                actions.push(Action::SelectReveal(h));
            }
            if resp.double_clicked() {
                actions.push(Action::Zoom(h));
            }
        }
        if resp.secondary_clicked() {
            self.tm_context = hovered;
            if let Some(h) = hovered {
                actions.push(Action::SelectReveal(h));
            }
        }
        let resp = match hovered {
            Some(h) => resp.on_hover_ui_at_pointer(|ui| {
                let n = &tree.nodes[h];
                ui.strong(tree.display_name(h));
                ui.label(RichText::new(tree.path_of(h).display().to_string()).weak());
                ui.label(if n.is_dir { format!("{} — {} files", human(n.size), n.files) } else { human(n.size) });
            }),
            None => resp,
        };
        let target = self.tm_context;
        resp.context_menu(|ui| match target {
            Some(t) => item_menu(ui, tree, t, actions),
            None => ui.close_menu(),
        });
    }

    fn top_files(&mut self, ui: &mut Ui, actions: &mut Vec<Action>) {
        let Some(tree) = self.tree.as_ref() else { return };
        let fresh = self
            .top_cache
            .as_ref()
            .is_some_and(|c| c.0 == self.view_root && c.1 == self.generation);
        if !fresh {
            self.top_cache = Some((self.view_root, self.generation, tree.largest_files(self.view_root, 500)));
        }
        let ids = &self.top_cache.as_ref().unwrap().2;
        let base = tree.path_of(self.view_root);
        let selected = self.selected;
        ui.label(RichText::new(format!("The {} largest files in this folder (double-click to locate):", ids.len())).weak());
        ui.spacing_mut().item_spacing.y = 0.0;
        ScrollArea::vertical().auto_shrink([false, false]).show_rows(ui, ROW_H, ids.len(), |ui, range| {
            for i in range {
                let id = ids[i];
                let n = &tree.nodes[id];
                let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), ROW_H), Sense::click());
                let painter = ui.painter();
                let is_sel = selected == Some(id);
                if is_sel {
                    painter.rect_filled(rect, 2.0, ui.visuals().selection.bg_fill);
                } else if resp.hovered() {
                    painter.rect_filled(rect, 2.0, ui.visuals().widgets.hovered.weak_bg_fill);
                }
                let tc = if is_sel { ui.visuals().selection.stroke.color } else { ui.visuals().text_color() };
                painter.text(pos2(rect.left() + 90.0, rect.center().y), Align2::RIGHT_CENTER, human(n.size), FontId::monospace(12.5), tc);
                let p = tree.path_of(id);
                let rel = p.strip_prefix(&base).unwrap_or(&p).display().to_string();
                painter.with_clip_rect(rect).text(pos2(rect.left() + 104.0, rect.center().y), Align2::LEFT_CENTER, format!("📄 {rel}"), FontId::proportional(13.0), tc);
                if resp.clicked() || resp.secondary_clicked() {
                    actions.push(Action::Select(id));
                }
                if resp.double_clicked() {
                    actions.push(Action::SelectReveal(id));
                    self.tab = Tab::Treemap;
                    actions.push(Action::Zoom(id));
                }
                resp.context_menu(|ui| item_menu(ui, tree, id, actions));
            }
        });
    }

    fn confirm_dialog(&mut self, ctx: &Context) {
        let Some(c) = self.confirm.as_mut() else { return };
        let Some(tree) = self.tree.as_ref() else {
            self.confirm = None;
            return;
        };
        let n = &tree.nodes[c.id];
        let path = tree.path_of(c.id);
        let mut decision = None;

        // Dim the background.
        let screen = ctx.screen_rect();
        ctx.layer_painter(egui::LayerId::new(egui::Order::Middle, egui::Id::new("dim")))
            .rect_filled(screen, 0.0, Color32::from_black_alpha(140));

        egui::Window::new(if c.permanent { "⚠ Delete permanently?" } else { "🗑 Move to Recycle Bin?" })
            .collapsible(false)
            .resizable(false)
            .anchor(Align2::CENTER_CENTER, [0.0, 0.0])
            .show(ctx, |ui| {
                ui.set_max_width(520.0);
                ui.label(RichText::new(format!("{} {}", if n.is_dir { "📁" } else { "📄" }, n.name)).strong().size(16.0));
                ui.label(RichText::new(path.display().to_string()).weak());
                ui.add_space(4.0);
                ui.label(if n.is_dir { format!("{} in {} files", human(n.size), n.files) } else { human(n.size) });
                ui.add_space(8.0);
                ui.checkbox(&mut c.permanent, "Delete permanently (skip the Recycle Bin)");
                if c.permanent {
                    ui.colored_label(Color32::from_rgb(240, 90, 90), "This cannot be undone!");
                } else {
                    ui.label(RichText::new("You can restore it from the Recycle Bin later.").weak());
                }
                ui.add_space(10.0);
                ui.horizontal(|ui| {
                    let txt = if c.permanent { "❌ Delete permanently" } else { "🗑 Move to Recycle Bin" };
                    let btn = Button::new(RichText::new(txt).color(Color32::WHITE)).fill(if c.permanent {
                        Color32::from_rgb(170, 40, 40)
                    } else {
                        Color32::from_rgb(50, 100, 170)
                    });
                    if ui.add(btn).clicked() {
                        decision = Some(true);
                    }
                    if ui.button("Cancel").clicked() {
                        decision = Some(false);
                    }
                });
            });
        if ctx.input(|i| i.key_pressed(Key::Escape)) {
            decision = Some(false);
        }
        match decision {
            Some(true) => {
                let (id, permanent) = (c.id, c.permanent);
                self.confirm = None;
                self.start_delete(id, permanent);
            }
            Some(false) => self.confirm = None,
            None => {}
        }
    }
}

impl eframe::App for App {
    fn update(&mut self, ctx: &Context, _frame: &mut eframe::Frame) {
        self.poll(ctx);
        self.top_bar(ctx);
        self.status_bar(ctx);

        let mut actions = Vec::new();
        if self.tree.is_some() {
            egui::SidePanel::left("tree_panel")
                .resizable(true)
                .default_width(580.0)
                .width_range(320.0..=1200.0)
                .show(ctx, |ui| self.tree_panel(ui, &mut actions));
            egui::CentralPanel::default().show(ctx, |ui| self.central(ui, &mut actions));
        } else {
            self.welcome(ctx);
        }
        for a in actions {
            self.apply(ctx, a);
        }
        self.confirm_dialog(ctx);
    }
}

// -------------------------------------------------------------------- helpers

struct Cols {
    name_left: f32,
    bar_l: f32,
    bar_r: f32,
    size_r: f32,
    items_r: f32,
}

impl Cols {
    fn new(rect: Rect) -> Self {
        let items_r = rect.right() - 10.0;
        let size_r = items_r - 72.0;
        let bar_r = size_r - 84.0;
        let bar_l = bar_r - 92.0;
        Cols { name_left: rect.left() + 20.0, bar_l, bar_r, size_r, items_r }
    }
}

fn visible_rows(tree: &Tree, expanded: &HashSet<usize>) -> Vec<Row> {
    fn walk(tree: &Tree, expanded: &HashSet<usize>, id: usize, depth: usize, rows: &mut Vec<Row>) {
        rows.push(Row { id, depth, more: 0 });
        let n = &tree.nodes[id];
        if n.is_dir && expanded.contains(&id) {
            for &c in n.children.iter().take(MAX_CHILD_ROWS) {
                walk(tree, expanded, c, depth + 1, rows);
            }
            if n.children.len() > MAX_CHILD_ROWS {
                rows.push(Row { id, depth: depth + 1, more: n.children.len() - MAX_CHILD_ROWS });
            }
        }
    }
    let mut rows = Vec::new();
    walk(tree, expanded, 0, 0, &mut rows);
    rows
}

fn item_menu(ui: &mut Ui, tree: &Tree, id: usize, actions: &mut Vec<Action>) {
    let n = &tree.nodes[id];
    ui.label(RichText::new(format!("{}  ({})", shorten(&tree.display_name(id), 50), human(n.size))).strong());
    ui.separator();
    let mut act = |ui: &mut Ui, enabled: bool, text: RichText, a: Action| {
        if ui.add_enabled(enabled, Button::new(text)).clicked() {
            actions.push(a);
            ui.close_menu();
        }
    };
    if n.is_dir {
        act(ui, true, "🔍 Zoom treemap here".into(), Action::Zoom(id));
    }
    act(ui, true, "↗ Open".into(), Action::Open(id));
    act(ui, true, REVEAL_LABEL.into(), Action::Reveal(id));
    act(ui, true, "📋 Copy path".into(), Action::CopyPath(id));
    ui.separator();
    let can_delete = n.parent.is_some();
    act(ui, can_delete, "🗑 Move to Recycle Bin        Del".into(), Action::Delete(id, false));
    act(
        ui,
        can_delete,
        RichText::new("❌ Delete permanently    Shift+Del").color(Color32::from_rgb(235, 90, 90)),
        Action::Delete(id, true),
    );
}

fn draw_node(p: &Painter, tree: &Tree, id: usize, rect: Rect, depth: usize, hits: &mut Vec<(Rect, usize)>) {
    if rect.width() < 1.0 || rect.height() < 1.0 {
        return;
    }
    let n = &tree.nodes[id];
    hits.push((rect, id));
    if !n.is_dir {
        cushion(p, rect, file_color(&n.name));
        if rect.width() > 50.0 && rect.height() > 15.0 {
            p.with_clip_rect(rect.shrink(2.0).intersect(p.clip_rect())).text(
                rect.left_top() + vec2(3.0, 2.0),
                Align2::LEFT_TOP,
                &n.name,
                FontId::proportional(11.0),
                Color32::from_black_alpha(230),
            );
        }
        return;
    }

    p.rect_filled(rect, 0.0, Color32::from_gray(48u8.saturating_sub((depth * 4).min(30) as u8)));
    p.rect_stroke(rect, 0.0, Stroke::new(1.0_f32, Color32::from_gray(12)));
    let mut inner = rect.shrink(1.5);
    if rect.width() > 40.0 && rect.height() > 32.0 {
        p.with_clip_rect(rect.shrink(1.0).intersect(p.clip_rect())).text(
            rect.left_top() + vec2(4.0, 1.5),
            Align2::LEFT_TOP,
            format!("{}  {}", tree.display_name(id), human(n.size)),
            FontId::proportional(11.0),
            Color32::from_gray(235),
        );
        inner.min.y += 14.0;
    }
    if inner.width() < 2.0 || inner.height() < 2.0 || n.size == 0 {
        return;
    }

    let total = n.size as f64;
    let area = inner.area() as f64;
    let mut ids = Vec::new();
    let mut vals = Vec::new();
    let mut shown = 0.0;
    for &c in &n.children {
        let s = tree.nodes[c].size as f64;
        if s <= 0.0 || s / total * area < TM_MIN_AREA || ids.len() >= 4000 {
            break; // children are sorted by size, so the rest are smaller
        }
        ids.push(c);
        vals.push(s);
        shown += s;
    }
    let rest = total - shown;
    if rest > 0.0 {
        vals.push(rest);
    }
    let rects = treemap::layout(&vals, inner);
    for (c, r) in ids.iter().zip(rects.iter()) {
        draw_node(p, tree, *c, *r, depth + 1, hits);
    }
}

fn cushion(p: &Painter, rect: Rect, base: Color32) {
    let light = mix(base, Color32::WHITE, 0.35);
    let dark = mix(base, Color32::BLACK, 0.45);
    let mut mesh = Mesh::default();
    mesh.colored_vertex(rect.left_top(), light);
    mesh.colored_vertex(rect.right_top(), base);
    mesh.colored_vertex(rect.right_bottom(), dark);
    mesh.colored_vertex(rect.left_bottom(), base);
    mesh.add_triangle(0, 1, 2);
    mesh.add_triangle(0, 2, 3);
    p.add(Shape::mesh(mesh));
    if rect.width() > 3.0 && rect.height() > 3.0 {
        p.rect_stroke(rect, 0.0, Stroke::new(0.5_f32, Color32::from_black_alpha(150)));
    }
}

fn mix(a: Color32, b: Color32, t: f32) -> Color32 {
    let f = |x: u8, y: u8| (x as f32 + (y as f32 - x as f32) * t) as u8;
    Color32::from_rgb(f(a.r(), b.r()), f(a.g(), b.g()), f(a.b(), b.b()))
}

fn triangle(p: &Painter, c: Pos2, open: bool, color: Color32) {
    let s = 4.0;
    let pts = if open {
        vec![pos2(c.x - s, c.y - s * 0.5), pos2(c.x + s, c.y - s * 0.5), pos2(c.x, c.y + s * 0.6)]
    } else {
        vec![pos2(c.x - s * 0.5, c.y - s), pos2(c.x + s * 0.6, c.y), pos2(c.x - s * 0.5, c.y + s)]
    };
    p.add(Shape::convex_polygon(pts, color, Stroke::NONE));
}

fn bar_color(frac: f32) -> Color32 {
    // green → yellow → red as the share grows
    Hsva::new(0.33 * (1.0 - frac), 0.65, 0.75, 1.0).into()
}

const CATEGORIES: &[(&str, f32, &[&str])] = &[
    ("video", 0.0, &["mp4", "mkv", "avi", "mov", "wmv", "webm", "flv", "m4v", "mpg", "mpeg", "ts"]),
    ("audio", 0.08, &["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma", "opus"]),
    ("images", 0.15, &["jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff", "svg", "heic", "raw", "psd", "ico", "cr2", "nef"]),
    ("documents", 0.33, &["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "odt", "ods", "csv", "rtf", "epub"]),
    ("code / data", 0.48, &["rs", "c", "cpp", "h", "hpp", "py", "js", "ts", "java", "cs", "go", "html", "css", "json", "xml", "toml", "yaml", "yml", "sql", "db", "sqlite", "rlib", "pdb", "o", "obj", "lib", "a"]),
    ("programs", 0.60, &["exe", "dll", "sys", "so", "dylib", "bin", "msi", "appx", "msix"]),
    ("archives / disk images", 0.78, &["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zst", "iso", "img", "vhd", "vhdx", "vmdk", "cab", "dmg"]),
];

fn category_color(hue: f32) -> Color32 {
    if hue < 0.0 {
        Color32::from_gray(150)
    } else {
        Hsva::new(hue, 0.6, 0.85, 1.0).into()
    }
}

fn file_color(name: &str) -> Color32 {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    for (_, hue, exts) in CATEGORIES {
        if exts.contains(&ext.as_str()) {
            return category_color(*hue);
        }
    }
    // Unknown types: muted, but still distinguishable per extension.
    let h = ext.bytes().fold(2166136261u32, |h, b| (h ^ b as u32).wrapping_mul(16777619));
    Hsva::new((h % 1000) as f32 / 1000.0, 0.15, 0.62, 1.0).into()
}

fn shorten(s: &str, max: usize) -> String {
    let count = s.chars().count();
    if count <= max {
        s.to_string()
    } else {
        let tail: String = s.chars().skip(count - (max - 1)).collect();
        format!("…{tail}")
    }
}

fn normalize(input: &str) -> PathBuf {
    let s = input.trim().trim_matches('"');
    if s.len() == 2 && s.ends_with(':') {
        PathBuf::from(format!("{s}\\"))
    } else {
        PathBuf::from(s)
    }
}

fn list_drives() -> Vec<String> {
    if cfg!(windows) {
        (b'C'..=b'Z')
            .map(|c| format!("{}:\\", c as char))
            .filter(|d| Path::new(d).exists())
            .collect()
    } else {
        vec!["/".into()]
    }
}

fn delete_permanently(path: &Path, is_dir: bool) -> Result<(), String> {
    let remove = || if is_dir { std::fs::remove_dir_all(path) } else { std::fs::remove_file(path) };
    match remove() {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::PermissionDenied => {
            // Read-only files block deletion on Windows: clear the flag and retry.
            clear_readonly(path);
            remove().map_err(|e| e.to_string())
        }
        Err(e) => Err(e.to_string()),
    }
}

#[allow(clippy::permissions_set_readonly_false)]
fn clear_readonly(path: &Path) {
    let Ok(md) = std::fs::symlink_metadata(path) else { return };
    if md.file_type().is_symlink() {
        return;
    }
    let mut perm = md.permissions();
    if perm.readonly() {
        perm.set_readonly(false);
        let _ = std::fs::set_permissions(path, perm);
    }
    if md.is_dir() {
        if let Ok(rd) = std::fs::read_dir(path) {
            for e in rd.flatten() {
                clear_readonly(&e.path());
            }
        }
    }
}

#[cfg(windows)]
fn reveal(path: &Path) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("explorer")
        .raw_arg(format!("/select,\"{}\"", path.display()))
        .spawn();
}

#[cfg(not(windows))]
fn reveal(path: &Path) {
    let _ = open::that_detached(path.parent().unwrap_or(path));
}
