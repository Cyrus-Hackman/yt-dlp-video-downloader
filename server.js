const express = require("express");
const { spawn, execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;

// B6: Bind to localhost only — not accessible from LAN
// B6: Remove cors() — UI is same-origin, doesn't need it
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Helpers ──────────────────────────────────────────────────

// Helper: convert seconds to HH:MM:SS
function secondsToTimecode(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// A7: Kill yt-dlp AND its child ffmpeg.exe on Windows
function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"]);
  } else {
    proc.kill("SIGKILL");
  }
}

// B6: Validate URLs start with http:// or https://
function isValidUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

// ── Save As dialog (single video) ──────────────────────────
app.get("/api/select-folder", (req, res) => {
  const ps1Path = path.join(__dirname, "pick-folder.ps1");
  // B4/B6: Build safe filename, strip illegal chars
  const fileName = (req.query.fileName || "download").replace(/[\\/:*?"<>|%]/g, "_");
  const fileType = req.query.fileType === "mp3" ? "mp3" : "mp4";
  const filter = fileType === "mp3"
    ? "Audio Files (*.mp3)|*.mp3"
    : "Video Files (*.mp4)|*.mp4";

  // B5: Use execFile instead of exec (no shell), pass args as array
  execFile(
    "powershell",
    ["-Sta", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1Path,
      "-FileName", `${fileName}.${fileType}`, "-Filter", filter],
    { encoding: "utf8" },
    (error, stdout, stderr) => {
      if (error) {
        console.error("Save dialog error:", stderr);
        return res.status(500).json({ error: "Failed to open save dialog" });
      }
      const selectedPath = stdout.trim();
      res.json({ path: selectedPath || null });
    }
  );
});

// ── Folder-only picker (playlists) ─────────────────────────
app.get("/api/select-folder-only", (req, res) => {
  const ps1Path = path.join(__dirname, "pick-folder-only.ps1");
  // B5: Use execFile, not exec
  execFile(
    "powershell",
    ["-Sta", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1Path],
    { encoding: "utf8" },
    (error, stdout, stderr) => {
      if (error) {
        console.error("Folder picker error:", stderr);
        return res.status(500).json({ error: "Failed to open folder picker" });
      }
      const selectedPath = stdout.trim();
      res.json({ path: selectedPath || null });
    }
  );
});

// ── Fetch single video info ─────────────────────────────────
app.post("/api/info", (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });
  // B6: Validate URL
  if (!isValidUrl(url)) return res.status(400).json({ error: "Invalid URL" });

  const ytDlpPath = path.join(__dirname, "yt-dlp.exe");
  // B6: Use '--' before URL, B8: add --no-playlist for single video fetch
  const proc = spawn(ytDlpPath, ["--js-runtimes", "node", "--no-playlist", "-J", "--", url]);

  let output = "";
  let errorOutput = "";

  proc.stdout.on("data", (data) => { output += data.toString(); });
  proc.stderr.on("data", (data) => { errorOutput += data.toString(); });

  proc.on("close", (code) => {
    if (code !== 0) {
      console.error(`yt-dlp error: ${errorOutput}`);
      return res.status(500).json({ error: "Failed to fetch video info", details: errorOutput });
    }
    try {
      const parsed = JSON.parse(output);
      const formats = parsed.formats || [];

      const audioFormats = formats.filter((f) => f.vcodec === "none" && f.acodec !== "none");
      const videoFormats = formats.filter((f) => f.vcodec !== "none" && f.ext !== "mhtml");

      const resolutionsSet = new Set();
      const uniqueVideoFormats = [];
      videoFormats.forEach((f) => {
        let height = f.height;
        if (!height && typeof f.resolution === "string") {
          const parts = f.resolution.split("x");
          if (parts.length === 2) height = parseInt(parts[1], 10);
        }
        if (height && !resolutionsSet.has(height)) {
          resolutionsSet.add(height);
          uniqueVideoFormats.push({ height, format_id: f.format_id, ext: f.ext });
        }
      });
      uniqueVideoFormats.sort((a, b) => b.height - a.height);

      res.json({
        title: parsed.title,
        thumbnail: parsed.thumbnail,
        duration: parsed.duration || 0,
        audioFormats: audioFormats.map((f) => ({ id: f.format_id, ext: f.ext, abr: f.abr })),
        videoQualities: uniqueVideoFormats,
        audioQualities: [320, 256, 192, 128, 96, 64],
      });
    } catch (e) {
      console.error("Error parsing JSON:", e);
      res.status(500).json({ error: "Failed to parse video info" });
    }
  });
});

// ── Fetch playlist entries ──────────────────────────────────
app.post("/api/playlist-info", (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });
  // B6: Validate URL
  if (!isValidUrl(url)) return res.status(400).json({ error: "Invalid URL" });

  const ytDlpPath = path.join(__dirname, "yt-dlp.exe");
  // B6: Use '--' before URL
  const proc = spawn(ytDlpPath, [
    "--js-runtimes", "node",
    "--flat-playlist",
    "-J",
    "--", url,
  ]);

  let output = "";
  let errorOutput = "";

  proc.stdout.on("data", (d) => { output += d.toString(); });
  proc.stderr.on("data", (d) => { errorOutput += d.toString(); });

  proc.on("close", (code) => {
    if (code !== 0) {
      return res.status(500).json({ error: "Failed to fetch playlist", details: errorOutput });
    }
    try {
      const parsed = JSON.parse(output);
      if (parsed.entries) {
        const entries = parsed.entries.map((e) => ({
          id: e.id,
          title: e.title || e.id,
          url: e.webpage_url || e.url || `https://www.youtube.com/watch?v=${e.id}`,
          thumbnail: e.thumbnail || null,
        }));
        return res.json({ isPlaylist: true, title: parsed.title, entries });
      }
      return res.json({ isPlaylist: false, title: parsed.title });
    } catch (e) {
      res.status(500).json({ error: "Failed to parse response" });
    }
  });
});

// ── Download endpoint (SSE) ─────────────────────────────────
app.get("/api/download", (req, res) => {
  const { url, type, quality, savePath, saveDir, startTime, endTime } = req.query;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendSSE = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  // B6: Validate inputs — send SSE errors (EventSource can't read 400 body)
  if (!url || !type) {
    sendSSE({ error: true, log: "Missing url or type parameter" });
    return res.end();
  }
  if (!isValidUrl(url)) {
    sendSSE({ error: true, log: "Invalid URL — must start with http:// or https://" });
    return res.end();
  }
  if (type !== "mp3" && type !== "mp4") {
    sendSSE({ error: true, log: `Unknown type: ${type}` });
    return res.end();
  }
  if (quality && quality !== "best" && !/^\d+$/.test(quality)) {
    sendSSE({ error: true, log: `Invalid quality value: ${quality}` });
    return res.end();
  }

  // A5: Validate trim times
  let cuttingArgs = [];
  const hasStart = startTime !== undefined && startTime !== null && startTime !== "";
  const hasEnd   = endTime   !== undefined && endTime   !== null && endTime   !== "";
  if (hasStart || hasEnd) {
    const startSec = hasStart ? Number(startTime) : 0;
    const endSec   = hasEnd   ? Number(endTime)   : null;
    if (!Number.isFinite(startSec) || startSec < 0) {
      sendSSE({ error: true, log: "Invalid trim start time" });
      return res.end();
    }
    if (endSec !== null && (!Number.isFinite(endSec) || endSec <= startSec)) {
      sendSSE({ error: true, log: "Trim end time must be greater than start time" });
      return res.end();
    }
    const startTC = secondsToTimecode(startSec);
    const section = endSec !== null
      ? `*${startTC}-${secondsToTimecode(endSec)}`
      : `*${startTC}-inf`;
    cuttingArgs = ["--download-sections", section, "--force-keyframes-at-cuts"];
  }

  const ytDlpPath = path.join(__dirname, "yt-dlp.exe");

  // B4: Escape % in paths to prevent yt-dlp template expansion
  // Build output template
  let outputTemplate;
  if (savePath) {
    // Single video: strip extension, escape %, add .%(ext)s
    const escapedPath = savePath.replace(/%/g, "%%").replace(/\.(mp4|mp3)$/i, "");
    outputTemplate = `${escapedPath}.%(ext)s`;
  } else if (saveDir) {
    // Playlist: escape % in directory, let yt-dlp build filename
    const escapedDir = saveDir.replace(/%/g, "%%");
    outputTemplate = `${escapedDir}\\%(title)s [%(id)s].%(ext)s`;
  } else {
    outputTemplate = "%(title)s [%(id)s].%(ext)s";
  }

  let args = [];

  if (type === "mp3") {
    // B1: Use actual quality value for MP3, not hardcoded 'best'
    const audioQual = quality && quality !== "best" ? `${quality}K` : "0";
    args = [
      "--js-runtimes", "node",
      "-x", "--audio-format", "mp3",
      "--audio-quality", audioQual,
      // B9: Embed thumbnail and metadata for MP3s
      "--embed-thumbnail", "--convert-thumbnails", "jpg", "--embed-metadata",
      "--ffmpeg-location", __dirname,
      "--newline",  // A6: Force one line per progress update
      ...cuttingArgs,
      // A3: Force overwrite for single (non-playlist) downloads
      ...(savePath ? ["--force-overwrites"] : []),
      "-o", outputTemplate,
      "--", url,  // B6: '--' before URL
    ];
  } else {
    // B3: Improved format string for correct resolution matching
    const formatArg = quality && quality !== "best"
      ? `bv*[height=${quality}][vcodec^=avc1]+ba[ext=m4a]/bv*[height=${quality}]+ba/bv*[height<=${quality}]+ba/b[height<=${quality}]/b`
      : "bv*+ba/b";
    args = [
      "--js-runtimes", "node",
      "-f", formatArg,
      "--merge-output-format", "mp4",
      "--ffmpeg-location", __dirname,
      "--newline",  // A6: Force one line per progress update
      ...cuttingArgs,
      // A3: Force overwrite for single (non-playlist) downloads
      ...(savePath ? ["--force-overwrites"] : []),
      "-o", outputTemplate,
      "--", url,  // B6: '--' before URL
    ];
  }

  const downloadProcess = spawn(ytDlpPath, args);
  let lastProgress = null;

  // A6: Parse progress from stdout (split on all newline types)
  downloadProcess.stdout.on("data", (data) => {
    const text = data.toString();
    const lines = text.split(/\r\n|\r|\n/);
    let foundProgress = null;
    for (const line of lines) {
      const m = line.match(/\[download\]\s+(\d+\.?\d*)%/);
      if (m) foundProgress = parseFloat(m[1]);
    }
    const payload = { log: text.trim() };
    if (foundProgress !== null) {
      lastProgress = foundProgress;
      payload.progress = foundProgress;
    }
    if (text.trim()) sendSSE(payload);
  });

  // A6: Also parse ffmpeg time= from stderr for trimmed downloads
  downloadProcess.stderr.on("data", (data) => {
    const text = data.toString();
    const lines = text.split(/\r\n|\r|\n/);
    let foundProgress = null;

    // Try yt-dlp style first
    for (const line of lines) {
      const m = line.match(/\[download\]\s+(\d+\.?\d*)%/);
      if (m) foundProgress = parseFloat(m[1]);
    }

    // If trim active, parse ffmpeg time= progress
    if (foundProgress === null && (hasStart || hasEnd)) {
      for (const line of lines) {
        const m = line.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
        if (m) {
          const elapsed = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
          const startSec = hasStart ? Number(startTime) : 0;
          const endSec   = hasEnd   ? Number(endTime)   : null;
          if (endSec !== null && endSec > startSec) {
            const pct = Math.min(99, (elapsed / (endSec - startSec)) * 100);
            foundProgress = Math.round(pct);
          }
        }
      }
    }

    const payload = { log: text.trim() };
    if (foundProgress !== null) {
      lastProgress = foundProgress;
      payload.progress = foundProgress;
    }
    if (text.trim()) sendSSE(payload);
  });

  downloadProcess.on("close", (code) => {
    if (code === 0) {
      sendSSE({ done: true, progress: 100, log: "Download completed successfully!" });
    } else {
      sendSSE({ error: true, log: `Process exited with code ${code}` });
    }
    res.end();
  });

  // A7: Kill entire process tree on client disconnect (use res 'close', not req 'close')
  res.on("close", () => killTree(downloadProcess));
});

// ── yt-dlp self-update via SSE ──────────────────────────────
// B10: Replace custom HTTP downloader with yt-dlp -U (much simpler, safer)
app.get("/api/update-ytdlp", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendSSE = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  const ytDlpPath = path.join(__dirname, "yt-dlp.exe");

  sendSSE({ log: "Running yt-dlp -U to check for updates..." });

  const proc = spawn(ytDlpPath, ["-U"]);

  proc.stdout.on("data", (data) => {
    const text = data.toString().trim();
    if (text) sendSSE({ log: text });
  });
  proc.stderr.on("data", (data) => {
    const text = data.toString().trim();
    if (text) sendSSE({ log: text });
  });

  proc.on("close", (code) => {
    if (code === 0) {
      sendSSE({ done: true, log: "yt-dlp is up to date! 🎉" });
    } else {
      sendSSE({ error: true, log: `Update process exited with code ${code}` });
    }
    res.end();
  });

  res.on("close", () => killTree(proc));
});

// B6: Bind to localhost only
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
