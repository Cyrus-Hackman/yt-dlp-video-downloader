# 🎬 YT-Downloader Pro

[![Node.js](https://img.shields.io/badge/Node.js-v16+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-v5.0-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![yt-dlp](https://img.shields.io/badge/Engine-yt--dlp-FF0000?logo=youtube&logoColor=white)](https://github.com/yt-dlp/yt-dlp)
[![FFmpeg](https://img.shields.io/badge/Converter-FFmpeg-007808?logo=ffmpeg&logoColor=white)](https://ffmpeg.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white)](#prerequisites)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

> **Fast, local, and modern YouTube media downloader with a sleek glassmorphic UI.**  
> *Created by Cyrus.*

---

## ✨ Features

- **🎬 High-Quality Video Downloads**
  - Download single videos as MP4.
  - Automatically parses available video streams and resolutions (e.g. 1080p, 720p, 480p, 360p, or best available).
  - Automatically merges high-resolution video and audio streams using FFmpeg.

- **🎵 Studio-Quality Audio Extraction**
  - Extract and convert audio tracks directly into high-fidelity MP3.
  - Choose custom bitrates (320 kbps, 256 kbps, 192 kbps, 128 kbps, 96 kbps, 64 kbps).
  - Automatically embeds official artwork/thumbnails and ID3 metadata.

- **✂️ Precision Video Trimming & Cutting**
  - Interactive dual-thumb range slider to set custom start and end points.
  - Direct timecode input with auto-formatting (`HH:MM:SS` or `MM:SS`).
  - Downloads **only** the selected time range using `yt-dlp --download-sections`, saving bandwidth and disk space.

- **📑 Full Playlist Queue Support**
  - Automatically detects YouTube playlist URLs.
  - Queue interface showing titles, thumbnails, and item counts.
  - Batch "Start All" downloading with individual item progress indicators.

- **📁 Native Windows File & Folder Picker**
  - Integrated PowerShell dialogs (`pick-folder.ps1` and `pick-folder-only.ps1`) for native Windows Save As and Folder Browser selection.
  - Choose exact destination folders and filenames right from the browser.

- **⚡ Real-Time Progress & Logs**
  - Live progress bar, percentage, download speed, ETA, and console logs via Server-Sent Events (SSE).

- **🔄 One-Click yt-dlp Updater**
  - Keep `yt-dlp.exe` updated with the latest fixes for YouTube format and signature changes directly from the web UI.

- **🚀 Instant 1-Click Launch**
  - Included `Start-Downloader.bat` script installs dependencies, terminates any lingering server instances, boots the app, and opens your default browser automatically.

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express, Server-Sent Events (SSE), Child Process (`spawn`/`exec`)
- **Frontend:** Vanilla HTML5, Modern CSS3 (Glassmorphism, responsive design, animations), Vanilla JavaScript
- **Core Binaries:** `yt-dlp.exe` & `ffmpeg.exe` (downloaded by user, placed in root)
- **Windows Integration:** PowerShell STA Form Dialogs (`SaveFileDialog` & `FolderBrowserDialog`)

---

## 📂 Project Structure

```plaintext
yt-dlp-video-downloader/
├── public/
│   ├── index.html            # Main web interface
│   ├── style.css             # Glassmorphism UI styling & animations
│   └── script.js             # Client application logic, slider, SSE handlers
├── server.js                 # Express server & API endpoints
├── pick-folder.ps1           # Windows SaveFileDialog helper script
├── pick-folder-only.ps1      # Windows FolderBrowserDialog helper script
├── Start-Downloader.bat      # One-click desktop launcher
├── yt-dlp.exe                # yt-dlp binary (downloaded separately)
├── ffmpeg.exe                # FFmpeg binary (downloaded separately)
├── package.json              # Project dependencies and configuration
├── .gitignore                # Git ignore rules for media and binaries
└── README.md                 # Project documentation
```

---

## 🚀 Getting Started

### Prerequisites

- **Operating System:** Windows 10 / 11
- **Node.js:** [Node.js (v18 or higher)](https://nodejs.org/) installed and available in your `PATH`. *(Express 5 requires Node 18+)*


---

### Step 1: Clone the Repository

```bash
git clone https://github.com/Cyrus-Hackman/yt-dlp-video-downloader.git
cd yt-dlp-video-downloader
```

---

### Step 2: Download Required Executables (`yt-dlp.exe` & `ffmpeg.exe`)

Because executables are not hosted in the Git repository, download them directly from their official sources and place them into the root folder of this project (`yt-dlp-video-downloader/` alongside `server.js`):

#### 1. Download `yt-dlp.exe`
- **Direct Download:** [https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe](https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe)
- Place `yt-dlp.exe` directly in the project folder.

#### 2. Download `ffmpeg.exe`
- **Official Builds:** Download a Windows build from [Gyan.dev FFmpeg Builds](https://www.gyan.dev/ffmpeg/builds/) (e.g. `ffmpeg-release-essentials.zip`) or [BtbN FFmpeg Releases](https://github.com/BtbN/FFmpeg-Builds/releases).
- Open the downloaded `.zip` archive, go to the `bin/` folder, and extract **`ffmpeg.exe`** into the project folder.

> [!TIP]
> **Quick PowerShell Download (Optional):**  
> You can download and place both files automatically by running PowerShell in the project directory:
> ```powershell
> # Download yt-dlp.exe
> Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile "yt-dlp.exe"
> 
> # Download and extract ffmpeg.exe
> Invoke-WebRequest -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile "ffmpeg.zip"
> Expand-Archive -Path "ffmpeg.zip" -DestinationPath "ffmpeg-temp"
> Get-ChildItem -Path "ffmpeg-temp" -Filter "ffmpeg.exe" -Recurse | Copy-Item -Destination "ffmpeg.exe"
> Remove-Item -Recurse -Force "ffmpeg.zip", "ffmpeg-temp"
> ```

---

### Step 3: Run the Application

#### Option A: Quick Launch (Recommended)
Simply double-click the **`Start-Downloader.bat`** file in the root directory. It will:
1. Automatically run `npm install express cors` if `node_modules` is missing.
2. Terminate any previous Node processes running on port 3000.
3. Launch the server (`node server.js`).
4. Automatically open `http://localhost:3000` in your web browser.

#### Option B: Manual Launch
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   node server.js
   ```
3. Open your browser and go to:
   ```
   http://localhost:3000
   ```

---

## 📖 How to Use

1. **Enter URL:** Paste a YouTube video or playlist link into the input box and click the search icon.
2. **Select Options:**
   - Choose format (**MP4 Video** or **MP3 Audio**).
   - Select desired **Resolution** (for video) or **Bitrate** (for audio).
3. **(Optional) Trim Clip:** Toggle the scissors icon to open the trimmer and drag the dual slider handles or type start/end timestamps.
4. **Choose Destination:** Click **Download Media** — a native Windows dialog will prompt you to choose where to save the file.
5. **Monitor:** Watch real-time download progress, transfer speed, and completion status.

---

## 🔌 API Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/info` | `POST` | Fetches metadata, available resolutions, and audio formats for a video. |
| `/api/playlist-info` | `POST` | Fetches flat playlist metadata and list of videos. |
| `/api/video-duration`| `POST` | Quickly retrieves total video duration in seconds for trimming calculations. |
| `/api/select-folder` | `GET` | Invokes native Windows `SaveFileDialog` via PowerShell. |
| `/api/select-folder-only` | `GET` | Invokes native Windows `FolderBrowserDialog` via PowerShell. |
| `/api/download` | `GET` | Initiates media download and streams real-time progress via SSE. |
| `/api/update-ytdlp` | `GET` | Downloads the latest `yt-dlp.exe` binary from GitHub releases with live progress. |

---

## 📝 License

This project is licensed under the ISC License.
