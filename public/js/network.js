import * as THREE from 'three';
import { joinRoom } from 'trystero/torrent';
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
export function getSafeSpawnPoint(remotePlayers = {}) {
  let bestPoint = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
  let maxMinDist = -1;
  const remotes = remotePlayers instanceof Map ? Array.from(remotePlayers.values()) : Object.values(remotePlayers || {});

  for (const sp of SPAWN_POINTS) {
    let minDistToEnemy = Infinity;
    for (const remote of remotes) {
      if (remote && remote.isAlive && remote.currentPosition) {
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

    // Persistent unique client ID generated ONCE when the page loads
    this.myId = 'player_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
    this.selfId = this.myId;
    this.localPlayerRef = null;

    this.roomId = 'GLOBAL-ARENA';
    this.username = 'Operative';
    this.weaponClass = 'assault';
    this.color = PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];

    this.kills = 0;
    this.deaths = 0;
    this.score = 0;

    // Single dictionary of remote players strictly keyed by packet.peerId: peerId -> RemotePlayer
    this.remotePlayers = {};

    // Hitbox meshes lookup for raycaster
    this.enemyHitboxes = [];

    // Peer joined announcement tracker
    this.announcedPeers = new Set();

    // Native browser BroadcastChannel for 0ms multi-tab synchronization on same PC
    this.broadcastChannel = null;

    // Recent message IDs cache for deduplication between BroadcastChannel & WebRTC
    this.recentMsgIds = new Set();

    // P2P Room instance & action handles
    this.room = null;
    this.sendFunctions = {};

    // Throttled network packet sender
    this.lastSent = 0;
    this.sendRateMs = 50; // 50ms (~20Hz) broadcast loop

    // Continuous heartbeat & background broadcast interval
    this.broadcastInterval = null;
    this.lastHeartbeatTime = 0;

    // Client-side automatic health regeneration tracking
    this.lastDamageTime = 0;
    this.lastRegenTick = 0;
    this.isRegenerating = false;
  }

  setLocalPlayer(localPlayer) {
    this.localPlayerRef = localPlayer;
  }

  connect(username, weaponClass, roomId = 'GLOBAL-ARENA', onConnected) {
    this.username = (username || `Player_${this.myId.slice(-4)}`).trim().slice(0, 16);
    this.weaponClass = ['assault', 'smg', 'sniper'].includes(weaponClass) ? weaponClass : 'assault';
    this.roomId = (roomId || 'GLOBAL-ARENA').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '') || 'GLOBAL-ARENA';

    console.log(`[P2P Network] Joining room: ${this.roomId} as ${this.username} (Peer ID: ${this.myId})`);

    // Pick safe initial spawn point
    const initialSpawn = getSafeSpawnPoint(this.remotePlayers);
    if (this.localPlayerRef) {
      this.localPlayerRef.respawn(initialSpawn, 100);
    }

    // Initialize self on scoreboard and HUD online counter
    this.updateScoreboardSelf();
    this.updateOnlineCount();

    // 1. Setup native BroadcastChannel for instant same-browser multi-tab sync (0ms latency)
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        if (this.broadcastChannel) {
          this.broadcastChannel.close();
        }
        this.broadcastChannel = new BroadcastChannel('arena-buster-' + this.roomId);
        this.broadcastChannel.onmessage = (event) => {
          if (!event.data) return;
          const { type, peerId, targetPeerId, msgId, payload } = event.data;
          const senderId = peerId || payload?.peerId;

          // If packet.peerId === this.myId, ignore it completely!
          if (!senderId || senderId === this.myId) return;
          if (targetPeerId && targetPeerId !== this.myId) return;

          // Message deduplication
          if (msgId && this.hasSeenMessage(msgId)) return;

          this.handleIncomingPacket(type, payload, senderId);
        };

        // Notify other tabs immediately on page unload
        window.addEventListener('beforeunload', () => {
          if (this.broadcastChannel) {
            try {
              this.broadcastChannel.postMessage({
                type: 'leave',
                peerId: this.myId,
                payload: { peerId: this.myId }
              });
            } catch (_) {}
          }
        });
      }
    } catch (err) {
      console.warn('[P2P Network] BroadcastChannel error:', err);
    }

    // 2. Join Trystero decentralized WebRTC room via WebTorrent trackers for internet peers
    try {
      const appId = 'arena-buster-p2p-fps';
      this.room = joinRoom({ appId }, this.roomId);

      // Register Trystero action channels
      const [sendProfile, getProfile] = this.room.makeAction('profile');
      const [sendState, getState] = this.room.makeAction('state');
      const [sendShoot, getShoot] = this.room.makeAction('shoot');
      const [sendHit, getHit] = this.room.makeAction('hit');
      const [sendDamageConfirm, getDamageConfirm] = this.room.makeAction('damageConfirm');
      const [sendHealthUpdate, getHealthUpdate] = this.room.makeAction('healthUpdate');
      const [sendKill, getKill] = this.room.makeAction('kill');
      const [sendRespawn, getRespawn] = this.room.makeAction('respawn');
      const [sendChat, getChat] = this.room.makeAction('chat');

      this.sendFunctions = {
        profile: sendProfile,
        state: sendState,
        shoot: sendShoot,
        hit: sendHit,
        damageConfirm: sendDamageConfirm,
        healthUpdate: sendHealthUpdate,
        kill: sendKill,
        respawn: sendRespawn,
        chat: sendChat
      };

      // Handle new peer connections via WebRTC
      this.room.onPeerJoin((trysteroId) => {
        console.log(`[P2P WebRTC] Peer connected: ${trysteroId}`);
        this.sendSelfProfile(trysteroId);
        this.sendCurrentState(trysteroId);
      });

      // Handle peer disconnections via WebRTC
      this.room.onPeerLeave((trysteroId) => {
        console.log(`[P2P WebRTC] Peer left: ${trysteroId}`);
        this.onReceiveLeave({ peerId: trysteroId }, trysteroId);
      });

      // Bind Trystero incoming actions to unified packet handler
      getProfile((data, trysteroId) => this.handleIncomingPacket('profile', data, data?.peerId || trysteroId));
      getState((data, trysteroId) => this.handleIncomingPacket('state', data, data?.peerId || trysteroId));
      getShoot((data, trysteroId) => this.handleIncomingPacket('shoot', data, data?.peerId || trysteroId));
      getHit((data, trysteroId) => this.handleIncomingPacket('hit', data, data?.peerId || trysteroId));
      getDamageConfirm((data, trysteroId) => this.handleIncomingPacket('damageConfirm', data, data?.peerId || trysteroId));
      getHealthUpdate((data, trysteroId) => this.handleIncomingPacket('healthUpdate', data, data?.peerId || trysteroId));
      getKill((data, trysteroId) => this.handleIncomingPacket('kill', data, data?.peerId || trysteroId));
      getRespawn((data, trysteroId) => this.handleIncomingPacket('respawn', data, data?.peerId || trysteroId));
      getChat((data, trysteroId) => this.handleIncomingPacket('chat', data, data?.peerId || trysteroId));
    } catch (err) {
      console.warn('[P2P Network] WebRTC room error:', err);
    }

    // Broadcast our profile and state immediately so all peers discover us
    this.sendSelfProfile();
    this.sendCurrentState();

    // 3. Dedicated Background setInterval: continues broadcasting even when tab is blurred/backgrounded
    if (this.broadcastInterval) clearInterval(this.broadcastInterval);
    this.broadcastInterval = setInterval(() => {
      this.broadcastHeartbeatAndState();
    }, 80);

    this.ui.addKillFeedMessage(`Joined arena: [${this.roomId}]`, 'system');
    if (onConnected) onConnected();
  }

  // Deduplicate messages received across both BroadcastChannel and WebRTC
  hasSeenMessage(msgId) {
    if (!msgId) return false;
    if (this.recentMsgIds.has(msgId)) return true;
    this.recentMsgIds.add(msgId);
    if (this.recentMsgIds.size > 250) {
      const first = this.recentMsgIds.values().next().value;
      this.recentMsgIds.delete(first);
    }
    return false;
  }

  // Dual-transport broadcast: sends via BroadcastChannel (local tabs) AND Trystero (internet peers)
  broadcastPacket(type, payload, targetPeerId = null, msgId = null) {
    if (!payload) return;
    payload.peerId = this.myId;

    // 1. Send via local browser BroadcastChannel (0ms latency)
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({
          type,
          peerId: this.myId,
          targetPeerId,
          msgId,
          payload
        });
      } catch (err) {
        console.warn('[BroadcastChannel error]', err);
      }
    }

    // 2. Send via WebRTC data channel
    const sendFn = this.sendFunctions[type];
    if (sendFn) {
      try {
        if (targetPeerId) {
          sendFn(payload, targetPeerId);
        } else {
          sendFn(payload);
        }
      } catch (_) {}
    }
  }

  // Unified incoming packet router
  handleIncomingPacket(type, payload, fallbackPeerId = null) {
    if (!payload) return;
    const peerId = payload.peerId || payload.id || fallbackPeerId;

    // Ensure that your own local player ID (this.myId) is NEVER processed or added as a remote player
    if (!peerId) return;
    if (peerId === this.myId || peerId === this.selfId || payload.peerId === this.myId || payload.id === this.myId) {
      return;
    }

    switch (type) {
      case 'profile':
        this.onReceiveProfile(payload, peerId);
        break;
      case 'state':
        this.onReceiveState(payload, peerId);
        break;
      case 'shoot':
        this.onReceiveShoot(payload, peerId);
        break;
      case 'hit':
        this.onReceiveHit(payload, peerId);
        break;
      case 'damageConfirm':
        this.onReceiveDamageConfirm(payload, peerId);
        break;
      case 'healthUpdate':
        this.onReceiveHealthUpdate(payload, peerId);
        break;
      case 'kill':
        this.onReceiveKill(payload, peerId);
        break;
      case 'respawn':
        this.onReceiveRespawn(payload, peerId);
        break;
      case 'chat':
        this.onReceiveChat(payload, peerId);
        break;
      case 'leave':
        this.onReceiveLeave(payload, peerId);
        break;
    }
  }

  createRemotePlayer(peerId, data) {
    if (!peerId) return null;
    // Strictly ensure own player ID is NEVER added to remotePlayers and NEVER triggers character creation
    if (peerId === this.myId || peerId === this.selfId) return null;
    if (data?.peerId === this.myId || data?.id === this.myId) return null;

    // Strictly check: if (this.remotePlayers[peerId]) { return this.remotePlayers[peerId]; }
    // If the player already exists in the dictionary, NEVER instantiate a new THREE.Group() or call scene.add().
    if (this.remotePlayers[peerId]) {
      return this.remotePlayers[peerId];
    }

    const remote = new RemotePlayer({
      id: peerId,
      username: data?.username || 'Operative',
      color: data?.color || '#00f0ff',
      weaponClass: data?.weaponClass || 'assault',
      health: data?.health ?? 100,
      isAlive: data?.isAlive !== false,
      position: data?.position || { x: 0, y: 0, z: 0 }
    }, this.scene);

    remote.lastSeen = Date.now();
    this.remotePlayers[peerId] = remote;
    this.rebuildHitboxCache();
    this.updateOnlineCount();

    if (!this.announcedPeers.has(peerId)) {
      this.announcedPeers.add(peerId);
      this.ui.addKillFeedMessage(`${data?.username || 'Operative'} joined the arena`, 'system');
    }

    return remote;
  }

  addRemotePlayer(data) {
    const peerId = data?.id || data?.peerId;
    return this.createRemotePlayer(peerId, data);
  }

  onReceiveProfile(profile, peerId) {
    if (!profile || !peerId) return;
    if (peerId === this.myId || peerId === this.selfId || profile.peerId === this.myId || profile.id === this.myId) {
      return;
    }

    let remote = this.remotePlayers[peerId];
    if (!remote) {
      remote = this.createRemotePlayer(peerId, profile);
      if (!remote) return;
      this.sendSelfProfile(peerId);
    }

    remote.lastSeen = Date.now();
    if (profile.username) remote.username = profile.username;
    if (profile.weaponClass && profile.weaponClass !== remote.weaponClass) {
      remote.changeWeapon(profile.weaponClass);
    }
    if (typeof profile.health === 'number') {
      remote.updateHealth(profile.health, 100);
    }

    this.ui.updateScoreboardEntry({
      id: peerId,
      username: remote.username,
      color: remote.color,
      kills: profile.kills || 0,
      deaths: profile.deaths || 0,
      score: profile.score || 0
    });
  }

  onReceiveState(data, peerId) {
    if (!data || !peerId) return;
    if (peerId === this.myId || peerId === this.selfId || data.peerId === this.myId || data.id === this.myId) {
      return;
    }

    // Strictly check: if not in dictionary, create ONCE.
    // If the player already exists in the dictionary, NEVER instantiate a new THREE.Group or call scene.add()!
    let remote = this.remotePlayers[peerId];
    if (!remote) {
      remote = this.createRemotePlayer(peerId, data);
      if (!remote) return;
      this.sendSelfProfile(peerId);
    }

    // Only update the existing mesh's target position and rotation
    remote.lastSeen = Date.now();

    if (data.position) {
      remote.targetPosition.set(data.position.x, data.position.y, data.position.z);
    }
    if (data.rotation) {
      remote.targetRotation.yaw = data.rotation.yaw ?? 0;
      remote.targetRotation.pitch = data.rotation.pitch ?? 0;
    }
    remote.isSprinting = !!data.isSprinting;
    remote.isSliding = !!data.isSliding;

    // Slide direction sync
    if (remote.isSliding) {
      if (typeof data.slideYaw === 'number') {
        remote.slideYaw = data.slideYaw;
      } else if (typeof data.slideDirX === 'number' && typeof data.slideDirZ === 'number' && (data.slideDirX !== 0 || data.slideDirZ !== 0)) {
        remote.slideYaw = Math.atan2(-data.slideDirX, -data.slideDirZ);
      }
      if (typeof data.slideDirX === 'number' && typeof data.slideDirZ === 'number') {
        remote.slideDir.set(data.slideDirX, data.slideDirZ);
      }
    }

    remote.isAlive = data.isAlive !== false;

    if (typeof data.health === 'number') {
      remote.updateHealth(data.health, 100);
    }

    if (data.weaponClass && data.weaponClass !== remote.weaponClass) {
      remote.changeWeapon(data.weaponClass);
    }

    if (data.kills !== undefined || data.deaths !== undefined || data.score !== undefined) {
      this.ui.updateScoreboardEntry({
        id: peerId,
        username: data.username || remote.username,
        color: data.color || remote.color,
        kills: data.kills || 0,
        deaths: data.deaths || 0,
        score: data.score || 0
      });
    }
  }

  onReceiveShoot(data, peerId) {
    if (!data || !peerId || peerId === this.myId) return;

    const remote = this.remotePlayers[peerId];
    if (remote) {
      remote.lastSeen = Date.now();
      remote.triggerMuzzleFlash();
    }

    const origin = new THREE.Vector3(data.origin.x, data.origin.y, data.origin.z);
    const hitPoint = new THREE.Vector3(data.hitPoint.x, data.hitPoint.y, data.hitPoint.z);

    // Distance audio attenuation
    const dist = this.camera.position.distanceTo(origin);
    audio.playGunshot(data.weaponClass || 'assault', true, dist);

    // Render 3D bullet tracer line
    this.spawnTracer(origin, hitPoint);
  }

  onReceiveHit(data, peerId) {
    if (!data || !this.localPlayerRef || !this.localPlayerRef.isAlive) return;

    // Check if local player is the target of the hit
    if (data.targetId && data.targetId !== this.myId) return;

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
    const confirmMsgId = 'confirm_' + this.myId + '_' + Date.now();
    this.broadcastPacket('damageConfirm', {
      peerId: this.myId,
      attackerId: data.attackerId,
      damage,
      isHeadshot,
      hitPoint,
      remainingHealth: this.localPlayerRef.health,
      victimId: this.myId
    }, data.attackerId, confirmMsgId);

    // Broadcast health update to room for overhead health bars
    this.broadcastPacket('healthUpdate', {
      peerId: this.myId,
      playerId: this.myId,
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
      const killMsgId = 'kill_' + this.myId + '_' + Date.now();
      this.broadcastPacket('kill', {
        peerId: this.myId,
        killerId: data.attackerId,
        killerName: data.attackerName || 'Enemy',
        victimId: this.myId,
        victimName: this.username,
        weaponClass: data.weaponClass || 'assault',
        isHeadshot
      }, null, killMsgId);

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
        const respawnMsgId = 'respawn_' + this.myId + '_' + Date.now();
        this.broadcastPacket('respawn', {
          peerId: this.myId,
          id: this.myId,
          position: respawnPoint,
          health: 100
        }, null, respawnMsgId);
      }, 3000);
    }
  }

  onReceiveDamageConfirm(data, peerId) {
    if (!data) return;
    if (data.attackerId !== this.myId) return;

    audio.playHitmarker(data.isHeadshot);
    this.ui.showHitmarker(data.isHeadshot);
    if (data.hitPoint) {
      this.ui.spawnFloatingDamage(data.hitPoint, data.damage, data.isHeadshot, this.camera);
    }
  }

  onReceiveHealthUpdate(data, peerId) {
    if (!data) return;
    const targetId = data.playerId || data.peerId || peerId;
    if (targetId === this.myId) return;

    const remote = this.remotePlayers[targetId];
    if (remote) {
      remote.lastSeen = Date.now();
      remote.updateHealth(data.health, data.maxHealth || 100);
    }
  }

  onReceiveKill(data, peerId) {
    if (!data) return;

    this.ui.addKillFeedKill(data.killerName, data.victimName, data.weaponClass, data.isHeadshot);

    // If local player was the killer
    if (data.killerId === this.myId) {
      this.kills += 1;
      this.score += data.isHeadshot ? 150 : 100;
      audio.playKillConfirmed();
      this.ui.showKillBanner(data.victimName, data.isHeadshot);
      this.updateScoreboardSelf();
    }

    // If victim was a remote player
    if (data.victimId !== this.myId) {
      const remote = this.remotePlayers[data.victimId];
      if (remote) {
        remote.onEliminated();
      }
    }
  }

  onReceiveRespawn(data, peerId) {
    if (!data) return;
    const targetId = data.id || data.peerId || peerId;
    if (targetId === this.myId) return;

    const remote = this.remotePlayers[targetId];
    if (remote && data.position) {
      remote.lastSeen = Date.now();
      remote.onRespawn(data.position);
    }
  }

  onReceiveChat(data, peerId) {
    if (!data) return;
    this.ui.addChatMessage(data.sender, data.color, data.text);
  }

  onReceiveLeave(packet, peerId) {
    const targetId = packet?.peerId || peerId;
    if (!targetId || targetId === this.myId) return;

    const remote = this.remotePlayers[targetId];
    if (remote) {
      this.ui.addKillFeedMessage(`${remote.username} left the arena`, 'system');
      this.removeRemotePlayer(targetId);
    }
  }

  // Periodic check: if a peer hasn't sent a packet in 4 seconds, remove their 3D mesh
  checkPeerTimeouts() {
    const now = Date.now();
    let changed = false;
    for (const peerId of Object.keys(this.remotePlayers)) {
      const remote = this.remotePlayers[peerId];
      if (remote && now - remote.lastSeen > 4000) {
        console.log(`[P2P Network] Removing timed-out peer (>4s): ${peerId}`);
        this.ui.addKillFeedMessage(`${remote.username} disconnected`, 'system');
        remote.destroy();
        delete this.remotePlayers[peerId];
        this.announcedPeers.delete(peerId);
        this.ui.removeScoreboardEntry(peerId);
        changed = true;
      }
    }
    if (changed) {
      this.rebuildHitboxCache();
      this.updateOnlineCount();
    }
  }

  // Periodic heartbeat & state broadcast (runs on setInterval so it never freezes in background tabs)
  broadcastHeartbeatAndState() {
    if (!this.localPlayerRef) return;

    // Send continuous state broadcast
    this.sendCurrentState();

    // Check automatic health regeneration even when tab is in background
    this.checkHealthRegen();

    // Check peer timeouts (4s inactivity) even when tab is in background
    this.checkPeerTimeouts();

    // Periodic heartbeat profile ping (every 2 seconds) to guarantee peer awareness
    const now = performance.now();
    if (now - this.lastHeartbeatTime > 2000) {
      this.lastHeartbeatTime = now;
      this.sendSelfProfile();
    }
  }

  sendSelfProfile(targetPeerId = null) {
    const profile = {
      peerId: this.myId,
      id: this.myId,
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

    this.broadcastPacket('profile', profile, targetPeerId);
  }

  sendCurrentState(targetPeerId = null) {
    if (!this.localPlayerRef) return;
    const camEuler = new THREE.Euler(0, 0, 0, 'YXZ').setFromQuaternion(this.camera.quaternion);
    const state = {
      peerId: this.myId,
      id: this.myId,
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
      slideDirX: this.localPlayerRef.isSliding ? this.localPlayerRef.slideDirection.x : 0,
      slideDirZ: this.localPlayerRef.isSliding ? this.localPlayerRef.slideDirection.z : 0,
      slideYaw: this.localPlayerRef.isSliding ? Math.atan2(-this.localPlayerRef.slideDirection.x, -this.localPlayerRef.slideDirection.z) : null,
      health: this.localPlayerRef.health,
      isAlive: this.localPlayerRef.isAlive,
      kills: this.kills,
      deaths: this.deaths,
      score: this.score
    };

    this.broadcastPacket('state', state, targetPeerId);
  }

  sendPlayerState(state) {
    const now = performance.now();
    if (now - this.lastSent < this.sendRateMs) return;
    this.lastSent = now;

    const fullState = {
      peerId: this.myId,
      id: this.myId,
      username: this.username,
      color: this.color,
      weaponClass: this.weaponClass,
      ...state,
      health: this.localPlayerRef ? this.localPlayerRef.health : 100,
      isAlive: this.localPlayerRef ? this.localPlayerRef.isAlive : true,
      kills: this.kills,
      deaths: this.deaths,
      score: this.score
    };

    this.broadcastPacket('state', fullState);
  }

  recordHit(targetId, hitboxType, hitPoint) {
    const weapon = WEAPONS_STATS[this.weaponClass] || WEAPONS_STATS.assault;
    const isHeadshot = hitboxType === 'head';
    const baseDamage = weapon.damage;
    const actualDamage = isHeadshot ? Math.round(baseDamage * weapon.headMultiplier) : baseDamage;

    const msgId = 'hit_' + this.myId + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

    // Send hit payload directly to target peer via dual transport
    this.broadcastPacket('hit', {
      peerId: this.myId,
      targetId,
      damage: actualDamage,
      isHeadshot,
      hitPoint: { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z },
      attackerId: this.myId,
      attackerName: this.username,
      weaponClass: this.weaponClass
    }, targetId, msgId);
  }

  broadcastShoot(origin, direction, hitPoint) {
    const msgId = 'shoot_' + this.myId + '_' + Date.now();
    this.broadcastPacket('shoot', {
      peerId: this.myId,
      origin: { x: origin.x, y: origin.y, z: origin.z },
      direction: { x: direction.x, y: direction.y, z: direction.z },
      hitPoint: { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z },
      weaponClass: this.weaponClass
    }, null, msgId);
  }

  changeWeapon(newWeaponClass) {
    this.weaponClass = newWeaponClass;
    this.sendSelfProfile();
    this.sendCurrentState();
  }

  sendChatMessage(text) {
    const cleanText = (text || '').toString().trim().slice(0, 100);
    if (!cleanText) return;

    const msgId = 'chat_' + this.myId + '_' + Date.now();
    this.broadcastPacket('chat', {
      peerId: this.myId,
      sender: this.username,
      color: this.color,
      text: cleanText
    }, null, msgId);

    this.ui.addChatMessage(this.username, this.color, cleanText);
  }

  updateScoreboardSelf() {
    this.ui.updateScoreboardEntry({
      id: this.myId,
      username: this.username,
      color: this.color,
      kills: this.kills,
      deaths: this.deaths,
      score: this.score
    });
  }

  updateOnlineCount() {
    const count = 1 + Object.keys(this.remotePlayers).length;
    this.ui.updateOnlineCount(count, this.roomId);
  }

  removeRemotePlayer(peerId) {
    const remote = this.remotePlayers[peerId];
    if (remote) {
      remote.destroy();
      delete this.remotePlayers[peerId];
      this.announcedPeers.delete(peerId);
      this.rebuildHitboxCache();
      this.updateOnlineCount();
      this.ui.removeScoreboardEntry(peerId);
    }
  }

  rebuildHitboxCache() {
    this.enemyHitboxes = [];
    for (const remote of Object.values(this.remotePlayers)) {
      if (remote && remote.isAlive) {
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

  checkHealthRegen() {
    if (!this.localPlayerRef || !this.localPlayerRef.isAlive || this.localPlayerRef.health >= 100) {
      if (this.isRegenerating) {
        this.isRegenerating = false;
        this.ui.updateHealth(this.localPlayerRef?.health || 100, 100, false);
      }
      return;
    }

    const now = Date.now();
    if (this.lastDamageTime > 0 && now - this.lastDamageTime >= 5000) {
      if (now - this.lastRegenTick >= 250) {
        this.lastRegenTick = now;
        const prevHp = this.localPlayerRef.health;
        this.localPlayerRef.health = Math.min(100, this.localPlayerRef.health + 5);
        this.isRegenerating = this.localPlayerRef.health < 100;

        if (this.localPlayerRef.health !== prevHp) {
          this.ui.updateHealth(this.localPlayerRef.health, 100, this.isRegenerating);
          this.broadcastPacket('healthUpdate', {
            peerId: this.myId,
            playerId: this.myId,
            health: this.localPlayerRef.health,
            maxHealth: 100,
            isRegenerating: this.isRegenerating
          });
        }

        if (!this.isRegenerating) {
          this.lastDamageTime = 0;
        }
      }
    }
  }

  update(delta) {
    // 1. Check for peer timeouts (> 4 seconds of inactivity)
    this.checkPeerTimeouts();

    // 2. Update all remote player animations & interpolation
    for (const remote of Object.values(this.remotePlayers)) {
      remote.update(delta);
    }

    // 3. Client-side automatic health regeneration
    this.checkHealthRegen();
  }

  destroy() {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close();
      } catch (_) {}
      this.broadcastChannel = null;
    }
    if (this.room) {
      try {
        this.room.leave();
      } catch (_) {}
      this.room = null;
    }
    for (const peerId of Object.keys(this.remotePlayers)) {
      this.remotePlayers[peerId].destroy();
    }
    this.remotePlayers = {};
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
    this.id = data.id || data.peerId;
    this.username = data.username || 'Operative';
    this.color = data.color || '#00f0ff';
    this.weaponClass = data.weaponClass || 'assault';
    this.scene = scene;
    this.isAlive = data.isAlive !== false;
    this.lastSeen = Date.now();

    this.currentPosition = new THREE.Vector3(data.position?.x || 0, data.position?.y || 0, data.position?.z || 0);
    this.targetPosition = new THREE.Vector3().copy(this.currentPosition);
    this.currentYaw = 0;
    this.targetRotation = { yaw: 0, pitch: 0 };
    this.isSprinting = false;
    this.isSliding = false;
    this.slideDir = new THREE.Vector2(0, 0);
    this.slideYaw = 0;
    this.runCycle = 0;

    // Main 3D Container
    this.root = new THREE.Group();
    this.root.position.copy(this.currentPosition);
    this.scene.add(this.root);

    this.buildCharacterMesh();
    this.buildNameplate();
    this.updateHealth(data.health ?? 100);
  }

  buildCharacterMesh() {
    const suitMat = new THREE.MeshStandardMaterial({
      color: 0x1a2333,
      roughness: 0.6,
      metalness: 0.4
    });

    const armorMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.color),
      roughness: 0.35,
      metalness: 0.7
    });

    const visorMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff
    });

    // 1. Torso
    const torsoGeo = new THREE.CylinderGeometry(0.35, 0.3, 0.9, 8);
    this.bodyMesh = new THREE.Mesh(torsoGeo, suitMat);
    this.bodyMesh.position.y = 1.05;
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.root.add(this.bodyMesh);

    // Armor chest plate
    const chestGeo = new THREE.BoxGeometry(0.5, 0.45, 0.35);
    const chestMesh = new THREE.Mesh(chestGeo, armorMat);
    chestMesh.position.set(0, 0.1, 0.08);
    this.bodyMesh.add(chestMesh);

    // Body Hitbox
    this.bodyHitbox = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 1.1, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this.bodyHitbox.position.y = 0.95;
    this.bodyHitbox.userData = {
      isHitbox: true,
      hitboxType: 'body',
      playerId: this.id
    };
    this.root.add(this.bodyHitbox);

    // 2. Head & Helmet
    this.headMesh = new THREE.Group();
    this.headMesh.position.y = 1.72;
    this.root.add(this.headMesh);

    const helmetGeo = new THREE.SphereGeometry(0.28, 8, 8);
    const helmet = new THREE.Mesh(helmetGeo, suitMat);
    helmet.castShadow = true;
    this.headMesh.add(helmet);

    // Visor
    const visorGeo = new THREE.BoxGeometry(0.32, 0.12, 0.18);
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 0.02, 0.2);
    this.headMesh.add(visor);

    // Head Hitbox (2x damage multiplier)
    this.headHitbox = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 8, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this.headHitbox.position.y = 1.72;
    this.headHitbox.userData = {
      isHitbox: true,
      hitboxType: 'head',
      playerId: this.id
    };
    this.root.add(this.headHitbox);

    // 3. Left Leg
    const legGeo = new THREE.CylinderGeometry(0.12, 0.1, 0.65, 6);
    this.leftLeg = new THREE.Mesh(legGeo, armorMat);
    this.leftLeg.position.set(-0.2, 0.32, 0);
    this.leftLeg.castShadow = true;
    this.root.add(this.leftLeg);

    // 4. Right Leg
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

    // Always-visible nameplate material through walls & bridges (depthTest: false, depthWrite: false, renderOrder: 9999)
    const spriteMat = new THREE.SpriteMaterial({
      map: this.nameplateTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });

    this.nameplateSprite = new THREE.Sprite(spriteMat);
    this.nameplateSprite.position.set(0, 2.3, 0);
    this.nameplateSprite.scale.set(1.8, 0.5, 1);
    this.nameplateSprite.renderOrder = 9999;
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

    // Angle interpolation helper that correctly wraps around shortest path
    const lerpAngle = (current, target, t) => {
      let diff = (target - current) % (Math.PI * 2);
      if (diff < -Math.PI) diff += Math.PI * 2;
      if (diff > Math.PI) diff -= Math.PI * 2;
      return current + diff * t;
    };

    if (this.isSliding) {
      // Orient the root body and legs in the actual direction of the slide!
      const targetYaw = (typeof this.slideYaw === 'number') ? this.slideYaw : this.targetRotation.yaw;
      this.currentYaw = lerpAngle(this.currentYaw, targetYaw, Math.min(1.0, delta * 18));
      this.root.rotation.y = this.currentYaw;

      // Allow head and weapon to point toward player's actual look/aim direction
      let aimYawOffset = (this.targetRotation.yaw - this.currentYaw) % (Math.PI * 2);
      if (aimYawOffset < -Math.PI) aimYawOffset += Math.PI * 2;
      if (aimYawOffset > Math.PI) aimYawOffset -= Math.PI * 2;
      aimYawOffset = Math.max(-1.3, Math.min(1.3, aimYawOffset));

      if (this.headMesh) {
        this.headMesh.rotation.y = THREE.MathUtils.lerp(this.headMesh.rotation.y, aimYawOffset, Math.min(1.0, delta * 15));
        this.headMesh.rotation.x = this.targetRotation.pitch;
      }
      if (this.weaponHolder) {
        this.weaponHolder.rotation.y = THREE.MathUtils.lerp(this.weaponHolder.rotation.y, aimYawOffset, Math.min(1.0, delta * 15));
        this.weaponHolder.rotation.x = this.targetRotation.pitch;
      }
    } else {
      // Normal standing/running: orient root to look yaw
      this.currentYaw = lerpAngle(this.currentYaw, this.targetRotation.yaw, Math.min(1.0, delta * 15));
      this.root.rotation.y = this.currentYaw;

      if (this.headMesh) {
        this.headMesh.rotation.y = THREE.MathUtils.lerp(this.headMesh.rotation.y, 0, Math.min(1.0, delta * 15));
        this.headMesh.rotation.x = this.targetRotation.pitch;
      }
      if (this.weaponHolder) {
        this.weaponHolder.rotation.y = THREE.MathUtils.lerp(this.weaponHolder.rotation.y, 0, Math.min(1.0, delta * 15));
        this.weaponHolder.rotation.x = this.targetRotation.pitch;
      }
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
      this.leftLeg.rotation.x = THREE.MathUtils.lerp(this.leftLeg.rotation.x, -1.2, Math.min(1.0, delta * 14));
      this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, 0.4, Math.min(1.0, delta * 14));
      this.leftLeg.position.z = THREE.MathUtils.lerp(this.leftLeg.position.z, 0.25, Math.min(1.0, delta * 14));
      this.rightLeg.position.z = THREE.MathUtils.lerp(this.rightLeg.position.z, -0.2, Math.min(1.0, delta * 14));
    } else {
      this.leftLeg.position.z = THREE.MathUtils.lerp(this.leftLeg.position.z, 0, Math.min(1.0, delta * 10));
      this.rightLeg.position.z = THREE.MathUtils.lerp(this.rightLeg.position.z, 0, Math.min(1.0, delta * 10));

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
