# MP3 Maker Setup Guide

## Project Structure
- **Port**: Changed from 3000 to **3003**
- **Temp Files**: Now stored in `public/temp/` folder
- **Static Files**: Served from `public/` folder
- **Fallback Image**: `oops.jpg` located in `public/` folder

## Features
- **YouTube, SoundCloud & Bandcamp** audio download (320kbps MP3)
- Real-time progress updates via Server-Sent Events (SSE)
- **Thumbnail extraction and embedding** into MP3 files (YouTube)
- Thumbnail display in web UI after conversion
- Fallback image (`oops.jpg`) when thumbnail unavailable
- **Bandcamp**: Works with free/name-your-price tracks at full quality (often FLAC source)

## Requirements
- **Node.js** >= 18
- **yt-dlp** (for downloading)
- **ffmpeg** (required for embedding thumbnails into MP3 files)

## CI/CD Deployment

### GitHub Repository
- **Repo URL**: https://github.com/PhilippeHo27/mp3maker.git
- **Workflow File**: `.github/workflows/deploy.yml`

### Required GitHub Secrets
Set these in your GitHub repository settings (Settings → Secrets and variables → Actions):
1. `SERVER_HOST` - Your Ubuntu server IP/hostname
2. `SERVER_USER` - SSH username for your server
3. `SSH_PRIVATE_KEY` - Your SSH private key for authentication

### Server Setup
On your Ubuntu server, you'll need to:

1. Create the project directory:
```bash
mkdir -p ~/projects/mp3maker
cd ~/projects/mp3maker
```

2. Clone the repository (first time):
```bash
git clone git@github.com:PhilippeHo27/mp3maker.git .
```

3. Install dependencies:
```bash
npm install
```

4. Install yt-dlp and ffmpeg (required for thumbnail embedding):
```bash
sudo apt update
sudo apt install yt-dlp ffmpeg
```

5. Start with PM2:
```bash
pm2 start server.js --name mp3maker
pm2 save
pm2 startup  # Follow the instructions to enable PM2 on boot
```

### Deployment Process
- Push to `main` branch triggers automatic deployment
- The workflow will:
  1. Pull latest code
  2. Install dependencies
  3. Restart PM2 process

## Local Development

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Access at: http://localhost:3003

## API Endpoints

- `POST /download` - Start audio download
- `GET /progress/:sessionId` - SSE endpoint for progress updates
- `GET /file/:sessionId` - Download the converted MP3 file
- `GET /thumbnail/:sessionId` - Get thumbnail URL for the video
- `GET /health` - Health check endpoint

## Thumbnail Feature
- Automatically extracts YouTube video thumbnails
- Displays thumbnail after conversion completes
- Falls back to `oops.jpg` if thumbnail unavailable or fails to load
- Works for YouTube (SoundCloud thumbnails not implemented yet)
