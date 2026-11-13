use std::io::{Read, Write};
use std::net::{TcpStream, SocketAddr};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop};
use tao::window::WindowBuilder;
use wry::WebViewBuilder;

fn main() {
    let web = web_dir();
    let (url, child) = match prepare(&web) {
        Ok(ready) => ready,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    };
    if let Err(error) = open_window(&url, child) {
        eprintln!("Could not open the studio window: {error}");
        std::process::exit(1);
    }
}

fn web_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let candidate = PathBuf::from(dir).join("web");
        if candidate.join("package.json").is_file() {
            return candidate;
        }
    }
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
    for ancestor in exe.parent().into_iter().flat_map(|dir| dir.ancestors()) {
        let candidate = ancestor.join("web");
        if candidate.join("package.json").is_file() {
            return candidate;
        }
    }
    PathBuf::from("web")
}

fn prepare(web: &PathBuf) -> Result<(String, Option<Child>), String> {
    for port in [3000u16, 3847] {
        let url = format!("http://127.0.0.1:{port}");
        if studio_ready(&url) {
            println!("Opening {url}");
            return Ok((url, None));
        }
    }
    if !web.join("package.json").is_file() {
        return Err(format!("Can't find the studio at {}", web.display()));
    }
    println!("Starting the 3D studio…");
    let mut child = Command::new("npm.cmd")
        .args(["run", "dev", "--", "-p", "3850"])
        .current_dir(web)
        .spawn()
        .map_err(|error| format!("Could not start npm ({error}). Install Node.js and run this from the project."))?;
    let url = "http://127.0.0.1:3850".to_string();
    let deadline = Instant::now() + Duration::from_secs(90);
    while Instant::now() < deadline {
        if studio_ready(&url) {
            println!("Opening {url}");
            return Ok((url, Some(child)));
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    stop(&mut child);
    Err("The 3D studio did not start.".into())
}

fn studio_ready(url: &str) -> bool {
    let port: u16 = url.rsplit(':').next().and_then(|text| text.parse().ok()).unwrap_or(0);
    let address: SocketAddr = match format!("127.0.0.1:{port}").parse() {
        Ok(address) => address,
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&address, Duration::from_millis(250)) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let request = format!("GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut body = String::new();
    let _ = stream.read_to_string(&mut body);
    body.contains("Disk Usage Analyzer")
}

fn open_window(url: &str, mut child: Option<Child>) -> wry::Result<()> {
    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title("Disk Usage Analyzer 3D")
        .with_inner_size(tao::dpi::LogicalSize::new(1320.0, 840.0))
        .with_min_inner_size(tao::dpi::LogicalSize::new(820.0, 500.0))
        .build(&event_loop)?;
    let _webview = WebViewBuilder::new().with_url(url).build(&window)?;
    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            if let Some(child) = child.as_mut() {
                stop(child);
            }
            *control_flow = ControlFlow::Exit;
        }
    });
}

fn stop(child: &mut Child) {
    let _ = Command::new("taskkill")
        .args(["/F", "/T", "/PID", &child.id().to_string()])
        .output();
}
