import * as THREE from 'three';
import { joinRoom, selfId } from 'trystero/mqtt';
import { WeaponModelBuilder, WEAPON_DATA } from './weapons.js';
import { audio } from './audio.js';

// Pre-defined arena spawn points (ground feet coordinates)
export const SPAWN_POINTS = [
  { x: 0, y: 0, z: 35 },
  { x: 0, y: 0, z: -35 },
  { x: 35, y: 0, z: 0 },
  { x: -35, y: 0, z: 0 },
  { x: 25, y: 0, z: 25 },
  { x: -25, y: 0, z: -25 },
  { x: 25, y: 0, z: -25 },
  { x: -25, y: 0, z: 25 },
  // Elevated catwalk and terrace spawns
  { x: 0, y: 4.5, z: 0 },
  { x: 37, y: 3.2, z: 0 },
  { x: -37, y: 3.2, z: 0 }
];

export const PLAYER_COLORS = [
  '#00f0ff', // Cyber Cyan
  '#ff0055', // Neon Crimson
  '#00ff66', // Toxic Green
  '#ffaa00', // Amber
  '#b026ff', // Neon Purple
  '#ffff00', // Bright Yellow
  '#3b82f6', // Electric Blue
  '#ec4899'  // Pink
];

// Helper to select a spawn point that is safely distant from active enemies
export function getSafeSpawnPoint(remotePlayers = new Map()) {
  let bestPoint = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
  let maxMinDist = -1;

  for (const sp of SPAWN_POINTS) {
    let minDistToEnemy = Infinity;
    for (const remote of remotePlayers.values()) {
      if (remote.isAlive) {
        const dx = sp.x - remote.currentPosition.x;
        const dz = sp.z - remote.currentPosition.z;
        const dist = Math.hypot(dx, dz);
        if (dist < minDistToEnemy) minDistToEnemy = dist;
      }
    }
    if (minDistToEnemy > maxMinDist) {
      maxMinDist = minDistToEnemy;
      bestPoint = sp;
    }
  }

  return { ...bestPoint };
}

export class NetworkManager {
  constructor(scene, camera, uiManager) {
    this.scene = scene;
    this.camera = camera;
    this.ui = uiManager;
    this.selfId = selfId;
    this.localPlayerRef = null;

    this.roomId = 'GLOBAL-ARENA';
    this.username = 'Operative';
    this.weaponClass = 'assault';
    this.color = PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];

    this.kills = 0;
    this.deaths = 0;
    this.score = 0;

    // Remote players map: peerId -> RemotePlayer
    this.remotePlayers = new Map();

    // Hitbox meshes lookup for raycaster
    this.enemyHitboxes = [];

    // Peer joined announcement tracker
    this.announcedPeers = new Set();

    // P2P Room instance & action handles
    this.room = null;
    this.sendProfile = null;
    this.getProfile = null;
    this.sendState = null;
    this.getState = null;
    this.sendShoot = null;
    this.getShoot = null;
    this.sendHit = null;
    this.getHit = null;
    this.sendDamageConfirm = null;
    this.getDamageConfirm = null;
    this.sendHealthUpdate = null;
    this.getHealthUpdate = null;
    this.sendKill = null;
    this.getKill = null;
    this.sendRespawn = null;
    this.getRespawn = null;
    this.sendChat = null;
    this.getChat = null;

    // Throttled network packet sender
    this.lastSent = 0;
    this.sendRateMs = 33; // ~30Hz

    // Client-side automatic health regeneration tracking
    this.lastDamageTime = 0;
    this.lastRegenTick = 0;
    this.isRegenerating = false;
  }

  setLocalPlayer(localPlayer) {
    this.localPlayerRef = localPlayer;
  }

  connect(username, weaponClass, roomId = 'GLOBAL-ARENA', onConnected) {
    this.username = (username || `Player_${this.selfId.slice(0, 4)}`).trim().slice(0, 16);
    this.weaponClass = ['assault', 'smg', 'sniper'].includes(weaponClass) ? weaponClass : 'assault';
    this.roomId = (roomId || 'GLOBAL-ARENA').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '') || 'GLOBAL-ARENA';

    console.log(`[P2P Network] Joining room: ${this.roomId} as ${this.username} (Peer ID: ${this.selfId})`);

    // Pick safe initial spawn point
    const initialSpawn = getSafeSpawnPoint(this.remotePlayers);
    if (this.localPlayerRef) {
      this.localPlayerRef.respawn(initialSpawn, 100);
    }

    // Initialize self on scoreboard
    this.updateScoreboardSelf();

    // Join Trystero decentralized WebRTC room via public MQTT broker signaling
    const appId = 'arena-buster-p2p-fps';
    this.room = joinRoom({ appId }, this.roomId);

    // Register Trystero action channels
    [this.sendProfile, this.getProfile] = this.room.makeAction('profile');
    [this.sendState, this.getState] = this.room.makeAction('state');
    [this.sendShoot, this.getShoot] = this.room.makeAction('shoot');
    [this.sendHit, this.getHit] = this.room.makeAction('hit');
    [this.sendDamageConfirm, this.getDamageConfirm] = this.room.makeAction('damageConfirm');
    [this.sendHealthUpdate, this.getHealthUpdate] = this.room.makeAction('healthUpdate');
    [this.sendKill, this.getKill] = this.room.makeAction('kill');
    [this.sendRespawn, this.getRespawn] = this.room.makeAction('respawn');
    [this.sendChat, this.getChat] = this.room.makeAction('chat');

    // 1. Handle new peer connections
    this.room.onPeerJoin((peerId) => {
      console.log(`[P2P Network] Peer joined room: ${peerId}`);
      // Send self profile and current location to joining peer
      this.sendSelfProfile(peerId);
      this.sendCurrentState(peerId);
    });

    // 2. Handle peer disconnections
    this.room.onPeerLeave((peerId) => {
      console.log(`[P2P Network] Peer left room: ${peerId}`);
      const remote = this.remotePlayers.get(peerId);
      if (remote) {
        this.ui.addKillFeedMessage(`${remote.username} left the arena`, 'system');
      }
      this.removeRemotePlayer(peerId);
      this.announcedPeers.delete(peerId);
    });

    // 3. Receive peer profiles
    this.getProfile((profile, peerId) => {
      if (!profile || peerId === this.selfId) return;

      if (!this.remotePlayers.has(peerId)) {
        this.addRemotePlayer({
          id: peerId,
          username: profile.username || 'Operative',
          color: profile.color || '#00f0ff',
          weaponClass: profile.weaponClass || 'assault',
          health: profile.health ?? 100,
          isAlive: profile.isAlive ?? true,
          position: profile.position || { x: 0, y: 0, z: 0 }
        });

        if (!this.announcedPeers.has(peerId)) {
          this.announcedPeers.add(peerId);
          this.ui.addKillFeedMessage(`${profile.username} joined the arena`, 'system');
        }

        // Return hand-shake profile
        this.sendSelfProfile(peerId);
      } else {
        const remote = this.remotePlayers.get(peerId);
        if (remote) {
          remote.username = profile.username;
          if (profile.weaponClass && profile.weaponClass !== remote.weaponClass) {
            remote.changeWeapon(profile.weaponClass);
          }
          if (typeof profile.health === 'number') {
            remote.updateHealth(profile.health, 100);
          }
        }
      }

      this.ui.updateScoreboardEntry({
        id: peerId,
        username: profile.username || 'Operative',
        color: profile.color || '#00f0ff',
        kills: profile.kills || 0,
        deaths: profile.deaths || 0,
        score: profile.score || 0
      });
    });

    // 4. Continuous state updates (~30Hz)
    this.getState((data, peerId) => {
      if (!data || peerId === this.selfId) return;

      let remote = this.remotePlayers.get(peerId);
      if (!remote) {
        this.addRemotePlayer({
          id: peerId,
          username: data.username || 'Operative',
          color: data.color || '#00f0ff',
          weaponClass: data.weaponClass || 'assault',
          health: data.health ?? 100,
          isAlive: data.isAlive ?? true,
          position: data.position || { x: 0, y: 0, z: 0 }
        });
        remote = this.remotePlayers.get(peerId);
      }

      if (remote) {
        if (data.position) {
          remote.targetPosition.set(data.position.x, data.position.y, data.position.z);
        }
        if (data.rotation) {
          remote.targetRotation.yaw = data.rotation.yaw ?? 0;
          remote.targetRotation.pitch = data.rotation.pitch ?? 0;
        }
        remote.isSprinting = !!data.isSprinting;
        remote.isSliding = !!data.isSliding;
        remote.isAlive = data.isAlive !== false;

        if (typeof data.health === 'number') {
          remote.updateHealth(data.health, 100);
        }

        if (data.weaponClass && data.weaponClass !== remote.weaponClass) {
          remote.changeWeapon(data.weaponClass);
        }
      }

      if (data.kills !== undefined || data.deaths !== undefined || data.score !== undefined) {
        this.ui.updateScoreboardEntry({
          id: peerId,
          username: data.username || remote?.username || 'Operative',
          color: data.color || remote?.color || '#00f0ff',
          kills: data.kills || 0,
          deaths: data.deaths || 0,
          score: data.score || 0
        });
      }
    });

    // 5. Remote player shooting visual & sound
    this.getShoot((data, peerId) => {
      if (!data || peerId === this.selfId) return;

      const remote = this.remotePlayers.get(peerId);
      const origin = new THREE.Vector3(data.origin.x, data.origin.y, data.origin.z);
      const hitPoint = new THREE.Vector3(data.hitPoint.x, data.hitPoint.y, data.hitPoint.z);

      if (remote) {
        remote.triggerMuzzleFlash();
      }

      // Distance audio attenuation
      const dist = this.camera.position.distanceTo(origin);
      audio.playGunshot(data.weaponClass || 'assault', true, dist);

      // Render 3D bullet tracer line
      this.spawnTracer(origin, hitPoint);
    });

    // 6. Direct Hit Registration (sent to local player from attacker)
    this.getHit((data, peerId) => {
      if (!data || !this.localPlayerRef || !this.localPlayerRef.isAlive) return;

      const damage = data.damage || 20;
      const isHeadshot = !!data.isHeadshot;
      const hitPoint = data.hitPoint || { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z };

      // Deduct health locally
      this.localPlayerRef.health = Math.max(0, this.localPlayerRef.health - damage);
      this.lastDamageTime = Date.now();
      this.isRegenerating = false;

      // Audio & visual feedback on hit
      audio.playDamageTaken();
      this.ui.triggerDamageFlash();
      this.ui.updateHealth(this.localPlayerRef.health, 100, false);

      // Send damage confirmation directly back to the attacker
      this.sendDamageConfirm({
        damage,
        isHeadshot,
        hitPoint,
        remainingHealth: this.localPlayerRef.health,
        victimId: this.selfId
      }, peerId);

      // Broadcast health update to room for overhead health bars
      this.sendHealthUpdate({
        playerId: this.selfId,
        health: this.localPlayerRef.health,
        maxHealth: 100,
        isRegenerating: false
      });

      // Handle elimination
      if (this.localPlayerRef.health <= 0) {
        this.localPlayerRef.isAlive = false;
        this.localPlayerRef.isADS = false;
        this.ui.setAds(false, false);
        this.deaths += 1;
        this.updateScoreboardSelf();

        // Broadcast elimination event to all peers
        this.sendKill({
          killerId: data.attackerId,
          killerName: data.attackerName || 'Enemy',
          victimId: this.selfId,
          victimName: this.username,
          weaponClass: data.weaponClass || 'assault',
          isHeadshot
        });

        // Local elimination UI & sound
        audio.playElimination();
        this.ui.showEliminationScreen(data.attackerName || 'Enemy', isHeadshot, 3000);

        // Client-side 3-second safe auto-respawn
        setTimeout(() => {
          const respawnPoint = getSafeSpawnPoint(this.remotePlayers);
          this.localPlayerRef.health = 100;
          this.localPlayerRef.isAlive = true;
          this.lastDamageTime = 0;
          this.isRegenerating = false;
          this.localPlayerRef.respawn(respawnPoint, 100);

          // Broadcast respawn event to all peers
          this.sendRespawn({
            id: this.selfId,
            position: respawnPoint,
            health: 100
          });
        }, 3000);
      }
    });

    // 7. Damage Confirmation (received by attacker when target takes damage)
    this.getDamageConfirm((data) => {
      if (!data) return;
      audio.playHitmarker(data.isHeadshot);
      this.ui.showHitmarker(data.isHeadshot);
      if (data.hitPoint) {
        this.ui.spawnFloatingDamage(data.hitPoint, data.damage, data.isHeadshot, this.camera);
      }
    });

    // 8. Overhead Health Updates
    this.getHealthUpdate((data, peerId) => {
      if (!data) return;
      const targetId = data.playerId || peerId;
      if (targetId === this.selfId) return;

      const remote = this.remotePlayers.get(targetId);
      if (remote) {
        remote.updateHealth(data.health, data.maxHealth || 100);
      }
    });

    // 9. Kill announcements
    this.getKill((data) => {
      if (!data) return;

      this.ui.addKillFeedKill(data.killerName, data.victimName, data.weaponClass, data.isHeadshot);

      // If local player was the killer
      if (data.killerId === this.selfId) {
        this.kills += 1;
        this.score += data.isHeadshot ? 150 : 100;
        audio.playKillConfirmed();
        this.ui.showKillBanner(data.victimName, data.isHeadshot);
        this.updateScoreboardSelf();
      }

      // If victim was a remote player
      if (data.victimId !== this.selfId) {
        const remote = this.remotePlayers.get(data.victimId);
        if (remote) {
          remote.onEliminated();
        }
      }
    });

    // 10. Remote Player Respawn
    this.getRespawn((data, peerId) => {
      if (!data) return;
      const targetId = data.id || peerId;
      if (targetId === this.selfId) return;

      const remote = this.remotePlayers.get(targetId);
      if (remote && data.position) {
        remote.onRespawn(data.position);
      }
    });

    // 11. In-game text chat
    this.getChat((data) => {
      if (!data) return;
      this.ui.addChatMessage(data.sender, data.color, data.text);
    });

    this.ui.addKillFeedMessage(`Connected to room: [${this.roomId}]`, 'system');
    if (onConnected) onConnected();
  }

  sendSelfProfile(targetPeerId = null) {
    if (!this.sendProfile) return;
    const profile = {
      id: this.selfId,
      username: this.username,
      weaponClass: this.weaponClass,
      color: this.color,
      health: this.localPlayerRef ? this.localPlayerRef.health : 100,
      isAlive: this.localPlayerRef ? this.localPlayerRef.isAlive : true,
      kills: this.kills,
      deaths: this.deaths,
      score: this.score,
      position: this.localPlayerRef ? {
        x: this.camera.position.x,
        y: this.camera.position.y - this.localPlayerRef.eyeHeight,
        z: this.camera.position.z
      } : { x: 0, y: 0, z: 0 }
    };

    if (targetPeerId) {
      this.sendProfile(profile, targetPeerId);
    } else {
      this.sendProfile(profile);
    }
  }

  sendCurrentState(targetPeerId = null) {
    if (!this.sendState || !this.localPlayerRef) return;
    const camEuler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    const state = {
      id: this.selfId,
      username: this.username,
      color: this.color,
      weaponClass: this.weaponClass,
      position: {
        x: this.camera.position.x,
        y: this.camera.position.y - this.localPlayerRef.eyeHeight,
        z: this.camera.position.z
      },
      rotation: {
        yaw: camEuler.y,
        pitch: camEuler.x
      },
      velocity: {
        x: this.localPlayerRef.velocity.x,
        y: this.localPlayerRef.velocity.y,
        z: this.localPlayerRef.velocity.z
      },
      isSprinting: this.localPlayerRef.isSprinting,
      isSliding: this.localPlayerRef.isSliding,
      health: this.localPlayerRef.health,
      isAlive: this.localPlayerRef.isAlive,
      kills: this.kills,
      deaths: this.deaths,
      score: this.score
    };

    if (targetPeerId) {
      this.sendState(state, targetPeerId);
    } else {
      this.sendState(state);
    }
  }

  sendPlayerState(state) {
    if (!this.sendState) return;

    const now = performance.now();
    if (now - this.lastSent < this.sendRateMs) return;
    this.lastSent = now;

    this.sendState({
      id: this.selfId,
      username: this.username,
      color: this.color,
      weaponClass: this.weaponClass,
      ...state,
      health: this.localPlayerRef ? this.localPlayerRef.health : 100,
      isAlive: this.localPlayerRef ? this.localPlayerRef.isAlive : true,
      kills: this.kills,
      deaths: this.deaths,
      score: this.score
    });
  }

  recordHit(targetId, hitboxType, hitPoint) {
    if (!this.sendHit) return;

    const weapon = WEAPONS_STATS[this.weaponClass] || WEAPONS_STATS.assault;
    const isHeadshot = hitboxType === 'head';
    const baseDamage = weapon.damage;
    const actualDamage = isHeadshot ? Math.round(baseDamage * weapon.headMultiplier) : baseDamage;

    // Send hit payload directly to target peer
    this.sendHit({
      damage: actualDamage,
      isHeadshot,
      hitPoint: { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z },
      attackerId: this.selfId,
      attackerName: this.username,
      weaponClass: this.weaponClass
    }, targetId);
  }

  broadcastShoot(origin, direction, hitPoint) {
    if (!this.sendShoot) return;
    this.sendShoot({
      origin: { x: origin.x, y: origin.y, z: origin.z },
      direction: { x: direction.x, y: direction.y, z: direction.z },
      hitPoint: { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z },
      weaponClass: this.weaponClass
    });
  }

  changeWeapon(newWeaponClass) {
    this.weaponClass = newWeaponClass;
    this.sendSelfProfile();
  }

  sendChatMessage(text) {
    const cleanText = (text || '').toString().trim().slice(0, 100);
    if (!cleanText || !this.sendChat) return;

    this.sendChat({
      sender: this.username,
      color: this.color,
      text: cleanText
    });
    this.ui.addChatMessage(this.username, this.color, cleanText);
  }

  updateScoreboardSelf() {
    this.ui.updateScoreboardEntry({
      id: this.selfId,
      username: this.username,
      color: this.color,
      kills: this.kills,
      deaths: this.deaths,
      score: this.score
    });
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
    for (const remote of this.remotePlayers.values()) {
      if (remote.isAlive) {
        if (remote.headHitbox) this.enemyHitboxes.push(remote.headHitbox);
        if (remote.bodyHitbox) this.enemyHitboxes.push(remote.bodyHitbox);
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
    // 1. Update all remote player animations & interpolation
    for (const remote of this.remotePlayers.values()) {
      remote.update(delta);
    }

    // 2. Client-side automatic health regeneration (5-second delay, +5 HP every 250ms)
    if (this.localPlayerRef && this.localPlayerRef.isAlive && this.localPlayerRef.health < 100) {
      const now = Date.now();
      if (this.lastDamageTime > 0 && now - this.lastDamageTime >= 5000) {
        if (now - this.lastRegenTick >= 250) {
          this.lastRegenTick = now;
          const prevHp = this.localPlayerRef.health;
          this.localPlayerRef.health = Math.min(100, this.localPlayerRef.health + 5);
          this.isRegenerating = this.localPlayerRef.health < 100;

          if (this.localPlayerRef.health !== prevHp) {
            this.ui.updateHealth(this.localPlayerRef.health, 100, this.isRegenerating);

            if (this.sendHealthUpdate) {
              this.sendHealthUpdate({
                playerId: this.selfId,
                health: this.localPlayerRef.health,
                maxHealth: 100,
                isRegenerating: this.isRegenerating
              });
            }
          }

          if (!this.isRegenerating) {
            this.lastDamageTime = 0;
          }
        }
      }
    } else if (this.isRegenerating) {
      this.isRegenerating = false;
      this.ui.updateHealth(this.localPlayerRef?.health || 100, 100, false);
    }
  }
}

// Balance stats lookup
const WEAPONS_STATS = {
  assault: { damage: 24, headMultiplier: 2.0 },
  smg: { damage: 16, headMultiplier: 2.0 },
  sniper: { damage: 80, headMultiplier: 2.0 }
};

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
    const headGeo = new THREE.BoxGeometry(0.42, 0.45, 0.45);
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

    // Glowing Neon Visor on Face
    const visorGeo = new THREE.BoxGeometry(0.34, 0.12, 0.08);
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 0.02, 0.22);
    this.headMesh.add(visor);

    // 3. Arms & Shoulders
    const armGeo = new THREE.BoxGeometry(0.2, 0.75, 0.2);
    this.leftArm = new THREE.Mesh(armGeo, armorMat);
    this.leftArm.position.set(-0.48, 1.05, 0);
    this.leftArm.castShadow = true;
    this.root.add(this.leftArm);

    this.rightArm = new THREE.Mesh(armGeo, armorMat);
    this.rightArm.position.set(0.48, 1.05, 0);
    this.rightArm.castShadow = true;
    this.root.add(this.rightArm);

    // 4. Legs
    const legGeo = new THREE.BoxGeometry(0.24, 0.65, 0.24);
    this.leftLeg = new THREE.Mesh(legGeo, armorMat);
    this.leftLeg.position.set(-0.2, 0.32, 0);
    this.leftLeg.castShadow = true;
    this.root.add(this.leftLeg);

    this.rightLeg = new THREE.Mesh(legGeo, armorMat);
    this.rightLeg.position.set(0.2, 0.32, 0);
    this.rightLeg.castShadow = true;
    this.root.add(this.rightLeg);

    // 5. Weapon Holder attached to right hand
    this.weaponHolder = new THREE.Group();
    this.weaponHolder.position.set(0.35, 0.95, 0.35);
    this.root.add(this.weaponHolder);

    this.changeWeapon(this.weaponClass);
  }

  changeWeapon(weaponClass) {
    this.weaponClass = weaponClass;
    while (this.weaponHolder.children.length > 0) {
      this.weaponHolder.remove(this.weaponHolder.children[0]);
    }

    const model = WeaponModelBuilder.createWorldModel(weaponClass);
    model.scale.set(0.85, 0.85, 0.85);
    this.weaponHolder.add(model);

    // Muzzle flash point
    const flashGeo = new THREE.SphereGeometry(0.12, 6, 6);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.9
    });
    this.muzzleFlash = new THREE.Mesh(flashGeo, flashMat);
    this.muzzleFlash.position.set(0, 0, 0.7);
    this.muzzleFlash.visible = false;
    this.weaponHolder.add(this.muzzleFlash);
  }

  triggerMuzzleFlash() {
    if (!this.muzzleFlash) return;
    this.muzzleFlash.visible = true;
    setTimeout(() => {
      if (this.muzzleFlash) this.muzzleFlash.visible = false;
    }, 50);
  }

  buildNameplate() {
    this.nameplateCanvas = document.createElement('canvas');
    this.nameplateCanvas.width = 256;
    this.nameplateCanvas.height = 72;
    this.nameplateCtx = this.nameplateCanvas.getContext('2d');

    this.nameplateTexture = new THREE.CanvasTexture(this.nameplateCanvas);
    this.nameplateTexture.minFilter = THREE.LinearFilter;

    const spriteMat = new THREE.SpriteMaterial({
      map: this.nameplateTexture,
      transparent: true,
      depthTest: false
    });

    this.nameplateSprite = new THREE.Sprite(spriteMat);
    this.nameplateSprite.position.set(0, 2.3, 0);
    this.nameplateSprite.scale.set(1.8, 0.5, 1);
    this.root.add(this.nameplateSprite);
  }

  updateHealth(health, maxHealth = 100) {
    if (!this.nameplateCtx) return;
    const ctx = this.nameplateCtx;
    const w = 256;
    const h = 72;

    ctx.clearRect(0, 0, w, h);

    // Dark semi-transparent pill background
    ctx.fillStyle = 'rgba(10, 15, 24, 0.85)';
    ctx.beginPath();
    ctx.roundRect(10, 6, w - 20, h - 12, 10);
    ctx.fill();

    // Border glow with player team color
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Username label
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(this.username, w / 2, 28);

    // Health bar track
    const barX = 24;
    const barY = 36;
    const barW = w - 48;
    const barH = 10;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 4);
    ctx.fill();

    // Health bar fill
    const pct = Math.max(0, Math.min(1.0, health / maxHealth));
    const fillW = Math.max(0, barW * pct);

    ctx.fillStyle = pct > 0.4 ? this.color : '#ff0055';
    ctx.beginPath();
    ctx.roundRect(barX, barY, fillW, barH, 4);
    ctx.fill();

    this.nameplateTexture.needsUpdate = true;
  }

  onEliminated() {
    this.isAlive = false;
    this.root.visible = false;
    if (this.bodyMesh) this.bodyMesh.userData.isHitbox = false;
    if (this.headMesh) this.headMesh.userData.isHitbox = false;
  }

  onRespawn(newPosition) {
    this.isAlive = true;
    if (newPosition) {
      this.currentPosition.set(newPosition.x, newPosition.y, newPosition.z);
      this.targetPosition.copy(this.currentPosition);
      this.root.position.copy(this.currentPosition);
    }
    this.root.visible = true;
    if (this.bodyMesh) this.bodyMesh.userData.isHitbox = true;
    if (this.headMesh) this.headMesh.userData.isHitbox = true;
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
