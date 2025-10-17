// Star Rain Background Animation
(function() {
  const canvas = document.createElement('canvas');
  canvas.id = 'background-canvas';
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.zIndex = '0';
  canvas.style.cursor = 'pointer';
  document.body.insertBefore(canvas, document.body.firstChild);

  const ctx = canvas.getContext('2d');
  let w = canvas.width = window.innerWidth;
  let h = canvas.height = window.innerHeight;
  
  let tick = 0;
  let chars = [];
  let raindrops = [];
  let activeColumns = new Set();
  let rainbowHue = 0;
  
  // Color palette system - muted/desaturated colors
  const colorPalettes = [
    { hue: 0, sat: 28, light: 55, name: 'Red' },      // ~#a76c6c
    { hue: 280, sat: 25, light: 58, name: 'Purple' }, // Muted purple
    { hue: 200, sat: 30, light: 60, name: 'Cyan' },   // Muted cyan
    { hue: 75, sat: 30, light: 58, name: 'Green' },   // ~#a0ae6b avocado
    { hue: 30, sat: 32, light: 60, name: 'Orange' },  // Muted orange
    { hue: 180, sat: 28, light: 58, name: 'Teal' }    // Muted teal
  ];
  
  let currentPaletteIndex = 0;
  let targetPaletteIndex = 0;
  let colorLerpProgress = 1; // 0 to 1, 1 means fully transitioned
  const lerpSpeed = 0.02; // How fast to transition
  
  // Dynamic background fade system
  let targetBackgroundFade = 0.05;
  let currentBackgroundFade = 0.05;
  
  // Ripple effect system
  let ripples = []; // Array of active ripples

  // Fixed parameters (no controls)
  // Font size is now the base unit - everything scales from this
  const CHAR_SIZE = 14; // Smaller font size (was 18)
  
  const config = {
    charSize: CHAR_SIZE,
    activeStars: 8,
    trailLength: 10,
    // Speeds are now relative to char size for consistent visual speed
    slowSpeed: CHAR_SIZE * 0.11,
    normalSpeed: CHAR_SIZE * 0.33,
    fastSpeed: CHAR_SIZE * 0.44,
    columnSpacing: 4,
    fadeSpeed: 0.02,
    baseOpacity: 0.1,
    glowIntensity: 0.5,
    backgroundFade: 0.05, // Will be updated dynamically
    spawnChance: 0.1,
    slowChance: 0.2,
    normalChance: 0.4,
    // Base color for palette (will be updated dynamically)
    baseHue: 0,
    baseSaturation: 60,
    baseLightness: 50,
    hueRange: 30, // Only vary hue by ±30 degrees
    backgroundColor: '#0a0a0a',
    rainbowMode: true,
    rainbowSpeed: 0.03
  };

  ctx.font = config.charSize + 'px monospace';

  function hslToRgb(h, s, l) {
    s /= 100;
    l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return {
      r: Math.round(255 * f(0)),
      g: Math.round(255 * f(8)),
      b: Math.round(255 * f(4))
    };
  }

  // Linear interpolation helper
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  
  // Calculate appropriate background fade based on color intensity
  // Brighter/more saturated colors need MORE fade to prevent trail burn
  function calculateBackgroundFade(sat, light) {
    // Normalize saturation and lightness to 0-1 range
    const s = sat / 100;
    const l = light / 100;
    
    // Color intensity: higher sat + mid-range lightness = more intense
    // Peak intensity around L=0.5-0.6
    const lightnessMultiplier = 1 - Math.abs(l - 0.55) * 2;
    const intensity = s * lightnessMultiplier;
    
    // Map intensity to fade range
    // Low intensity (~0) -> 0.05 fade
    // High intensity (~1) -> 0.5 fade
    const minFade = 0.05;
    const maxFade = 0.5;
    return minFade + (intensity * (maxFade - minFade));
  }
  
  // Get current palette color with lerping
  function getCurrentPalette() {
    if (colorLerpProgress >= 1) {
      return colorPalettes[currentPaletteIndex];
    }
    
    // Lerp between current and target palette
    const current = colorPalettes[currentPaletteIndex];
    const target = colorPalettes[targetPaletteIndex];
    
    // Handle hue wrapping (shortest path around color wheel)
    let hueDiff = target.hue - current.hue;
    if (hueDiff > 180) hueDiff -= 360;
    if (hueDiff < -180) hueDiff += 360;
    
    return {
      hue: (current.hue + hueDiff * colorLerpProgress) % 360,
      sat: lerp(current.sat, target.sat, colorLerpProgress),
      light: lerp(current.light, target.light, colorLerpProgress)
    };
  }
  
  // Get color within the palette range
  function getPaletteColor(hueOffset) {
    const palette = getCurrentPalette();
    const hue = (palette.hue + hueOffset) % 360;
    return hslToRgb(hue, palette.sat, palette.light);
  }

  function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }

  function getCurrentColor() {
    if (config.rainbowMode) {
      // Map rainbow hue to constrained palette range
      const paletteHue = (rainbowHue / 360) * config.hueRange * 2 - config.hueRange;
      return getPaletteColor(paletteHue);
    } else {
      return getPaletteColor(0);
    }
  }

  // Multi-wave ripple effect - like a rock hitting water
  function Ripple(x, y) {
    this.x = x;
    this.y = y;
    this.time = 0; // Time since ripple started
    this.maxTime = 120; // How long ripple lasts (frames)
    this.speed = 10; // Pixels per frame expansion (was 8)
    this.waveCount = 3; // Number of waves following each other (was 5)
    this.waveSpacing = 100; // Distance between waves
    this.waveThickness = 35; // Thickness of each wave
  }
  
  Ripple.prototype.update = function() {
    this.time++;
    const maxRadius = Math.sqrt(w * w + h * h);
    const currentRadius = this.time * this.speed;
    return currentRadius < maxRadius + (this.waveCount * this.waveSpacing);
  };
  
  Ripple.prototype.affectsChar = function(char) {
    const dx = char.x - this.x;
    const dy = char.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    // Current expanding radius
    const expandingRadius = this.time * this.speed;
    
    let totalIntensity = 0;
    
    // Create multiple waves following each other
    for (let i = 0; i < this.waveCount; i++) {
      const waveRadius = expandingRadius - (i * this.waveSpacing);
      
      // Skip if this wave hasn't started yet
      if (waveRadius < 0) continue;
      
      // Check if character is within this wave ring
      const distFromWave = Math.abs(dist - waveRadius);
      
      if (distFromWave < this.waveThickness) {
        // Calculate intensity based on position within wave
        const waveProgress = distFromWave / this.waveThickness;
        // Bell curve: peaks in middle of wave
        const waveIntensity = Math.sin((1 - waveProgress) * Math.PI);
        
        // Each subsequent wave is weaker
        const waveDamping = 1 - (i / this.waveCount) * 0.6;
        
        // Distance damping
        const maxDist = Math.sqrt(w * w + h * h);
        const distanceDamping = Math.max(0, 1 - (dist / maxDist));
        
        totalIntensity = Math.max(totalIntensity, waveIntensity * waveDamping * distanceDamping);
      }
    }
    
    return totalIntensity * config.glowIntensity;
  };

  function Char(x, y) {
    this.x = x;
    this.y = y;
    this.char = Math.random() < 0.5 ? '0' : '1';
    this.baseOpacity = config.baseOpacity;
    this.glowOpacity = 0;
    this.rippleGlow = 0; // Glow from ripple effects
  }

  Char.prototype.step = function() {
    if (this.glowOpacity > 0) {
      this.glowOpacity -= config.fadeSpeed;
    }
    
    // Decay ripple glow
    if (this.rippleGlow > 0) {
      this.rippleGlow -= 0.05;
    }
    
    // Combine glow effects
    let totalGlow = Math.max(this.glowOpacity, this.rippleGlow);
    let opacity = this.baseOpacity + totalGlow;
    let brightness = totalGlow > 0 ? 1 : 0.3;
    let rgb = getCurrentColor();
    
    ctx.fillStyle = `rgba(${rgb.r * brightness}, ${rgb.g * brightness}, ${rgb.b * brightness}, ${opacity})`;
    ctx.fillText(this.char, this.x, this.y);
  };

  Char.prototype.glow = function() {
    this.glowOpacity = config.glowIntensity;
  };

  function Raindrop() {
    this.reset();
  }

  Raindrop.prototype.reset = function() {
    let attempts = 0;
    do {
      this.column = Math.floor(Math.random() * (w / config.charSize)) * config.charSize;
      attempts++;
    } while (isColumnTooClose(this.column) && attempts < 50);
    
    activeColumns.add(this.column);
    this.y = -20;
    
    let speedType = Math.random();
    if (speedType < config.slowChance) {
      this.speed = config.slowSpeed;
    } else if (speedType < config.slowChance + config.normalChance) {
      this.speed = config.normalSpeed;
    } else {
      this.speed = config.fastSpeed;
    }
  };

  Raindrop.prototype.step = function() {
    this.y += this.speed;
    
    chars.forEach(char => {
      if (Math.abs(char.x - this.column) < config.charSize / 2) {
        let dy = Math.abs(char.y - this.y);
        if (dy < config.trailLength) {
          char.glow();
        }
      }
    });
    
    if (this.y > h + 50) {
      activeColumns.delete(this.column);
      this.reset();
    }
  };

  function isColumnTooClose(newColumn) {
    for (let col of activeColumns) {
      if (Math.abs(col - newColumn) < config.charSize * config.columnSpacing) {
        return true;
      }
    }
    return false;
  }

  function createGrid() {
    chars = [];
    for (let x = 0; x < w; x += config.charSize) {
      for (let y = 0; y < h; y += config.charSize) {
        chars.push(new Char(x, y));
      }
    }
  }

  function animate() {
    window.requestAnimationFrame(animate);
    
    ++tick;
    
    // Update color lerp progress
    if (colorLerpProgress < 1) {
      colorLerpProgress = Math.min(1, colorLerpProgress + lerpSpeed);
      
      // When transition completes, update current palette
      if (colorLerpProgress >= 1) {
        currentPaletteIndex = targetPaletteIndex;
      }
    }
    
    // Update background fade based on current palette
    const palette = getCurrentPalette();
    targetBackgroundFade = calculateBackgroundFade(palette.sat, palette.light);
    currentBackgroundFade = targetBackgroundFade;
    
    // Update ripples
    ripples = ripples.filter(ripple => {
      const stillAlive = ripple.update();
      
      if (stillAlive) {
        // Apply ripple effect to characters
        chars.forEach(char => {
          const intensity = ripple.affectsChar(char);
          if (intensity > 0) {
            char.rippleGlow = Math.max(char.rippleGlow, intensity * config.glowIntensity);
          }
        });
      }
      
      return stillAlive;
    });
    
    // Update rainbow hue slowly (10x slower)
    if (config.rainbowMode) {
      rainbowHue = (rainbowHue + config.rainbowSpeed) % 360;
    }
    
    let bgRgb = hexToRgb(config.backgroundColor);
    ctx.fillStyle = `rgba(${bgRgb.r}, ${bgRgb.g}, ${bgRgb.b}, ${currentBackgroundFade})`;
    ctx.fillRect(0, 0, w, h);
    
    if (raindrops.length < config.activeStars && Math.random() < config.spawnChance) {
      raindrops.push(new Raindrop());
    }
    
    chars.forEach(char => char.step());
    raindrops.forEach(drop => drop.step());
  }

  // Initialize
  ctx.fillStyle = config.backgroundColor;
  ctx.fillRect(0, 0, w, h);
  createGrid();
  animate();

  // Handle window resize
  window.addEventListener('resize', function() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    ctx.font = config.charSize + 'px monospace';
    createGrid();
    raindrops = [];
    activeColumns.clear();
  });
  
  // Click anywhere to cycle through color palettes and create ripple
  canvas.addEventListener('click', function(event) {
    // Get click position
    const rect = canvas.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;
    
    // Create ripple at click position
    ripples.push(new Ripple(clickX, clickY));
    
    // Change color palette
    targetPaletteIndex = (targetPaletteIndex + 1) % colorPalettes.length;
    colorLerpProgress = 0; // Start color lerping
    
    console.log(`💧 Ripple at (${Math.round(clickX)}, ${Math.round(clickY)}) | Transitioning to ${colorPalettes[targetPaletteIndex].name} palette...`);
  });
})();
