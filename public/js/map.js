import * as THREE from 'three';
import { TextureGenerator } from './textures.js';

export class ArenaMap {
  constructor(scene) {
    this.scene = scene;
    this.colliders = []; // Solid AABB boxes: { min: Vector3, max: Vector3 }
    this.ramps = [];     // Ramp objects: { box, axis, dir, startY, endY, minCoord, maxCoord }
    this.interactiveObjects = []; // Meshes for bullet impacts
  }

  build() {
    this.createSkybox();
    this.createLights();
    this.createFloorsAndWalls();
    this.createPlatformsAndRamps();
    this.createCoverObstacles();
    this.createPillarsAndDetails();
    return this;
  }

  createSkybox() {
    // Stylized gradient sky dome
    const skyGeo = new THREE.SphereGeometry(250, 32, 16);
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Cyberpunk dusk atmosphere gradient
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0.0, '#05070f'); // Zenith: Deep midnight
    grad.addColorStop(0.4, '#0f172a'); // Mid: Deep navy slate
    grad.addColorStop(0.7, '#1e1b4b'); // Horizon upper: Indigo twilight
    grad.addColorStop(0.95, '#00f0ff'); // Horizon glow: Cyber cyan
    grad.addColorStop(1.0, '#05070f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 16, 512);

    const skyTex = new THREE.CanvasTexture(canvas);
    const skyMat = new THREE.MeshBasicMaterial({
      map: skyTex,
      side: THREE.BackSide,
      fog: false
    });

    const sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(sky);

    // Arena subtle distance fog (gentle and bright for crisp visibility)
    this.scene.fog = new THREE.FogExp2(0x1a233a, 0.0035);
  }

  createLights() {
    // Increased AmbientLight for bright, crisp visibility on all walls, crates, and pillars
    const ambientLight = new THREE.AmbientLight(0x94a3b8, 1.8);
    this.scene.add(ambientLight);

    // HemisphereLight for rich sky-to-ground bounce lighting like Deadshot.io
    const hemiLight = new THREE.HemisphereLight(0xcde0ff, 0x334155, 1.6);
    hemiLight.position.set(0, 50, 0);
    this.scene.add(hemiLight);

    // Main stadium sun / key light
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight.position.set(40, 70, 30);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 200;
    dirLight.shadow.camera.left = -60;
    dirLight.shadow.camera.right = 60;
    dirLight.shadow.camera.top = 60;
    dirLight.shadow.camera.bottom = -60;
    dirLight.shadow.bias = -0.0005;
    this.scene.add(dirLight);

    // Rim / fill light (cool crisp cyan tone)
    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.0);
    rimLight.position.set(-50, 40, -40);
    this.scene.add(rimLight);

    // Colored accent point lights around arena
    const pointLightConfigs = [
      { x: 0, y: 7.5, z: 0, color: 0x00f0ff, intensity: 2.5, dist: 35 },
      { x: 28, y: 5.5, z: 0, color: 0xff0055, intensity: 2.0, dist: 25 },
      { x: -28, y: 5.5, z: 0, color: 0x00ff66, intensity: 2.0, dist: 25 },
      { x: 0, y: 4, z: 36, color: 0xffaa00, intensity: 2.0, dist: 25 },
      { x: 0, y: 4, z: -36, color: 0x3b82f6, intensity: 2.0, dist: 25 }
    ];

    pointLightConfigs.forEach(cfg => {
      const pLight = new THREE.PointLight(cfg.color, cfg.intensity, cfg.dist);
      pLight.position.set(cfg.x, cfg.y, cfg.z);
      this.scene.add(pLight);

      // Glowing beacon orb mesh
      const orbGeo = new THREE.SphereGeometry(0.35, 12, 12);
      const orbMat = new THREE.MeshBasicMaterial({ color: cfg.color });
      const orb = new THREE.Mesh(orbGeo, orbMat);
      orb.position.copy(pLight.position);
      this.scene.add(orb);
    });
  }

  createFloorsAndWalls() {
    const floorTexture = TextureGenerator.createFloorTexture();
    const wallTexture = TextureGenerator.createWallTexture();

    // Main Ground Floor (100 x 100)
    const floorGeo = new THREE.PlaneGeometry(100, 100);
    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTexture,
      roughness: 0.7,
      metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.interactiveObjects.push(floor);

    // Outer Perimeter Walls (height: 10, thickness: 2)
    const wallMat = new THREE.MeshStandardMaterial({
      map: wallTexture,
      roughness: 0.5,
      metalness: 0.4
    });

    const wallConfigs = [
      // North Wall (Z = -50)
      { width: 100, height: 10, depth: 2, x: 0, y: 5, z: -50 },
      // South Wall (Z = 50)
      { width: 100, height: 10, depth: 2, x: 0, y: 5, z: 50 },
      // East Wall (X = 50)
      { width: 2, height: 10, depth: 100, x: 50, y: 5, z: 0 },
      // West Wall (X = -50)
      { width: 2, height: 10, depth: 100, x: -50, y: 5, z: 0 }
    ];

    wallConfigs.forEach(cfg => {
      const geo = new THREE.BoxGeometry(cfg.width, cfg.height, cfg.depth);
      const wall = new THREE.Mesh(geo, wallMat);
      wall.position.set(cfg.x, cfg.y, cfg.z);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.scene.add(wall);
      this.interactiveObjects.push(wall);

      // Add collider
      this.addBoxCollider(
        cfg.x - cfg.width / 2, cfg.x + cfg.width / 2,
        0, cfg.height,
        cfg.z - cfg.depth / 2, cfg.z + cfg.depth / 2
      );
    });
  }

  createPlatformsAndRamps() {
    const floorTexture = TextureGenerator.createFloorTexture();
    const rampTexture = TextureGenerator.createRampTexture();

    const platMat = new THREE.MeshStandardMaterial({
      map: floorTexture,
      roughness: 0.6,
      metalness: 0.3
    });

    const rampMat = new THREE.MeshStandardMaterial({
      map: rampTexture,
      roughness: 0.5,
      metalness: 0.5
    });

    // 1. Central Elevated Sky Bridge Platform (Height Y = 4.5, dimensions 16 x 20 x 1)
    const centerBridgeGeo = new THREE.BoxGeometry(16, 1, 20);
    const centerBridge = new THREE.Mesh(centerBridgeGeo, platMat);
    centerBridge.position.set(0, 4.0, 0); // top surface is at Y = 4.5, bottom surface at Y = 3.5
    centerBridge.castShadow = true;
    centerBridge.receiveShadow = true;
    this.scene.add(centerBridge);
    this.interactiveObjects.push(centerBridge);

    // Elevated bridge slab collider: allows players to walk freely underneath it (Y = 0 to 3.5)
    this.addBoxCollider(-8, 8, 3.5, 4.5, -10, 10);

    // Bridge Low Half-Wall Cover on East & West edges (Y = 4.5 to 5.7)
    const railMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7, roughness: 0.3 });
    const railEast = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 20), railMat);
    railEast.position.set(7.6, 5.1, 0);
    this.scene.add(railEast);
    this.interactiveObjects.push(railEast);
    this.addBoxCollider(7.2, 8.0, 4.5, 5.7, -10, 10);

    const railWest = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 20), railMat);
    railWest.position.set(-7.6, 5.1, 0);
    this.scene.add(railWest);
    this.interactiveObjects.push(railWest);
    this.addBoxCollider(-8.0, -7.2, 4.5, 5.7, -10, 10);

    // 2. North Ramp leading from Z = 10 to Z = 24 (Length 14, climbs from Y=0 to Y=4.5)
    // In Three.js, tilted plane/box:
    const rampLength = 14;
    const rampWidth = 8;
    const rampHeight = 4.5;
    const rampAngle = Math.atan2(rampHeight, rampLength);
    const hypot = Math.hypot(rampHeight, rampLength);

    // South-facing Ramp (leading up to bridge from South: Z = 10 to Z = 24)
    const southRampMesh = new THREE.Mesh(new THREE.BoxGeometry(rampWidth, 0.6, hypot), rampMat);
    southRampMesh.position.set(0, rampHeight / 2 - 0.2, 10 + rampLength / 2);
    southRampMesh.rotation.x = -rampAngle;
    southRampMesh.castShadow = true;
    southRampMesh.receiveShadow = true;
    this.scene.add(southRampMesh);
    this.interactiveObjects.push(southRampMesh);

    this.ramps.push({
      axis: 'z',
      dir: -1, // climbing when moving -Z (from 24 towards 10)
      minCoord: 10,
      maxCoord: 24,
      minX: -rampWidth / 2,
      maxX: rampWidth / 2,
      startY: 0,
      endY: rampHeight
    });

    // North-facing Ramp (leading up to bridge from North: Z = -24 to Z = -10)
    const northRampMesh = new THREE.Mesh(new THREE.BoxGeometry(rampWidth, 0.6, hypot), rampMat);
    northRampMesh.position.set(0, rampHeight / 2 - 0.2, -10 - rampLength / 2);
    northRampMesh.rotation.x = rampAngle;
    northRampMesh.castShadow = true;
    northRampMesh.receiveShadow = true;
    this.scene.add(northRampMesh);
    this.interactiveObjects.push(northRampMesh);

    this.ramps.push({
      axis: 'z',
      dir: 1, // climbing when moving +Z (from -24 towards -10)
      minCoord: -24,
      maxCoord: -10,
      minX: -rampWidth / 2,
      maxX: rampWidth / 2,
      startY: 0,
      endY: rampHeight
    });

    // 3. Side Terraces (East & West)
    // East Terrace (X = 30 to 45, Z = -10 to 10, height Y = 3.2)
    const eastTerrace = new THREE.Mesh(new THREE.BoxGeometry(15, 0.8, 20), platMat);
    eastTerrace.position.set(37.5, 2.8, 0); // top at Y = 3.2
    eastTerrace.castShadow = true;
    eastTerrace.receiveShadow = true;
    this.scene.add(eastTerrace);
    this.interactiveObjects.push(eastTerrace);
    this.addBoxCollider(30, 45, 0, 3.2, -10, 10);

    // East Terrace Ramp (X = 22 to 30, Z = 0, width 6, height 3.2)
    const eastRampHypot = Math.hypot(3.2, 8);
    const eastRampAngle = Math.atan2(3.2, 8);
    const eastRampMesh = new THREE.Mesh(new THREE.BoxGeometry(eastRampHypot, 0.6, 6), rampMat);
    eastRampMesh.position.set(26, 1.4, 0);
    eastRampMesh.rotation.z = -eastRampAngle;
    this.scene.add(eastRampMesh);
    this.interactiveObjects.push(eastRampMesh);

    this.ramps.push({
      axis: 'x',
      dir: 1, // climbing moving towards +X (22 to 30)
      minCoord: 22,
      maxCoord: 30,
      minZ: -3,
      maxZ: 3,
      startY: 0,
      endY: 3.2
    });

    // West Terrace (X = -45 to -30, Z = -10 to 10, height Y = 3.2)
    const westTerrace = new THREE.Mesh(new THREE.BoxGeometry(15, 0.8, 20), platMat);
    westTerrace.position.set(-37.5, 2.8, 0);
    westTerrace.castShadow = true;
    westTerrace.receiveShadow = true;
    this.scene.add(westTerrace);
    this.interactiveObjects.push(westTerrace);
    this.addBoxCollider(-45, -30, 0, 3.2, -10, 10);

    // West Terrace Ramp (X = -30 to -22, Z = 0, width 6, height 3.2)
    const westRampMesh = new THREE.Mesh(new THREE.BoxGeometry(eastRampHypot, 0.6, 6), rampMat);
    westRampMesh.position.set(-26, 1.4, 0);
    westRampMesh.rotation.z = eastRampAngle;
    this.scene.add(westRampMesh);
    this.interactiveObjects.push(westRampMesh);

    this.ramps.push({
      axis: 'x',
      dir: -1, // climbing moving towards -X (-22 to -30)
      minCoord: -30,
      maxCoord: -22,
      minZ: -3,
      maxZ: 3,
      startY: 0,
      endY: 3.2
    });
  }

  createCoverObstacles() {
    const militaryCrateTex = TextureGenerator.createCrateTexture('military');
    const orangeCrateTex = TextureGenerator.createCrateTexture('orange');
    const metalCrateTex = TextureGenerator.createCrateTexture('metal');

    const matMil = new THREE.MeshStandardMaterial({ map: militaryCrateTex, roughness: 0.6, metalness: 0.3 });
    const matOrg = new THREE.MeshStandardMaterial({ map: orangeCrateTex, roughness: 0.6, metalness: 0.3 });
    const matMet = new THREE.MeshStandardMaterial({ map: metalCrateTex, roughness: 0.5, metalness: 0.6 });

    // Helper to spawn a crate obstacle with collision
    const addCrate = (x, y, z, sx, sy, sz, mat) => {
      const geo = new THREE.BoxGeometry(sx, sy, sz);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y + sy / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.interactiveObjects.push(mesh);

      this.addBoxCollider(
        x - sx / 2, x + sx / 2,
        y, y + sy,
        z - sz / 2, z + sz / 2
      );
      return mesh;
    };

    // 1. Center bridge tactical cover crates
    addCrate(4, 4.5, 4, 2.2, 1.8, 2.2, matMil);
    addCrate(-4, 4.5, -4, 2.2, 1.8, 2.2, matOrg);

    // 2. Mid-field ground crates (North & South lanes)
    // South side cover clusters
    addCrate(-14, 0, 18, 3.0, 2.2, 3.0, matMil);
    addCrate(-14, 0, 21.2, 3.0, 2.2, 3.0, matMet);
    addCrate(14, 0, 18, 3.0, 2.2, 3.0, matOrg);
    addCrate(14, 2.2, 18, 2.2, 1.8, 2.2, matMil); // Stacked crate!

    // North side cover clusters
    addCrate(-14, 0, -18, 3.0, 2.2, 3.0, matOrg);
    addCrate(-14, 2.2, -18, 2.2, 1.8, 2.2, matMil); // Stacked!
    addCrate(14, 0, -18, 3.0, 2.2, 3.0, matMet);
    addCrate(14, 0, -21.2, 3.0, 2.2, 3.0, matMil);

    // 3. Corner bunkers & barriers
    // North-West corner
    addCrate(-30, 0, -32, 4.0, 2.4, 1.5, matMet);
    addCrate(-32, 0, -28, 1.5, 2.4, 4.0, matMil);
    addCrate(-25, 0, -35, 2.5, 1.6, 2.5, matOrg);

    // North-East corner
    addCrate(30, 0, -32, 4.0, 2.4, 1.5, matMil);
    addCrate(32, 0, -28, 1.5, 2.4, 4.0, matMet);
    addCrate(25, 0, -35, 2.5, 1.6, 2.5, matOrg);

    // South-West corner
    addCrate(-30, 0, 32, 4.0, 2.4, 1.5, matMil);
    addCrate(-32, 0, 28, 1.5, 2.4, 4.0, matOrg);
    addCrate(-25, 0, 35, 2.5, 1.6, 2.5, matMet);

    // South-East corner
    addCrate(30, 0, 32, 4.0, 2.4, 1.5, matOrg);
    addCrate(32, 0, 28, 1.5, 2.4, 4.0, matMet);
    addCrate(25, 0, 35, 2.5, 1.6, 2.5, matMil);

    // 4. East & West Terrace upper cover
    addCrate(36, 3.2, -4, 2.0, 1.6, 2.0, matMil);
    addCrate(-36, 3.2, 4, 2.0, 1.6, 2.0, matOrg);
  }

  createPillarsAndDetails() {
    // Massive architectural support pillars supporting arena roof arches
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x1f2937,
      roughness: 0.4,
      metalness: 0.6
    });

    const pillarCoords = [
      [-8, 0, -10],
      [8, 0, -10],
      [-8, 0, 10],
      [8, 0, 10],
      [-28, 0, -28],
      [28, 0, -28],
      [-28, 0, 28],
      [28, 0, 28]
    ];

    pillarCoords.forEach(([px, py, pz]) => {
      const geo = new THREE.CylinderGeometry(1.2, 1.5, 12, 8);
      const pillar = new THREE.Mesh(geo, pillarMat);
      pillar.position.set(px, 6, pz);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      this.scene.add(pillar);
      this.interactiveObjects.push(pillar);

      // Glowing trim ring on pillars
      const ringGeo = new THREE.TorusGeometry(1.4, 0.08, 8, 24);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(px, 4, pz);
      this.scene.add(ring);

      this.addBoxCollider(px - 1.4, px + 1.4, 0, 12, pz - 1.4, pz + 1.4);
    });
  }

  addBoxCollider(minX, maxX, minY, maxY, minZ, maxZ) {
    this.colliders.push({
      min: new THREE.Vector3(Math.min(minX, maxX), Math.min(minY, maxY), Math.min(minZ, maxZ)),
      max: new THREE.Vector3(Math.max(minX, maxX), Math.max(minY, maxY), Math.max(minZ, maxZ))
    });
  }

  // Full 3D AABB and sloped ramp collision detection and resolution
  resolveCollisions(pos, radius = 0.45, height = 1.8) {
    const stepTolerance = 0.55; // Allows stepping up onto platforms/crates/curbs
    let groundHeight = 0; // Base arena floor height
    let onRamp = false;

    // 1. Resolve Sloped Ramp Heights
    for (const ramp of this.ramps) {
      let inside = false;
      let factor = 0;

      if (ramp.axis === 'z') {
        if (pos.x >= ramp.minX - radius && pos.x <= ramp.maxX + radius &&
            pos.z >= ramp.minCoord - 0.3 && pos.z <= ramp.maxCoord + 0.3) {
          const clampedZ = Math.max(ramp.minCoord, Math.min(pos.z, ramp.maxCoord));
          factor = (ramp.dir === 1)
            ? (clampedZ - ramp.minCoord) / (ramp.maxCoord - ramp.minCoord)
            : (ramp.maxCoord - clampedZ) / (ramp.maxCoord - ramp.minCoord);
          inside = true;
        }
      } else if (ramp.axis === 'x') {
        if (pos.z >= ramp.minZ - radius && pos.z <= ramp.maxZ + radius &&
            pos.x >= ramp.minCoord - 0.3 && pos.x <= ramp.maxCoord + 0.3) {
          const clampedX = Math.max(ramp.minCoord, Math.min(pos.x, ramp.maxCoord));
          factor = (ramp.dir === 1)
            ? (clampedX - ramp.minCoord) / (ramp.maxCoord - ramp.minCoord)
            : (ramp.maxCoord - clampedX) / (ramp.maxCoord - ramp.minCoord);
          inside = true;
        }
      }

      if (inside) {
        const rampY = ramp.startY + factor * (ramp.endY - ramp.startY);
        // Only provide floor support if player's feet are near the ramp incline
        if (pos.y >= rampY - 0.7 && pos.y <= rampY + 1.2) {
          groundHeight = Math.max(groundHeight, rampY);
          onRamp = true;
        }
      }
    }

    // 2. Resolve Floor Support on Top of Boxes & Platforms (3D Standing/Walking Support)
    for (const box of this.colliders) {
      const inBoxHoriz = (
        pos.x >= box.min.x - radius && pos.x <= box.max.x + radius &&
        pos.z >= box.min.z - radius && pos.z <= box.max.z + radius
      );

      if (inBoxHoriz) {
        // If player's feet are above or within step tolerance of the top surface, support standing on top!
        if (pos.y >= box.max.y - stepTolerance && pos.y >= box.min.y) {
          groundHeight = Math.max(groundHeight, box.max.y);
        }
      }
    }

    // Step-up snapping: If player is stepping onto a platform or crate within stepTolerance, snap feet to surface
    if (pos.y < groundHeight && pos.y >= groundHeight - stepTolerance) {
      pos.y = groundHeight;
    }

    // 3. 3D Solid Box Horizontal Wall Collisions (with strict vertical height checks)
    for (const box of this.colliders) {
      // Check 1: Walking UNDER elevated bridges/platforms
      // If player's head (pos.y + height) is at or below the bottom of the box, allow walking underneath freely!
      if (pos.y + height <= box.min.y + 0.05) {
        continue;
      }

      // Check 2: Walking ON TOP of boxes/platforms
      // If player's feet are at or above the top surface of the box, allow walking on top without horizontal blocking!
      if (pos.y >= box.max.y - 0.08) {
        continue;
      }

      // Check 3: Seamless ramp-to-platform transition
      // If player is on a ramp and level with or climbing onto this platform, don't trigger horizontal blocking
      if (onRamp && pos.y >= box.max.y - 0.3) {
        continue;
      }

      // Player vertically overlaps with the solid side face of this box: resolve horizontal push-out
      const closestX = Math.max(box.min.x, Math.min(pos.x, box.max.x));
      const closestZ = Math.max(box.min.z, Math.min(pos.z, box.max.z));

      const dx = pos.x - closestX;
      const dz = pos.z - closestZ;
      const distSq = dx * dx + dz * dz;

      if (distSq < radius * radius) {
        const dist = Math.sqrt(distSq);
        if (dist > 0.0001) {
          const overlap = radius - dist;
          pos.x += (dx / dist) * overlap;
          pos.z += (dz / dist) * overlap;
        } else {
          // Push out to the nearest face if penetrated
          const dLeft = Math.abs(pos.x - box.min.x);
          const dRight = Math.abs(box.max.x - pos.x);
          const dBack = Math.abs(pos.z - box.min.z);
          const dFront = Math.abs(box.max.z - pos.z);
          const minD = Math.min(dLeft, dRight, dBack, dFront);

          if (minD === dLeft) pos.x = box.min.x - radius;
          else if (minD === dRight) pos.x = box.max.x + radius;
          else if (minD === dBack) pos.z = box.min.z - radius;
          else pos.z = box.max.z + radius;
        }
      }
    }

    return { groundHeight, onRamp };
  }
}
