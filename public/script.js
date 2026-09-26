document.addEventListener('DOMContentLoaded', () => {
    // ── Core refs ──────────────────────────────────────────────
    const urlInput        = document.getElementById('url');
    const btnFetch        = document.getElementById('btn-fetch');
    const btnDownload     = document.getElementById('btn-download');
    const videoInfoRef    = document.getElementById('video-info');
    const videoTitleRef   = document.getElementById('video-title');
    const videoThumbRef   = document.getElementById('video-thumb');
    const optionsRowRef   = document.getElementById('options-row');
    const formatSelectRef = document.getElementById('format');
    const qualitySelectRef= document.getElementById('quality');
    const qualityGroupRef = document.getElementById('quality-group');

    // Single-video progress
    const progressContainer  = document.getElementById('progress-container');
    const progressStatusRef  = document.getElementById('progress-status');
    const progressPercentRef = document.getElementById('progress-percent');
    const progressBarFillRef = document.getElementById('progress-bar-fill');
    const logOutputRef       = document.getElementById('log-output');

    // ── State ──────────────────────────────────────────────────
    let currentVideoInfo  = null;
    let currentIsPlaylist = false;
    let playlistEntries   = [];
    let eventSource       = null;

    // Trim state
    let trimDuration = 0;
    let trimStartSec = 0;
    let trimEndSec   = 0;

    // ── Trim UI refs ───────────────────────────────────────────
    const trimSection    = document.getElementById('trim-section');
    const trimEnabled    = document.getElementById('trim-enabled');
    const trimControls   = document.getElementById('trim-controls');
    const trimStartInput = document.getElementById('trim-start');
    const trimEndInput   = document.getElementById('trim-end');
    const trimClipLength = document.getElementById('trim-clip-length');
    const trimRangeFill  = document.getElementById('trim-range-fill');
    const durationText   = document.getElementById('video-duration-text');

    // A1/A2: Use stable element references, never clone
    const trackEl  = document.getElementById('trim-track');
    const startEl  = document.getElementById('trim-thumb-start');
    const endEl    = document.getElementById('trim-thumb-end');

    // ── Trim helpers ───────────────────────────────────────────
    function formatTime(sec) {
        sec = Math.max(0, Math.floor(sec));
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        return `${m}:${String(s).padStart(2,'0')}`;
    }

    function parseTimeInput(str) {
        const parts = str.split(':').map(Number);
        if (parts.some(isNaN)) return null;
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        return parts[0];
    }

    function updateTrimUI() {
        if (!trimDuration) return;
        const startPct = (trimStartSec / trimDuration) * 100;
        const endPct   = (trimEndSec   / trimDuration) * 100;
        // A1: Always write to the LIVE elements (never detached clones)
        startEl.style.left       = startPct + '%';
        endEl.style.left         = endPct   + '%';
        trimRangeFill.style.left  = startPct + '%';
        trimRangeFill.style.width = (endPct - startPct) + '%';
        trimStartInput.value = formatTime(trimStartSec);
        trimEndInput.value   = formatTime(trimEndSec);
        const clipSec = trimEndSec - trimStartSec;
        trimClipLength.textContent = clipSec > 0 ? formatTime(clipSec) + ' selected' : 'Full video';
    }

    // A1: initTrimSlider only sets state + redraws — no cloning, no new listeners
    function initTrimSlider(duration) {
        trimDuration = duration;
        trimStartSec = 0;
        trimEndSec   = duration;
        durationText.textContent = formatTime(duration);
        updateTrimUI();
    }

    // A2: Single pointer-event handler on the track, registered once at startup
    let activeThumb = null; // 'start' | 'end' | 'pending' | null
    let downX = 0;

    const secFromX = (x) => {
        const r = trackEl.getBoundingClientRect();
        // A2: Snap to whole seconds
        return Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * trimDuration);
    };

    function setThumb(which, sec) {
        if (which === 'start') {
            trimStartSec = Math.max(0, Math.min(sec, trimEndSec - 1));
        } else {
            trimEndSec = Math.min(trimDuration, Math.max(sec, trimStartSec + 1));
        }
        // A2: Raise z-index of the last-moved thumb so it's always grabbable
        startEl.style.zIndex = which === 'start' ? 3 : 2;
        endEl.style.zIndex   = which === 'end'   ? 3 : 2;
        updateTrimUI();
    }

    trackEl.addEventListener('pointerdown', (e) => {
        // A2: Guard: only active when trim is enabled and duration is known
        if (!trimDuration || !trimEnabled.checked) return;
        e.preventDefault();
        trackEl.setPointerCapture(e.pointerId);
        downX = e.clientX;

        const r = trackEl.getBoundingClientRect();
        const gapPx = ((trimEndSec - trimStartSec) / trimDuration) * r.width;
        const sec   = secFromX(e.clientX);

        // A2: If handles are very close and user clicks one of them, defer
        if (gapPx < 20 && (e.target === startEl || e.target === endEl)) {
            activeThumb = 'pending';
            return;
        }

        // Pick nearest thumb by time distance
        activeThumb = Math.abs(sec - trimStartSec) <= Math.abs(sec - trimEndSec) ? 'start' : 'end';
        setThumb(activeThumb, sec);
    });

    trackEl.addEventListener('pointermove', (e) => {
        if (!activeThumb) return;
        // A2: Resolve 'pending' on first real movement
        if (activeThumb === 'pending') {
            if (Math.abs(e.clientX - downX) < 3) return;
            activeThumb = e.clientX < downX ? 'start' : 'end';
        }
        setThumb(activeThumb, secFromX(e.clientX));
    });

    ['pointerup', 'pointercancel'].forEach(t =>
        trackEl.addEventListener(t, () => { activeThumb = null; })
    );

    // A2: Keyboard support on the thumbs
    startEl.addEventListener('keydown', (e) => {
        if (!trimDuration || !trimEnabled.checked) return;
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowLeft')  { setThumb('start', trimStartSec - step); e.preventDefault(); }
        if (e.key === 'ArrowRight') { setThumb('start', trimStartSec + step); e.preventDefault(); }
    });
    endEl.addEventListener('keydown', (e) => {
        if (!trimDuration || !trimEnabled.checked) return;
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowLeft')  { setThumb('end', trimEndSec - step); e.preventDefault(); }
        if (e.key === 'ArrowRight') { setThumb('end', trimEndSec + step); e.preventDefault(); }
    });

    // Text input → slider sync
    trimStartInput.addEventListener('change', () => {
        const v = parseTimeInput(trimStartInput.value);
        if (v !== null && v >= 0 && v < trimEndSec) { trimStartSec = v; updateTrimUI(); }
        else trimStartInput.value = formatTime(trimStartSec);
    });
    trimEndInput.addEventListener('change', () => {
        const v = parseTimeInput(trimEndInput.value);
        if (v !== null && v > trimStartSec && v <= trimDuration) { trimEndSec = v; updateTrimUI(); }
        else trimEndInput.value = formatTime(trimEndSec);
    });

    // Toggle enable/disable of trim controls
    trimEnabled.addEventListener('change', () => {
        if (trimEnabled.checked) {
            trimControls.classList.remove('disabled');
        } else {
            trimControls.classList.add('disabled');
        }
    });

    // ── A4: Reset state when URL input changes ─────────────────
    urlInput.addEventListener('input', () => {
        currentVideoInfo  = null;
        currentIsPlaylist = false;
        trimDuration = 0;
        trimEnabled.checked = false;
        trimControls.classList.add('disabled');
        videoInfoRef.classList.add('hidden');
        optionsRowRef.classList.add('hidden');
        trimSection.classList.add('hidden');
        btnDownload.classList.add('hidden');
        btnDownload.disabled = true;
    });

    // A4: Enter key in URL input calls fetchInfo, doesn't submit
    urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            fetchInfo();
        }
    });

    // ── Fetch / detect ─────────────────────────────────────────
    btnFetch.addEventListener('click', fetchInfo);

    document.getElementById('download-form').addEventListener('submit', (e) => {
        e.preventDefault();
        // A4: If no info fetched for the current URL, fetch first
        if (!currentVideoInfo && !currentIsPlaylist) {
            fetchInfo();
            return;
        }
        if (currentIsPlaylist) openPlaylistFolderModal();
        else startDownload();
    });

    formatSelectRef.addEventListener('change', populateQualities);

    async function fetchInfo() {
        const url = urlInput.value.trim();
        if (!url) return alert('Please enter a valid URL');

        // A4: Reset info at start of every fetch
        currentVideoInfo  = null;
        currentIsPlaylist = false;
        playlistEntries   = [];
        trimDuration = 0;

        // Reset UI
        videoInfoRef.classList.add('hidden');
        optionsRowRef.classList.add('hidden');
        btnDownload.classList.add('hidden');
        btnDownload.disabled = true;
        progressContainer.classList.add('hidden');
        document.getElementById('queue-container').classList.add('hidden');
        trimSection.classList.add('hidden');
        trimEnabled.checked = false;
        trimControls.classList.add('disabled');

        btnFetch.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btnFetch.disabled  = true;

        try {
            // B8: If URL has both v= and list=, ask user what to do
            const hasVideoId   = /[?&]v=/.test(url);
            const hasPlaylist  = /[?&]list=/.test(url) || url.includes('/playlist');

            if (hasVideoId && hasPlaylist) {
                const choice = confirm(
                    'This URL links to a video inside a playlist.\n\n' +
                    'Click OK to download just this video.\n' +
                    'Click Cancel to download the whole playlist.'
                );
                if (choice) {
                    // Fetch single video only
                    await fetchSingleVideo(url);
                } else {
                    await fetchPlaylist(url);
                }
            } else if (hasPlaylist) {
                await fetchPlaylist(url);
            } else {
                await fetchSingleVideo(url);
            }
        } catch (err) {
            alert('Error: ' + err.message);
            console.error(err);
        } finally {
            btnFetch.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
            btnFetch.disabled  = false;
        }
    }

    async function fetchSingleVideo(url) {
        const res = await fetch('/api/info', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ url }),
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to fetch');
        }
        const data = await res.json();
        currentVideoInfo = data;
        videoTitleRef.textContent = data.title || 'Unknown Title';
        videoThumbRef.src = data.thumbnail || '';
        videoInfoRef.classList.remove('hidden');
        optionsRowRef.classList.remove('hidden');
        populateQualities();
        btnDownload.classList.remove('hidden');
        btnDownload.disabled  = false;
        btnDownload.innerHTML = '<i class="fa-solid fa-download"></i> Download Media';

        // A8: Only show trim if duration is known
        trimSection.classList.remove('hidden');
        trimEnabled.checked = false;
        trimControls.classList.add('disabled');

        if (data.duration && data.duration > 0) {
            initTrimSlider(data.duration);
            trimEnabled.disabled = false;
        } else {
            durationText.textContent = '--:--';
            trimEnabled.disabled = true;
            // Show unavailability note
            const trimHeader = trimSection.querySelector('.trim-header span');
            if (trimHeader) trimHeader.textContent = 'Trim Clip (unavailable for this video)';
        }
    }

    async function fetchPlaylist(url) {
        const plRes = await fetch('/api/playlist-info', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ url }),
        });
        if (!plRes.ok) throw new Error('Failed to fetch playlist info');
        const plData = await plRes.json();

        if (plData.isPlaylist && plData.entries && plData.entries.length > 0) {
            currentIsPlaylist = true;
            playlistEntries   = plData.entries;
            buildPlaylistQueue(plData.title, plData.entries);
            optionsRowRef.classList.remove('hidden');
            populateQualities();
            btnDownload.classList.remove('hidden');
            btnDownload.disabled  = false;
            btnDownload.innerHTML = '<i class="fa-solid fa-list-ul"></i> Download Playlist';
            videoInfoRef.classList.add('hidden');
        } else {
            throw new Error('No videos found in this playlist.');
        }
    }

    function populateQualities() {
        const type = formatSelectRef.value;
        qualitySelectRef.innerHTML = '';
        qualityGroupRef.style.opacity = '1';
        qualitySelectRef.disabled = false;

        if (type === 'mp4') {
            const bestOpt = document.createElement('option');
            bestOpt.value = 'best';
            bestOpt.textContent = 'Best Video';
            qualitySelectRef.appendChild(bestOpt);

            // B2: Use generic heights for playlist, real data for single video
            const heights = (currentVideoInfo && currentVideoInfo.videoQualities && !currentIsPlaylist)
                ? currentVideoInfo.videoQualities.map(q => q.height)
                : [2160, 1440, 1080, 720, 480, 360];

            heights.forEach((h) => {
                const opt = document.createElement('option');
                opt.value = h;
                // B3: Note for high-res that may use VP9/AV1
                const note = (h >= 1440) ? ' (VP9/AV1)' : '';
                opt.textContent = `${h}p${note}`;
                qualitySelectRef.appendChild(opt);
            });
        } else if (type === 'mp3') {
            const bestAudio = document.createElement('option');
            bestAudio.value = 'best';
            bestAudio.textContent = 'Best Audio (VBR)';
            qualitySelectRef.appendChild(bestAudio);

            // B2: Always show bitrate list (use generic for playlist)
            const bitrates = (currentVideoInfo && currentVideoInfo.audioQualities && !currentIsPlaylist)
                ? currentVideoInfo.audioQualities
                : [320, 256, 192, 128, 96, 64];

            bitrates.forEach((kbps) => {
                const opt = document.createElement('option');
                opt.value = kbps;
                opt.textContent = `${kbps} kbps`;
                qualitySelectRef.appendChild(opt);
            });
        }
    }

    // ── Playlist Queue UI ──────────────────────────────────────
    function buildPlaylistQueue(playlistTitle, entries) {
        const queueContainer = document.getElementById('queue-container');
        const queueList      = document.getElementById('queue-list');
        const queueSubtitle  = document.getElementById('queue-subtitle');
        const startBtn       = document.getElementById('btn-start-queue');

        queueSubtitle.textContent = `${entries.length} video${entries.length !== 1 ? 's' : ''} · ${playlistTitle || ''}`;
        queueList.innerHTML = '';

        entries.forEach((entry, i) => {
            const item = document.createElement('div');
            item.className = 'queue-item';
            item.id        = `queue-item-${i}`;

            const numEl = document.createElement('div');
            numEl.className = 'queue-item-num';
            numEl.textContent = String(i + 1);

            const infoEl = document.createElement('div');
            infoEl.className = 'queue-item-info';

            // B7: Use textContent, not innerHTML, to prevent HTML injection
            const titleEl = document.createElement('div');
            titleEl.className = 'queue-item-title';
            titleEl.textContent = entry.title;  // safe — no innerHTML

            const barBgEl = document.createElement('div');
            barBgEl.className = 'queue-item-bar-bg hidden';
            const barFillEl = document.createElement('div');
            barFillEl.className = 'queue-item-bar-fill';
            barBgEl.appendChild(barFillEl);

            infoEl.appendChild(titleEl);
            infoEl.appendChild(barBgEl);

            const statusEl = document.createElement('div');
            statusEl.className = 'queue-item-status';
            statusEl.id = `queue-status-${i}`;
            statusEl.innerHTML = '<i class="fa-regular fa-clock"></i> Pending';

            item.appendChild(numEl);
            item.appendChild(infoEl);
            item.appendChild(statusEl);
            queueList.appendChild(item);
        });

        startBtn.disabled = false;
        startBtn.onclick  = openPlaylistFolderModal;
        queueContainer.classList.remove('hidden');
    }

    function updateQueueItem(index, state, percent = 0) {
        const statusEl = document.getElementById(`queue-status-${index}`);
        const itemEl   = document.getElementById(`queue-item-${index}`);
        const barBg    = itemEl && itemEl.querySelector('.queue-item-bar-bg');
        const barFill  = itemEl && itemEl.querySelector('.queue-item-bar-fill');

        if (!statusEl) return;

        if (state === 'downloading') {
            statusEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="color:#60a5fa"></i> ${percent}%`;
            itemEl && itemEl.classList.add('queue-item--active');
            if (barBg) { barBg.classList.remove('hidden'); barFill.style.width = percent + '%'; }
        } else if (state === 'done') {
            statusEl.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#34d399"></i> Done';
            itemEl && itemEl.classList.remove('queue-item--active');
            itemEl && itemEl.classList.add('queue-item--done');
            if (barBg) { barFill.style.width = '100%'; }
        } else if (state === 'error') {
            statusEl.innerHTML = '<i class="fa-solid fa-circle-xmark" style="color:#f87171"></i> Error';
            itemEl && itemEl.classList.remove('queue-item--active');
            itemEl && itemEl.classList.add('queue-item--error');
        }
    }

    // ── Playlist folder modal ──────────────────────────────────
    const playlistFolderModal  = document.getElementById('playlist-folder-modal');
    const playlistFolderInput  = document.getElementById('playlist-folder-input');
    const playlistBrowseBtn    = document.getElementById('playlist-browse-btn');
    const playlistModalCancel  = document.getElementById('playlist-modal-cancel');
    const playlistModalConfirm = document.getElementById('playlist-modal-confirm');

    playlistBrowseBtn.addEventListener('click', async () => {
        playlistBrowseBtn.disabled = true;
        playlistBrowseBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Opening...';
        try {
            const res  = await fetch('/api/select-folder-only');
            const data = await res.json();
            if (data.path) {
                playlistFolderInput.value = data.path;
                playlistFolderInput.style.borderColor = '#34d399';
                playlistModalConfirm.disabled = false;
            }
        } catch (err) {
            console.error('Playlist browse failed:', err);
        } finally {
            playlistBrowseBtn.disabled = false;
            playlistBrowseBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Browse';
        }
    });

    function openPlaylistFolderModal() {
        playlistFolderInput.value = '';
        playlistFolderInput.style.borderColor = '';
        playlistModalConfirm.disabled = true;
        playlistFolderModal.classList.remove('hidden');
    }

    playlistModalCancel.addEventListener('click', () => {
        playlistFolderModal.classList.add('hidden');
    });

    playlistModalConfirm.addEventListener('click', () => {
        const folder = playlistFolderInput.value.trim();
        if (!folder) return;
        playlistFolderModal.classList.add('hidden');
        startQueueDownload(folder);
    });

    // ── Queue sequential download ──────────────────────────────
    async function startQueueDownload(saveFolder) {
        const type    = formatSelectRef.value;
        // B1: Use actual quality value for both mp3 and mp4
        const quality = qualitySelectRef.value;
        const overallStatus = document.getElementById('queue-overall-status');
        const startBtn = document.getElementById('btn-start-queue');

        startBtn.disabled = true;
        btnDownload.disabled = true;

        for (let i = 0; i < playlistEntries.length; i++) {
            const entry = playlistEntries[i];
            updateQueueItem(i, 'downloading', 0);
            overallStatus.textContent = `Downloading ${i + 1} / ${playlistEntries.length}`;
            document.getElementById(`queue-item-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

            // B4: Pass saveDir separately so server can escape % and build template
            const ok = await downloadSingleSSE(entry.url, type, quality, null, saveFolder, i);
            updateQueueItem(i, ok ? 'done' : 'error');
        }

        overallStatus.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#34d399"></i> All done!';
        btnDownload.disabled = false;
        startBtn.disabled = false;
        startBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Download Again';
    }

    function downloadSingleSSE(url, type, quality, savePath, saveDir, queueIndex) {
        return new Promise((resolve) => {
            const params = { url, type, quality };
            if (savePath) params.savePath = savePath;
            if (saveDir)  params.saveDir  = saveDir;
            const qs = new URLSearchParams(params).toString();
            const es = new EventSource(`/api/download?${qs}`);

            es.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    // A6: Use server-parsed progress (not re-parsed from log text)
                    if (typeof data.progress === 'number' && queueIndex !== undefined) {
                        updateQueueItem(queueIndex, 'downloading', data.progress.toFixed(0));
                    }
                    if (data.done) { es.close(); resolve(true); }
                    if (data.error) { es.close(); resolve(false); }
                } catch (e) { /* ignore */ }
            };
            es.onerror = () => { es.close(); resolve(false); };
        });
    }

    // ── Save-As modal (single video) ───────────────────────────
    const folderModalOverlay = document.getElementById('folder-modal-overlay');
    const folderPathInput    = document.getElementById('folder-path-input');
    const modalConfirmBtn    = document.getElementById('modal-confirm-btn');
    const modalCancelBtn     = document.getElementById('modal-cancel-btn');
    const browseBtn          = document.getElementById('browse-btn');

    browseBtn.addEventListener('click', async () => {
        browseBtn.disabled = true;
        browseBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Opening...';
        try {
            const type  = formatSelectRef.value;
            const title = currentVideoInfo ? currentVideoInfo.title : 'download';
            const params = new URLSearchParams({ fileName: title, fileType: type });
            const res  = await fetch('/api/select-folder?' + params.toString());
            const data = await res.json();
            if (data.path) {
                folderPathInput.value = data.path;
                folderPathInput.style.borderColor = '#34d399';
                modalConfirmBtn.disabled = false;
            }
        } catch (err) { console.error('Browse failed:', err); }
        finally {
            browseBtn.disabled = false;
            browseBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Browse';
        }
    });

    function showFolderModal() {
        return new Promise((resolve) => {
            folderPathInput.value = '';
            folderPathInput.style.borderColor = '';
            modalConfirmBtn.disabled = true;
            folderModalOverlay.classList.remove('hidden');

            const onConfirm = () => { const p = folderPathInput.value.trim(); if (!p) return; cleanup(); resolve(p); };
            const onCancel  = () => { cleanup(); resolve(null); };
            const onKeydown = (e) => { if (e.key === 'Escape') onCancel(); };
            function cleanup() {
                folderModalOverlay.classList.add('hidden');
                modalConfirmBtn.removeEventListener('click', onConfirm);
                modalCancelBtn.removeEventListener('click', onCancel);
                document.removeEventListener('keydown', onKeydown);
            }
            modalConfirmBtn.addEventListener('click', onConfirm);
            modalCancelBtn.addEventListener('click', onCancel);
            document.addEventListener('keydown', onKeydown);
        });
    }

    // ── Single video download ──────────────────────────────────
    async function startDownload() {
        const url  = urlInput.value.trim();
        const type = formatSelectRef.value;
        // B1: Use qualitySelectRef.value for BOTH mp3 and mp4
        const quality = qualitySelectRef.value;
        if (!url) return;

        const fullSavePath = await showFolderModal();
        if (!fullSavePath) return;

        // A2: Trim values already snapped to whole seconds in setThumb()
        let startTime = '';
        let endTime   = '';
        if (trimEnabled.checked && trimDuration > 0) {
            if (trimStartSec > 0)               startTime = String(trimStartSec);
            if (trimEndSec < trimDuration - 0.5) endTime   = String(trimEndSec);
        }

        progressContainer.classList.remove('hidden');
        progressBarFillRef.style.width = '0%';
        progressPercentRef.textContent = '0%';
        progressStatusRef.textContent  = 'Initializing...';
        progressStatusRef.style.color  = 'var(--text-primary)';
        logOutputRef.innerHTML = '';
        btnDownload.disabled   = true;
        btnDownload.innerHTML  = '<i class="fa-solid fa-spinner fa-spin"></i> Downloading...';

        if (eventSource) eventSource.close();

        // B4: Pass savePath; server handles % escaping
        const params = { url, type, quality, savePath: fullSavePath, startTime, endTime };
        const qs = new URLSearchParams(params).toString();
        eventSource = new EventSource(`/api/download?${qs}`);

        addLog(`Started: ${url}`);

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.log) addLog(data.log);
                // A6: Only update bar when server sends an explicit progress value
                if (typeof data.progress === 'number' && !data.done) {
                    progressBarFillRef.style.width = `${data.progress}%`;
                    progressPercentRef.textContent = `${Math.round(data.progress)}%`;
                    progressStatusRef.textContent  = data.progress >= 99 ? 'Finalizing...' : 'Downloading...';
                }
                if (data.done) {
                    progressStatusRef.textContent = 'Completed!';
                    progressStatusRef.style.color = '#34d399';
                    progressBarFillRef.style.width = '100%';
                    progressPercentRef.textContent = '100%';
                    btnDownload.disabled  = false;
                    btnDownload.innerHTML = '<i class="fa-solid fa-download"></i> Download Another';
                    eventSource.close();
                }
                if (data.error) {
                    progressStatusRef.textContent = 'Error occurred!';
                    progressStatusRef.style.color = '#f87171';
                    btnDownload.disabled  = false;
                    btnDownload.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Retry Download';
                    eventSource.close();
                }
            } catch (e) { console.error('SSE parse error', e); }
        };

        eventSource.onerror = () => {
            progressStatusRef.textContent = 'Connection Lost';
            progressStatusRef.style.color = '#f87171';
            btnDownload.disabled  = false;
            btnDownload.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Retry Download';
            eventSource.close();
        };
    }

    function addLog(message) {
        if (!message) return;
        const entry = document.createElement('div');
        entry.textContent = message;
        logOutputRef.appendChild(entry);
        logOutputRef.scrollTop = logOutputRef.scrollHeight;
    }

    // ── yt-dlp Auto Update ─────────────────────────────────────
    const btnUpdate       = document.getElementById('btn-update-ytdlp');
    const updateContainer = document.getElementById('update-container');
    const updateStatus    = document.getElementById('update-status');
    const updatePercent   = document.getElementById('update-percent');
    const updateBarFill   = document.getElementById('update-bar-fill');
    const updateLog       = document.getElementById('update-log');

    btnUpdate.addEventListener('click', () => {
        updateContainer.classList.remove('hidden');
        updateLog.innerHTML = '';
        updateBarFill.style.width = '0%';
        updateStatus.textContent  = 'Connecting...';
        updateStatus.style.color  = '';
        updatePercent.textContent = '';
        btnUpdate.disabled = true;
        btnUpdate.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Updating...';

        // B10: Server now uses yt-dlp -U; no progress bar needed
        updateBarFill.style.width = '100%'; // indeterminate state

        const es = new EventSource('/api/update-ytdlp');
        es.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.log) {
                    const entry = document.createElement('div');
                    entry.textContent = data.log;
                    updateLog.appendChild(entry);
                    updateLog.scrollTop = updateLog.scrollHeight;
                    updateStatus.textContent = data.log;
                }
                if (data.done) {
                    updateStatus.textContent = '✅ Updated successfully!';
                    updateStatus.style.color = '#34d399';
                    es.close();
                    btnUpdate.disabled = false;
                    btnUpdate.innerHTML = '<i class="fa-solid fa-rotate"></i> Update yt-dlp';
                }
                if (data.error) {
                    updateStatus.textContent = '❌ Update failed';
                    updateStatus.style.color = '#f87171';
                    es.close();
                    btnUpdate.disabled = false;
                    btnUpdate.innerHTML = '<i class="fa-solid fa-rotate"></i> Update yt-dlp';
                }
            } catch (e) { /* ignore */ }
        };
        es.onerror = () => {
            updateStatus.textContent = 'Connection error';
            updateStatus.style.color = '#f87171';
            es.close();
            btnUpdate.disabled = false;
            btnUpdate.innerHTML = '<i class="fa-solid fa-rotate"></i> Update yt-dlp';
        };
    });
});
