//! Artifacts: HTML and SVG that Claude made, shown next to the chat. The
//! window hands the content over (`artifact_stage`) and shows it in a frame
//! loaded from the `artifact:` scheme. Each page comes with its own strict
//! Content Security Policy: inline code and cdnjs only, no network requests,
//! no storage, no frames, no forms. The frame is sandboxed without the app's
//! origin, so it cannot reach Sienna's commands, the key or the chats.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::http::{header, Response, StatusCode};

const KINDS: [&str; 2] = ["html", "svg"];
/// The tool caps content at 300,000 characters; UTF-8 can need four bytes each.
const MAX_BYTES: usize = 1_200_000;
/// Pages kept for frames that reload; older ones are dropped.
const KEEP: usize = 16;
const CDN: &str = "https://cdnjs.cloudflare.com";

#[derive(Default)]
pub struct Artifacts {
    pages: Mutex<VecDeque<(String, Vec<u8>)>>,
    counter: AtomicU64,
}

fn csp() -> String {
    format!(
        "default-src 'none'; script-src 'unsafe-inline' {CDN}; style-src 'unsafe-inline' {CDN}; \
         img-src data: blob: {CDN}; font-src data: {CDN}; media-src data: blob:; connect-src 'none'; \
         frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"
    )
}

/// Tells the panel how large the page's content is, for "fit" and "fill":
/// the box around what is visible (text, images, controls, and boxes with a
/// background, border or shadow), cut where a parent clips its overflow and
/// leaving out wrappers that fill the whole view, plus the page's own margin.
/// Only numbers go out, by `postMessage` to the panel.
/// While the frame resizes (a dragged border), it measures once it settles.
const MEASURE: &str = r#"<script>(()=>{const send=()=>{const d=document,body=d.body;if(!body)return;const W=innerWidth,H=innerHeight,clips=new Map();const cut=(a,c)=>({left:Math.max(a.left,c.left),top:Math.max(a.top,c.top),right:Math.min(a.right,c.right),bottom:Math.min(a.bottom,c.bottom)});const clipOf=e=>{if(!e||e===body||e===d.documentElement)return{left:-1/0,top:-1/0,right:1/0,bottom:1/0};if(clips.has(e))return clips.get(e);let c=clipOf(e.parentElement);const s=getComputedStyle(e);if(s.overflowX!=='visible'||s.overflowY!=='visible')c=cut(c,e.getBoundingClientRect());clips.set(e,c);return c};let l=1/0,t=1/0,r=-1/0,b=-1/0;const add=(x,e)=>{const c=cut(x,clipOf(e));const w=c.right-c.left,h=c.bottom-c.top;if(w<1||h<1||(w>=W-1&&h>=H-1))return;l=Math.min(l,c.left+scrollX);t=Math.min(t,c.top+scrollY);r=Math.max(r,c.right+scrollX);b=Math.max(b,c.bottom+scrollY)};const walk=d.createTreeWalker(body,4);const range=d.createRange();for(let n=walk.nextNode(),i=0;n&&i<4000;n=walk.nextNode(),i++){if(n.nodeValue.trim()&&n.parentElement){range.selectNodeContents(n);add(range.getBoundingClientRect(),n.parentElement)}}const all=body.querySelectorAll('*');for(let i=0;i<all.length&&i<4000;i++){const e=all[i];const s=getComputedStyle(e);if(s.visibility==='hidden'||s.opacity==='0')continue;if(/^(IMG|SVG|CANVAS|VIDEO|INPUT|BUTTON|SELECT|TEXTAREA|PROGRESS|METER)$/i.test(e.tagName)){add(e.getBoundingClientRect(),e.parentElement);continue}const bg=s.backgroundColor,shown=(bg&&bg!=='transparent'&&!/rgba\([^)]*,\s*0\)$/.test(bg))||s.backgroundImage!=='none'||parseFloat(s.borderTopWidth)>0||parseFloat(s.borderLeftWidth)>0||s.boxShadow!=='none';if(shown)add(e.getBoundingClientRect(),e.parentElement)}if(!(r>l&&b>t)){l=0;t=0;r=d.documentElement.scrollWidth;b=d.documentElement.scrollHeight}const bs=getComputedStyle(body),hs=getComputedStyle(d.documentElement),px=v=>parseFloat(v)||0;parent.postMessage({sienna:'size',l:l,t:t,w:r-l,h:b-t,vw:innerWidth,vh:innerHeight,pl:px(bs.paddingLeft)+px(bs.marginLeft)+px(hs.paddingLeft),pt:px(bs.paddingTop)+px(bs.marginTop)+px(hs.paddingTop)},'*')};let q=0;const later=()=>{clearTimeout(q);q=setTimeout(send,120)};addEventListener('load',send);addEventListener('resize',later);try{new ResizeObserver(later).observe(document.documentElement)}catch(e){}})()</script>"#;

/// The page for the frame: an SVG on its own page, centered on white like
/// an image; both with the measuring script at the end.
fn page(kind: &str, content: &str) -> String {
    if kind == "svg" {
        format!(
            "<!doctype html><html><head><meta charset=\"utf-8\"><style>html,body{{margin:0;height:100%}}\
             body{{display:grid;place-items:center;background:#fff}}svg{{max-width:100%;max-height:100vh}}</style>\
             </head><body>{content}{MEASURE}</body></html>"
        )
    } else {
        format!("{content}{MEASURE}")
    }
}

impl Artifacts {
    /// Keeps a page for the frame and returns the token in its address.
    pub fn stage(&self, kind: &str, content: &str) -> Result<String, String> {
        if !KINDS.contains(&kind) || content.len() > MAX_BYTES {
            return Err("error.invalidRequest".into());
        }
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|time| time.as_nanos())
            .unwrap_or(0);
        let token = format!(
            "{:x}{:x}",
            nanos,
            self.counter.fetch_add(1, Ordering::Relaxed)
        );
        let mut pages = self.pages.lock().map_err(|_| "error.invalidRequest")?;
        if pages.len() >= KEEP {
            pages.pop_front();
        }
        pages.push_back((token.clone(), page(kind, content).into_bytes()));
        Ok(token)
    }

    /// Serves `artifact://localhost/<token>`.
    pub fn serve(&self, path: &str) -> Response<Vec<u8>> {
        let token = path.trim_start_matches('/');
        let body = self.pages.lock().ok().and_then(|pages| {
            pages
                .iter()
                .find(|(key, _)| key == token)
                .map(|(_, body)| body.clone())
        });
        let builder = Response::builder()
            .header(header::CONTENT_SECURITY_POLICY, csp())
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
            .header(header::REFERRER_POLICY, "no-referrer")
            .header("Cross-Origin-Resource-Policy", "same-origin");
        match body {
            Some(body) => builder
                .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                .body(body),
            None => builder.status(StatusCode::NOT_FOUND).body(Vec::new()),
        }
        .unwrap_or_else(|_| Response::new(Vec::new()))
    }
}

/// The file name an artifact is saved under: its id and the kind's extension.
pub fn file_name(id: &str, kind: &str, language: &str) -> String {
    let id: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(64)
        .collect();
    let ext = match kind {
        "html" => "html",
        "svg" => "svg",
        "markdown" => "md",
        _ => match language.to_ascii_lowercase().as_str() {
            "python" | "py" => "py",
            "javascript" | "js" => "js",
            "typescript" | "ts" => "ts",
            "tsx" => "tsx",
            "rust" | "rs" => "rs",
            "swift" => "swift",
            "go" => "go",
            "json" => "json",
            "css" => "css",
            "shell" | "bash" | "sh" | "zsh" => "sh",
            "sql" => "sql",
            "java" => "java",
            "kotlin" => "kt",
            "c" => "c",
            "cpp" | "c++" => "cpp",
            "ruby" => "rb",
            "yaml" | "yml" => "yaml",
            _ => "txt",
        },
    };
    format!("{}.{ext}", if id.is_empty() { "artifact" } else { &id })
}

#[cfg(test)]
mod tests {
    use super::{file_name, Artifacts};

    #[test]
    fn serves_staged_pages_with_a_strict_policy() {
        let artifacts = Artifacts::default();
        assert!(artifacts.stage("js", "x").is_err());
        let token = artifacts.stage("html", "<p>hi</p>").unwrap();
        let response = artifacts.serve(&format!("/{token}"));
        assert!(response.body().starts_with(b"<p>hi</p><script>"));
        let policy = response.headers()["content-security-policy"]
            .to_str()
            .unwrap();
        assert!(policy.contains("connect-src 'none'") && policy.contains("default-src 'none'"));
        assert_eq!(artifacts.serve("/unknown").status(), 404);
        assert_eq!(file_name("../budget", "code", "Python"), "budget.py");
    }
}
