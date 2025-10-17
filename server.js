const express = require('express');
const ytDlp = require('yt-dlp-exec');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// Use system yt-dlp if available (more up-to-date than bundled version)
process.env.YTDL_PATH = process.env.YTDL_PATH || 'yt-dlp';

const app = express();

// Configuration
const PORT = process.env.PORT || 3003;
const BASE_PATH = process.env.BASE_PATH || ''; // Empty for local, '/mp3maker' for production
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || BASE_PATH !== '';

// Store active download sessions
const activeSessions = new Map();

// Store log history (keep last 500 lines)
const logHistory = [];
const MAX_LOG_HISTORY = 500;
const logClients = new Set();

// Middleware
app.use(express.json());
app.use(express.text({ limit: '1mb' })); // For cookie file uploads
app.use(BASE_PATH, express.static('public'));

// Logging utility
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${level}] ${message}`;
  console.log(logLine);
  
  // Store in history
  logHistory.push({ timestamp, level, message, full: logLine });
  if (logHistory.length > MAX_LOG_HISTORY) {
    logHistory.shift(); // Remove oldest
  }
  
  // Broadcast to all log viewers
  const data = JSON.stringify({ timestamp, level, message, full: logLine });
  logClients.forEach(client => {
    try {
      client.write(`data: ${data}\n\n`);
    } catch (err) {
      logClients.delete(client);
    }
  });
}

// Detect platform from URL using regex
function detectPlatform(url) {
  if (/(?:youtube\.com|youtu\.be)/.test(url)) return 'youtube';
  if (/soundcloud\.com/.test(url)) return 'soundcloud';
  if (/bandcamp\.com/.test(url)) return 'bandcamp';
  return 'unknown';
}

// Enhanced error messages based on yt-dlp output
function getErrorMessage(error, exitCode = null) {
  const errorMsg = error.message.toLowerCase();
  
  // Exit code based errors
  if (exitCode === 1) {
    return 'Video unavailable or private';
  }
  
  // Content-based error detection
  if (errorMsg.includes('geo') || errorMsg.includes('not available in your')) {
    return 'Video not available in your region';
  }
  if (errorMsg.includes('copyright')) {
    return 'Copyright restriction';
  }
  if (errorMsg.includes('age') || errorMsg.includes('restricted')) {
    return 'This video is age-restricted and cannot be downloaded';
  }
  if (errorMsg.includes('private') || errorMsg.includes('unavailable')) {
    return 'This video is private or unavailable';
  }
  if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
    return 'Download timeout - video may be too long';
  }
  if (errorMsg.includes('network') || errorMsg.includes('enotfound')) {
    return 'Network error. Please check your internet connection';
  }
  
  return error.message || 'An unknown error occurred';
}

// Sanitize filename to remove invalid characters
function sanitizeFilename(filename) {
  return filename.replace(/[^\w\s-]/gi, '').trim().substring(0, 100);
}

// Send SSE progress update
function sendProgress(sessionId, data) {
  const session = activeSessions.get(sessionId);
  if (session && session.res) {
    session.res.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

// Wait for SSE connection to be established
function waitForSSEConnection(sessionId, maxWaitMs = 5000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      const session = activeSessions.get(sessionId);
      if (session && session.res) {
        clearInterval(checkInterval);
        resolve(true);
      } else if (Date.now() - startTime > maxWaitMs) {
        clearInterval(checkInterval);
        log(`SSE connection timeout for session: ${sessionId}`, 'WARN');
        resolve(false);
      }
    }, 50);
  });
}

// Unified download function using yt-dlp for both YouTube and SoundCloud
async function downloadAudio(url, sessionId, platform) {
  // Use a simple filename without extension - yt-dlp will add .mp3
  const tempFileBase = path.join(__dirname, 'public', 'temp', `temp-${sessionId}`);
  const tempFile = `${tempFileBase}.mp3`;
  let videoTitle = 'audio';
  let thumbnailUrl = null;
  
  sendProgress(sessionId, { 
    status: 'fetching', 
    percent: 0,
    message: '🔍 Connecting to YouTube...'
  });
  
  return new Promise(async (resolve, reject) => {
    let exitCode = null;
    
    // First, get the video title
    let countdownInterval;
    try {
      log(`Starting info fetch for: ${url}`, 'INFO');
      sendProgress(sessionId, { 
        status: 'fetching', 
        percent: 2,
        message: '📡 Fetching video info...'
      });
      
      // Add countdown timer for info fetch
      let countdown = 30;
      countdownInterval = setInterval(() => {
        countdown--;
        if (countdown > 0) {
          sendProgress(sessionId, { 
            status: 'fetching', 
            percent: 2 + ((30 - countdown) / 30 * 3),
            message: `📡 Fetching video info... (${countdown}s)`
          });
        }
      }, 1000);
      
      // Check for cookies file (only in production)
      const cookiePath = path.join(__dirname, 'cookies.txt');
      const hasCookies = IS_PRODUCTION && fs.existsSync(cookiePath);
      
      // Strategy: 
      // - Local: No special options (fastest, works perfectly)
      // - Production with cookies: Use web client with cookies (bypasses bot detection)
      // - Production without cookies: Use iOS/Android (bypasses SABR)
      const infoClientStrategy = IS_PRODUCTION && platform === 'youtube' && !hasCookies
        ? 'youtube:player_client=ios,android'
        : undefined;
      
      if (hasCookies) {
        log('Using cookies.txt for info fetch (production)', 'INFO');
      } else if (infoClientStrategy) {
        log('Using iOS/Android client for info fetch (production, no cookies)', 'INFO');
      } else if (!IS_PRODUCTION) {
        log('Using default yt-dlp (local)', 'INFO');
      }
      
      const titleOutput = await Promise.race([
        ytDlp(url, {
          dumpSingleJson: true,
          noWarnings: true,
          noCheckCertificate: true,
          ...(infoClientStrategy && { extractorArgs: infoClientStrategy }),
          ...(hasCookies && { cookies: cookiePath })
          // Local: raw yt-dlp | Production: iOS/Android or web+cookies
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Info fetch timeout after 30s')), 30000)
        )
      ]);
      
      if (countdownInterval) clearInterval(countdownInterval);
      
      if (titleOutput && titleOutput.title) {
        videoTitle = sanitizeFilename(titleOutput.title);
        log(`Video title: ${videoTitle}`);
        
        // Extract thumbnail URL (YouTube provides multiple, get the best quality)
        if (titleOutput.thumbnail) {
          thumbnailUrl = titleOutput.thumbnail;
          log(`Thumbnail URL: ${thumbnailUrl}`);
        } else if (titleOutput.thumbnails && titleOutput.thumbnails.length > 0) {
          // Get the highest quality thumbnail
          const bestThumbnail = titleOutput.thumbnails[titleOutput.thumbnails.length - 1];
          thumbnailUrl = bestThumbnail.url;
          log(`Thumbnail URL: ${thumbnailUrl}`);
        }
        
        sendProgress(sessionId, { 
          status: 'fetching', 
          percent: 5,
          message: `✨ Found: ${videoTitle.substring(0, 40)}${videoTitle.length > 40 ? '...' : ''}`
        });
      }
      log(`Info fetch completed successfully`, 'INFO');
    } catch (err) {
      if (countdownInterval) clearInterval(countdownInterval);
      log(`Could not fetch title: ${err.message}`, 'WARN');
      // Continue without title if fetch fails
    }
    
    sendProgress(sessionId, { 
      status: 'fetching', 
      percent: 8,
      message: '🎵 Preparing download...'
    });
    
    // Check for cookies file (only in production)
    const cookiePath = path.join(__dirname, 'cookies.txt');
    const hasCookies = IS_PRODUCTION && fs.existsSync(cookiePath);
    
    // Strategy: 
    // - Local: No special options (fastest, works perfectly)
    // - Production with cookies: Use web client with cookies (bypasses bot detection)
    // - Production without cookies: Use iOS/Android (bypasses SABR)
    const clientStrategy = IS_PRODUCTION && platform === 'youtube' && !hasCookies
      ? 'youtube:player_client=ios,android'
      : undefined;
    
    if (hasCookies) {
      log('Using cookies.txt for authentication (production)', 'INFO');
    } else if (clientStrategy) {
      log('Using iOS/Android client (production, no cookies)', 'INFO');
    } else if (!IS_PRODUCTION) {
      log('Using default yt-dlp (local)', 'INFO');
    }
    
    const ytDlpProcess = ytDlp.exec(url, {
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: '320k',
      format: 'bestaudio/best',
      addMetadata: true,
      embedThumbnail: true,
      output: tempFileBase,
      noPlaylist: true,
      ...(clientStrategy && { extractorArgs: clientStrategy }),
      ...(hasCookies && { cookies: cookiePath })
      // Local: raw yt-dlp | Production: iOS/Android or web+cookies
    });
    
    // Store process and temp file base in session for cleanup on disconnect
    const session = activeSessions.get(sessionId);
    if (session) {
      session.ytDlpProcess = ytDlpProcess;
      session.tempFileBase = tempFileBase;
    }

    ytDlpProcess.stdout.on('data', (data) => {
      const output = data.toString();
      log(`yt-dlp: ${output.trim()}`);
      
      // Show progress for various yt-dlp stages
      if (output.includes('Extracting URL')) {
        sendProgress(sessionId, {
          status: 'fetching',
          percent: 10,
          message: '🔗 Extracting URL...'
        });
      } else if (output.includes('Downloading webpage')) {
        sendProgress(sessionId, {
          status: 'fetching',
          percent: 15,
          message: '📄 Loading webpage...'
        });
      } else if (output.includes('Downloading tv client config')) {
        sendProgress(sessionId, {
          status: 'fetching',
          percent: 20,
          message: '⚙️ Loading config...'
        });
      } else if (output.includes('Downloading tv player API JSON') || output.includes('Downloading web safari player API JSON')) {
        sendProgress(sessionId, {
          status: 'fetching',
          percent: 25,
          message: '🎬 Loading player API...'
        });
      } else if (output.includes('Downloading m3u8 information')) {
        sendProgress(sessionId, {
          status: 'fetching',
          percent: 30,
          message: '📊 Analyzing streams...'
        });
      } else if (output.includes('Downloading 1 format')) {
        sendProgress(sessionId, {
          status: 'fetching',
          percent: 35,
          message: '✅ Format selected!'
        });
      }
      
      // Handle sleep countdown with live updates
      const sleepMatch = output.match(/Sleeping\s+(\d+\.?\d*)\s+seconds/);
      if (sleepMatch) {
        const sleepSeconds = parseFloat(sleepMatch[1]);
        let countdown = Math.ceil(sleepSeconds);
        
        // Send initial countdown message
        sendProgress(sessionId, {
          status: 'fetching',
          percent: 10,
          message: `⏳ Rate limit: ${countdown}s...`
        });
        
        // Update countdown every second
        const countdownInterval = setInterval(() => {
          countdown--;
          if (countdown > 0) {
            sendProgress(sessionId, {
              status: 'fetching',
              percent: 10 + ((sleepSeconds - countdown) / sleepSeconds) * 5,
              message: `⏳ Rate limit: ${countdown}s...`
            });
          } else {
            clearInterval(countdownInterval);
          }
        }, 1000);
      }
      
      // Parse progress from yt-dlp output
      const progressMatch = output.match(/(\d+\.?\d*)%/);
      const speedMatch = output.match(/(\d+\.?\d*[KMG]iB\/s)/);
      const etaMatch = output.match(/ETA\s+(\d+:\d+)/);
      
      if (progressMatch) {
        const percent = parseFloat(progressMatch[1]);
        
        // Determine status based on output content
        let status = 'downloading';
        let message = 'Downloading...';
        
        if (output.includes('[download]')) {
          status = 'downloading';
          message = 'Downloading...';
        } else if (output.includes('Extracting audio')) {
          status = 'converting';
          message = 'Converting to MP3...';
        } else if (output.includes('Deleting') || output.includes('has already been downloaded')) {
          status = 'converting';
          message = 'Converting to MP3...';
        }
        
        sendProgress(sessionId, {
          status,
          percent: Math.min(percent, 99),
          message,
          speed: speedMatch ? speedMatch[1] : null,
          eta: etaMatch ? etaMatch[1] : null
        });
      } else if (output.includes('Extracting audio') || output.includes('[ExtractAudio]')) {
        sendProgress(sessionId, {
          status: 'converting',
          percent: 95,
          message: 'Converting to MP3...'
        });
      }
    });

    ytDlpProcess.stderr.on('data', (data) => {
      const output = data.toString();
      log(`yt-dlp stderr: ${output.trim()}`, 'WARN');
    });

    ytDlpProcess.on('close', (code) => {
      exitCode = code;
      if (code === 0) {
        sendProgress(sessionId, { 
          status: 'complete', 
          percent: 100,
          message: 'Complete!'
        });
        // Store video title and thumbnail for filename
        const session = activeSessions.get(sessionId);
        if (session) {
          session.videoTitle = videoTitle;
          session.thumbnailUrl = thumbnailUrl;
        }
        resolve(tempFile);
      } else {
        reject(new Error(`yt-dlp process failed with exit code ${code}`));
      }
    });

    ytDlpProcess.on('error', (err) => {
      reject(err);
    });
  });
}

// SSE endpoint for progress updates
app.get(`${BASE_PATH}/progress/:sessionId`, (req, res) => {
  const { sessionId } = req.params;
  
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Store response object for this session
  if (!activeSessions.has(sessionId)) {
    activeSessions.set(sessionId, {});
  }
  activeSessions.get(sessionId).res = res;
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ status: 'fetching', percent: 0, message: 'Preparing...' })}\n\n`);
  
  // Clean up on client disconnect
  req.on('close', () => {
    const session = activeSessions.get(sessionId);
    if (session) {
      // Kill yt-dlp process if still running
      if (session.ytDlpProcess) {
        try {
          session.ytDlpProcess.kill('SIGTERM');
          log(`Killed yt-dlp process for disconnected session: ${sessionId}`, 'WARN');
        } catch (err) {
          log(`Error killing process: ${err.message}`, 'ERROR');
        }
      }
      
      // Clean up temp file if exists and download not completed
      if (session.tempFileBase && !session.tempFile) {
        const possibleFiles = [
          session.tempFileBase,
          `${session.tempFileBase}.mp3`,
          `${session.tempFileBase}.webp`,
          `${session.tempFileBase}.png`
        ];
        
        possibleFiles.forEach(file => {
          if (fs.existsSync(file)) {
            try {
              fs.unlinkSync(file);
              log(`Cleaned up orphaned file: ${path.basename(file)}`, 'INFO');
            } catch (err) {
              log(`Error cleaning file: ${err.message}`, 'ERROR');
            }
          }
        });
      }
      
      delete session.res;
      delete session.ytDlpProcess;
    }
    log(`SSE connection closed for session: ${sessionId}`);
  });
});

// Download endpoint
app.post(`${BASE_PATH}/download`, async (req, res) => {
  const startTime = Date.now();
  const sessionId = Date.now().toString();
  let tempFile = null;
  let exitCode = null;
  
  try {
    const { url } = req.body;
    
    if (!url) {
      log(`Invalid URL attempted: ${url}`, 'WARN');
      return res.status(400).json({ error: 'Please provide a valid URL' });
    }

    const platform = detectPlatform(url);
    
    if (platform === 'unknown') {
      return res.status(400).json({ error: 'Unsupported URL. Please use YouTube, SoundCloud or Bandcamp links.' });
    }

    log(`Download request [${platform}]: ${url}`);
    
    // Return session ID immediately
    res.json({ sessionId, platform });
    
    // Store session
    if (!activeSessions.has(sessionId)) {
      activeSessions.set(sessionId, {});
    }
    activeSessions.get(sessionId).url = url;
    activeSessions.get(sessionId).platform = platform;
    
    // Wait for SSE connection to be established before starting download
    await waitForSSEConnection(sessionId);
    
    // Download using unified yt-dlp function
    tempFile = await downloadAudio(url, sessionId, platform);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log(`Download completed in ${duration}s [${platform}]`, 'SUCCESS');
    
    // Store file path for retrieval
    activeSessions.get(sessionId).tempFile = tempFile;
    
  } catch (error) {
    log(`Error: ${error.message}`, 'ERROR');
    
    // Extract exit code from error message if available
    const exitCodeMatch = error.message.match(/exit code (\d+)/);
    if (exitCodeMatch) {
      exitCode = parseInt(exitCodeMatch[1]);
    }
    
    // Clean up temp file on error
    if (tempFile && fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    
    // Send error via SSE
    sendProgress(sessionId, { 
      status: 'error', 
      percent: 0, 
      message: getErrorMessage(error, exitCode),
      error: getErrorMessage(error, exitCode)
    });
  }
});

// File retrieval endpoint
app.get(`${BASE_PATH}/file/:sessionId`, (req, res) => {
  const { sessionId } = req.params;
  const session = activeSessions.get(sessionId);
  
  if (!session || !session.tempFile) {
    return res.status(404).json({ error: 'File not found or expired' });
  }
  
  const tempFile = session.tempFile;
  
  if (!fs.existsSync(tempFile)) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  // Get video title for filename
  const videoTitle = session.videoTitle || 'audio';
  const filename = `${videoTitle}.mp3`;
  
  // Send file to client
  res.download(tempFile, filename, (err) => {
    // Delete temp file after sending
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
      log('Temp file deleted');
    }
    
    // Clean up session
    activeSessions.delete(sessionId);
    
    if (err) {
      log(`Download error: ${err.message}`, 'ERROR');
    }
  });
});

// Thumbnail endpoint
app.get(`${BASE_PATH}/thumbnail/:sessionId`, (req, res) => {
  const { sessionId } = req.params;
  const session = activeSessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  // Return thumbnail URL or fallback
  const thumbnailUrl = session.thumbnailUrl || '/oops.jpg';
  res.json({ thumbnailUrl });
});

// Health check endpoint
app.get(`${BASE_PATH}/health`, (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Admin: Health check endpoint
// TODO: Add authentication in production
app.get(`${BASE_PATH}/admin/health`, async (req, res) => {
  try {
    const cookiePath = path.join(__dirname, 'cookies.txt');
    const exists = fs.existsSync(cookiePath);
    let ageInDays = null;
    
    if (exists) {
      const stats = fs.statSync(cookiePath);
      const ageMs = Date.now() - stats.mtimeMs;
      ageInDays = Math.round(ageMs / (1000 * 60 * 60 * 24));
    }
    
    let ytdlpVersion = 'unknown';
    try {
      ytdlpVersion = execSync('yt-dlp --version', { encoding: 'utf8' }).trim();
    } catch (err) {
      log(`Could not get yt-dlp version: ${err.message}`, 'WARN');
    }
    
    res.json({
      cookies: {
        exists,
        ageInDays
      },
      ytdlp: {
        version: ytdlpVersion
      },
      server: {
        uptimeSeconds: Math.round(process.uptime())
      }
    });
  } catch (error) {
    log(`Admin health check error: ${error.message}`, 'ERROR');
    res.status(500).json({ error: 'Failed to get health status' });
  }
});

// Admin: Update cookies endpoint
// TODO: Add authentication in production
app.post(`${BASE_PATH}/admin/update-cookies`, (req, res) => {
  try {
    const cookiePath = path.join(__dirname, 'cookies.txt');
    const cookieContent = typeof req.body === 'string' ? req.body : JSON.parse(req.body).cookieText;
    
    if (!cookieContent || cookieContent.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Cookie content is empty' });
    }
    
    // Write cookie file with restricted permissions
    fs.writeFileSync(cookiePath, cookieContent, { mode: 0o600 });
    log('Cookies updated via admin panel', 'SUCCESS');
    
    res.json({ 
      success: true, 
      message: 'Cookies updated successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    log(`Failed to update cookies: ${error.message}`, 'ERROR');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin: Real-time logs endpoint (SSE)
// TODO: Add authentication in production
app.get(`${BASE_PATH}/admin/logs`, (req, res) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send log history first
  logHistory.forEach(entry => {
    const data = JSON.stringify(entry);
    res.write(`data: ${data}\n\n`);
  });
  
  // Add client to set for future logs
  logClients.add(res);
  log(`Admin log viewer connected (${logClients.size} active)`, 'INFO');
  
  // Clean up on disconnect
  req.on('close', () => {
    logClients.delete(res);
    log(`Admin log viewer disconnected (${logClients.size} active)`, 'INFO');
  });
});

// Clean up orphaned temp files on startup
function cleanupTempFiles() {
  const tempDir = path.join(__dirname, 'public', 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
    return;
  }
  const files = fs.readdirSync(tempDir);
  let cleaned = 0;
  files.forEach(file => {
    if (file.startsWith('temp-') && (file.endsWith('.mp3') || file.match(/^temp-\d+$/))) {
      try {
        fs.unlinkSync(path.join(tempDir, file));
        cleaned++;
      } catch (err) {
        // Ignore errors
      }
    }
  });
  if (cleaned > 0) {
    log(`Cleaned up ${cleaned} orphaned temp file(s)`, 'INFO');
  }
}

// Start server
cleanupTempFiles();
app.listen(PORT, () => {
  log(`Server running on http://localhost:${PORT}`, 'SUCCESS');
  log(`Supports: YouTube, SoundCloud & Bandcamp`, 'INFO');
  log(`Output: CBR 320kbps MP3`, 'INFO');
  log(`Press Ctrl+C to stop the server`);
});
