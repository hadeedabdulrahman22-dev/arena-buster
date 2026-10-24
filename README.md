# 🎮 ARENA BUSTER - Serverless 3D Multiplayer FPS Web Game

A fast-paced multiplayer 3D first-person shooter web game inspired by **Deadshot.io**, built with **Three.js** and **Trystero (WebRTC Peer-to-Peer)**.

**Play 24/7 anywhere with zero backend server required!** Works as a 100% static web app on **GitHub Pages**, **Vercel**, and any static host, while maintaining dual-compatibility with Node.js/Express.

---

## ⚡ Instant Play (Serverless WebRTC P2P)

### Option A: Play on GitHub Pages / Vercel (Recommended)
1. Open the live deployment link:
   - **GitHub Pages**: `https://<your-username>.github.io/arena-buster/`
   - **Vercel**: Deploy with one click or link your GitHub repo for instant static deployment.
2. Enter your Operative Codename.
3. The room code defaults to **`GLOBAL-ARENA`** so anyone who clicks **PLAY NOW** joins the same public arena immediately!
4. **Custom Room Codes**: Want to play privately with friends? Simply type any room name (e.g. `MY-SQUAD-99`) and share the room code with your friends.

### Option B: Local Testing (Dual Compatibility)
Run locally using Node.js:
```bash
npm start
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🎯 Game Features

### 1. Serverless WebRTC P2P Multiplayer (Trystero)
- **Zero Server Maintenance**: Uses decentralized WebRTC data channels via lightweight public MQTT broker signaling.
- **Global Public Matchmaking**: Room defaults to `GLOBAL-ARENA` for instant matchmaking.
- **Private Match Rooms**: Type any custom room code to battle in private friend lobbies.
- **Client-Side Authoritative Combat**:
  - Direct P2P hit verification and damage confirmation.
  - Floating combat text (`-24`, `-48`, `-160 CRIT!`) and spatial hitmarkers.
  - 3-second safe respawn at the arena point farthest from active enemies.
  - Synchronized kill feed announcements and TAB scoreboard.

### 2. Tactical Sliding Mechanic
- **Trigger**: Press `C` or `Ctrl` while moving or sprinting (`Shift + W`).
- **Physics & Momentum**: Fast initial forward burst of speed that smoothly decays over 0.8 seconds.
- **Camera & Viewmodel Dynamics**: Smoothly lowers camera eye height (`1.7` down to `0.85`), tilts camera/gun with a tactical roll angle, and plays whoosh audio.
- **Multiplayer Sync**: Remote players' 3D character models and hitboxes dynamically duck and slide.

### 3. Automatic Health Regeneration
- **Regen Logic**: If a player takes no damage for 5 seconds, health automatically regenerates at **+5 HP every 250ms** back to 100 HP.
- **HUD Healing Animation**: Glowing cyan/green healing pulse effect on the health bar with a smooth numerical counter.
- **Multiplayer Sync**: Remote overhead billboard health bars smoothly fill up in real time.

### 4. Centered Crosshair & ADS Precision
- Dynamic crosshair strictly locked to screen center with radial expansion on recoil.
- Center dot aligned with NDC `(0, 0)` raycasting for pinpoint accuracy.
- Right-click Aim Down Sights (ADS) for tighter spread (and full mil-dot sniper scope).

### 5. Full 3D Map & Collision Physics
- Elevated sky bridge catwalk, smooth slope ramps, crates, pillars, and boundary walls.
- Full 3D AABB height checks: walk smoothly on top of crates/platforms, walk freely underneath elevated sky bridges, and ascend/descend ramps without invisible walls.

### 6. Weapon Classes

| Class | Damage (Body / Head) | Fire Rate | Mag Size | Range | Special |
|---|---|---|---|---|---|
| **Assault Rifle** | 24 / **48** | 120ms (500 RPM) | 30 | Medium-Long | Balanced all-rounder, holographic red dot |
| **SMG Vector** | 16 / **32** | 80ms (750 RPM) | 35 | Close-Mid | Rapid fire shredder, fast reload |
| **Heavy Sniper** | 80 / **160** *(Instant Kill!)* | 950ms (Bolt-Action) | 5 | Long | Extreme damage, right-click high zoom scope |

*Headshots deal **2x damage** with distinctive crunch sound and critical hitmarkers!*

---

## 🎮 Controls

| Key | Action |
|---|---|
| `W, A, S, D` | Move operative |
| `Mouse` | Look / Aim (PointerLock) |
| `Left Click` | Shoot weapon |
| `Right Click` | Aim Down Sights (ADS) / Sniper Scope |
| `Shift` | Tactical Sprint |
| `C` / `Ctrl` | Tactical Slide |
| `Space` | Jump |
| `R` | Reload weapon |
| `Tab` | Arena Leaderboard / Scoreboard |
| `Enter` | In-Game Chat |
| `Esc` | Release mouse cursor |

---

## 🌐 Deploy to GitHub Pages

1. In your GitHub repository settings, go to **Pages** (`Settings > Pages`).
2. Under **Build and deployment > Source**, select **Deploy from a branch**.
3. Choose branch `main` and folder `/ (root)`.
4. Click **Save**. Your game will be live at `https://<your-username>.github.io/<repo-name>/`!

## 🚀 Deploy to Vercel

1. Import your GitHub repository in the [Vercel Dashboard](https://vercel.com).
2. Framework Preset: **Other** (Static Site).
3. Root Directory: `./`
4. Click **Deploy**. Vercel will build and serve it immediately on a high-speed global edge network!
