const express = require("express");
const { execFile, spawn } = require("child_process");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Only allow public Instagram post/reel/tv links
const IG_RE = /^https:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv)\/[A-Za-z0-9_-]+\/?(\?.*)?$/;

// Simple in-memory rate limit: 15 requests / minute / IP
const hits = new Map();
function limiter(req, res, next) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.ip;
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (list.length >= 15) return res.status(429).json({ error: "Too many requests. Try again in a minute." });
  list.push(now);
  hits.set(ip, list);
  next();
}

// Get video info (title + thumbnail) for preview
app.post("/api/info", limiter, (req, res) => {
  const url = String(req.body?.url || "").trim();
  if (!IG_RE.test(url)) return res.status(400).json({ error: "Please paste a valid public Instagram post or reel link." });

  execFile("yt-dlp", ["-J", "--no-playlist", url], { timeout: 30000, maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
    if (err) return res.status(422).json({ error: "Couldn't fetch this video. It may be private, removed, or Instagram blocked the request." });
    try {
      const d = JSON.parse(stdout);
      res.json({ title: d.title || "Instagram video", thumbnail: d.thumbnail || null, uploader: d.uploader || null, duration: d.duration || null });
    } catch {
      res.status(500).json({ error: "Unexpected response from downloader." });
    }
  });
});

// Stream the video file to the user
app.get("/api/download", limiter, (req, res) => {
  const url = String(req.query.url || "").trim();
  if (!IG_RE.test(url)) return res.status(400).send("Invalid link.");

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", 'attachment; filename="instagram-video.mp4"');

  const p = spawn("yt-dlp", ["-f", "b[ext=mp4]/b", "--no-playlist", "-o", "-", url]);
  p.stdout.pipe(res);
  p.on("error", () => res.end());
  p.on("close", code => { if (code !== 0 && !res.headersSent) res.status(500).end(); });
  req.on("close", () => p.kill("SIGKILL"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running on port " + PORT));
