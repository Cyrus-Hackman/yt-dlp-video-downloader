const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Fetch video info (formats, title)
app.post("/api/info", (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  const ytDlpPath = path.join(__dirname, "yt-dlp.exe");

  // We use -J to get the full JSON dump
  const process = spawn(ytDlpPath, ['--js-runtimes', 'node', '-J', url]);

  let output = "";
  let errorOutput = "";

  process.stdout.on("data", (data) => {
    output += data.toString();
  });

  process.stderr.on("data", (data) => {
    errorOutput += data.toString();
  });

  process.on("close", (code) => {
    if (code !== 0) {
      console.error(`yt-dlp error: ${errorOutput}`);
      return res
        .status(500)
        .json({ error: "Failed to fetch video info", details: errorOutput });
    }

    try {
      const parsed = JSON.parse(output);

      // Extract formats
      const formats = parsed.formats || [];

      // Filter audio-only formats for MP3 option
      const audioFormats = formats.filter(
        (f) => f.vcodec === "none" && f.acodec !== "none",
      );

      // Filter video formats for MP4
      const videoFormats = formats.filter(
        (f) => f.vcodec !== "none" && f.ext !== "mhtml",
      );

      // Unique resolutions for video
      const resolutionsSet = new Set();
      const uniqueVideoFormats = [];
      videoFormats.forEach(f => {
          let height = f.height;
          if (!height && typeof f.resolution === 'string') {
              const parts = f.resolution.split('x');
              if (parts.length === 2) height = parseInt(parts[1], 10);
          }
          
          if (height && !resolutionsSet.has(height)) {
              resolutionsSet.add(height);
              uniqueVideoFormats.push({ height, format_id: f.format_id, ext: f.ext });
          }
      });
      // Sort video qualities descending
      uniqueVideoFormats.sort((a, b) => b.height - a.height);
      
      res.json({
          title: parsed.title,
          thumbnail: parsed.thumbnail,
          audioFormats: audioFormats.map(f => ({ id: f.format_id, ext: f.ext, abr: f.abr })),
          videoQualities: uniqueVideoFormats,
          audioQualities: [320, 256, 192, 128, 96, 64]
      });
    } catch (e) {
      console.error("Error parsing JSON:", e);
      res.status(500).json({ error: "Failed to parse video info" });
    }
  });
});

// Download endpoint with Server-Sent Events (SSE)
app.get("/api/download", (req, res) => {
  const { url, type, quality } = req.query;

  if (!url || !type) {
    return res.status(400).json({ error: "URL and type are required" });
  }

  // Setup SSE Headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const ytDlpPath = path.join(__dirname, "yt-dlp.exe");
  let args = [];

  if (type === 'mp3') {
      // Audio extraction using ffmpeg
      const audioQual = (quality && quality !== 'best') ? `${quality}K` : '0';
      args = [
          '--js-runtimes', 'node',
          '-x', '--audio-format', 'mp3',
          '--audio-quality', audioQual,
          '--ffmpeg-location', __dirname,
          '-o', '%(title)s [%(id)s].%(ext)s',
          url
      ];
  } else if (type === 'mp4') {
    // Video download
    const formatArg = quality && quality !== 'best' ? `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best` : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
    args = [
      '--js-runtimes', 'node',
      '-f', formatArg,
      '--merge-output-format', 'mp4',
      '--ffmpeg-location', __dirname,
      '-o', '%(title)s [%(id)s].%(ext)s',
      url
    ];
  }

  const downloadProcess = spawn(ytDlpPath, args);

  downloadProcess.stdout.on("data", (data) => {
    const text = data.toString();
    // Regex to find progress percent
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
      res.write(
        `data: ${JSON.stringify({ done: true, log: "Download completed successfully!" })}\n\n`,
      );
    } else {
      res.write(
        `data: ${JSON.stringify({ error: true, log: `Process exited with code ${code}` })}\n\n`,
      );
    }
    res.end();
  });

  // Handle client disconnect
  req.on("close", () => {
    downloadProcess.kill();
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
