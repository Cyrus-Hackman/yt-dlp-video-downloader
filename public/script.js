document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('url');
    const btnFetch = document.getElementById('btn-fetch');
    const btnDownload = document.getElementById('btn-download');
    
    const videoInfoRef = document.getElementById('video-info');
    const videoTitleRef = document.getElementById('video-title');
    const videoThumbRef = document.getElementById('video-thumb');
    
    const optionsRowRef = document.getElementById('options-row');
    const formatSelectRef = document.getElementById('format');
    const qualitySelectRef = document.getElementById('quality');
    const qualityGroupRef = document.getElementById('quality-group');
    
    const progressContainer = document.getElementById('progress-container');
    const progressStatusRef = document.getElementById('progress-status');
    const progressPercentRef = document.getElementById('progress-percent');
    const progressBarFillRef = document.getElementById('progress-bar-fill');
    const logOutputRef = document.getElementById('log-output');

    let currentVideoInfo = null;
    let eventSource = null;

    btnFetch.addEventListener('click', fetchVideoInfo);
    
    document.getElementById('download-form').addEventListener('submit', (e) => {
        e.preventDefault();
        startDownload();
    });

    formatSelectRef.addEventListener('change', () => {
        populateQualities();
    });

    async function fetchVideoInfo() {
        const url = urlInput.value.trim();
        if (!url) return alert('Please enter a valid URL');

        // Reset UI
        videoInfoRef.classList.add('hidden');
        optionsRowRef.classList.add('hidden');
        btnDownload.classList.add('hidden');
        progressContainer.classList.add('hidden');
        btnFetch.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btnFetch.disabled = true;

        try {
            const response = await fetch('/api/info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Failed to fetch');
            }

            const data = await response.json();
            currentVideoInfo = data;
            
            // Populate UI
            videoTitleRef.textContent = data.title || 'Unknown Title';
            videoThumbRef.src = data.thumbnail || 'https://via.placeholder.com/120x90?text=No+Thumb';
            
            videoInfoRef.classList.remove('hidden');
            optionsRowRef.classList.remove('hidden');
            
            populateQualities();

            btnDownload.classList.remove('hidden');
            btnDownload.disabled = false;

        } catch (err) {
            alert('Error fetching video info. Make sure the link is correct and yt-dlp is working.');
            console.error(err);
        } finally {
            btnFetch.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
            btnFetch.disabled = false;
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

            if (currentVideoInfo && currentVideoInfo.videoQualities) {
                currentVideoInfo.videoQualities.forEach(q => {
                    const opt = document.createElement('option');
                    opt.value = q.height;
                    opt.textContent = `${q.height}p`;
                    qualitySelectRef.appendChild(opt);
                });
            }
        } else if (type === 'mp3') {
            const bestAudio = document.createElement('option');
            bestAudio.value = 'best';
            bestAudio.textContent = 'Best Audio (VBR)';
            qualitySelectRef.appendChild(bestAudio);

            if (currentVideoInfo && currentVideoInfo.audioQualities) {
                currentVideoInfo.audioQualities.forEach(kbps => {
                    const opt = document.createElement('option');
                    opt.value = kbps;
                    opt.textContent = `${kbps} kbps`;
                    qualitySelectRef.appendChild(opt);
                });
            }
        }
    }

    function addLog(message) {
        if (!message) return;
        const entry = document.createElement('div');
        entry.textContent = message;
        logOutputRef.appendChild(entry);
        logOutputRef.scrollTop = logOutputRef.scrollHeight;
    }

    function startDownload() {
        const url = urlInput.value.trim();
        const type = formatSelectRef.value;
        const quality = type === 'mp4' ? qualitySelectRef.value : 'best';

        if (!url) return;

        // Reset and display progress UI
        progressContainer.classList.remove('hidden');
        progressBarFillRef.style.width = '0%';
        progressPercentRef.textContent = '0%';
        progressStatusRef.textContent = 'Initializing...';
        progressStatusRef.style.color = 'var(--text-primary)';
        logOutputRef.innerHTML = '';
        
        btnDownload.disabled = true;
        btnDownload.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Downloading...';

        if (eventSource) {
            eventSource.close();
        }

        const qs = new URLSearchParams({ url, type, quality }).toString();
        eventSource = new EventSource(`/api/download?${qs}`);
        
        addLog(`Started download task for ${url}`);

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                if (data.log) {
                    addLog(data.log);
                }

                if (data.progress !== undefined && !data.done) {
                    progressBarFillRef.style.width = `${data.progress}%`;
                    progressPercentRef.textContent = `${data.progress}%`;
                    
                    if (data.progress === 100) {
                        progressStatusRef.textContent = 'Finalizing...';
                    } else if (data.progress > 0) {
                        progressStatusRef.textContent = 'Downloading...';
                    }
                }

                if (data.done) {
                    progressStatusRef.textContent = 'Completed!';
                    progressStatusRef.style.color = '#34d399'; // Emerald
                    progressBarFillRef.style.width = '100%';
                    progressPercentRef.textContent = '100%';
                    btnDownload.disabled = false;
                    btnDownload.innerHTML = '<i class="fa-solid fa-download"></i> Download Another';
                    eventSource.close();
                }

                if (data.error) {
                    progressStatusRef.textContent = 'Error occurred!';
                    progressStatusRef.style.color = '#f87171'; // Red
                    btnDownload.disabled = false;
                    btnDownload.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Retry Download';
                    eventSource.close();
                }

            } catch (err) {
                console.error("SSE parse error", err);
            }
        };

        eventSource.onerror = (err) => {
            console.error('EventSource failed:', err);
            progressStatusRef.textContent = 'Connection Lost';
            progressStatusRef.style.color = '#f87171';
            btnDownload.disabled = false;
            btnDownload.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Retry Download';
            eventSource.close();
        };
    }
});
