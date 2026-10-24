import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { WEAPON_DATA, WeaponModelBuilder } from './weapons.js';
import { audio } from './audio.js';

export class LocalPlayer {
  constructor(camera, scene, domElement, map, networkManager, uiManager) {
    this.camera = camera;
    this.scene = scene;
    this.domElement = domElement;
    this.map = map;
    this.network = networkManager;
    this.ui = uiManager;

    this.controls = new PointerLockControls(camera, domElement);

    // Disconnect default unconstrained mousemove listener from PointerLockControls
    this.domElement.ownerDocument.removeEventListener('mousemove', this.controls._onMouseMove);

    // Setup rock-steady Euler rotation tracker for PointerLock with spike filtering and clamping
    const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
    const _PI_2 = Math.PI / 2;

    this._onMouseMoveClamped = (event) => {
      if (this.controls.enabled === false || this.controls.isLocked === false) return;

      const movementX = event.movementX || event.mozMovementX || event.webkitMovementX || 0;
      const movementY = event.movementY || event.mozMovementY || event.webkitMovementY || 0;

      // Ignore huge mouse spikes (Math.abs > 300) so clicking to shoot or lock focus doesn't cause sudden camera jumps
      if (Math.abs(movementX) > 300 || Math.abs(movementY) > 300) {
        return;
      }

      // Clamp movement delta to prevent sudden camera snaps
      const clampedX = Math.max(-100, Math.min(100, movementX));
      const clampedY = Math.max(-100, Math.min(100, movementY));

      _euler.setFromQuaternion(this.camera.quaternion);

      _euler.y -= clampedX * 0.002 * this.controls.pointerSpeed;
      _euler.x -= clampedY * 0.002 * this.controls.pointerSpeed;

      // Clamp vertical pitch between minPolarAngle and maxPolarAngle
      _euler.x = Math.max(_PI_2 - this.controls.maxPolarAngle, Math.min(_PI_2 - this.controls.minPolarAngle, _euler.x));

      this.camera.quaternion.setFromEuler(_euler);
      this.controls.dispatchEvent({ type: 'change' });
    };

    this.domElement.ownerDocument.addEventListener('mousemove', this._onMouseMoveClamped);

    // Player state
    this.isAlive = true;
    this.health = 100;
    this.maxHealth = 100;
    this.weaponClass = 'assault';
    this.weaponStats = WEAPON_DATA.assault;
    this.ammo = this.weaponStats.magSize;
    this.isReloading = false;
    this.reloadProgress = 0;
    this.lastFired = 0;
    this.isADS = false;

    // Movement physics
    this.velocity = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.moveInput = { forward: 0, backward: 0, left: 0, right: 0 };
    this.isSprinting = false;
    this.canJump = false;
    this.gravity = 28.0;
    this.jumpForce = 11.5;
    this.walkSpeed = 10.0;
    this.sprintSpeed = 16.0;
    this.damping = 9.0;
    this.normalEyeHeight = 1.7; // Height above ground
    this.slideEyeHeight = 0.85; // Lowered camera height when sliding
    this.eyeHeight = 1.7;

    // Tactical Sliding State
    this.isSliding = false;
    this.slideTimer = 0;
    this.slideDuration = 0.8; // 0.8 seconds
    this.slideCooldown = 1.1; // 1.1 seconds
    this.lastSlideTime = -10;
    this.slideDirection = new THREE.Vector3();
    this.slideInitialSpeed = 22.0; // Fast initial forward burst
    this.slideTiltAngle = -0.09; // Slight camera/weapon roll during slide
    this.currentRoll = 0;

    // Viewmodel Recoil State (strictly on the 3D gun mesh, zero camera rotation interference)
    this.viewmodelRecoilOffset = new THREE.Vector3(0, 0, 0); // local offset (x, y, z)
    this.viewmodelRecoilRotX = 0; // local tilt angle

    // Gun viewmodel & bobbing
    this.viewmodel = null;
    this.muzzleFlash = null;
    this.viewmodelBasePos = new THREE.Vector3(0.24, -0.22, -0.45);
    this.viewmodelAdsPos = new THREE.Vector3(0.0, -0.165, -0.38);
    this.viewmodelCurrentPos = new THREE.Vector3().copy(this.viewmodelBasePos);
    this.bobTimer = 0;
    this.stepTimer = 0;

    // Raycaster for shooting
    this.raycaster = new THREE.Raycaster();
    this.tracers = [];
    this.particles = [];

    this.setupInputs();
    this.equipWeapon('assault');
  }

  setupInputs() {
    // Keyboard controls
    const onKeyDown = (e) => {
      if (!this.isAlive) return;

      // Don't capture keys if typing in chat
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return;

      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.moveInput.forward = 1;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.moveInput.backward = 1;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.moveInput.left = 1;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.moveInput.right = 1;
          break;
        case 'Space':
          if (this.canJump) {
            this.velocity.y = this.jumpForce;
            this.canJump = false;
            if (this.isSliding) {
              // Jump immediately out of slide
              this.isSliding = false;
              this.slideTimer = 0;
            }
            audio.playJump();
          }
          break;
        case 'KeyC':
        case 'ControlLeft':
        case 'ControlRight':
          this.tryStartSlide();
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.isSprinting = true;
          break;
        case 'KeyR':
          this.reload();
          break;
        case 'Digit1':
          this.changeWeapon('assault');
          break;
        case 'Digit2':
          this.changeWeapon('smg');
          break;
        case 'Digit3':
          this.changeWeapon('sniper');
          break;
      }
    };

    const onKeyUp = (e) => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.moveInput.forward = 0;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.moveInput.backward = 0;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.moveInput.left = 0;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.moveInput.right = 0;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.isSprinting = false;
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // Mouse Controls (Shoot & Aim)
    window.addEventListener('mousedown', (e) => {
      if (!this.controls.isLocked || !this.isAlive) return;

      if (e.button === 0) {
        // Left click: Fire weapon
        this.isFiring = true;
        this.shoot();
      } else if (e.button === 2) {
        // Right click: Aim Down Sights (ADS)
        this.isADS = true;
        this.ui.setAds(true, this.weaponStats.hasScopeOverlay);
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.isFiring = false;
      } else if (e.button === 2) {
        this.isADS = false;
        this.ui.setAds(false, false);
      }
    });

    // Prevent context menu on right click in game
    window.addEventListener('contextmenu', (e) => {
      if (this.controls.isLocked) {
        e.preventDefault();
      }
    });
  }

  tryStartSlide() {
    const now = performance.now() / 1000;
    if (this.isSliding || !this.isAlive) return;
    if (now - this.lastSlideTime < this.slideCooldown) return;
    if (!this.canJump) return; // Must be on the ground

    // Check if player is moving forward or sprinting
    const isMoving = this.moveInput.forward || this.moveInput.left || this.moveInput.right || this.isSprinting;
    if (!isMoving) return;

    this.isSliding = true;
    this.slideTimer = this.slideDuration;
    this.lastSlideTime = now;

    // Get horizontal forward direction from camera
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    forward.y = 0;
    forward.normalize();

    // Blend with strafe if moving sideways
    const sideInput = Number(this.moveInput.right) - Number(this.moveInput.left);
    if (sideInput !== 0) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      right.y = 0;
      right.normalize();
      forward.addScaledVector(right, sideInput * 0.5).normalize();
    }

    this.slideDirection.copy(forward);

    // Initial forward speed burst
    this.velocity.x = this.slideDirection.x * this.slideInitialSpeed;
    this.velocity.z = this.slideDirection.z * this.slideInitialSpeed;

    audio.playSlide();
  }

  equipWeapon(weaponId) {
    if (!WEAPON_DATA[weaponId]) return;
    this.weaponClass = weaponId;
    this.weaponStats = WEAPON_DATA[weaponId];
    this.ammo = this.weaponStats.magSize;
    this.isReloading = false;

    // Remove old viewmodel if any
    if (this.viewmodel) {
      this.camera.remove(this.viewmodel);
      this.viewmodel = null;
    }

    // Create new procedural viewmodel
    this.viewmodel = WeaponModelBuilder.createViewModel(weaponId);
    this.camera.add(this.viewmodel);

    // Muzzle flash holder
    this.muzzleFlash = WeaponModelBuilder.createMuzzleFlash();
    this.muzzleFlash.visible = false;
    this.viewmodel.add(this.muzzleFlash);
    if (this.viewmodel.userData.muzzleOffset) {
      this.muzzleFlash.position.copy(this.viewmodel.userData.muzzleOffset);
    }

    if (this.ui) {
      this.ui.updateAmmo(this.ammo, this.weaponStats.magSize);
      this.ui.updateWeaponCard(this.weaponStats);
    }
  }

  changeWeapon(newWeaponId) {
    if (newWeaponId === this.weaponClass || !WEAPON_DATA[newWeaponId]) return;
    this.equipWeapon(newWeaponId);
    if (this.network) {
      this.network.changeWeapon(newWeaponId);
    }
  }

  shoot() {
    if (!this.isAlive || this.isReloading) return;

    const now = performance.now();
    if (now - this.lastFired < this.weaponStats.fireRateMs) return;

    if (this.ammo <= 0) {
      audio.playEmptyClick();
      this.reload();
      return;
    }

    this.lastFired = now;
    this.ammo--;
    this.ui.updateAmmo(this.ammo, this.weaponStats.magSize);

    // Audio
    audio.playGunshot(this.weaponClass, false);

    // Trigger visual recoil & muzzle flash
    this.applyRecoil();
    this.triggerMuzzleFlash();

    // Calculate raycast direction from exact center of screen (NDC: (0, 0))
    // When ADS/zoomed, always dead-center (0, 0) on the crosshair dot.
    // When hipfiring, apply slight spread in NDC coordinates.
    const screenCoord = this.isADS
      ? new THREE.Vector2(0, 0)
      : new THREE.Vector2(
          (Math.random() - 0.5) * this.weaponStats.spread,
          (Math.random() - 0.5) * this.weaponStats.spread
        );

    this.raycaster.setFromCamera(screenCoord, this.camera);
    const rayOrigin = this.camera.position.clone();
    const rayDir = this.raycaster.ray.direction.clone();

    // Query both other players' hitboxes and map obstacles
    const enemyHitboxes = this.network.getEnemyHitboxes();
    const mapObjects = this.map.interactiveObjects;
    const targetCandidates = [...enemyHitboxes, ...mapObjects];

    const intersects = this.raycaster.intersectObjects(targetCandidates, false);

    let hitPoint = rayOrigin.clone().add(rayDir.clone().multiplyScalar(150));
    let hitObject = null;

    if (intersects.length > 0) {
      const hit = intersects[0];
      hitPoint = hit.point;
      hitObject = hit.object;

      // Check if we hit an enemy player hitbox
      if (hitObject.userData && hitObject.userData.isHitbox) {
        const targetId = hitObject.userData.playerId;
        const hitboxType = hitObject.userData.hitboxType; // 'head' or 'body'

        if (this.network) {
          this.network.recordHit(targetId, hitboxType, hitPoint);
        }
      } else {
        // Hit environment: spawn spark particles
        this.spawnSparks(hitPoint, hit.face ? hit.face.normal : new THREE.Vector3(0, 1, 0));
      }
    }

    // Spawn visual tracer line
    const gunMuzzleWorld = new THREE.Vector3();
    if (this.muzzleFlash) {
      this.muzzleFlash.getWorldPosition(gunMuzzleWorld);
    } else {
      gunMuzzleWorld.copy(this.camera.position).add(new THREE.Vector3(0.2, -0.2, -0.4).applyQuaternion(this.camera.quaternion));
    }
    this.spawnTracer(gunMuzzleWorld, hitPoint);

    // Broadcast shoot event to other players
    if (this.network) {
      this.network.broadcastShoot(gunMuzzleWorld, rayDir, hitPoint);
    }
  }

  applyRecoil() {
    // 1. Completely removing any camera rotation changes so player's crosshair and view stay 100% steady.
    
    // 2. Applying recoil strictly to the 3D weapon viewmodel mesh
    let kickZ = 0.08;
    let liftY = 0.015;
    let tiltX = 0.12;

    if (this.weaponClass === 'sniper') {
      kickZ = 0.18;
      liftY = 0.035;
      tiltX = 0.24;
    } else if (this.weaponClass === 'smg') {
      kickZ = 0.05;
      liftY = 0.01;
      tiltX = 0.07;
    }

    // Accumulate recoil on gun viewmodel mesh
    this.viewmodelRecoilOffset.z = Math.min(0.25, this.viewmodelRecoilOffset.z + kickZ);
    this.viewmodelRecoilOffset.y = Math.min(0.06, this.viewmodelRecoilOffset.y + liftY);
    this.viewmodelRecoilRotX = Math.min(0.35, this.viewmodelRecoilRotX + tiltX);

    // Expand crosshair slightly via UI
    this.ui.triggerCrosshairRecoil();
  }

  triggerMuzzleFlash() {
    if (!this.muzzleFlash) return;
    this.muzzleFlash.visible = true;
    this.muzzleFlash.rotation.z = Math.random() * Math.PI * 2;
    setTimeout(() => {
      if (this.muzzleFlash) this.muzzleFlash.visible = false;
    }, 45);
  }

  spawnTracer(start, end) {
    const distance = start.distanceTo(end);
    const geom = new THREE.CylinderGeometry(0.015, 0.015, distance, 6);
    geom.translate(0, distance / 2, 0);
    geom.rotateX(Math.PI / 2);

    const mat = new THREE.MeshBasicMaterial({
      color: 0xffee88,
      transparent: true,
      opacity: 0.95
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(start);
    mesh.lookAt(end);
    this.scene.add(mesh);

    this.tracers.push({
      mesh,
      created: performance.now(),
      lifetime: 90 // ms
    });
  }

  spawnSparks(position, normal) {
    const sparkCount = 6;
    for (let i = 0; i < sparkCount; i++) {
      const geo = new THREE.SphereGeometry(0.03, 4, 4);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffaa22 });
      const spark = new THREE.Mesh(geo, mat);
      spark.position.copy(position);

      const vel = normal.clone().multiplyScalar(1.5 + Math.random() * 2);
      vel.x += (Math.random() - 0.5) * 3;
      vel.y += (Math.random() - 0.5) * 3;
      vel.z += (Math.random() - 0.5) * 3;

      this.scene.add(spark);
      this.particles.push({
        mesh: spark,
        vel,
        created: performance.now(),
        lifetime: 250
      });
    }
  }

  reload() {
    if (this.isReloading || this.ammo === this.weaponStats.magSize) return;

    this.isReloading = true;
    audio.playReload();
    this.ui.startReloadAnimation(this.weaponStats.reloadTimeMs);

    setTimeout(() => {
      if (!this.isAlive) return;
      this.ammo = this.weaponStats.magSize;
      this.isReloading = false;
      this.ui.updateAmmo(this.ammo, this.weaponStats.magSize);
    }, this.weaponStats.reloadTimeMs);
  }

  respawn(spawnPos, health = 100) {
    this.isAlive = true;
    this.health = health;
    this.ammo = this.weaponStats.magSize;
    this.isReloading = false;
    this.velocity.set(0, 0, 0);

    this.camera.position.set(spawnPos.x, spawnPos.y + this.eyeHeight, spawnPos.z);
    this.camera.quaternion.identity();

    this.ui.updateHealth(this.health, this.maxHealth);
    this.ui.updateAmmo(this.ammo, this.weaponStats.magSize);
    this.ui.hideEliminationScreen();

    // Lock pointer back in if desired
    if (!this.controls.isLocked) {
      this.controls.lock();
    }
  }

  update(delta) {
    if (!this.controls.isLocked || !this.isAlive) {
      this.updateParticles(delta);
      return;
    }

    // Continuous fire for automatic weapons (Assault, SMG)
    if (this.isFiring && this.weaponClass !== 'sniper') {
      this.shoot();
    }

    // 1. Movement & Sliding Physics
    if (this.isSliding) {
      this.slideTimer -= delta;
      const progress = 1.0 - Math.max(0, this.slideTimer / this.slideDuration);
      // Fast initial forward burst that smoothly decays over 0.8s
      const currentSlideSpeed = THREE.MathUtils.lerp(this.slideInitialSpeed, this.walkSpeed, Math.pow(progress, 0.75));
      this.velocity.x = this.slideDirection.x * currentSlideSpeed;
      this.velocity.z = this.slideDirection.z * currentSlideSpeed;

      if (this.slideTimer <= 0) {
        this.isSliding = false;
      }
    } else {
      const currentSpeed = this.isSprinting ? this.sprintSpeed : this.walkSpeed;
      this.direction.z = Number(this.moveInput.forward) - Number(this.moveInput.backward);
      this.direction.x = Number(this.moveInput.right) - Number(this.moveInput.left);
      this.direction.normalize();

      // Smooth horizontal deceleration
      this.velocity.x -= this.velocity.x * this.damping * delta;
      this.velocity.z -= this.velocity.z * this.damping * delta;

      // Apply movement acceleration relative to camera horizontal yaw
      if (this.moveInput.forward || this.moveInput.backward) {
        this.velocity.z -= this.direction.z * currentSpeed * 6.0 * delta;
      }
      if (this.moveInput.left || this.moveInput.right) {
        this.velocity.x -= this.direction.x * currentSpeed * 6.0 * delta;
      }
    }

    // Apply gravity
    this.velocity.y -= this.gravity * delta;

    // Smoothly lerp camera eye height down during slide (1.7 -> 0.85), and back up when finished
    const targetEyeHeight = this.isSliding ? this.slideEyeHeight : this.normalEyeHeight;
    this.eyeHeight = THREE.MathUtils.lerp(this.eyeHeight, targetEyeHeight, delta * 12);

    // Smoothly lerp camera & weapon roll tilt during slide
    const targetRoll = this.isSliding ? this.slideTiltAngle : 0;
    this.currentRoll = THREE.MathUtils.lerp(this.currentRoll, targetRoll, delta * 12);

    // Apply Z roll angle to camera quaternion
    const rollEuler = new THREE.Euler(0, 0, 0, 'YXZ').setFromQuaternion(this.camera.quaternion);
    rollEuler.z = this.currentRoll;
    this.camera.quaternion.setFromEuler(rollEuler);

    // Calculate move vector in world space
    const moveVector = new THREE.Vector3();
    this.controls.moveRight(-this.velocity.x * delta);
    this.controls.moveForward(-this.velocity.z * delta);
    this.camera.position.y += this.velocity.y * delta;

    // 2. Map & Ramp Collision Resolution (Full 3D AABB & Step-Up Support)
    const feetPos = this.camera.position.clone();
    feetPos.y -= this.eyeHeight;

    const { groundHeight, onRamp } = this.map.resolveCollisions(feetPos, 0.45, 1.8);

    // Apply resolved ground & vertical collisions
    if (feetPos.y <= groundHeight) {
      this.velocity.y = Math.max(0, this.velocity.y);
      this.camera.position.y = groundHeight + this.eyeHeight;
      this.canJump = true;
    } else if (feetPos.y <= groundHeight + 0.2) {
      // Allow jumping when running up ramps or stepped onto platforms
      this.canJump = true;
    } else {
      this.canJump = false;
    }

    // Sync back resolved horizontal position and stepped-up vertical position
    this.camera.position.x = feetPos.x;
    this.camera.position.z = feetPos.z;
    if (feetPos.y > this.camera.position.y - this.eyeHeight) {
      this.camera.position.y = feetPos.y + this.eyeHeight;
    }

    // Out-of-bounds safety check (if fallen off map)
    if (this.camera.position.y < -5) {
      this.camera.position.set(0, 3, 0);
      this.velocity.set(0, 0, 0);
    }

    // 3. Footstep Sounds
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.canJump && horizontalSpeed > 1.5) {
      this.stepTimer += delta * (this.isSprinting ? 2.5 : 1.7);
      if (this.stepTimer > 1.0) {
        audio.playFootstep();
        this.stepTimer = 0;
      }
    }

    // 4. Viewmodel Bobbing, ADS, and Smooth Recoil Recovery strictly on Gun Mesh
    const targetFov = this.isADS ? this.weaponStats.adsFov : this.weaponStats.normalFov;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, delta * 14);
    this.camera.updateProjectionMatrix();

    if (this.viewmodel) {
      const basePos = this.isADS ? this.viewmodelAdsPos : this.viewmodelBasePos;

      // Bobbing calculation
      let bobX = 0;
      let bobY = 0;
      if (horizontalSpeed > 0.8 && this.canJump && !this.isADS) {
        this.bobTimer += delta * (this.isSprinting ? 14 : 9);
        bobX = Math.cos(this.bobTimer) * 0.015;
        bobY = Math.abs(Math.sin(this.bobTimer)) * 0.02;
      } else {
        // Idle breathing bob
        bobY = Math.sin(performance.now() * 0.002) * 0.003;
      }

      this.viewmodelCurrentPos.x = THREE.MathUtils.lerp(this.viewmodelCurrentPos.x, basePos.x + bobX, delta * 12);
      this.viewmodelCurrentPos.y = THREE.MathUtils.lerp(this.viewmodelCurrentPos.y, basePos.y + bobY, delta * 12);
      this.viewmodelCurrentPos.z = THREE.MathUtils.lerp(this.viewmodelCurrentPos.z, basePos.z, delta * 12);

      // Smoothly recover gun recoil back to resting position
      this.viewmodelRecoilOffset.z = THREE.MathUtils.lerp(this.viewmodelRecoilOffset.z, 0, delta * 16);
      this.viewmodelRecoilOffset.y = THREE.MathUtils.lerp(this.viewmodelRecoilOffset.y, 0, delta * 16);
      this.viewmodelRecoilRotX = THREE.MathUtils.lerp(this.viewmodelRecoilRotX, 0, delta * 16);

      // Apply recoil and bobbing strictly to viewmodel mesh
      this.viewmodel.position.set(
        this.viewmodelCurrentPos.x,
        this.viewmodelCurrentPos.y + this.viewmodelRecoilOffset.y,
        this.viewmodelCurrentPos.z + this.viewmodelRecoilOffset.z
      );
      this.viewmodel.rotation.set(
        this.viewmodelRecoilRotX,
        0,
        this.currentRoll * 1.5
      );

      // Hide viewmodel when sniper is aiming in scope
      if (this.weaponClass === 'sniper' && this.isADS) {
        this.viewmodel.visible = false;
      } else {
        this.viewmodel.visible = true;
      }
    }

    // 5. Network sync tick (extracting yaw & pitch from camera quaternion without modifying camera)
    if (this.network) {
      const camEuler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.network.sendPlayerState({
        position: {
          x: this.camera.position.x,
          y: this.camera.position.y - this.eyeHeight,
          z: this.camera.position.z
        },
        rotation: {
          yaw: camEuler.y,
          pitch: camEuler.x
        },
        velocity: {
          x: this.velocity.x,
          y: this.velocity.y,
          z: this.velocity.z
        },
        isSprinting: this.isSprinting,
        isSliding: this.isSliding
      });
    }

    this.updateTracers();
    this.updateParticles(delta);
  }

  updateTracers() {
    const now = performance.now();
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      const age = now - t.created;
      if (age >= t.lifetime) {
        this.scene.remove(t.mesh);
        t.mesh.geometry.dispose();
        t.mesh.material.dispose();
        this.tracers.splice(i, 1);
      } else {
        t.mesh.material.opacity = 1.0 - (age / t.lifetime);
      }
    }
  }

  updateParticles(delta) {
    const now = performance.now();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      const age = now - p.created;
      if (age >= p.lifetime) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.particles.splice(i, 1);
      } else {
        p.vel.y -= 12 * delta;
        p.mesh.position.addScaledVector(p.vel, delta);
        p.mesh.scale.multiplyScalar(0.96);
      }
    }
  }
}
