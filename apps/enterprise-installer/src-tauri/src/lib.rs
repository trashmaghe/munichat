//! Native backend for the Elyzian Enterprise Installer.
//!
//! Four commands drive the wizard: `preflight` (is Docker here?), `write_env_file`
//! (persist the generated `.env`), `deploy_stack` (run Docker Compose, streaming
//! its output back to the UI), and `stack_health` (did the API come up?).

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
    repo_dir: Option<String>,
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

/// Locate the directory that holds `docker/docker-compose.yml` — the Elyzian
/// stack root. Search the current dir and the executable's dir, walking up a
/// few levels so the installer works whether it's run from the repo or shipped
/// next to the compose files.
fn find_stack_dir() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.to_path_buf());
        }
    }

    for start in candidates {
        let mut dir: Option<&Path> = Some(start.as_path());
        for _ in 0..6 {
            let Some(d) = dir else { break };
            if d.join("docker").join("docker-compose.yml").is_file() {
                return Some(d.to_path_buf());
            }
            dir = d.parent();
        }
    }
    None
}

/// Resolve the caller-supplied repo dir, falling back to auto-detection when it
/// is empty or ".".
fn resolve_repo_dir(input: &str) -> Option<PathBuf> {
    let trimmed = input.trim();
    if !trimmed.is_empty() && trimmed != "." {
        let p = PathBuf::from(trimmed);
        if p.join("docker").join("docker-compose.yml").is_file() {
            return Some(p);
        }
    }
    find_stack_dir()
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
fn preflight() -> PreflightReport {
    let docker_installed = run_capture("docker", &["--version"]).is_some();
    // `docker version` talking to the server proves the daemon is up.
    let server_version = run_capture("docker", &["version", "--format", "{{.Server.Version}}"]);
    let docker_running = server_version.as_deref().map(|s| !s.is_empty()).unwrap_or(false);
    let compose_available = run_capture("docker", &["compose", "version"]).is_some();
    let repo_dir = find_stack_dir().map(|p| p.to_string_lossy().to_string());

    PreflightReport {
        docker_installed,
        docker_running,
        compose_available,
        docker_version: server_version.filter(|s| !s.is_empty()),
        repo_dir,
    }
}

#[tauri::command]
fn write_env_file(repo_dir: String, content: String) -> Result<String, String> {
    let dir = resolve_repo_dir(&repo_dir).ok_or_else(|| {
        "Could not locate the Elyzian stack (docker/docker-compose.yml). Place the installer beside it.".to_string()
    })?;
    let path = dir.join(".env");
    std::fs::write(&path, content).map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().to_string())
}

/// Run `docker compose … up -d`, streaming each output line to the frontend via
/// the `deploy-log` event. Resolves once compose exits.
#[tauri::command]
fn deploy_stack(app: tauri::AppHandle, repo_dir: String, use_edge: bool) -> Result<DeployResult, String> {
    let dir = resolve_repo_dir(&repo_dir)
        .ok_or_else(|| "Could not locate the Elyzian stack (docker/docker-compose.yml).".to_string())?;

    let mut args: Vec<String> = vec![
        "compose".into(),
        "-f".into(),
        "docker/docker-compose.yml".into(),
    ];
    if use_edge {
        args.push("-f".into());
        args.push("docker/docker-compose.edge.yml".into());
    }
    // `--build` so the API/web images are built from the release source on
    // first run; on later runs Compose reuses the cached layers.
    args.extend([
        "--env-file".into(),
        ".env".into(),
        "up".into(),
        "-d".into(),
        "--build".into(),
    ]);

    emit_log(&app, "status", &format!("$ docker {}", args.join(" ")));

    let mut child = Command::new("docker")
        .args(&args)
        .current_dir(&dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to launch Docker Compose: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let app_out = app.clone();
    let out_handle = std::thread::spawn(move || {
        if let Some(out) = stdout {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                emit_log(&app_out, "stdout", &line);
            }
        }
    });
    let app_err = app.clone();
    let err_handle = std::thread::spawn(move || {
        if let Some(err) = stderr {
            // Compose writes pull/create progress to stderr even on success.
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                emit_log(&app_err, "stderr", &line);
            }
        }
    });

    let status = child.wait().map_err(|e| format!("Docker Compose failed: {e}"))?;
    let _ = out_handle.join();
    let _ = err_handle.join();

    let ok = status.success();
    emit_log(
        &app,
        "status",
        if ok { "Compose finished — containers are starting." } else { "Compose exited with an error." },
    );
    Ok(DeployResult { ok, exit_code: status.code() })
}

fn emit_log(app: &tauri::AppHandle, stream: &str, line: &str) {
    let _ = app.emit(
        "deploy-log",
        DeployLogLine { stream: stream.to_string(), line: line.to_string() },
    );
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
            // Keep the main window hidden until the WebView paints, avoiding a
            // white flash on launch.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            preflight,
            write_env_file,
            deploy_stack,
            stack_health
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Elyzian Enterprise Installer");
}
