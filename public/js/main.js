import * as THREE from 'three';
import { ArenaMap } from './map.js';
import { LocalPlayer } from './player.js';
import { NetworkManager } from './network.js';
import { UIManager } from './ui.js';

class GameApp {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ui = new UIManager();

    this.initRenderer();
    this.initScene();
    this.initCamera();

    // Build the 3D Arena
    this.map = new ArenaMap(this.scene);
    this.map.build();

    // Initialize Network and Local Player
    this.network = new NetworkManager(this.scene, this.camera, this.ui);
    this.player = new LocalPlayer(this.camera, this.scene, document.body, this.map, this.network, this.ui);
    this.network.setLocalPlayer(this.player);

    this.lastTime = performance.now();
    this.isPlaying = false;

    this.setupEvents();
    this.animate();
  }

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
  }

  initScene() {
    this.scene = new THREE.Scene();
  }

  initCamera() {
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camera.position.set(0, 1.7, 30);
    this.scene.add(this.camera);
  }

  setupEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Lobby Play Button Trigger
    this.ui.onPlayClicked(({ username, weaponClass }) => {
      this.isPlaying = true;
      this.player.equipWeapon(weaponClass);

      // Connect to multiplayer backend
      this.network.connect(username, weaponClass, () => {
        // Lock pointer to enter first-person view
        this.player.controls.lock();
      });
    });

    // Re-lock pointer on click if game is active and not chatting
    this.canvas.addEventListener('click', () => {
      if (this.isPlaying && this.player.isAlive && !this.player.controls.isLocked) {
        const chatInput = document.getElementById('chat-input');
        if (document.activeElement !== chatInput) {
          this.player.controls.lock();
        }
      }
    });

    // Chat handling
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
      window.addEventListener('keydown', (e) => {
        if (!this.isPlaying) return;

        if (e.code === 'Enter') {
          if (document.activeElement === chatInput) {
            const text = chatInput.value.trim();
            if (text && this.network.socket) {
              this.network.socket.emit('chatMessage', text);
            }
            chatInput.value = '';
            chatInput.blur();
            if (this.player.isAlive) {
              this.player.controls.lock();
            }
          } else {
            this.player.controls.unlock();
            chatInput.focus();
          }
        } else if (e.code === 'Escape' && document.activeElement === chatInput) {
          chatInput.blur();
          if (this.player.isAlive) {
            this.player.controls.lock();
          }
        }
      });
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const now = performance.now();
    // Cap delta at 0.1s to avoid physics explosions during tab switches
    const delta = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    if (this.isPlaying) {
      this.player.update(delta);
      this.network.update(delta);
    }

    this.renderer.render(this.scene, this.camera);
  }
}

// Start game when page loads
window.addEventListener('DOMContentLoaded', () => {
  window.gameApp = new GameApp();
});
