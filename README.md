# 🎮 ARENA BUSTER - 3D Multiplayer FPS Web Game

A fast-paced multiplayer 3D first-person shooter web game inspired by **Deadshot.io**, built with **Three.js**, **Node.js**, **Express**, and **Socket.io**.

---

## ⚡ Quick Start

### 1. Start the Server
Run the following in the project root:
```bash
npm start
```
The server will boot and display:
```
=========================================
 ARENA BUSTER - Multiplayer FPS Server 
 Running on http://localhost:3000
 Network IP: http://0.0.0.0:3000
=========================================
```

### 2. Play with Friends (Local & LAN / Wi-Fi)
- **On your machine**: Open your web browser to [http://localhost:3000](http://localhost:3000).
- **For your friends on the same local network**:
  1. Find your local IP address (e.g. `192.168.1.XX` via `ipconfig` in command prompt).
  2. Send your friends the link: `http://192.168.1.XX:3000`.
  3. Enter usernames, choose weapon classes, and jump into the arena together!

---

## 🎯 Game Features

### 1. Tactical Lobby UI
- Clean dark-themed cyberpunk/military interface.
- Username codename input (with automatic random name generation).
- Weapon class selection cards with stat bars.
- Big vibrant blue **PLAY NOW** button.
- Procedural Web Audio API sound effects toggle.

### 2. 3D Combat Arena
- Enclosed perimeter walls with industrial textures and hazard trims.
- Multi-tier vertical gameplay:
  - **Elevated Sky Bridge Platform**: Central elevated platform with protective half-wall peek covers.
  - **Incline Ramps**: Smooth slope-climbing ramps leading up to the sky bridge and side terraces.
  - **Cover Crates**: Single crates, tall stacked double-crates, and barricades for tactical flanking.
  - **Support Pillars**: Heavy architectural pillars with glowing cyan beacon rings.
- Atmospheric dynamic skybox with dusk twilight gradient.
- Atmospheric lighting (sunlight with soft shadows, cool rim light, and colored sci-fi beacons).

### 3. FPS Controls & Shooting
- **PointerLockControls**: Full mouse-look aiming with centered dynamic crosshair.
- **WASD + Sprint + Jump**:
  - `W, A, S, D` / Arrow keys: Movement with realistic momentum and friction.
  - `Shift`: High-speed sprint.
  - `Space`: Jump with gravity physics.
- **Procedural 3D Weapon Models (First-Person Viewmodels)**:
  - Dynamic walking/sprinting viewmodel bobbing & idle breathing sway.
  - Recoil animation (camera punch + weapon kicks back and smoothly recovers).
  - Muzzle flashes & glowing bullet tracers.
  - Wall impact spark bursts.
  - Right-Click **Aim Down Sights (ADS)**:
    - Assault & SMG: Smooth zoom and tightens weapon spread.
    - Sniper Rifle: Full-screen military sniper scope with illuminated mil-dot reticle.
  - Reloading (`R`): Animated reload progress bar and sound effects.

### 4. Weapon Classes

| Class | Damage (Body / Head) | Fire Rate | Mag Size | Range | Special |
|---|---|---|---|---|---|
| **Assault Rifle** | 24 / **48** | 120ms (500 RPM) | 30 | Medium-Long | Balanced all-rounder, holographic red dot |
| **SMG Vector** | 16 / **32** | 80ms (750 RPM) | 35 | Close-Mid | Rapid fire shredder, fast reload |
| **Heavy Sniper** | 80 / **160** *(Instant Kill!)* | 950ms (Bolt-Action) | 5 | Long | Extreme damage, right-click high zoom scope |

*Headshots deal **2x damage** with distinctive crunch sound and critical hitmarkers!*

### 5. Real-Time Multiplayer State (Socket.io)
- Real-time position & rotation synchronization with smooth interpolation (lerping).
- 3D colored humanoid operative models for remote players:
  - Armor torso and glowing team helmet.
  - Floating 2D billboard nameplate showing username and live health bar.
  - Dynamic running leg animations.
  - Separate **Head** and **Body** hitboxes for 2x headshot damage.
  - Remote player muzzle flashes, tracers, and distance-attenuated 3D gunshot sounds.

### 6. Health, Elimination & Automatic Respawn
- **100 HP** with bottom-left animated health bar and low-health danger pulse.
- **Ammo Counter & Reload Indicator** at bottom-right.
- **Top-Right Animated Kill Feed**: Shows `[Killer] 🔫 [Victim]` with special `[HEADSHOT]` badge.
- **Hitmarkers**:
  - White hitmarker for standard body hits.
  - Red hitmarker + floating combat damage text (e.g. `-160 CRIT!`) on headshots.
- **Elimination Overlay**:
  - When eliminated, player sees "ELIMINATED BY [Killer]".
  - Automatic **3-second respawn timer** counts down `3... 2... 1...`.
  - Player automatically respawns at a safe spawn location with full health and ammo!
- **Scoreboard (`Tab` key)**: Displays all players ranked by score, kills, deaths, and K/D ratio.
- **In-Game Chat (`Enter` key)**: Real-time text chat with friends while playing.

---

## ⌨️ Controls Summary

| Key / Action | Function |
|---|---|
| **W, A, S, D** | Move |
| **Shift** | Sprint |
| **Space** | Jump |
| **Mouse Move** | Aim / Look around |
| **Left Click** | Fire Weapon |
| **Right Click** | Aim Down Sights (ADS) / Sniper Scope |
| **R** | Reload |
| **1, 2, 3** | Quick-switch weapon class in game |
| **Tab (Hold)** | Open Leaderboard / Scoreboard |
| **Enter** | Open Chat / Send Message |
| **Esc / Click** | Release / Lock Cursor |
