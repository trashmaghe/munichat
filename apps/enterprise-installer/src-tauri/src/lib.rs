//! Native backend for the Elyzian Enterprise Installer.
//!
//! The installer ships the `docker/` compose tree as a bundled resource. To
//! deploy it copies that tree into a writable working directory, writes the
//! generated `.env` beside it, then runs `docker compose pull` + `up -d`
//! against the images compose — downloading the app images from the registry,
//! so the server needs no source checkout. Output streams to the UI via the
//! `deploy-log` event.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::{Emitter, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreflightReport {
    docker_installed: bool,
    docker_running: bool,
    compose_available: bool,
    docker_version: Option<String>,
    stack_bundled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeployResult {
    ok: bool,
    exit_code: Option<i32>,
}

#[derive(Clone, Serialize)]
struct DeployLogLine {
    stream: String,
    line: String,
}

const IMAGES_COMPOSE: &str = "docker/docker-compose.images.yml";
const EDGE_COMPOSE: &str = "docker/docker-compose.edge.yml";

/// The directory that contains `docker/…` — bundled resources in a packaged
/// install, or the repo root during `tauri dev`.
fn stack_source(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(res) = app.path().resource_dir() {
        if res.join(IMAGES_COMPOSE).is_file() {
            return Some(res);
        }
    }
    // Dev fallback: walk up from the cwd to find the repo's docker/ tree.
    let mut dir = std::env::current_dir().ok();
    for _ in 0..6 {
        let d = dir?;
        if d.join(IMAGES_COMPOSE).is_file() {
            return Some(d);
        }
        dir = d.parent().map(Path::to_path_buf);
    }
    None
}

/// Writable working directory the stack actually runs from.
fn work_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No writable app-data directory: {e}"))?;
    let dir = base.join("stack");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

fn run_capture(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

#[tauri::command]
fn preflight(app: tauri::AppHandle) -> PreflightReport {
    let docker_installed = run_capture("docker", &["--version"]).is_some();
    let server_version = run_capture("docker", &["version", "--format", "{{.Server.Version}}"]);
    let docker_running = server_version.as_deref().map(|s| !s.is_empty()).unwrap_or(false);
    let compose_available = run_capture("docker", &["compose", "version"]).is_some();
    let stack_bundled = stack_source(&app).is_some();

    PreflightReport {
        docker_installed,
        docker_running,
        compose_available,
        docker_version: server_version.filter(|s| !s.is_empty()),
        stack_bundled,
    }
}

/// Open a URL in the operator's default browser (used by the "Get Docker
/// Desktop" helper).
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let result = Command::new("cmd").args(["/C", "start", "", &url]).spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(&url).spawn();

    result.map(|_| ()).map_err(|e| format!("Could not open {url}: {e}"))
}

fn emit_log(app: &tauri::AppHandle, stream: &str, line: &str) {
    let _ = app.emit(
        "deploy-log",
        DeployLogLine { stream: stream.to_string(), line: line.to_string() },
    );
}

/// Run one streaming `docker compose …` command from `dir`, forwarding output.
/// Returns the process exit code.
fn run_compose(app: &tauri::AppHandle, dir: &Path, extra: &[&str], use_edge: bool) -> Result<i32, String> {
    let mut args: Vec<String> = vec!["compose".into(), "-f".into(), IMAGES_COMPOSE.into()];
    if use_edge {
        args.push("-f".into());
        args.push(EDGE_COMPOSE.into());
    }
    args.extend(["--env-file".into(), ".env".into()]);
    args.extend(extra.iter().map(|s| s.to_string()));

    emit_log(app, "status", &format!("$ docker {}", args.join(" ")));

    let mut child = Command::new("docker")
        .args(&args)
        .current_dir(dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to launch Docker Compose: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let app_out = app.clone();
    let out = std::thread::spawn(move || {
        if let Some(o) = stdout {
            for line in BufReader::new(o).lines().map_while(Result::ok) {
                emit_log(&app_out, "stdout", &line);
            }
        }
    });
    let app_err = app.clone();
    let err = std::thread::spawn(move || {
        if let Some(e) = stderr {
            for line in BufReader::new(e).lines().map_while(Result::ok) {
                emit_log(&app_err, "stderr", &line);
            }
        }
    });

    let status = child.wait().map_err(|e| format!("Docker Compose failed: {e}"))?;
    let _ = out.join();
    let _ = err.join();
    Ok(status.code().unwrap_or(-1))
}

/// Prepare the working directory, then pull the images and bring the stack up,
/// streaming all output. `env_content` is the generated `.env`.
#[tauri::command]
fn deploy_stack(app: tauri::AppHandle, env_content: String, use_edge: bool) -> Result<DeployResult, String> {
    let source = stack_source(&app)
        .ok_or_else(|| "The Elyzian stack files are missing from this installer.".to_string())?;
    let dir = work_dir(&app)?;

    emit_log(&app, "status", "Preparing the stack files…");
    copy_dir(&source.join("docker"), &dir.join("docker"))
        .map_err(|e| format!("Failed to stage the compose files: {e}"))?;
    std::fs::write(dir.join(".env"), &env_content)
        .map_err(|e| format!("Failed to write .env: {e}"))?;

    emit_log(&app, "status", "Downloading Elyzian images…");
    let pull = run_compose(&app, &dir, &["pull"], use_edge)?;
    if pull != 0 {
        emit_log(&app, "stderr", "Image download failed — check the registry/tag and network.");
        return Ok(DeployResult { ok: false, exit_code: Some(pull) });
    }

    emit_log(&app, "status", "Starting the stack…");
    let up = run_compose(&app, &dir, &["up", "-d"], use_edge)?;
    let ok = up == 0;
    emit_log(
        &app,
        "status",
        if ok { "Stack is up — containers are starting." } else { "Compose exited with an error." },
    );
    Ok(DeployResult { ok, exit_code: Some(up) })
}

/// Probe the API's `/health` endpoint. Returns true on a 2xx response.
#[tauri::command]
fn stack_health(api_url: String) -> bool {
    let url = format!("{}/health", api_url.trim_end_matches('/'));
    match ureq::get(&url).timeout(std::time::Duration::from_secs(5)).call() {
        Ok(resp) => (200..300).contains(&resp.status()),
        Err(_) => false,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            preflight,
            open_url,
            deploy_stack,
            stack_health
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Elyzian Enterprise Installer");
}
