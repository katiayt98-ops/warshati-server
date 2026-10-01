const http = require("http");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const SYSTEM = [
  "You are an expert web developer. The user describes an app or website, possibly in Arabic.",
  "Return ONE complete, self-contained HTML file (inline CSS and JS, no external files, no build step).",
  "Make it responsive, modern, and mobile-first. Use RTL and Arabic UI text if the user wrote in Arabic.",
  "Store data in memory only (never localStorage). Do not call external APIs.",
  "If the user supplies previous HTML, modify it according to the new request and return the full updated file.",
  "Output ONLY the HTML code, with no explanation and no markdown fences."
].join("\n");

const PAGE = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
'<meta name="viewport" content="width=device-width,initial-scale=1"><title>ورشتي</title>' +
'<style>body{margin:0;font-family:system-ui,sans-serif;background:#111;color:#eee}' +
'.w{max-width:900px;margin:auto;padding:16px}textarea{width:100%;box-sizing:border-box;min-height:100px;' +
'border-radius:12px;border:1px solid #333;background:#1c1c1c;color:#eee;padding:12px;font-size:16px}' +
'button{margin:8px 4px 0 0;padding:12px 20px;border:0;border-radius:12px;background:#3b82f6;color:#fff;font-size:16px}' +
'button:disabled{opacity:.5}iframe{width:100%;height:70vh;border:1px solid #333;border-radius:12px;background:#fff;margin-top:12px}' +
'#st{margin-top:8px;color:#9ca3af}</style></head><body><div class="w"><h2>ورشتي</h2>' +
'<textarea id="p" placeholder="وصف التطبيق اللي بدك إياه..."></textarea>' +
'<button id="b" onclick="go()">ولّد</button><button onclick="cp()">نسخ الكود</button>' +
'<div id="st"></div><iframe id="f" sandbox="allow-scripts"></iframe></div>' +
'<script>var cur="";var st=document.getElementById("st");var b=document.getElementById("b");' +
'async function go(){var p=document.getElementById("p").value.trim();if(!p)return;b.disabled=true;st.textContent="جاري التوليد...";' +
'try{var r=await fetch("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:p,previousHtml:cur})});' +
'var d=await r.json();if(!r.ok)throw new Error(d.error||"خطأ");cur=d.html;document.getElementById("f").srcdoc=cur;st.textContent="تم. اكتب تعديل وولّد من جديد لتحسينه."}' +
'catch(e){st.textContent="خطأ: "+e.message}b.disabled=false}' +
'function cp(){if(cur&&navigator.clipboard){navigator.clipboard.writeText(cur);st.textContent="انسخ الكود"}}</script></body></html>';

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 6;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 300000) { reject(new Error("too large")); req.destroy(); }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

async function generate(prompt, previousHtml) {
  let text = prompt;
  if (previousHtml) text = "Current HTML:\n" + previousHtml + "\n\nRequested change:\n" + prompt;
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent";
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text }] }]
    })
  });
  const d = await r.json();
  if (!r.ok) throw new Error((d.error && d.error.message) || "Gemini error");
  const parts = (d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || [];
  let out = parts.map((p) => p.text || "").join("");
  out = out.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "").trim();
  if (!out) throw new Error("Empty response");
  return out;
}

http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
      if (req.url === "/health") return send(res, 200, { ok: true });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(PAGE);
    }
    if (req.method === "POST" && req.url === "/api/generate") {
      if (!API_KEY) return send(res, 500, { error: "GEMINI_API_KEY is not set" });
      if (limited(req.socket.remoteAddress || "x")) return send(res, 429, { error: "كثرة طلبات، جرّب بعد دقيقة" });
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.prompt) return send(res, 400, { error: "prompt required" });
      const html = await generate(String(body.prompt).slice(0, 4000), String(body.previousHtml || "").slice(0, 150000));
      return send(res, 200, { html });
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}).listen(PORT, () => console.log("Warshati server on " + PORT));
