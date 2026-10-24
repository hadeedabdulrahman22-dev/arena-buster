const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Serve static frontend files (both public/ and root directory for static & serverless compatibility)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));
// Serve local Three.js modules
app.use('/three', express.static(path.join(__dirname, 'node_modules/three')));

// Pre-defined arena spawn points (X, Y, Z - ground feet coordinates)
const SPAWN_POINTS = [
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

// Weapon balance stats
const WEAPONS = {
  assault: {
    name: 'Assault Rifle',
    damage: 24,
    headMultiplier: 2.0,
    fireRateMs: 120, // ~500 RPM
    magSize: 30,
    reloadTimeMs: 1800,
    range: 160
  },
  smg: {
    name: 'SMG',
    damage: 16,
    headMultiplier: 2.0,
    fireRateMs: 80, // 750 RPM
    magSize: 35,
    reloadTimeMs: 1400,
    range: 100
  },
  sniper: {
    name: 'Sniper Rifle',
    damage: 80,
    headMultiplier: 2.0, // 160 = instant headshot kill
    fireRateMs: 950,
    magSize: 5,
    reloadTimeMs: 2400,
    range: 250
  }
};

const PLAYER_COLORS = [
  '#00f0ff', // Cyber Cyan
  '#ff0055', // Neon Crimson
  '#00ff66', // Toxic Green
  '#ffaa00', // Amber
  '#b026ff', // Neon Purple
  '#ffff00', // Bright Yellow
  '#3b82f6', // Electric Blue
  '#ec4899'  // Pink
];

// In-memory player state
const players = new Map();

function getRandomSpawn(excludeId) {
  // Try to find a spawn point far from existing alive enemies
  let bestPoint = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
  let maxMinDist = -1;

  for (const sp of SPAWN_POINTS) {
    let minDistToEnemy = Infinity;
    for (const [id, player] of players.entries()) {
      if (id !== excludeId && player.isAlive) {
        const dx = sp.x - player.position.x;
        const dz = sp.z - player.position.z;
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

io.on('connection', (socket) => {
  console.log(`[Socket Connected] ID: ${socket.id}`);

  socket.on('join', (data) => {
    const username = (data.username || `Player_${socket.id.slice(0, 4)}`).trim().slice(0, 16);
    const weaponClass = ['assault', 'smg', 'sniper'].includes(data.weaponClass) ? data.weaponClass : 'assault';
    const color = PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
    const spawn = getRandomSpawn(socket.id);

    const player = {
      id: socket.id,
      username,
      weaponClass,
      color,
      position: { x: spawn.x, y: spawn.y, z: spawn.z },
      rotation: { yaw: 0, pitch: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      health: 100,
      maxHealth: 100,
      isAlive: true,
      isSprinting: false,
      isSliding: false,
      kills: 0,
      deaths: 0,
      score: 0,
      lastFired: 0,
      lastDamageTime: 0,
      isRegenerating: false
    };

    players.set(socket.id, player);

    // Send init packet to joining client with all current active players
    socket.emit('init', {
      selfId: socket.id,
      player,
      players: Array.from(players.values()),
      weapons: WEAPONS
    });

    // Notify other players
    socket.broadcast.emit('playerJoined', player);
    console.log(`[Player Joined] ${username} (${weaponClass})`);
  });

  // Client position & rotation updates
  socket.on('playerMove', (data) => {
    const player = players.get(socket.id);
    if (!player || !player.isAlive) return;

    if (data.position && typeof data.position.x === 'number') {
      player.position.x = data.position.x;
      player.position.y = data.position.y;
      player.position.z = data.position.z;
    }

    if (data.rotation && typeof data.rotation.yaw === 'number') {
      player.rotation.yaw = data.rotation.yaw;
      player.rotation.pitch = data.rotation.pitch;
    }

    if (data.velocity) {
      player.velocity = data.velocity;
    }

    if (typeof data.isSprinting === 'boolean') {
      player.isSprinting = data.isSprinting;
    }

    if (typeof data.isSliding === 'boolean') {
      player.isSliding = data.isSliding;
      player.slideDirX = data.slideDirX ?? 0;
      player.slideDirZ = data.slideDirZ ?? 0;
      player.slideYaw = data.slideYaw ?? null;
    }
  });

  // Weapon firing broadcast
  socket.on('playerShoot', (data) => {
    const player = players.get(socket.id);
    if (!player || !player.isAlive) return;

    const now = Date.now();
    const weapon = WEAPONS[player.weaponClass] || WEAPONS.assault;

    // Soft rate limiting
    if (now - player.lastFired < weapon.fireRateMs * 0.75) {
      return;
    }
    player.lastFired = now;

    // Broadcast fire event so other players see tracer, muzzle flash, hear shot
    socket.broadcast.emit('remotePlayerShot', {
      id: socket.id,
      weaponClass: player.weaponClass,
      origin: data.origin,
      direction: data.direction,
      hitPoint: data.hitPoint
    });
  });

  // Hit registration
  socket.on('playerHit', (data) => {
    const attacker = players.get(socket.id);
    if (!attacker || !attacker.isAlive) return;

    const target = players.get(data.targetId);
    if (!target || !target.isAlive || target.id === attacker.id) return;

    const weapon = WEAPONS[attacker.weaponClass] || WEAPONS.assault;
    const isHeadshot = data.hitboxType === 'head';
    const baseDamage = weapon.damage;
    const actualDamage = isHeadshot ? Math.round(baseDamage * weapon.headMultiplier) : baseDamage;

    target.health = Math.max(0, target.health - actualDamage);
    target.lastDamageTime = Date.now();
    target.isRegenerating = false;

    // Notify attacker (hitmarker / feedback)
    socket.emit('damageDealt', {
      targetId: target.id,
      targetName: target.username,
      damage: actualDamage,
      isHeadshot,
      remainingHealth: target.health,
      hitPoint: data.hitPoint
    });

    // Notify target
    io.to(target.id).emit('damageTaken', {
      attackerId: attacker.id,
      attackerName: attacker.username,
      damage: actualDamage,
      isHeadshot,
      remainingHealth: target.health
    });

    // Broadcast updated health so everyone's overhead bars reflect it
    io.emit('healthUpdate', {
      playerId: target.id,
      health: target.health,
      maxHealth: target.maxHealth
    });

    // Handle elimination
    if (target.health <= 0) {
      target.isAlive = false;
      target.deaths += 1;
      attacker.kills += 1;
      attacker.score += isHeadshot ? 150 : 100;

      // Broadcast kill event for kill feed & scoreboard
      io.emit('playerKilled', {
        killerId: attacker.id,
        killerName: attacker.username,
        victimId: target.id,
        victimName: target.username,
        weaponClass: attacker.weaponClass,
        isHeadshot,
        killerScore: attacker.score,
        killerKills: attacker.kills,
        victimDeaths: target.deaths
      });

      // Send elimination screen trigger to victim
      io.to(target.id).emit('eliminated', {
        killerName: attacker.username,
        isHeadshot,
        respawnTimeMs: 3000
      });

      console.log(`[Kill] ${attacker.username} killed ${target.username} (${isHeadshot ? 'HEADSHOT' : 'BODY'}) with ${attacker.weaponClass}`);

      // Auto-respawn after 3 seconds
      setTimeout(() => {
        if (!players.has(target.id)) return; // Player may have left
        const respawnPoint = getRandomSpawn(target.id);
        target.health = 100;
        target.isAlive = true;
        target.lastDamageTime = 0;
        target.isRegenerating = false;
        target.isSliding = false;
        target.position = { x: respawnPoint.x, y: respawnPoint.y, z: respawnPoint.z };
        target.velocity = { x: 0, y: 0, z: 0 };

        io.to(target.id).emit('respawn', {
          position: target.position,
          health: 100
        });

        io.emit('playerRespawned', {
          id: target.id,
          position: target.position,
          health: 100
        });
      }, 3000);
    }
  });

  // Weapon switch in-game
  socket.on('changeWeapon', (newWeapon) => {
    const player = players.get(socket.id);
    if (!player || !WEAPONS[newWeapon]) return;
    player.weaponClass = newWeapon;
    io.emit('playerWeaponChanged', {
      id: socket.id,
      weaponClass: newWeapon
    });
  });

  // Chat message
  socket.on('chatMessage', (msg) => {
    const player = players.get(socket.id);
    if (!player) return;
    const text = (msg || '').toString().trim().slice(0, 100);
    if (!text) return;
    io.emit('chatMessage', {
      sender: player.username,
      color: player.color,
      text
    });
  });

  // Disconnection
  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (player) {
      console.log(`[Player Left] ${player.username} (${socket.id})`);
      players.delete(socket.id);
      io.emit('playerLeft', socket.id);
    }
  });
});

// Automatic Health Regeneration Loop (Checks every 250ms)
// If a player took no damage for 5 seconds (5000ms), regenerate +5 HP every 250ms smoothly up to 100
setInterval(() => {
  if (players.size === 0) return;
  const now = Date.now();

  for (const [id, player] of players.entries()) {
    if (player.isAlive && player.health < player.maxHealth) {
      if (player.lastDamageTime > 0 && now - player.lastDamageTime >= 5000) {
        const prevHp = player.health;
        player.health = Math.min(player.maxHealth, player.health + 5);
        player.isRegenerating = player.health < player.maxHealth;

        if (player.health !== prevHp) {
          io.emit('healthUpdate', {
            playerId: player.id,
            health: player.health,
            maxHealth: player.maxHealth,
            isRegenerating: player.isRegenerating
          });
        }
      }
    } else if (player.isRegenerating) {
      player.isRegenerating = false;
    }
  }
}, 250);

// Periodic state broadcast (30 ticks per second) for smooth interpolation
setInterval(() => {
  if (players.size === 0) return;

  const snapshot = [];
  for (const [id, p] of players.entries()) {
    snapshot.push({
      id: p.id,
      username: p.username,
      color: p.color,
      weaponClass: p.weaponClass,
      position: p.position,
      rotation: p.rotation,
      velocity: p.velocity,
      isSprinting: p.isSprinting,
      isSliding: p.isSliding,
      slideDirX: p.slideDirX || 0,
      slideDirZ: p.slideDirZ || 0,
      slideYaw: p.slideYaw ?? null,
      isRegenerating: p.isRegenerating,
      health: p.health,
      isAlive: p.isAlive,
      kills: p.kills,
      deaths: p.deaths,
      score: p.score
    });
  }

  io.emit('gameState', {
    timestamp: Date.now(),
    players: snapshot
  });
}, 33); // ~30Hz

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(` ARENA BUSTER - Multiplayer FPS Server `);
  console.log(` Running on http://localhost:${PORT}`);
  console.log(` Network IP: http://0.0.0.0:${PORT}`);
  console.log(`=========================================`);
});
