const express = require("express");
const { spawn, execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
// Fix 4: Changed to uncommon port to avoid clashing with React/Next dev servers on 3000
const PORT = 3789;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Global state ──────────────────────────────────────────────
// Fix 3: Track active downloads and update state for mutual lockout
let activeDownloads = 0;
let isUpdating = false;

// ── Helpers ───────────────────────────────────────────────────

function secondsToTimecode(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Fix 3 / A7: Kill yt-dlp AND its child ffmpeg.exe on Windows
function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === "win32") {
    const tk = spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"]);
    // Fix 3: Silence errors on the taskkill spawn itself
    tk.on("error", () => {});
  } else {
    proc.kill("SIGKILL");
  }
}

// B6: Validate URLs start with http:// or https://
function isValidUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

// ── Save As dialog (single video) ────────────────────────────
app.get("/api/select-folder", (req, res) => {
  const ps1Path = path.join(__dirname, "pick-folder.ps1");
  const fileName = (req.query.fileName || "download").replace(/[\\/:*?"<>|%]/g, "_");
  const fileType = req.query.fileType === "mp3" ? "mp3" : "mp4";
  const filter = fileType === "mp3"
    ? "Audio Files (*.mp3)|*.mp3"
    : "Video Files (*.mp4)|*.mp4";

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
      res.json({ path: stdout.trim() || null });
    }
  );
});

// ── Folder-only picker (playlists) ───────────────────────────
app.get("/api/select-folder-only", (req, res) => {
  const ps1Path = path.join(__dirname, "pick-folder-only.ps1");
  execFile(
    "powershell",
    ["-Sta", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1Path],
    { encoding: "utf8" },
    (error, stdout, stderr) => {
      if (error) {
        console.error("Folder picker error:", stderr);
        return res.status(500).json({ error: "Failed to open folder picker" });
      }
      res.json({ path: stdout.trim() || null });
    }
  );
});

// ── Fetch single video info ───────────────────────────────────
app.post("/api/info", (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });
  if (!isValidUrl(url)) return res.status(400).json({ error: "Invalid URL" });

  const ytDlpPath = path.join(__dirname, "yt-dlp.exe");
  const proc = spawn(ytDlpPath, ["--js-runtimes", "node", "--no-playlist", "-J", "--", url]);

  let output = "";
  let errorOutput = "";
  let responded = false;

  // Fix 3: Handle spawn errors (missing yt-dlp.exe, antivirus block, etc.)
  proc.on("error", (err) => {
    if (responded) return;
    responded = true;
    console.error("spawn error (info):", err.message);
    res.status(500).json({ error: "Could not start yt-dlp: " + err.message });
  });

  proc.stdout.on("data", (data) => { output += data.toString(); });
  proc.stderr.on("data", (data) => { errorOutput += data.toString(); });

  proc.on("close", (code) => {
    if (responded) return;
    responded = true;
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

// ── Fetch playlist entries ────────────────────────────────────
app.post("/api/playlist-info", (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });
  if (!isValidUrl(url)) return res.status(400).json({ error: "Invalid URL" });

  const ytDlpPath = path.join(__dirname, "yt-dlp.exe");
  const proc = spawn(ytDlpPath, [
    "--js-runtimes", "node",
    "--flat-playlist",
    "-J",
    "--", url,
  ]);

  let output = "";
  let errorOutput = "";
  let responded = false;

  // Fix 3: Handle spawn errors
  proc.on("error", (err) => {
    if (responded) return;
    responded = true;
    console.error("spawn error (playlist-info):", err.message);
    res.status(500).json({ error: "Could not start yt-dlp: " + err.message });
  });

  proc.stdout.on("data", (d) => { output += d.toString(); });
  proc.stderr.on("data", (d) => { errorOutput += d.toString(); });

  proc.on("close", (code) => {
    if (responded) return;
    responded = true;
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

// ── Download endpoint (SSE) ───────────────────────────────────
app.get("/api/download", (req, res) => {
  const { url, type, quality, savePath, saveDir, startTime, endTime, duration: clientDuration } = req.query;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendSSE = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  // Fix 3: Refuse while an update is running
  if (isUpdating) {
    sendSSE({ error: true, log: "Cannot download while yt-dlp is updating. Please wait." });
    return res.end();
  }

  // Validate inputs
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
  // Fix 5: Accept 'best-compatible' as a valid quality value
  if (quality && quality !== "best" && quality !== "best-compatible" && !/^\d+$/.test(quality)) {
    sendSSE({ error: true, log: `Invalid quality value: ${quality}` });
    return res.end();
  }

  // A5: Validate trim times
  let cuttingArgs = [];
  const hasStart = startTime !== undefined && startTime !== null && startTime !== "";
  const hasEnd   = endTime   !== undefined && endTime   !== null && endTime   !== "";
  let startSec = 0;
  let endSec = null;

  if (hasStart || hasEnd) {
    startSec = hasStart ? Number(startTime) : 0;
    endSec   = hasEnd   ? Number(endTime)   : null;
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
    cuttingArgs = [
      "--download-sections", section,
      "--force-keyframes-at-cuts",
      // Fix 6e: Force ffmpeg to emit progress stats on stderr
      "--downloader-args", "ffmpeg:-stats",
    ];
  }

  const ytDlpPath = path.join(__dirname, "yt-dlp.exe");

  // B4: Escape % in paths to prevent yt-dlp template expansion
  let outputTemplate;
  if (savePath) {
    const escapedPath = savePath.replace(/%/g, "%%").replace(/\.(mp4|mp3)$/i, "");
    outputTemplate = `${escapedPath}.%(ext)s`;
  } else if (saveDir) {
    const escapedDir = saveDir.replace(/%/g, "%%");
    outputTemplate = `${escapedDir}\\%(title)s [%(id)s].%(ext)s`;
  } else {
    outputTemplate = "%(title)s [%(id)s].%(ext)s";
  }

  let args = [];
  const isSingleVideo = !!savePath; // savePath only set for single-video mode

  if (type === "mp3") {
    const audioQual = quality && quality !== "best" ? `${quality}K` : "0";
    args = [
      "--js-runtimes", "node",
      "-x", "--audio-format", "mp3",
      "--audio-quality", audioQual,
      "--embed-thumbnail", "--convert-thumbnails", "jpg", "--embed-metadata",
      "--ffmpeg-location", __dirname,
      "--newline",
      ...cuttingArgs,
      ...(isSingleVideo ? ["--force-overwrites", "--no-playlist"] : []), // Fix 2
      "-o", outputTemplate,
      "--", url,
    ];
  } else {
    // Fix 5: Handle 'best-compatible' quality option
    let formatArg;
    if (quality === "best-compatible") {
      formatArg = "bv*[vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b";
    } else if (quality && quality !== "best") {
      formatArg = `bv*[height=${quality}][vcodec^=avc1]+ba[ext=m4a]/bv*[height=${quality}]+ba/bv*[height<=${quality}]+ba/b[height<=${quality}]/b`;
    } else {
      formatArg = "bv*+ba/b";
    }
    args = [
      "--js-runtimes", "node",
      "-f", formatArg,
      "--merge-output-format", "mp4",
      "--ffmpeg-location", __dirname,
      "--newline",
      ...cuttingArgs,
      ...(isSingleVideo ? ["--force-overwrites", "--no-playlist"] : []), // Fix 2
      "-o", outputTemplate,
      "--", url,
    ];
  }

  const downloadProcess = spawn(ytDlpPath, args);

  // Fix 3: Track active downloads
  activeDownloads++;

  // Fix 3: Handle spawn error (missing yt-dlp.exe etc.)
  downloadProcess.on("error", (err) => {
    console.error("spawn error (download):", err.message);
    sendSSE({ error: true, log: "Could not start yt-dlp: " + err.message });
    activeDownloads = Math.max(0, activeDownloads - 1);
    res.end();
  });

  // A6: Parse progress from stdout
  downloadProcess.stdout.on("data", (data) => {
    const text = data.toString();
    const lines = text.split(/\r\n|\r|\n/);
    let foundProgress = null;
    for (const line of lines) {
      const m = line.match(/\[download\]\s+(\d+\.?\d*)%/);
      if (m) foundProgress = parseFloat(m[1]);
    }
    const payload = { log: text.trim() };
    if (foundProgress !== null) payload.progress = foundProgress;
    if (text.trim()) sendSSE(payload);
  });

  // A6 / Fix 6e: Parse ffmpeg time= from stderr for trimmed downloads
  downloadProcess.stderr.on("data", (data) => {
    const text = data.toString();
    const lines = text.split(/\r\n|\r|\n/);
    let foundProgress = null;

    // yt-dlp style [download] NN%
    for (const line of lines) {
      const m = line.match(/\[download\]\s+(\d+\.?\d*)%/);
      if (m) foundProgress = parseFloat(m[1]);
    }

    // ffmpeg time= progress for trimmed downloads
    if (foundProgress === null && (hasStart || hasEnd)) {
      for (const line of lines) {
        const m = line.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
        if (m) {
          const elapsed = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);

          // Fix 6e: Use endSec if available, otherwise fall back to clientDuration - startSec
          let clipLen = null;
          if (endSec !== null && endSec > startSec) {
            clipLen = endSec - startSec;
          } else if (clientDuration) {
            const totalDur = Number(clientDuration);
            if (Number.isFinite(totalDur) && totalDur > startSec) {
              clipLen = totalDur - startSec;
            }
          }

          if (clipLen !== null && clipLen > 0) {
            foundProgress = Math.min(99, Math.round((elapsed / clipLen) * 100));
          }
        }
      }
    }

    const payload = { log: text.trim() };
    if (foundProgress !== null) payload.progress = foundProgress;
    if (text.trim()) sendSSE(payload);
  });

  downloadProcess.on("close", (code) => {
    activeDownloads = Math.max(0, activeDownloads - 1);
    if (code === 0) {
      sendSSE({ done: true, progress: 100, log: "Download completed successfully!" });
    } else {
      sendSSE({ error: true, log: `Process exited with code ${code}` });
    }
    res.end();
  });

  // A7: Kill process tree when client disconnects
  res.on("close", () => killTree(downloadProcess));
});

// ── yt-dlp self-update via SSE ────────────────────────────────
app.get("/api/update-ytdlp", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendSSE = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  // Fix 3: Refuse while downloads are running
  if (activeDownloads > 0) {
    sendSSE({ error: true, log: `Cannot update while ${activeDownloads} download(s) are running. Please wait.` });
    return res.end();
  }

  isUpdating = true;
  const ytDlpPath = path.join(__dirname, "yt-dlp.exe");
  sendSSE({ log: "Running yt-dlp -U to check for updates..." });

  const proc = spawn(ytDlpPath, ["-U"]);

  // Fix 3: Handle spawn error
  proc.on("error", (err) => {
    isUpdating = false;
    console.error("spawn error (update):", err.message);
    sendSSE({ error: true, log: "Could not start yt-dlp: " + err.message });
    res.end();
  });

  proc.stdout.on("data", (data) => {
    const text = data.toString().trim();
    if (text) sendSSE({ log: text });
  });
  proc.stderr.on("data", (data) => {
    const text = data.toString().trim();
    if (text) sendSSE({ log: text });
  });

  proc.on("close", (code) => {
    isUpdating = false;
    if (code === 0) {
      sendSSE({ done: true, log: "yt-dlp is up to date! 🎉" });
    } else {
      sendSSE({ error: true, log: `Update process exited with code ${code}` });
    }
    res.end();
  });

  res.on("close", () => {
    isUpdating = false;
    killTree(proc);
  });
});

// Fix 4: Bind to localhost only, port 3789
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
