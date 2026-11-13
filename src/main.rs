#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod scan;
mod tree;
mod treemap;

use eframe::egui;
use std::path::PathBuf;

fn main() -> Result<(), eframe::Error> {
    // Optional: a folder passed on the command line is scanned at startup.
    let initial = std::env::args_os().nth(1).map(PathBuf::from);

    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1320.0, 840.0])
            .with_min_inner_size([820.0, 500.0])
            .with_title("Disk Usage Analyzer"),
        ..Default::default()
    };

    eframe::run_native(
        "Disk Usage Analyzer",
        options,
        Box::new(move |_cc| Ok(Box::new(app::App::new(initial)))),
    )
}
