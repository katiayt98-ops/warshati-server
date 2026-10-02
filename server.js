const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const PAGE = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

const SYSTEM = [
  "You are a senior product engineer and designer. The user describes an app in any language.",
  "Return ONE complete, self-contained HTML file: inline CSS and JS, no external files, no CDN, no build step.",
  "Design quality matters: clear hierarchy, generous spacing, a restrained palette, system fonts, visible focus states, mobile-first and responsive.",
  "Make every control actually work. Keep state in memory only (never localStorage). Do not call external APIs.",
  "Write interface text in the same language as the user's request. Use dir=rtl for Arabic or Hebrew.",
  "If previous HTML is supplied, apply the requested change to it and return the full updated file.",
  "Output ONLY the HTML, with no explanation and no markdown fences."
].join("\n");

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
      if (data.length > 300000) { reject(new Error("Request too large")); req.destroy(); }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGemini(body) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
      body: JSON.stringify(body)
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) return d;
    if ((r.status === 429 || r.status === 503) && attempt === 0) { await sleep(2000); continue; }
    if (r.status === 429) throw new Error("The free AI quota is busy right now. Wait a minute and try again.");
    throw new Error((d.error && d.error.message) || "The AI service returned an error.");
  }
}

async function generate(prompt, previousHtml) {
  let text = prompt;
  if (previousHtml) text = "Current HTML:\n" + previousHtml + "\n\nRequested change:\n" + prompt;
  const d = await callGemini({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text }] }]
  });
  const parts = (d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || [];
  let out = parts.map((p) => p.text || "").join("");
  out = out.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "").trim();
  if (!out) throw new Error("The AI returned an empty answer. Try rephrasing your request.");
  return out;
}

http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true, keyConfigured: !!API_KEY });
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(PAGE);
    }
    if (req.method === "POST" && req.url === "/api/generate") {
      if (!API_KEY) return send(res, 500, { error: "The server has no GEMINI_API_KEY yet. Add it in Render under Environment, then redeploy." });
      if (limited(req.socket.remoteAddress || "x")) return send(res, 429, { error: "Too many requests. Try again in a minute." });
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.prompt) return send(res, 400, { error: "Please describe the app first." });
      const html = await generate(String(body.prompt).slice(0, 4000), String(body.previousHtml || "").slice(0, 150000));
      return send(res, 200, { html });
    }
    send(res, 404, { error: "Not found" });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}).listen(PORT, () => console.log("Forge server on " + PORT));
