// Pasar Senja — the night market itself.
//
// Layout (metres, x east, z south; the yard is 44 x 36, walled in):
//   Malam spawn .......... north (z = -14) .......... Site A (east, x = 14)
//   west lane (x = -16)   mid lane (x = 0)   east lane (x = 16)
//   Senja spawn .......... south (z = +14) .......... bomb starts with Senja
//
// Cover is stalls (counter + striped awning + sign), crates, and two
// shipping containers. Every solid is an axis-aligned box collider, so
// movement, bullets and bot sight all agree on the same map. Nothing here
// is copied from any commercial game: the stalls sell sate, kopi, batik,
// fruit and jamu, under paper lanterns and string lights.

import * as THREE from 'three';
import { STALL_SIGNS } from './config.js';
import {
  awningTexture, containerTexture, groundTexture, lanternTexture,
  signTexture, wallTexture, woodTexture,
} from './textures.js';

const BOUNDS = { minX: -22, maxX: 22, minZ: -18, maxZ: 18 };

// Waypoints bots walk between. Each route is a list of node names; a bot
// follows its route, pauses at cover nodes, and re-paths when its target
// changes (push the site, hold mid, rotate to defuse).
const WAYPOINTS = {
  spawnSenja: [0, 14.5], midSouth: [0, 8], westSouth: [-16, 8], eastSouth: [16, 8],
  mid: [0, 0], westMid: [-16, 0], eastMid: [16, 0],
  midNorth: [0, -8], westNorth: [-16, -8], eastNorth: [16, -8],
  site: [14, -11], siteWest: [8, -11], siteSouth: [14, -5],
  spawnMalam: [0, -14.5], market: [-8, -4], plaza: [8, 4],
};

const ROUTES = {
  senjaWest: ['spawnSenja', 'westSouth', 'westMid', 'westNorth', 'spawnMalam'],
  senjaMid: ['spawnSenja', 'midSouth', 'mid', 'midNorth', 'spawnMalam'],
  senjaEast: ['spawnSenja', 'eastSouth', 'eastMid', 'siteSouth', 'site'],
  senjaSite: ['spawnSenja', 'midSouth', 'plaza', 'siteSouth', 'site'],
  malamSite: ['spawnMalam', 'eastNorth', 'site', 'siteWest'],
  malamMid: ['spawnMalam', 'midNorth', 'mid', 'midSouth'],
  malamWest: ['spawnMalam', 'westNorth', 'westMid', 'westSouth'],
};

export function createWorld(scene) {
  const colliders = [];
  const shootables = [];
  const group = new THREE.Group();
  scene.add(group);

  const groundMat = new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95 });
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.9 });
  const woodMat = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.85 });
  const darkWood = new THREE.MeshStandardMaterial({ map: woodTexture('#5d4126'), roughness: 0.9 });
  const containerMat = new THREE.MeshStandardMaterial({ map: containerTexture(), roughness: 0.7, metalness: 0.25 });
  const containerMat2 = new THREE.MeshStandardMaterial({ map: containerTexture('#6e3b2a'), roughness: 0.7, metalness: 0.25 });
  const lanternMat = new THREE.MeshStandardMaterial({
    map: lanternTexture(), emissive: 0xff9a1f, emissiveIntensity: 1.4,
    emissiveMap: lanternTexture(), roughness: 0.6,
  });

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const sphereGeo = new THREE.SphereGeometry(1, 12, 10);

  function addBox(material, x, y, z, sx, sy, sz, { solid = true, shootable = true } = {}) {
    const mesh = new THREE.Mesh(boxGeo, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (solid) colliders.push({ minX: x - sx / 2, maxX: x + sx / 2, minZ: z - sz / 2, maxZ: z + sz / 2, height: y + sy / 2 });
    if (shootable) shootables.push(mesh);
    return mesh;
  }

  // Ground and dusk sky.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(48, 40), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  scene.background = new THREE.Color(0x1b2038);
  scene.fog = new THREE.Fog(0x1b2038, 22, 52);

  // Perimeter walls.
  addBox(wallMat, 0, 2, -19, 46, 4, 2);
  addBox(wallMat, 0, 2, 19, 46, 4, 2);
  addBox(wallMat, -23, 2, 0, 2, 4, 40);
  addBox(wallMat, 23, 2, 0, 2, 4, 40);

  // Moon + warm market light. One shadow-casting light only, for speed.
  const moon = new THREE.DirectionalLight(0x8fa8ff, 0.55);
  moon.position.set(-14, 24, -10);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  moon.shadow.camera.left = -26;
  moon.shadow.camera.right = 26;
  moon.shadow.camera.top = 26;
  moon.shadow.camera.bottom = -26;
  scene.add(moon);
  scene.add(new THREE.AmbientLight(0x33405e, 0.85));
  const warm = new THREE.PointLight(0xff9a1f, 60, 30, 1.8);
  warm.position.set(0, 5.5, 0);
  scene.add(warm);

  // --- Stalls: counter, striped awning on four poles, paper sign. ---
  const awningColours = [
    ['#b3402a', '#f5e6c8'], ['#2e6f5e', '#f5e6c8'], ['#c98a1b', '#3a2a1a'],
    ['#33555e', '#f5e6c8'], ['#7a3b5e', '#f5e6c8'], ['#b3402a', '#2e6f5e'],
  ];
  const stallSpots = [
    { x: -8, z: 4, rot: 0.1 }, { x: -8, z: -4, rot: -0.08 }, { x: 8, z: 10, rot: 0.05 },
    { x: -16, z: -12, rot: 0.12 }, { x: 8, z: -2, rot: -0.1 }, { x: 16, z: 2, rot: 0.06 },
    { x: -4, z: -12, rot: 0 }, { x: 18, z: -14, rot: -0.06 },
  ];
  stallSpots.forEach((spot, i) => {
    const [a, b] = awningColours[i % awningColours.length];
    const awningMat = new THREE.MeshStandardMaterial({ map: awningTexture(a, b), roughness: 0.9, side: THREE.DoubleSide });
    const stall = new THREE.Group();
    stall.position.set(spot.x, 0, spot.z);
    stall.rotation.y = spot.rot;
    const counter = new THREE.Mesh(boxGeo, woodMat);
    counter.position.y = 0.55;
    counter.scale.set(3.2, 1.1, 1.4);
    counter.castShadow = true;
    counter.receiveShadow = true;
    stall.add(counter);
    const awning = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 2.2), awningMat);
    awning.rotation.x = -Math.PI / 2 + 0.35;
    awning.position.y = 2.5;
    awning.castShadow = true;
    stall.add(awning);
    for (const [px, pz] of [[-1.7, -0.9], [1.7, -0.9], [-1.7, 0.9], [1.7, 0.9]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 6), darkWood);
      pole.position.set(px, 1.25, pz);
      stall.add(pole);
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.95),
      new THREE.MeshStandardMaterial({ map: signTexture(STALL_SIGNS[i % STALL_SIGNS.length]), roughness: 0.8 }));
    sign.position.set(0, 2.1, 0.75);
    stall.add(sign);
    // Goods on the counter: little coloured boxes and spheres.
    for (let g = 0; g < 5; g += 1) {
      const good = new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({
        color: [0xd95f2a, 0x7fb069, 0xe0a458, 0x9b5de5, 0xef476f][g % 5], roughness: 0.7,
      }));
      good.scale.setScalar(0.16);
      good.position.set(-1.2 + g * 0.6, 1.22, (g % 2 === 0 ? -0.3 : 0.25));
      stall.add(good);
    }
    group.add(stall);
    colliders.push({ minX: spot.x - 1.6, maxX: spot.x + 1.6, minZ: spot.z - 0.7, maxZ: spot.z + 0.7, height: 1.1 });
    shootables.push(counter);
  });

  // --- Crates: stacked boxes that read as cover at a glance. ---
  const crateSpots = [
    [-12, 0, 1.2], [-11, 0.6, 1.2], [-12, 12, 1.0], [12, -6, 1.2], [13, -6, 1.2],
    [4, 8, 1.0], [5, 8, 1.0], [3, 9, 1.0], [-4, -8, 1.2], [20, 6, 1.0], [-20, -6, 1.2],
    [0, -12, 1.0], [10, 12, 1.0],
  ];
  crateSpots.forEach(([x, z, s], i) => {
    const y = i % 3 === 0 ? s / 2 + 1.1 : s / 2;
    addBox(woodMat, x, y, z, s, s, s);
  });

  // --- Two shipping containers: the map's big sightline breakers. ---
  addBox(containerMat, -6, 1.3, -14, 7, 2.6, 2.4);
  addBox(containerMat2, 12, 1.3, 8, 2.4, 2.6, 7);

  // --- Lanterns on poles + string lights across the lanes. ---
  const lanternPositions = [[-8, 0], [8, 0], [0, -8], [0, 8], [14, -11], [-16, -8], [16, 8]];
  lanternPositions.forEach(([x, z]) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.4, 6), darkWood);
    pole.position.set(x, 1.7, z);
    group.add(pole);
    const lamp = new THREE.Mesh(sphereGeo, lanternMat);
    lamp.scale.set(0.32, 0.4, 0.32);
    lamp.position.set(x, 3.5, z);
    group.add(lamp);
    const light = new THREE.PointLight(0xff9a1f, 7, 11, 1.8);
    light.position.set(x, 3.4, z);
    scene.add(light);
    colliders.push({ minX: x - 0.1, maxX: x + 0.1, minZ: z - 0.1, maxZ: z + 0.1, height: 3.4 });
  });
  // Strings of small bulbs between poles.
  const bulbGeo = new THREE.SphereGeometry(0.07, 6, 6);
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffb020, emissiveIntensity: 2 });
  const stringPairs = [[[-8, 0], [8, 0]], [[0, -8], [0, 8]], [[-16, -8], [0, -8]], [[8, 0], [16, 8]]];
  stringPairs.forEach(([a, b]) => {
    for (let i = 1; i < 9; i += 1) {
      const t = i / 9;
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.set(a[0] + (b[0] - a[0]) * t, 3.3 - Math.sin(t * Math.PI) * 0.5, a[1] + (b[1] - a[1]) * t);
      group.add(bulb);
    }
  });

  // --- Site A: a glowing ring and a sign on the east wall. ---
  const site = { center: new THREE.Vector3(14, 0, -11), radius: 3.4 };
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.0, 3.4, 40),
    new THREE.MeshBasicMaterial({ color: 0xf0a830, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(site.center.x, 0.06, site.center.z);
  group.add(ring);
  const siteSign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.2),
    new THREE.MeshStandardMaterial({ map: signTexture('SITE A', '#2e6f5e'), roughness: 0.8 }));
  siteSign.position.set(14, 3.1, -17.8);
  group.add(siteSign);
  const siteLight = new THREE.PointLight(0xf0a830, 14, 14, 1.8);
  siteLight.position.set(14, 3, -11);
  scene.add(siteLight);

  return {
    colliders, shootables, bounds: BOUNDS, site, group,
    waypoints: WAYPOINTS, routes: ROUTES,
    spawnSenja: [[-6, 15.5], [-2, 15.5], [2, 15.5], [6, 15.5], [0, 13]],
    spawnMalam: [[-6, -15.5], [-2, -15.5], [2, -15.5], [6, -15.5], [0, -13]],
  };
}

// Circle (x, z, radius) against the AABB colliders: push the circle out of
// every box it overlaps, and clamp it inside the yard. Returns true if any
// push happened. Used by the player and every bot, so movement and bullets
// agree on what is solid.
export function collideCircle(colliders, bounds, x, z, radius, height) {
  let pushed = false;
  const clampedX = Math.max(bounds.minX + radius, Math.min(bounds.maxX - radius, x));
  const clampedZ = Math.max(bounds.minZ + radius, Math.min(bounds.maxZ - radius, z));
  if (clampedX !== x || clampedZ !== z) pushed = true;
  let outX = clampedX;
  let outZ = clampedZ;
  for (const box of colliders) {
    if (height > box.height + 0.05) continue;
    const nearX = Math.max(box.minX, Math.min(outX, box.maxX));
    const nearZ = Math.max(box.minZ, Math.min(outZ, box.maxZ));
    const dx = outX - nearX;
    const dz = outZ - nearZ;
    const distSq = dx * dx + dz * dz;
    if (distSq >= radius * radius) continue;
    if (distSq > 0.0001) {
      const dist = Math.sqrt(distSq);
      outX = nearX + (dx / dist) * radius;
      outZ = nearZ + (dz / dist) * radius;
    } else {
      // Centre inside the box: push out along the smallest penetration.
      const pushLeft = outX - box.minX + radius;
      const pushRight = box.maxX - outX + radius;
      const pushUp = outZ - box.minZ + radius;
      const pushDown = box.maxZ - outZ + radius;
      const min = Math.min(pushLeft, pushRight, pushUp, pushDown);
      if (min === pushLeft) outX = box.minX - radius;
      else if (min === pushRight) outX = box.maxX + radius;
      else if (min === pushUp) outZ = box.minZ - radius;
      else outZ = box.maxZ + radius;
    }
    pushed = true;
  }
  return { x: outX, z: outZ, pushed };
}
