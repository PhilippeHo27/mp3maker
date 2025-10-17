// Main downloader functionality

// DOM elements
const urlInput = document.getElementById('url');
const convertBtn = document.getElementById('download');
const downloadReadyBtn = document.getElementById('downloadReady');
const status = document.getElementById('status');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const statusText = document.getElementById('statusText');
const progressPercent = document.getElementById('progressPercent');
const progressSpeed = document.getElementById('progressSpeed');
const progressEta = document.getElementById('progressEta');
const thumbnailContainer = document.getElementById('thumbnailContainer');
const thumbnailImage = document.getElementById('thumbnailImage');
const thumbnailTitle = document.getElementById('thumbnailTitle');

let eventSource = null;
let currentSessionId = null;

// Detect BASE_PATH from current URL (e.g., /mp3maker in production, empty in dev)
window.BASE_PATH = window.BASE_PATH || window.location.pathname.split('/').slice(0, -1).join('/') || '';
const BASE_PATH = window.BASE_PATH;

// Convert button click handler
convertBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  
  if (!url) {
    showStatus('Please enter a YouTube, SoundCloud or Bandcamp URL', 'error');
    return;
  }

  // Reset UI
  convertBtn.disabled = true;
  downloadReadyBtn.style.display = 'none';
  hideStatus();
  hideThumbnail();
  showProgress();
  resetProgress();
  currentSessionId = null;

  try {
    // Start download
    const response = await fetch(`${BASE_PATH}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Download failed');
    }

    const { sessionId, platform } = await response.json();
    
    // Update status with loading animation
    updateStatus('Starting conversion...', 0, null, null, true);

    // Connect to SSE for progress updates
    connectToProgress(sessionId);

  } catch (error) {
    hideProgress();
    showStatus(error.message, 'error');
    convertBtn.disabled = false;
  }
});

// Connect to progress SSE stream
function connectToProgress(sessionId) {
  // Close existing connection
  if (eventSource) {
    eventSource.close();
  }

  // Create new SSE connection
  eventSource = new EventSource(`${BASE_PATH}/progress/${sessionId}`);

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    if (data.status === 'error' || data.error) {
      // Error occurred
      hideProgress();
      showStatus(data.message || data.error, 'error');
      convertBtn.disabled = false;
      eventSource.close();
    } else if (data.status === 'complete') {
      // Download complete - show download button
      updateStatus(data.message || 'Ready to download!', 100);
      currentSessionId = sessionId;
      
      // Fetch and display thumbnail
      fetchThumbnail(sessionId);
      
      // Show download button
      setTimeout(() => {
        hideProgress();
        downloadReadyBtn.style.display = 'block';
        convertBtn.disabled = false;
      }, 500);
      
      eventSource.close();
    } else {
      // Update progress - handle both 'progress' and 'percent' keys
      const percent = data.percent !== undefined ? data.percent : data.progress || 0;
      const message = data.message || data.status || 'Processing...';
      const isFetching = data.status === 'fetching';
      updateStatus(message, percent, data.speed, data.eta, isFetching);
    }
  };

  eventSource.onerror = (error) => {
    console.error('SSE error:', error);
    eventSource.close();
  };
}

// Download ready button click handler
downloadReadyBtn.addEventListener('click', () => {
  if (!currentSessionId) return;
  
  // Create download link
  const link = document.createElement('a');
  link.href = `/file/${currentSessionId}`;
  link.download = 'audio.mp3';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  // Hide button, thumbnail and show success
  downloadReadyBtn.style.display = 'none';
  hideThumbnail();
  showStatus('Downloaded! Check your Downloads folder', 'success');
  
  // Reset after a few seconds
  setTimeout(() => {
    hideStatus();
    currentSessionId = null;
  }, 3000);
});

// Update progress display
function updateStatus(statusMsg, progress, speed = null, eta = null, isFetching = false) {
  statusText.textContent = statusMsg;
  
  // Add loading animation class during fetch
  if (isFetching) {
    statusText.classList.add('loading');
    progressBar.classList.add('fetching');
  } else {
    statusText.classList.remove('loading');
    progressBar.classList.remove('fetching');
    progressBar.style.width = `${progress}%`;
  }
  
  progressPercent.textContent = `${Math.round(progress)}%`;
  
  if (speed) {
    progressSpeed.textContent = `⚡ ${speed}`;
  } else {
    progressSpeed.textContent = '';
  }
  
  if (eta) {
    progressEta.textContent = `⏱ ${eta}`;
  } else {
    progressEta.textContent = '';
  }

  // Update status text color
  if (progress === 100) {
    statusText.className = 'status-text success';
  } else {
    statusText.className = 'status-text';
  }
}

// Reset progress to initial state
function resetProgress() {
  updateStatus('Starting...', 0, null, null, true);
  statusText.className = 'status-text';
}

// UI helper functions
function showProgress() {
  progressContainer.classList.add('active');
}

function hideProgress() {
  progressContainer.classList.remove('active');
}

function showStatus(message, type) {
  status.textContent = message;
  status.className = `status ${type} active`;
}

function hideStatus() {
  status.className = 'status';
}

function showThumbnail() {
  thumbnailContainer.classList.add('active');
}

function hideThumbnail() {
  thumbnailContainer.classList.remove('active');
}

// Fetch and display thumbnail
async function fetchThumbnail(sessionId) {
  try {
    const response = await fetch(`${BASE_PATH}/thumbnail/${sessionId}`);
    if (response.ok) {
      const data = await response.json();
      thumbnailImage.src = data.thumbnailUrl;
      thumbnailImage.onerror = () => {
        // Fallback to oops.jpg if thumbnail fails to load
        thumbnailImage.src = '/oops.jpg';
      };
      showThumbnail();
    }
  } catch (error) {
    console.error('Failed to fetch thumbnail:', error);
    // Use fallback image
    thumbnailImage.src = '/oops.jpg';
    showThumbnail();
  }
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  if (eventSource) {
    eventSource.close();
  }
});
