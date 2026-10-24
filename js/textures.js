import * as THREE from 'three';

// Procedural Canvas Texture Generator for crisp, zero-latency textures
export class TextureGenerator {
  static createFloorTexture() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Base dark slate background
    ctx.fillStyle = '#12141a';
    ctx.fillRect(0, 0, size, size);

    // Grid panels
    const tileSize = 64;
    for (let x = 0; x < size; x += tileSize) {
      for (let y = 0; y < size; y += tileSize) {
        // Subtle tile variation
        const shade = Math.floor(22 + (Math.random() * 8));
        ctx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 6})`;
        ctx.fillRect(x + 2, y + 2, tileSize - 4, tileSize - 4);

        // Tile inner bevel
        ctx.strokeStyle = '#1e222d';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 4, y + 4, tileSize - 8, tileSize - 8);

        // Corner dots
        ctx.fillStyle = '#2d3748';
        ctx.fillRect(x + 5, y + 5, 2, 2);
        ctx.fillRect(x + tileSize - 7, y + 5, 2, 2);
      }
    }

    // High-tech subtle grid lines
    ctx.strokeStyle = '#1a202c';
    ctx.lineWidth = 2;
    for (let i = 0; i <= size; i += tileSize) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, size);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(size, i);
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(16, 16);
    return texture;
  }

  static createWallTexture() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Base concrete/metal gray
    ctx.fillStyle = '#1e2029';
    ctx.fillRect(0, 0, size, size);

    // Large metal panel dividers
    ctx.fillStyle = '#161820';
    ctx.fillRect(0, 0, size, 16);
    ctx.fillRect(0, size - 16, size, 16);
    ctx.fillRect(0, size / 2 - 8, size, 16);

    // Horizontal seam stripes
    ctx.strokeStyle = '#0e1015';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, size, size);
    ctx.strokeRect(0, size / 2, size, size / 2);

    // Panel plates
    ctx.fillStyle = '#252834';
    ctx.fillRect(20, 30, size - 40, size / 2 - 50);
    ctx.fillRect(20, size / 2 + 30, size - 40, size / 2 - 50);

    // Rivets
    ctx.fillStyle = '#4a5568';
    for (let x = 30; x < size; x += 60) {
      ctx.beginPath();
      ctx.arc(x, 22, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, size / 2 - 12, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, size / 2 + 22, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, size - 22, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Subtle neon cyan tech indicator on walls
    ctx.fillStyle = 'rgba(0, 240, 255, 0.6)';
    ctx.fillRect(40, size / 2 - 4, 80, 8);
    ctx.fillStyle = 'rgba(0, 240, 255, 0.9)';
    ctx.fillRect(45, size / 2 - 2, 70, 4);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 2);
    return texture;
  }

  static createCrateTexture(theme = 'military') {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Base background
    ctx.fillStyle = theme === 'orange' ? '#9a4c14' : (theme === 'metal' ? '#2d3748' : '#334155');
    ctx.fillRect(0, 0, size, size);

    // Outer border frame
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, size, 16);
    ctx.fillRect(0, size - 16, size, 16);
    ctx.fillRect(0, 0, 16, size);
    ctx.fillRect(size - 16, 0, 16, size);

    // Cross braces (X brace)
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(16, 16);
    ctx.lineTo(size - 16, size - 16);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(size - 16, 16);
    ctx.lineTo(16, size - 16);
    ctx.stroke();

    // Corner metal brackets
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 36, 36);
    ctx.fillRect(size - 36, 0, 36, 36);
    ctx.fillRect(0, size - 36, 36, 36);
    ctx.fillRect(size - 36, size - 36, 36, 36);

    // Corner bolts
    ctx.fillStyle = '#94a3b8';
    [
      [14, 14], [size - 14, 14],
      [14, size - 14], [size - 14, size - 14],
      [26, 14], [14, 26],
      [size - 26, 14], [size - 14, 26],
      [26, size - 14], [14, size - 26],
      [size - 26, size - 14], [size - 14, size - 26]
    ].forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // Stencil text / symbol
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CRATE-09', size / 2, size / 2 + 7);

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  }

  static createRampTexture() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Diamond plate metal base
    ctx.fillStyle = '#222630';
    ctx.fillRect(0, 0, size, size);

    // Tread ridges
    ctx.strokeStyle = '#383e4d';
    ctx.lineWidth = 4;
    for (let y = 10; y < size; y += 20) {
      ctx.beginPath();
      ctx.moveTo(10, y);
      ctx.lineTo(size - 10, y);
      ctx.stroke();
    }

    // Caution border stripes on sides
    const stripeWidth = 14;
    ctx.save();
    for (let y = -20; y < size + 20; y += 24) {
      ctx.fillStyle = '#f59e0b'; // Yellow hazard
      ctx.fillRect(0, y, stripeWidth, 12);
      ctx.fillRect(size - stripeWidth, y, stripeWidth, 12);
      ctx.fillStyle = '#111827'; // Black
      ctx.fillRect(0, y + 12, stripeWidth, 12);
      ctx.fillRect(size - stripeWidth, y + 12, stripeWidth, 12);
    }
    ctx.restore();

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 4);
    return texture;
  }
}
