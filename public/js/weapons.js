import * as THREE from 'three';

// Weapon Definitions and 3D Procedural Viewmodels
export const WEAPON_DATA = {
  assault: {
    id: 'assault',
    name: 'Assault Rifle',
    type: 'Full-Auto Rifle',
    damage: 24,
    headMultiplier: 2.0,
    fireRateMs: 120, // ~500 RPM
    magSize: 30,
    reloadTimeMs: 1800,
    spread: 0.015,
    adsSpread: 0.004,
    recoilPitch: 0.035,
    recoilYaw: 0.01,
    adsFov: 55,
    normalFov: 75,
    desc: 'Versatile combat rifle. Well-balanced damage, fire rate, and accuracy at all ranges.'
  },
  smg: {
    id: 'smg',
    name: 'SMG Vector',
    type: 'Rapid Submachine Gun',
    damage: 16,
    headMultiplier: 2.0,
    fireRateMs: 80, // ~750 RPM
    magSize: 35,
    reloadTimeMs: 1400,
    spread: 0.03,
    adsSpread: 0.012,
    recoilPitch: 0.022,
    recoilYaw: 0.015,
    adsFov: 62,
    normalFov: 75,
    desc: 'High fire-rate submachine gun. Deadly in close-quarters skirmishes.'
  },
  sniper: {
    id: 'sniper',
    name: 'Heavy Sniper',
    type: 'Bolt-Action Sniper',
    damage: 80,
    headMultiplier: 2.0, // 160 dmg: 1-shot headshot kill
    fireRateMs: 950,
    magSize: 5,
    reloadTimeMs: 2400,
    spread: 0.05,
    adsSpread: 0.0005,
    recoilPitch: 0.12,
    recoilYaw: 0.02,
    adsFov: 24, // High zoom
    normalFov: 75,
    hasScopeOverlay: true,
    desc: 'High-caliber precision rifle. Devastating long-range power with instant headshot elimination.'
  }
};

export class WeaponModelBuilder {
  // Build first-person viewmodel attached to camera
  static createViewModel(weaponId) {
    const gunGroup = new THREE.Group();
    gunGroup.name = `viewmodel_${weaponId}`;

    const darkMetal = new THREE.MeshStandardMaterial({
      color: 0x1a1d24,
      metalness: 0.8,
      roughness: 0.3
    });
    const gunSteel = new THREE.MeshStandardMaterial({
      color: 0x374151,
      metalness: 0.9,
      roughness: 0.25
    });
    const carbon = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.6,
      metalness: 0.1
    });
    const neonCyan = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const neonRed = new THREE.MeshBasicMaterial({ color: 0xff0055 });

    if (weaponId === 'assault') {
      // Receiver / Main Body
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.45), darkMetal);
      body.position.set(0, 0, 0);
      gunGroup.add(body);

      // Top Picatinny Rail
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.35), gunSteel);
      rail.position.set(0, 0.07, 0);
      gunGroup.add(rail);

      // Red Dot Sight
      const sightBase = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.08), carbon);
      sightBase.position.set(0, 0.10, 0.05);
      const sightDot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 8), neonRed);
      sightDot.position.set(0, 0.11, 0.05);
      gunGroup.add(sightBase);
      gunGroup.add(sightDot);

      // Barrel
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.35, 12), gunSteel);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, -0.35);
      gunGroup.add(barrel);

      // Muzzle Brake / Flash Hider
      const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.025, 0.08, 8), darkMetal);
      muzzle.rotation.x = Math.PI / 2;
      muzzle.position.set(0, 0.02, -0.54);
      gunGroup.add(muzzle);

      // Handguard
      const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.10, 0.25), carbon);
      handguard.position.set(0, 0.02, -0.22);
      gunGroup.add(handguard);

      // Magazine (curved 30-round mag)
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.10), darkMetal);
      mag.position.set(0, -0.14, -0.05);
      mag.rotation.x = -0.2;
      gunGroup.add(mag);

      // Pistol Grip
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.08), carbon);
      grip.position.set(0, -0.12, 0.14);
      grip.rotation.x = 0.35;
      gunGroup.add(grip);

      // Tactical Stock
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.28), carbon);
      stock.position.set(0, -0.01, 0.35);
      gunGroup.add(stock);

      // Sci-fi accent line
      const accent = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.01, 0.3), neonCyan);
      accent.position.set(0, 0.02, 0);
      gunGroup.add(accent);

      gunGroup.userData.muzzleOffset = new THREE.Vector3(0, 0.02, -0.58);

    } else if (weaponId === 'smg') {
      // Compact Vector / MP9 style submachine gun
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.32), darkMetal);
      body.position.set(0, 0, 0);
      gunGroup.add(body);

      // Barrel & Suppressor
      const suppressor = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.24, 12), gunSteel);
      suppressor.rotation.x = Math.PI / 2;
      suppressor.position.set(0, 0.02, -0.26);
      gunGroup.add(suppressor);

      // Holo sight
      const holo = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.08), carbon);
      holo.position.set(0, 0.09, 0.02);
      const holoReticle = new THREE.Mesh(new THREE.RingGeometry(0.008, 0.012, 8), neonCyan);
      holoReticle.position.set(0, 0.095, 0.02);
      gunGroup.add(holo);
      gunGroup.add(holoReticle);

      // Angled foregrip
      const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.06), carbon);
      foregrip.position.set(0, -0.10, -0.10);
      foregrip.rotation.x = -0.3;
      gunGroup.add(foregrip);

      // Pistol grip & Magazine inside handle
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.20, 0.08), carbon);
      grip.position.set(0, -0.12, 0.08);
      grip.rotation.x = 0.3;
      gunGroup.add(grip);

      // Folding skeleton stock
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.22), gunSteel);
      stock.position.set(0, 0.02, 0.24);
      gunGroup.add(stock);

      gunGroup.userData.muzzleOffset = new THREE.Vector3(0, 0.02, -0.38);

    } else {
      // Heavy Sniper Rifle (.50 cal styling)
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.15, 0.55), darkMetal);
      body.position.set(0, 0, 0);
      gunGroup.add(body);

      // Long heavy fluted barrel
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, 0.70, 12), gunSteel);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.03, -0.60);
      gunGroup.add(barrel);

      // Massive Muzzle Brake
      const brake = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.12), darkMetal);
      brake.position.set(0, 0.03, -0.98);
      gunGroup.add(brake);

      // High-magnification sniper scope
      const scopeBody = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 12), gunSteel);
      scopeBody.rotation.x = Math.PI / 2;
      scopeBody.position.set(0, 0.14, -0.05);
      gunGroup.add(scopeBody);

      // Scope mount rings
      const ring1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.04), carbon);
      ring1.position.set(0, 0.10, 0.06);
      const ring2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.04), carbon);
      ring2.position.set(0, 0.10, -0.16);
      gunGroup.add(ring1);
      gunGroup.add(ring2);

      // Heavy Mag
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.18, 0.12), carbon);
      mag.position.set(0, -0.15, -0.08);
      gunGroup.add(mag);

      // Heavy Stock with cheek riser
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.38), carbon);
      stock.position.set(0, -0.01, 0.42);
      gunGroup.add(stock);

      // Folded bipod under barrel
      const bipod = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.25), gunSteel);
      bipod.position.set(0, -0.05, -0.45);
      gunGroup.add(bipod);

      gunGroup.userData.muzzleOffset = new THREE.Vector3(0, 0.03, -1.04);
    }

    // Default hipfire offset relative to camera
    gunGroup.position.set(0.24, -0.22, -0.45);
    return gunGroup;
  }

  // Build third-person weapon mesh held by other players
  static createThirdPersonModel(weaponId) {
    const tpGroup = new THREE.Group();
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.8, roughness: 0.3 });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, metalness: 0.9, roughness: 0.2 });

    if (weaponId === 'sniper') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.6), darkMat);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8), steelMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, -0.55);
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.32, 8), darkMat);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.13, -0.05);

      tpGroup.add(body);
      tpGroup.add(barrel);
      tpGroup.add(scope);
      tpGroup.userData.muzzlePos = new THREE.Vector3(0, 0.02, -0.92);

    } else if (weaponId === 'smg') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.15, 0.38), darkMat);
      const suppressor = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.26, 8), steelMat);
      suppressor.rotation.x = Math.PI / 2;
      suppressor.position.set(0, 0.02, -0.26);

      tpGroup.add(body);
      tpGroup.add(suppressor);
      tpGroup.userData.muzzlePos = new THREE.Vector3(0, 0.02, -0.40);

    } else {
      // Assault
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.14, 0.5), darkMat);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.4, 8), steelMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, -0.4);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.20, 0.12), darkMat);
      mag.position.set(0, -0.14, -0.05);

      tpGroup.add(body);
      tpGroup.add(barrel);
      tpGroup.add(mag);
      tpGroup.userData.muzzlePos = new THREE.Vector3(0, 0.02, -0.62);
    }

    return tpGroup;
  }

  // Create temporary muzzle flash
  static createMuzzleFlash() {
    const flashGroup = new THREE.Group();
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xfff0aa,
      transparent: true,
      opacity: 0.9
    });

    const star1 = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 6), flashMat);
    star1.rotation.x = -Math.PI / 2;
    flashGroup.add(star1);

    const pLight = new THREE.PointLight(0xffaa44, 4, 8);
    flashGroup.add(pLight);

    return flashGroup;
  }
}
