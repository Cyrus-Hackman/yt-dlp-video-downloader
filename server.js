const express = require("express");
const { spawn, exec } = require("child_process");
const path = require("path");
const cors = require("cors");
const https = require("https");
const fs = require("fs");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Native Windows Save As dialog via PowerShell STA mode
app.get("/api/select-folder", (req, res) => {
  const ps1Path = path.join(__dirname, "pick-folder.ps1");
  const fileName = (req.query.fileName || "download").replace(/[\\/:*?"<>|]/g, "_");
  const fileType = req.query.fileType === "mp3" ? "mp3" : "mp4";
  const filter = fileType === "mp3"
    ? "Audio Files (*.mp3)|*.mp3"
    : "Video Files (*.mp4)|*.mp4";

  const cmd = `powershell -Sta -NoProfile -ExecutionPolicy Bypass -File "${ps1Path}" -FileName "${fileName}.${fileType}" -Filter "${filter}"`;

  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error("Save dialog error:", stderr);
      return res.status(500).json({ error: "Failed to open save dialog" });
    }
    const selectedPath = stdout.trim();
    res.json({ path: selectedPath || null });
  });
});

// Folder-only picker for playlists (FolderBrowserDialog via separate ps1)
app.get("/api/select-folder-only", (req, res) => {
  const ps1Path = path.join(__dirname, "pick-folder-only.ps1");
  const cmd = `powershell -Sta -NoProfile -ExecutionPolicy Bypass -File "${ps1Path}"`;
  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error("Folder picker error:", stderr);
      return res.status(500).json({ error: "Failed to open folder picker" });
    }
    const selectedPath = stdout.trim();
    res.json({ path: selectedPath || null });
  });
});

// Fetch single video OR detect playlist
app.post("/api/info", (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });

  const ytDlpPath = path.join(__dirname, "yt-dlp.exe");
  const proc = spawn(ytDlpPath, ["--js-runtimes", "node", "-J", url]);

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

// Fetch only video duration (fast, no full format parsing)
app.post("/api/video-duration", (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });

  const ytDlpPath = path.join(__dirname, "yt-dlp.exe");
  // --print duration outputs just the seconds as a float
  const proc = spawn(ytDlpPath, ["--js-runtimes", "node", "--print", "%(duration)s", "--no-download", url]);

  let output = "";
  let errorOutput = "";

  proc.stdout.on("data", (data) => { output += data.toString(); });
  proc.stderr.on("data", (data) => { errorOutput += data.toString(); });

  proc.on("close", (code) => {
    if (code !== 0) {
      return res.status(500).json({ error: "Failed to fetch duration", details: errorOutput });
    }
    const seconds = parseFloat(output.trim());
    if (isNaN(seconds)) {
      return res.status(500).json({ error: "Could not parse duration" });
    }
    res.json({ duration: seconds });
  });
});

// Fetch playlist entries (flat, no full download)
app.post("/api/playlist-info", (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });

  const ytDlpPath = path.join(__dirname, "yt-dlp.exe");
  const proc = spawn(ytDlpPath, [
    "--js-runtimes", "node",
    "--flat-playlist",
    "-J",
    url,
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
      // It's a playlist if it has entries
      if (parsed.entries) {
        const entries = parsed.entries.map((e) => ({
          id: e.id,
          title: e.title || e.id,
          url: e.webpage_url || e.url || `https://www.youtube.com/watch?v=${e.id}`,
          thumbnail: e.thumbnail || null,
        }));
        return res.json({ isPlaylist: true, title: parsed.title, entries });
      }
      // It's a single video — return minimal info
      return res.json({ isPlaylist: false, title: parsed.title });
    } catch (e) {
      res.status(500).json({ error: "Failed to parse response" });
    }
  });
});

// Helper: convert seconds (number) to HH:MM:SS string
function secondsToTimecode(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Download endpoint with Server-Sent Events (SSE)
app.get("/api/download", (req, res) => {
  const { url, type, quality, savePath, startTime, endTime } = req.query;

  if (!url || !type) {
    return res.status(400).json({ error: "URL and type are required" });
  }

  // savePath is the full file path from the SaveFileDialog
  const outputTemplate = savePath || "%(title)s [%(id)s].%(ext)s";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const ytDlpPath = path.join(__dirname, "yt-dlp.exe");

  // Build cutting args if a range is specified
  const cuttingArgs = [];
  const hasStart = startTime !== undefined && startTime !== null && startTime !== '';
  const hasEnd   = endTime   !== undefined && endTime   !== null && endTime !== '';
  if (hasStart || hasEnd) {
    const startSec = hasStart ? parseFloat(startTime) : 0;
    const endSec   = hasEnd   ? parseFloat(endTime)   : null;
    const startTC  = secondsToTimecode(startSec);
    const section  = endSec !== null
      ? `*${startTC}-${secondsToTimecode(endSec)}`
      : `*${startTC}-inf`;
    cuttingArgs.push("--download-sections", section, "--force-keyframes-at-cuts");
  }

  let args = [];

  if (type === "mp3") {
    const audioQual = quality && quality !== "best" ? `${quality}K` : "0";
    args = [
      "--js-runtimes", "node",
      "-x", "--audio-format", "mp3",
      "--audio-quality", audioQual,
      "--ffmpeg-location", __dirname,
      ...cuttingArgs,
      "-o", outputTemplate,
      url,
    ];
  } else if (type === "mp4") {
    const formatArg =
      quality && quality !== "best"
        ? `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best`
        : "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best";
    args = [
      "--js-runtimes", "node",
      "-f", formatArg,
      "--merge-output-format", "mp4",
      "--ffmpeg-location", __dirname,
      ...cuttingArgs,
      "-o", outputTemplate,
      url,
    ];
  }

  const downloadProcess = spawn(ytDlpPath, args);

  downloadProcess.stdout.on("data", (data) => {
    const text = data.toString();
    const percentMatch = text.match(/\[download\]\s+(\d+\.?\d*)%/);
    let progress = 0;
    if (percentMatch && percentMatch[1]) {
      progress = parseFloat(percentMatch[1]);
    }
    res.write(`data: ${JSON.stringify({ log: text.trim(), progress })}\n\n`);
  });

  downloadProcess.stderr.on("data", (data) => {
    const text = data.toString();
    res.write(`data: ${JSON.stringify({ log: text.trim() })}\n\n`);
  });

  downloadProcess.on("close", (code) => {
    if (code === 0) {
      res.write(`data: ${JSON.stringify({ done: true, log: "Download completed successfully!" })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ error: true, log: `Process exited with code ${code}` })}\n\n`);
    }
    res.end();
  });

  req.on("close", () => { downloadProcess.kill(); });
});

// Auto-update yt-dlp via SSE
app.get("/api/update-ytdlp", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (msg, done = false, error = false) => {
    res.write(`data: ${JSON.stringify({ log: msg, done, error })}\n\n`);
  };

  send("Checking latest yt-dlp release from GitHub...");

  const ytDlpPath = path.join(__dirname, "yt-dlp.exe");
  const tmpPath = ytDlpPath + ".new";

  const options = {
    hostname: "github.com",
    path: "/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
    method: "GET",
    headers: { "User-Agent": "yt-downloader-pro" },
  };

  function doDownload(url, redirects = 0) {
    if (redirects > 5) {
      send("Too many redirects.", false, true);
      res.end();
      return;
    }
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers: { "User-Agent": "yt-downloader-pro" },
    };

    const request = https.get(reqOptions, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        doDownload(response.headers.location, redirects + 1);
        return;
      }
      if (response.statusCode !== 200) {
        send(`Download failed: HTTP ${response.statusCode}`, false, true);
        res.end();
        return;
      }

      const total = parseInt(response.headers["content-length"] || "0", 10);
      let received = 0;
      let lastPercent = -1;

      send("Downloading new yt-dlp.exe...");
      const file = fs.createWriteStream(tmpPath);

      response.on("data", (chunk) => {
        received += chunk.length;
        file.write(chunk);
        if (total > 0) {
          const pct = Math.floor((received / total) * 100);
          if (pct !== lastPercent) {
            lastPercent = pct;
            res.write(`data: ${JSON.stringify({ log: `Downloading... ${pct}%`, progress: pct })}\n\n`);
          }
        }
      });

      response.on("end", () => {
        file.end(() => {
          try {
            // Backup old and replace
            if (fs.existsSync(ytDlpPath)) fs.unlinkSync(ytDlpPath);
            fs.renameSync(tmpPath, ytDlpPath);
            send("yt-dlp updated successfully! 🎉", true);
          } catch (err) {
            send(`Failed to replace yt-dlp.exe: ${err.message}`, false, true);
          }
          res.end();
        });
      });

      response.on("error", (err) => {
        send(`Download error: ${err.message}`, false, true);
        res.end();
      });
    });

    request.on("error", (err) => {
      send(`Request error: ${err.message}`, false, true);
      res.end();
    });
  }

  doDownload("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe");
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
