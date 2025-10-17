// Admin panel functionality

// DOM elements
const adminBtn = document.getElementById('adminBtn');
const adminModal = document.getElementById('adminModal');
const closeModal = document.getElementById('closeModal');
const refreshHealth = document.getElementById('refreshHealth');
const healthDisplay = document.getElementById('healthDisplay');
const cookieTextarea = document.getElementById('cookieTextarea');
const updateCookiesBtn = document.getElementById('updateCookiesBtn');
const modalStatus = document.getElementById('modalStatus');
const logsContainer = document.getElementById('logsContainer');
const clearLogsBtn = document.getElementById('clearLogs');

let logEventSource = null;

// Detect BASE_PATH from current URL
const BASE_PATH = window.location.pathname.split('/').slice(0, -1).join('/') || '';

// Keyboard shortcut: Ctrl+Shift+A to open admin panel
document.addEventListener('keydown', (event) => {
  // Ctrl+Shift+A opens admin panel
  if (event.ctrlKey && event.shiftKey && event.key === 'A') {
    event.preventDefault();
    adminModal.classList.toggle('active');
    if (adminModal.classList.contains('active')) {
      loadHealthStatus();
      connectToLogs();
    } else {
      disconnectFromLogs();
    }
  }
  
  // Escape closes admin panel
  if (event.key === 'Escape' && adminModal.classList.contains('active')) {
    event.preventDefault();
    adminModal.classList.remove('active');
    disconnectFromLogs();
  }
});

// Open admin modal (for button if needed)
adminBtn.addEventListener('click', () => {
  adminModal.classList.add('active');
  loadHealthStatus();
  connectToLogs();
});

// Close modal
closeModal.addEventListener('click', () => {
  adminModal.classList.remove('active');
  disconnectFromLogs();
});

// Close modal when clicking outside
adminModal.addEventListener('click', (e) => {
  if (e.target === adminModal) {
    adminModal.classList.remove('active');
    disconnectFromLogs();
  }
});

// Refresh health status
refreshHealth.addEventListener('click', () => {
  loadHealthStatus();
});

// Load health status
async function loadHealthStatus() {
  healthDisplay.innerHTML = '<div class="health-item">Loading...</div>';
  
  try {
    const response = await fetch(`${BASE_PATH}/admin/health`);
    if (!response.ok) throw new Error('Failed to load health status');
    
    const data = await response.json();
    
    let html = '';
    
    // Cookies status
    if (data.cookies.exists) {
      const age = data.cookies.ageInDays;
      const icon = age < 30 ? '✅' : age < 60 ? '⚠️' : '❌';
      html += `<div class="health-item"><span class="health-icon">${icon}</span> Cookies: Present (${age} days old)</div>`;
    } else {
      html += '<div class="health-item"><span class="health-icon">❌</span> Cookies: Not found</div>';
    }
    
    // yt-dlp version
    html += `<div class="health-item"><span class="health-icon">✅</span> yt-dlp: ${data.ytdlp.version}</div>`;
    
    // Server uptime
    const uptimeHours = Math.floor(data.server.uptimeSeconds / 3600);
    const uptimeDays = Math.floor(uptimeHours / 24);
    const remainingHours = uptimeHours % 24;
    const uptimeStr = uptimeDays > 0 
      ? `${uptimeDays} days, ${remainingHours} hours`
      : `${uptimeHours} hours`;
    html += `<div class="health-item"><span class="health-icon">✅</span> Server uptime: ${uptimeStr}</div>`;
    
    healthDisplay.innerHTML = html;
  } catch (error) {
    healthDisplay.innerHTML = `<div class="health-item"><span class="health-icon">❌</span> Error: ${error.message}</div>`;
  }
}

// Update cookies
updateCookiesBtn.addEventListener('click', async () => {
  const cookieContent = cookieTextarea.value.trim();
  
  if (!cookieContent) {
    showModalStatus('Please paste cookie content', 'error');
    return;
  }
  
  updateCookiesBtn.disabled = true;
  updateCookiesBtn.textContent = 'Updating...';
  
  try {
    const response = await fetch(`${BASE_PATH}/admin/update-cookies`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: cookieContent
    });
    
    const result = await response.json();
    
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Failed to update cookies');
    }
    
    showModalStatus('✅ Cookies updated successfully!', 'success');
    cookieTextarea.value = '';
    
    // Refresh health status
    setTimeout(() => loadHealthStatus(), 500);
    
  } catch (error) {
    showModalStatus(`❌ Error: ${error.message}`, 'error');
  } finally {
    updateCookiesBtn.disabled = false;
    updateCookiesBtn.textContent = 'Update Cookies';
  }
});

// Show modal status message
function showModalStatus(message, type) {
  modalStatus.textContent = message;
  modalStatus.className = `modal-status ${type} active`;
  
  setTimeout(() => {
    modalStatus.classList.remove('active');
  }, 5000);
}

// ===== LOG VIEWER FUNCTIONALITY =====

// Connect to log stream
function connectToLogs() {
  if (logEventSource) return; // Already connected
  
  logsContainer.innerHTML = '<div class="log-line">Connecting to log stream...</div>';
  
  logEventSource = new EventSource(`${BASE_PATH}/admin/logs`);
  
  logEventSource.onmessage = (event) => {
    const log = JSON.parse(event.data);
    addLogLine(log);
  };
  
  logEventSource.onerror = () => {
    if (logsContainer.children.length === 0) {
      logsContainer.innerHTML = '<div class="log-line ERROR">Connection failed</div>';
    }
  };
}

// Disconnect from log stream
function disconnectFromLogs() {
  if (logEventSource) {
    logEventSource.close();
    logEventSource = null;
  }
}

// Add a log line to the display
function addLogLine(log) {
  // Clear "connecting" message on first real log
  if (logsContainer.children.length === 1 && 
      logsContainer.children[0].textContent.includes('Connecting')) {
    logsContainer.innerHTML = '';
  }
  
  const logLine = document.createElement('div');
  logLine.className = `log-line ${log.level}`;
  logLine.textContent = log.full;
  
  logsContainer.appendChild(logLine);
  
  // Auto-scroll to bottom
  logsContainer.scrollTop = logsContainer.scrollHeight;
  
  // Limit to 500 lines in UI
  while (logsContainer.children.length > 500) {
    logsContainer.removeChild(logsContainer.firstChild);
  }
}

// Clear logs display
clearLogsBtn.addEventListener('click', () => {
  logsContainer.innerHTML = '<div class="log-line">Logs cleared (new logs will appear below)</div>';
});
