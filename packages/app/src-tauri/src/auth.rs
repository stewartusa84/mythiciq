// Desktop OAuth loopback capture (RFC 8252). A Tauri webview can't navigate out to the Cognito Hosted
// UI and back, and Google federation blocks embedded webviews — so desktop sign-in opens the SYSTEM
// browser to the Hosted UI and captures the redirect on a fixed loopback port with a one-shot local
// HTTP listener. The captured `?code=` is handed back to the JS auth client (app/src/mvp/auth.svelte.ts),
// which runs the normal PKCE token exchange. No HTTP-server dependency: we read the single request line
// and write a tiny 200 response, mirroring the dependency-free style of the `carve` crate.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

/// Must match the configured desktop Cognito app client's registered callback.
const LOOPBACK_PORT: u16 = 8765;
/// How long to wait for the user to finish signing in before giving up.
const CAPTURE_TIMEOUT_SECS: u64 = 180;

#[derive(serde::Serialize)]
pub struct OAuthResult {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

/// Parse the request target (path?query) out of an HTTP request line:
/// "GET /?code=x&state=y HTTP/1.1" -> "/?code=x&state=y".
pub fn parse_request_target(line: &str) -> Option<&str> {
    let mut parts = line.split(' ');
    let _method = parts.next()?;
    parts.next()
}

/// Read one query parameter out of a `&`-separated query string, percent-decoded.
fn query_param(query: &str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        if it.next() == Some(key) {
            return Some(url_decode(it.next().unwrap_or("")));
        }
    }
    None
}

/// Minimal application/x-www-form-urlencoded decode (%XX + '+'). Enough for an OAuth code/state/error.
fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => match (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                (Some(h), Some(l)) => {
                    out.push(h * 16 + l);
                    i += 3;
                }
                _ => {
                    out.push(b'%');
                    i += 1;
                }
            },
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Open the default browser to `url` without a third-party crate (single arg → no shell-quoting of `&`).
fn open_in_browser(url: &str) {
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn();
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
}

fn respond(stream: &mut TcpStream, ok: bool) {
    let body = if ok {
        "<!doctype html><meta charset=utf-8><body style=\"font-family:sans-serif;background:#0e1116;color:#e8e8ea;text-align:center;padding-top:80px\"><h2>MythicIQ</h2><p>You're signed in. You can close this tab and return to the app.</p></body>"
    } else {
        "<!doctype html><meta charset=utf-8><body style=\"font-family:sans-serif;background:#0e1116;color:#e8e8ea;text-align:center;padding-top:80px\"><h2>MythicIQ</h2><p>Sign-in failed or was cancelled. You can close this tab.</p></body>"
    };
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

/// Open the system browser to `authorize_url` and capture the OAuth redirect on the loopback port.
/// Returns the `code`/`state` (or an `error`) from the redirect query. Async so the blocking listener
/// runs off the UI thread.
#[tauri::command]
pub async fn oauth_capture(authorize_url: String) -> Result<OAuthResult, String> {
    tauri::async_runtime::spawn_blocking(move || capture(&authorize_url))
        .await
        .map_err(|e| format!("oauth task failed: {e}"))?
}

fn capture(authorize_url: &str) -> Result<OAuthResult, String> {
    let listener = TcpListener::bind(("127.0.0.1", LOOPBACK_PORT))
        .map_err(|e| format!("could not bind 127.0.0.1:{LOOPBACK_PORT}: {e}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| e.to_string())?;

    open_in_browser(authorize_url);

    let deadline = Instant::now() + Duration::from_secs(CAPTURE_TIMEOUT_SECS);
    loop {
        if Instant::now() >= deadline {
            return Err("sign-in timed out".into());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buf = [0u8; 8192];
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let n = stream.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                let line = req.lines().next().unwrap_or("");
                let query = parse_request_target(line)
                    .and_then(|t| t.split('?').nth(1))
                    .unwrap_or("");
                let code = query_param(query, "code");
                let state = query_param(query, "state");
                let error = query_param(query, "error");
                respond(&mut stream, code.is_some());
                // Ignore stray hits with no OAuth params (e.g. a favicon request); keep waiting.
                if code.is_some() || error.is_some() {
                    return Ok(OAuthResult { code, state, error });
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(e) => return Err(format!("accept failed: {e}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_request_target() {
        assert_eq!(
            parse_request_target("GET /?code=abc&state=xyz HTTP/1.1"),
            Some("/?code=abc&state=xyz")
        );
        assert_eq!(parse_request_target("garbage"), None);
        assert_eq!(parse_request_target(""), None);
    }

    #[test]
    fn extracts_and_decodes_query_params() {
        let q = "code=ab%2Dcd&state=h%20i&error=";
        assert_eq!(query_param(q, "code").as_deref(), Some("ab-cd"));
        assert_eq!(query_param(q, "state").as_deref(), Some("h i"));
        assert_eq!(query_param(q, "error").as_deref(), Some(""));
        assert_eq!(query_param(q, "missing"), None);
    }
}
