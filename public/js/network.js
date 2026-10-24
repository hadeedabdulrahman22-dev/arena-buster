import * as THREE from 'three';
import { WeaponModelBuilder } from './weapons.js';
import { audio } from './audio.js';

export class NetworkManager {
  constructor(scene, camera, uiManager) {
    this.scene = scene;
    this.camera = camera;
    this.ui = uiManager;
    this.socket = null;
    this.selfId = null;
    this.localPlayerRef = null;

    // Map of remote players: id -> RemotePlayerInstance
    this.remotePlayers = new Map();

    // Hitbox meshes lookup for raycaster
    this.enemyHitboxes = [];

    // Throttled network packet sender
    this.lastSent = 0;
    this.sendRateMs = 33; // ~30Hz
  }

  setLocalPlayer(localPlayer) {
    this.localPlayerRef = localPlayer;
  }

  connect(username, weaponClass, onConnected) {
    // Connect to Socket.io server
    this.socket = window.io();

    this.socket.on('connect', () => {
      console.log('[Network] Connected to server! Socket ID:', this.socket.id);
      this.socket.emit('join', { username, weaponClass });
    });

    this.socket.on('init', (data) => {
      this.selfId = data.selfId;
      console.log('[Network] Initialized self ID:', this.selfId);

      // Spawn initial position
      if (this.localPlayerRef && data.player && data.player.position) {
        this.localPlayerRef.respawn(data.player.position, data.player.health);
      }

      // Add existing players in room
      data.players.forEach(p => {
        if (p.id !== this.selfId) {
          this.addRemotePlayer(p);
        }
      });

      if (onConnected) onConnected(data);
    });

    this.socket.on('playerJoined', (playerData) => {
      if (playerData.id !== this.selfId) {
        this.addRemotePlayer(playerData);
        this.ui.addKillFeedMessage(`${playerData.username} joined the arena`, 'system');
      }
    });

    this.socket.on('playerLeft', (id) => {
      this.removeRemotePlayer(id);
    });

    // High frequency snapshot update
    this.socket.on('gameState', (data) => {
      if (!data.players) return;
      data.players.forEach(p => {
        if (p.id === this.selfId) {
          // Update scoreboard data for self
          this.ui.updateScoreboardEntry(p);
          return;
        }

        const remote = this.remotePlayers.get(p.id);
        if (remote) {
          remote.targetPosition.set(p.position.x, p.position.y, p.position.z);
          remote.targetRotation.yaw = p.rotation ? p.rotation.yaw : 0;
          remote.targetRotation.pitch = p.rotation ? p.rotation.pitch : 0;
          remote.isSprinting = p.isSprinting;
          remote.isSliding = p.isSliding;
          remote.isAlive = p.isAlive;
          remote.updateHealth(p.health, 100);

          if (p.weaponClass !== remote.weaponClass) {
            remote.changeWeapon(p.weaponClass);
          }
        } else {
          this.addRemotePlayer(p);
        }

        this.ui.updateScoreboardEntry(p);
      });
    });

    // Remote player shot visual & audio
    this.socket.on('remotePlayerShot', (data) => {
      const remote = this.remotePlayers.get(data.id);
      const origin = new THREE.Vector3(data.origin.x, data.origin.y, data.origin.z);
      const hitPoint = new THREE.Vector3(data.hitPoint.x, data.hitPoint.y, data.hitPoint.z);

      if (remote) {
        remote.triggerMuzzleFlash();
      }

      // Distance to camera for audio attenuation
      const dist = this.camera.position.distanceTo(origin);
      audio.playGunshot(data.weaponClass, true, dist);

      // Render tracer line
      this.spawnTracer(origin, hitPoint);
    });

    // Authoritative hit confirmations
    this.socket.on('damageDealt', (data) => {
      // Audio feedback
      audio.playHitmarker(data.isHeadshot);

      // UI Hitmarker & floating combat text
      this.ui.showHitmarker(data.isHeadshot);
      if (data.hitPoint) {
        this.ui.spawnFloatingDamage(data.hitPoint, data.damage, data.isHeadshot, this.camera);
      }
    });

    this.socket.on('damageTaken', (data) => {
      audio.playDamageTaken();
      this.ui.triggerDamageFlash();
      if (this.localPlayerRef) {
        this.localPlayerRef.health = data.remainingHealth;
        this.ui.updateHealth(data.remainingHealth, 100, false);
      }
    });

    this.socket.on('healthUpdate', (data) => {
      if (data.playerId === this.selfId) {
        if (this.localPlayerRef) {
          this.localPlayerRef.health = data.health;
          this.ui.updateHealth(data.health, data.maxHealth, data.isRegenerating);
        }
      } else {
        const remote = this.remotePlayers.get(data.playerId);
        if (remote) {
          remote.updateHealth(data.health, data.maxHealth);
        }
      }
    });

    this.socket.on('playerKilled', (data) => {
      this.ui.addKillFeedKill(data.killerName, data.victimName, data.weaponClass, data.isHeadshot);

      if (data.killerId === this.selfId) {
        audio.playKillConfirmed();
        this.ui.showKillBanner(data.victimName, data.isHeadshot);
      }

      if (data.victimId === this.selfId) {
        audio.playElimination();
      } else {
        const remote = this.remotePlayers.get(data.victimId);
        if (remote) {
          remote.onEliminated();
        }
      }
    });

    this.socket.on('eliminated', (data) => {
      if (this.localPlayerRef) {
        this.localPlayerRef.isAlive = false;
        this.localPlayerRef.isADS = false;
        this.ui.setAds(false, false);
      }
      this.ui.showEliminationScreen(data.killerName, data.isHeadshot, data.respawnTimeMs);
    });

    this.socket.on('respawn', (data) => {
      if (this.localPlayerRef) {
        this.localPlayerRef.respawn(data.position, data.health);
      }
    });

    this.socket.on('playerRespawned', (data) => {
      if (data.id !== this.selfId) {
        const remote = this.remotePlayers.get(data.id);
        if (remote) {
          remote.onRespawn(data.position);
        }
      }
    });

    this.socket.on('playerWeaponChanged', (data) => {
      const remote = this.remotePlayers.get(data.id);
      if (remote) {
        remote.changeWeapon(data.weaponClass);
      }
    });

    this.socket.on('chatMessage', (msg) => {
      this.ui.addChatMessage(msg.sender, msg.color, msg.text);
    });
  }

  sendPlayerState(state) {
    if (!this.socket || !this.socket.connected) return;

    const now = performance.now();
    if (now - this.lastSent < this.sendRateMs) return;
    this.lastSent = now;

    this.socket.emit('playerMove', state);
  }

  addRemotePlayer(data) {
    if (this.remotePlayers.has(data.id)) return;
    const remote = new RemotePlayer(data, this.scene);
    this.remotePlayers.set(data.id, remote);
    this.rebuildHitboxCache();
  }

  removeRemotePlayer(id) {
    const remote = this.remotePlayers.get(id);
    if (remote) {
      remote.destroy();
      this.remotePlayers.delete(id);
      this.rebuildHitboxCache();
      this.ui.removeScoreboardEntry(id);
    }
  }

  rebuildHitboxCache() {
    this.enemyHitboxes = [];
    for (const [id, remote] of this.remotePlayers.entries()) {
      if (remote.isAlive) {
        this.enemyHitboxes.push(remote.headHitbox);
        this.enemyHitboxes.push(remote.bodyHitbox);
      }
    }
  }

  getEnemyHitboxes() {
    return this.enemyHitboxes;
  }

  spawnTracer(start, end) {
    const distance = start.distanceTo(end);
    const geom = new THREE.CylinderGeometry(0.015, 0.015, distance, 6);
    geom.translate(0, distance / 2, 0);
    geom.rotateX(Math.PI / 2);

    const mat = new THREE.MeshBasicMaterial({
      color: 0xff6644,
      transparent: true,
      opacity: 0.95
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(start);
    mesh.lookAt(end);
    this.scene.add(mesh);

    setTimeout(() => {
      this.scene.remove(mesh);
      geom.dispose();
      mat.dispose();
    }, 80);
  }

  update(delta) {
    for (const remote of this.remotePlayers.values()) {
      remote.update(delta);
    }
  }
}

// Representation of another connected player in 3D
class RemotePlayer {
  constructor(data, scene) {
    this.id = data.id;
    this.username = data.username || 'Operative';
    this.color = data.color || '#00f0ff';
    this.weaponClass = data.weaponClass || 'assault';
    this.scene = scene;
    this.isAlive = data.isAlive !== false;

    this.currentPosition = new THREE.Vector3(data.position?.x || 0, data.position?.y || 0, data.position?.z || 0);
    this.targetPosition = new THREE.Vector3().copy(this.currentPosition);
    this.currentYaw = 0;
    this.targetRotation = { yaw: 0, pitch: 0 };
    this.isSprinting = false;
    this.isSliding = false;
    this.runCycle = 0;

    // Main 3D Container
    this.root = new THREE.Group();
    this.root.position.copy(this.currentPosition);
    this.scene.add(this.root);

    this.buildMesh();
    this.buildNameplate();
    this.updateHealth(data.health || 100, 100);
  }

  buildMesh() {
    const playerColorHex = parseInt(this.color.replace('#', '0x'), 16);
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.6,
      roughness: 0.3
    });
    const teamMat = new THREE.MeshStandardMaterial({
      color: playerColorHex,
      metalness: 0.4,
      roughness: 0.3
    });
    const visorMat = new THREE.MeshBasicMaterial({
      color: playerColorHex
    });

    // 1. Torso / Body (Hitbox: body)
    const torsoGeo = new THREE.BoxGeometry(0.7, 0.9, 0.4);
    this.bodyMesh = new THREE.Mesh(torsoGeo, teamMat);
    this.bodyMesh.position.y = 1.05;
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.bodyMesh.userData = {
      isHitbox: true,
      hitboxType: 'body',
      playerId: this.id
    };
    this.root.add(this.bodyMesh);
    this.bodyHitbox = this.bodyMesh;

    // Tactical Chest Vest Plate
    const vestGeo = new THREE.BoxGeometry(0.6, 0.5, 0.45);
    const vest = new THREE.Mesh(vestGeo, armorMat);
    vest.position.set(0, 0.05, 0);
    this.bodyMesh.add(vest);

    // 2. Head & Helmet (Hitbox: head)
    const headGeo = new THREE.SphereGeometry(0.24, 16, 16);
    this.headMesh = new THREE.Mesh(headGeo, armorMat);
    this.headMesh.position.y = 1.72;
    this.headMesh.castShadow = true;
    this.headMesh.userData = {
      isHitbox: true,
      hitboxType: 'head',
      playerId: this.id
    };
    this.root.add(this.headMesh);
    this.headHitbox = this.headMesh;

    // Glowing Visor on Helmet
    const visorGeo = new THREE.BoxGeometry(0.28, 0.1, 0.12);
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 0.02, -0.19);
    this.headMesh.add(visor);

    // 3. Arms & Hands holding weapon
    const armGeo = new THREE.BoxGeometry(0.16, 0.65, 0.16);
    this.leftArm = new THREE.Mesh(armGeo, armorMat);
    this.leftArm.position.set(-0.45, 1.0, -0.1);
    this.leftArm.rotation.x = -0.5;
    this.root.add(this.leftArm);

    this.rightArm = new THREE.Mesh(armGeo, armorMat);
    this.rightArm.position.set(0.45, 1.0, -0.1);
    this.rightArm.rotation.x = -0.5;
    this.root.add(this.rightArm);

    // Weapon mesh held in hands
    this.weaponHolder = new THREE.Group();
    this.weaponHolder.position.set(0.3, 0.95, -0.3);
    this.root.add(this.weaponHolder);
    this.equipThirdPersonWeapon(this.weaponClass);

    // 4. Legs (Animated for walking / running)
    const legGeo = new THREE.BoxGeometry(0.22, 0.7, 0.22);
    this.leftLeg = new THREE.Mesh(legGeo, armorMat);
    this.leftLeg.position.set(-0.2, 0.35, 0);
    this.leftLeg.castShadow = true;
    this.root.add(this.leftLeg);

    this.rightLeg = new THREE.Mesh(legGeo, armorMat);
    this.rightLeg.position.set(0.2, 0.35, 0);
    this.rightLeg.castShadow = true;
    this.root.add(this.rightLeg);
  }

  equipThirdPersonWeapon(weaponId) {
    while (this.weaponHolder.children.length > 0) {
      this.weaponHolder.remove(this.weaponHolder.children[0]);
    }

    this.weaponClass = weaponId;
    this.weaponMesh = WeaponModelBuilder.createThirdPersonModel(weaponId);
    this.weaponHolder.add(this.weaponMesh);

    // Muzzle flash mesh
    this.muzzleFlash = WeaponModelBuilder.createMuzzleFlash();
    this.muzzleFlash.visible = false;
    this.weaponHolder.add(this.muzzleFlash);
    if (this.weaponMesh.userData.muzzlePos) {
      this.muzzleFlash.position.copy(this.weaponMesh.userData.muzzlePos);
    }
  }

  changeWeapon(weaponId) {
    this.equipThirdPersonWeapon(weaponId);
  }

  triggerMuzzleFlash() {
    if (!this.muzzleFlash) return;
    this.muzzleFlash.visible = true;
    setTimeout(() => {
      if (this.muzzleFlash) this.muzzleFlash.visible = false;
    }, 45);
  }

  buildNameplate() {
    this.nameplateCanvas = document.createElement('canvas');
    this.nameplateCanvas.width = 256;
    this.nameplateCanvas.height = 64;
    this.nameplateCtx = this.nameplateCanvas.getContext('2d');

    this.nameplateTexture = new THREE.CanvasTexture(this.nameplateCanvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: this.nameplateTexture,
      transparent: true,
      depthTest: false
    });

    this.nameplateSprite = new THREE.Sprite(spriteMat);
    this.nameplateSprite.position.y = 2.3;
    this.nameplateSprite.scale.set(2.4, 0.6, 1.0);
    this.root.add(this.nameplateSprite);

    this.redrawNameplate(100, 100);
  }

  redrawNameplate(health, maxHealth) {
    const ctx = this.nameplateCtx;
    const w = 256;
    const h = 64;

    ctx.clearRect(0, 0, w, h);

    // Background pill
    ctx.fillStyle = 'rgba(10, 15, 25, 0.75)';
    ctx.beginPath();
    ctx.roundRect(10, 4, w - 20, h - 8, 8);
    ctx.fill();

    // Username
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(this.username, w / 2, 28);

    // Health bar container
    const barX = 24;
    const barY = 38;
    const barW = w - 48;
    const barH = 10;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(barX, barY, barW, barH);

    // Health bar fill
    const healthPct = Math.max(0, Math.min(1.0, health / maxHealth));
    let barColor = '#00f0ff';
    if (healthPct < 0.35) barColor = '#ff0055';
    else if (healthPct < 0.65) barColor = '#f59e0b';

    ctx.fillStyle = barColor;
    ctx.fillRect(barX, barY, barW * healthPct, barH);

    this.nameplateTexture.needsUpdate = true;
  }

  updateHealth(health, maxHealth = 100) {
    this.health = health;
    this.redrawNameplate(health, maxHealth);
  }

  onEliminated() {
    this.isAlive = false;
    this.root.visible = false;
    this.bodyMesh.userData.isHitbox = false;
    this.headMesh.userData.isHitbox = false;
  }

  onRespawn(pos) {
    this.isAlive = true;
    this.currentPosition.set(pos.x, pos.y, pos.z);
    this.targetPosition.copy(this.currentPosition);
    this.root.position.copy(this.currentPosition);
    this.root.visible = true;
    this.bodyMesh.userData.isHitbox = true;
    this.headMesh.userData.isHitbox = true;
    this.updateHealth(100, 100);
  }

  update(delta) {
    if (!this.isAlive) return;

    // Smooth position interpolation
    this.currentPosition.lerp(this.targetPosition, Math.min(1.0, delta * 18));
    this.root.position.copy(this.currentPosition);

    // Smooth rotation interpolation
    this.currentYaw = THREE.MathUtils.lerp(this.currentYaw, this.targetRotation.yaw, Math.min(1.0, delta * 15));
    this.root.rotation.y = this.currentYaw;

    // Pitch weapon and head slightly towards aim direction
    if (this.headMesh) {
      this.headMesh.rotation.x = this.targetRotation.pitch;
    }
    if (this.weaponHolder) {
      this.weaponHolder.rotation.x = this.targetRotation.pitch;
    }

    // Smoothly lower body, head, arms, and hitboxes during slide
    const targetBodyY = this.isSliding ? 0.6 : 1.05;
    const targetBodyScaleY = this.isSliding ? 0.65 : 1.0;
    const targetHeadY = this.isSliding ? 1.15 : 1.72;
    const targetWeaponY = this.isSliding ? 0.6 : 0.95;
    const targetNameplateY = this.isSliding ? 1.7 : 2.3;

    this.bodyMesh.position.y = THREE.MathUtils.lerp(this.bodyMesh.position.y, targetBodyY, Math.min(1.0, delta * 14));
    this.bodyMesh.scale.y = THREE.MathUtils.lerp(this.bodyMesh.scale.y, targetBodyScaleY, Math.min(1.0, delta * 14));
    this.headMesh.position.y = THREE.MathUtils.lerp(this.headMesh.position.y, targetHeadY, Math.min(1.0, delta * 14));
    this.weaponHolder.position.y = THREE.MathUtils.lerp(this.weaponHolder.position.y, targetWeaponY, Math.min(1.0, delta * 14));
    this.nameplateSprite.position.y = THREE.MathUtils.lerp(this.nameplateSprite.position.y, targetNameplateY, Math.min(1.0, delta * 14));

    if (this.isSliding) {
      this.leftLeg.rotation.x = THREE.MathUtils.lerp(this.leftLeg.rotation.x, -1.0, Math.min(1.0, delta * 12));
      this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, -0.8, Math.min(1.0, delta * 12));
    } else {
      // Walking / Running leg animations
      const moveDist = this.currentPosition.distanceTo(this.targetPosition);
      if (moveDist > 0.02) {
        const runSpeed = this.isSprinting ? 14 : 9;
        this.runCycle += delta * runSpeed;
        const legAngle = Math.sin(this.runCycle) * 0.6;
        this.leftLeg.rotation.x = legAngle;
        this.rightLeg.rotation.x = -legAngle;
      } else {
        this.leftLeg.rotation.x = THREE.MathUtils.lerp(this.leftLeg.rotation.x, 0, delta * 10);
        this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, 0, delta * 10);
      }
    }
  }

  destroy() {
    this.scene.remove(this.root);
  }
}
