# Audio Downloader - YouTube & SoundCloud to MP3

A powerful audio downloader with real-time progress tracking. Downloads from YouTube and SoundCloud with CBR 320kbps MP3 output optimized for DJ equipment.

## Features

- 🎵 **CBR 320kbps MP3** - Constant bitrate for DJ equipment compatibility
- 🎬 **YouTube Support** - Using yt-dlp for reliable downloads
- 🎧 **SoundCloud Support** - Direct track downloads
- 📊 **Real-time Progress** - Live progress bar with speed and ETA
- 🌙 **Dark Minimalist UI** - Clean, modern interface
- 🏷️ **ID3 Metadata** - Proper tags from video/track info
- 🛡️ **Smart Error Handling** - User-friendly error messages
- 💾 **Auto-download** - Files save to browser's Downloads folder
- 🖥️ **Cross-platform** - Windows, macOS, Linux support

## Requirements

### System Requirements

- **Node.js**: Version 18 or higher
- **yt-dlp**: Required for both YouTube and SoundCloud downloads
- **FFmpeg**: Automatically used by yt-dlp for audio conversion

### Installing yt-dlp

yt-dlp is a powerful downloader that supports both YouTube and SoundCloud (and 1000+ other sites).

#### Windows

**Using winget (recommended):**
```bash
winget install yt-dlp
```

**Using Chocolatey:**
```bash
choco install yt-dlp
```

**Manual Installation:**
1. Download `yt-dlp.exe` from [github.com/yt-dlp/yt-dlp/releases](https://github.com/yt-dlp/yt-dlp/releases)
2. Place it in a folder like `C:\yt-dlp\`
3. Add that folder to your system PATH

#### macOS

**Using Homebrew (recommended):**
```bash
brew install yt-dlp
```

**Using pip:**
```bash
pip install yt-dlp
```

#### Linux

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install yt-dlp
```

**Using pip:**
```bash
pip install yt-dlp
```

**Arch Linux:**
```bash
sudo pacman -S yt-dlp
```

### Installing FFmpeg (Optional)

FFmpeg is used by yt-dlp for audio conversion. While yt-dlp can use a bundled version, installing FFmpeg system-wide provides better performance.

**Windows:**
```bash
winget install ffmpeg
# or
choco install ffmpeg
```

**macOS:**
```bash
brew install ffmpeg
```

**Linux:**
```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# Fedora
sudo dnf install ffmpeg

# Arch
sudo pacman -S ffmpeg
```

## Installation

1. **Clone or download this repository**

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Verify installations:**
   ```bash
   yt-dlp --version
   ffmpeg -version
   ```

## Usage

1. **Start the server:**
   ```bash
   npm start
   ```

2. **Open your browser:**
   - Navigate to `http://localhost:3000`

3. **Download audio:**
   - Paste a YouTube or SoundCloud URL
   - Click "Download"
   - Watch real-time progress with speed and ETA
   - File automatically downloads when complete

### Supported URLs

- **YouTube**: `https://www.youtube.com/watch?v=...` or `https://youtu.be/...`
- **SoundCloud**: `https://soundcloud.com/artist/track`

### Output Format

- **Format**: MP3
- **Bitrate**: CBR 320kbps (constant bitrate)
- **Metadata**: ID3v2.3 tags with title and artist
- **Compatibility**: Optimized for DJ equipment (no VBR)

## Configuration

You can modify the server port in `server.js`:

```javascript
const PORT = process.env.PORT || 3000;           // Server port
```

Or set it via environment variable:
```bash
PORT=8080 npm start
```

## Project Structure

```
YoutubeConverter/
├── public/
│   └── index.html          # Frontend UI
├── server.js               # Express backend
├── package.json            # Dependencies and scripts
├── .gitignore             # Git ignore rules
└── README.md              # This file
```

## Troubleshooting

### "yt-dlp not found" or "FFmpeg not found" error

**Solution:**
- Ensure both yt-dlp and FFmpeg are installed (see installation instructions above)
- Verify they're in your system PATH:
  ```bash
  yt-dlp --version
  ffmpeg -version
  ```
- On Windows, restart your terminal/command prompt after adding to PATH

### "This video is age-restricted and cannot be downloaded"

**Cause:** YouTube restricts access to age-restricted videos via third-party tools.

**Solution:** This is a YouTube limitation and cannot be bypassed.

### "This video is private or unavailable"

**Cause:** The video/track is set to private, deleted, or region-locked.

**Solution:** Ensure the content is publicly accessible in your region.

### "This content is not available in your region"

**Cause:** The content is geo-blocked in your location.

**Solution:** This is a platform restriction and cannot be bypassed.

### "Network error. Please check your internet connection"

**Cause:** Network connectivity issues or YouTube is blocking requests.

**Solutions:**
- Check your internet connection
- Wait a few minutes and try again
- YouTube may be temporarily blocking requests


### Downloads fail consistently

**Solutions:**
1. Update dependencies: `npm update`
2. Clear npm cache: `npm cache clean --force`
3. Reinstall dependencies: `rm -rf node_modules && npm install`
4. Check server logs for specific error messages

### Port 3000 already in use

**Solution:**
- Change the port in `server.js` or set environment variable:
  ```bash
  PORT=8080 npm start
  ```

## Logging

The server logs all activities with timestamps:

- **INFO**: Normal operations (download requests, progress, yt-dlp output)
- **WARN**: Warnings (invalid URLs, FFmpeg not detected)
- **ERROR**: Errors (download failures, conversion issues)
- **SUCCESS**: Successful operations (server start, completed downloads)

Example log output:
```
[2025-10-16T22:43:00.000Z] [SUCCESS] Server running on http://localhost:3000
[2025-10-16T22:43:00.001Z] [INFO] Supports: YouTube & SoundCloud
[2025-10-16T22:43:00.002Z] [INFO] Output: CBR 320kbps MP3
[2025-10-16T22:43:15.200Z] [INFO] Download request [youtube]: https://www.youtube.com/watch?v=...
[2025-10-16T22:43:16.300Z] [INFO] yt-dlp: [download] 45.2% of 8.5MiB at 2.1MiB/s ETA 00:02
[2025-10-16T22:43:30.500Z] [SUCCESS] Download completed in 15.30s [youtube]
[2025-10-16T22:43:30.600Z] [INFO] Temp file deleted
```

## Technical Details

### Unified Download System (yt-dlp)

Both YouTube and SoundCloud use the same yt-dlp-based system:

- **Process**: Spawns yt-dlp as child process via `yt-dlp-exec`
- **Audio Extraction**: `format: 'bestaudio'` for highest quality source
- **Conversion**: FFmpeg postprocessor with precise settings:
  - Sample rate: 44100 Hz (`-ar 44100`)
  - Channels: Stereo (`-ac 2`)
  - Bitrate: CBR 320kbps (`-b:a 320k`)
  - VBR disabled: `-write_xing 0` (critical for DJ equipment)
- **Metadata**: `--add-metadata` embeds ID3v2.3 tags
- **Progress**: Real-time parsing from yt-dlp stdout
- **Platform Detection**: Regex-based URL matching

### Progress Updates (Server-Sent Events)

- SSE connection established before download starts
- Backend sends progress updates in real-time
- Frontend updates progress bar smoothly
- Shows: status, percentage, speed, ETA
- Auto-closes connection on completion or error

## API Endpoints

### POST /download

Initiates a download and returns a session ID.

**Request:**
```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID"
}
```

**Response:**
```json
{
  "sessionId": "1729123456789",
  "platform": "youtube"
}
```

### GET /progress/:sessionId

Server-Sent Events endpoint for real-time progress updates.

**Response Stream:**
```
data: {"status":"fetching","percent":0,"message":"Fetching info..."}
data: {"status":"downloading","percent":45,"message":"Downloading...","speed":"2.1MiB/s","eta":"00:02"}
data: {"status":"converting","percent":95,"message":"Converting to MP3..."}
data: {"status":"complete","percent":100,"message":"Complete!"}
```

**Error Response:**
```
data: {"status":"error","percent":0,"message":"Video unavailable or private","error":"..."}
```

### GET /file/:sessionId

Downloads the converted MP3 file.

**Response:**
- Success: MP3 file download
- Error: 404 if file not found or expired

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "uptime": 123.456
}
```

## Security Notes

- This tool is for personal use only
- Respect copyright and YouTube's Terms of Service
- Only download content you have permission to download
- The server runs locally and does not store any files

## License

MIT

## Disclaimer

This tool is for educational purposes only. Users are responsible for complying with YouTube's Terms of Service and copyright laws. The developers are not responsible for any misuse of this software.
