import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Decoration, Plant } from '../shared/types';
import { seededRandom } from './scene-3d-profile';

/** All botany is original solid geometry. Leaves have a curved, closed lentil
 * section, not alpha sprites or camera-facing image planes. */
function leafGeometry(length: number, width: number, curl: number, rows = 10, cols = 6): THREE.BufferGeometry {
  const vertices: number[] = [], indices: number[] = [], uv: number[] = [];
  for (let side = 0; side < 2; side++) for (let row = 0; row <= rows; row++) {
    const t = row / rows, silhouette = Math.sin(Math.PI * t) ** .94 * (1 - .055 * (row % 2));
    for (let col = 0; col <= cols; col++) {
      const u = col / cols * 2 - 1;
      vertices.push(u * width * silhouette, t * length, curl * t * t + (1 - u * u) * silhouette * width * (side ? -.022 : .075)); uv.push((u + 1) / 2, t);
    }
  }
  const stride = (rows + 1) * (cols + 1);
  for (let side = 0; side < 2; side++) for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const a = side * stride + row * (cols + 1) + col, b = a + cols + 1;
    if (side) indices.push(a, b + 1, b, a, a + 1, b + 1); else indices.push(a, b, b + 1, a, b + 1, a + 1);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}
/** Deterministic original vein/bark pigments, not photographs or downloaded
 * assets. Fine veins sit on thin 3D leaves, retaining real terrain occlusion. */
function botanicalTexture(kind: 'fern' | 'fittonia' | 'bark', pigment: THREE.Color): THREE.DataTexture {
  const width = 128, height = 256, bytes = new Uint8Array(width * height * 4), rng = seededRandom(5531), color = pigment.clone().convertLinearToSRGB();
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const x = col / (width - 1) - .5, y = row / (height - 1), offset = (row * width + col) * 4;
    let light = .89 + rng() * .09;
    if (kind === 'bark') light *= .81 + .20 * Math.sin(col * .44 + Math.sin(y * 15) * 1.7) ** 2 + .12 * Math.sin(col * 1.19 + y * 3) ** 2;
    else {
      const center = .012 * Math.sin(y * 8), midrib = Math.exp(-Math.abs(x - center) * 175);
      const ribs = Math.abs(Math.sin((y - Math.abs(x) * .34) * Math.PI * 8));
      const branch = Math.exp(-ribs * (kind === 'fittonia' ? 33 : 45)) * Math.min(1, Math.abs(x) * 22);
      light += midrib * (kind === 'fittonia' ? .50 : .25) + branch * (kind === 'fittonia' ? .34 : .13);
    }
    bytes[offset] = Math.min(255, Math.round(color.r * light * 255)); bytes[offset + 1] = Math.min(255, Math.round(color.g * light * 255)); bytes[offset + 2] = Math.min(255, Math.round(color.b * light * 255)); bytes[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(bytes, width, height); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping; texture.needsUpdate = true; return texture;
}
function branchMesh(points: THREE.Vector3[], radius: number, material: THREE.Material): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points), geometry = new THREE.TubeGeometry(curve, 30, radius, 9, false), positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
  for (let i = 0; i < positions.count; i++) {
    const t = Math.floor(i / 10) / 30, angle = i % 10 / 9 * Math.PI * 2, point = curve.getPointAt(t);
    const taper = (1 - t * .68) * (1 + .095 * Math.sin(angle * 5 + t * 10) + .035 * Math.cos(angle * 9 - t * 7));
    positions.setXYZ(i, point.x + (positions.getX(i) - point.x) * taper, point.y + (positions.getY(i) - point.y) * taper, point.z + (positions.getZ(i) - point.z) * taper);
  }
  normals.needsUpdate = true; geometry.computeVertexNormals(); return new THREE.Mesh(geometry, material);
}
function lineMesh(points: THREE.Vector3[], radius: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), Math.max(5, points.length * 3), radius, 5, false), material);
}
function finish(group: THREE.Group): THREE.Group {
  // Batch each plant's solid leaves, veins and stems by material. A detailed
  // fern stays a few draw calls rather than one call for every small leaflet.
  group.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, { source: THREE.Mesh[]; geometry: THREE.BufferGeometry[] }>();
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || Array.isArray(object.material)) return;
    let bucket = buckets.get(object.material); if (!bucket) { bucket = { source: [], geometry: [] }; buckets.set(object.material, bucket); }
    const local = group.matrixWorld.clone().invert().multiply(object.matrixWorld), geometry = object.geometry.clone().applyMatrix4(local); if (!geometry.getAttribute('uv')) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2)); bucket.source.push(object); bucket.geometry.push(geometry);
  });
  const oldGeometry = new Set<THREE.BufferGeometry>();
  for (const [material, bucket] of buckets) {
    const merged = mergeGeometries(bucket.geometry, false); bucket.geometry.forEach(geometry => geometry.dispose()); if (!merged) continue;
    for (const object of bucket.source) { object.parent?.remove(object); oldGeometry.add(object.geometry); }
    group.add(new THREE.Mesh(merged, material));
  }
  oldGeometry.forEach(geometry => geometry.dispose());
  group.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } }); return group;
}
export function buildPlant(plant: Plant): THREE.Group {
  const root = new THREE.Group(), rng = seededRandom(plant.kind.length * 313 + 1959), vitality = Math.max(.2, plant.health);
  const pigment = plant.kind === 'fern' ? '#347a3b' : plant.kind === 'fittonia' ? '#27623b' : '#316d32';
  const green = new THREE.Color('#626448').lerp(new THREE.Color(pigment), vitality).multiplyScalar(1 - plant.wetness * .055);
  const material = new THREE.MeshPhysicalMaterial({ color: green, roughness: .88 - plant.wetness * .14, metalness: 0, specularIntensity: .10, envMapIntensity: .075, clearcoat: .02 + plant.wetness * .05, clearcoatRoughness: .65, side: THREE.DoubleSide });
  if (plant.kind === 'fern' || plant.kind === 'fittonia') { material.map = botanicalTexture(plant.kind, green); material.color.set('#ffffff'); }
  const stemMaterial = new THREE.MeshStandardMaterial({ color: '#42603a', roughness: .97, envMapIntensity: .06 });
  const growth = plant.scale * (.76 + plant.growth * .66); root.scale.setScalar(growth);
  if (plant.kind === 'cushion-moss' || plant.kind === 'sheet-moss') {
    const cushion = plant.kind === 'cushion-moss', count = cushion ? 520 : 420;
    const geometry = leafGeometry(.12, .016, .016, 3, 2), bladeMaterial = material.clone(); bladeMaterial.color.set('#ffffff');
    const mesh = new THREE.InstancedMesh(geometry, bladeMaterial, count), dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2, r = Math.sqrt(rng()), x = Math.cos(angle) * r * (cushion ? .54 : .69), z = Math.sin(angle) * r * .4;
      const y = .025 + (cushion ? .22 : .075) * (1 - r * r) + Math.sin(x * 16 + z * 11) * .012; dummy.position.set(x, y, z); dummy.rotation.set((rng() - .5) * 1.15, rng() * Math.PI * 2, (rng() - .5) * 1.15); dummy.scale.set(.65 + rng() * .6, .55 + rng() * .7, .65 + rng() * .6); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, green.clone().multiplyScalar(.90 + rng() * .26));
    }
    root.add(mesh);
    const baseMaterial = material.clone(); baseMaterial.color.multiplyScalar(.68); const base = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), baseMaterial); base.position.y = .045; base.scale.set(cushion ? .53 : .68, cushion ? .185 : .058, .38); root.add(base);
    // Sporophytes are real fine stalks with little rounded capsules.
    for (let i = 0; i < 7; i++) {
      const x = (rng() - .5) * .7, z = (rng() - .5) * .5, y = cushion ? .25 : .12;
      root.add(lineMesh([new THREE.Vector3(x, y, z), new THREE.Vector3(x + .025, y + .17, z), new THREE.Vector3(x + .055, y + .2, z)], .004, stemMaterial));
      const capsule = new THREE.Mesh(new THREE.SphereGeometry(.009, 7, 5), stemMaterial); capsule.position.set(x + .055, y + .2, z); capsule.scale.y = 1.6; root.add(capsule);
    }
  } else if (plant.kind === 'fern') {
    const leaflet = leafGeometry(.27, .039, .020, 12, 4);
    for (let frond = 0; frond < 7; frond++) {
      const group = new THREE.Group(), angle = frond / 7 * Math.PI * 2, length = 1.0 + rng() * .49;
      group.rotation.y = angle; const points: THREE.Vector3[] = [];
      for (let s = 0; s <= 8; s++) { const t = s / 8; points.push(new THREE.Vector3(t * t * .69, t * length - t ** 3 * .34, 0)); }
      group.add(lineMesh(points, .0065, stemMaterial));
      for (let step = 1; step <= 12; step++) for (const sign of [-1, 1]) {
        const t = step / 13, leaf = new THREE.Mesh(leaflet, material); leaf.position.set(t * t * .69, t * length - t ** 3 * .34, 0);
        leaf.rotation.set(.17 * sign, .32 * sign, sign * 1.13 - .19); leaf.scale.setScalar(.24 + Math.sin(t * Math.PI) * .96); group.add(leaf);
      }
      root.add(group);
    }
  } else {
    const leaf = leafGeometry(.43, .131, .032, 14, 6);
    for (let branch = 0; branch < 5; branch++) {
      const angle = branch * 2.39996, height = .38 + rng() * .57, x = Math.cos(angle) * .39, z = Math.sin(angle) * .35;
      root.add(lineMesh([new THREE.Vector3(0, 0, 0), new THREE.Vector3(x * .5, height * .58, z * .5), new THREE.Vector3(x, height, z)], .012, stemMaterial));
      for (let side = 0; side < 2; side++) {
        const group = new THREE.Group(); group.position.set(x, height - side * .18, z); group.rotation.set(.53 + side * .16, angle + side * Math.PI, -.65);
        group.add(new THREE.Mesh(leaf, material));
        root.add(group);
      }
    }
  }
  return finish(root);
}
export function buildDecoration(item: Decoration): THREE.Group {
  const root = new THREE.Group(); root.scale.setScalar(item.scale);
  if (item.kind === 'stone') {
    const original = new THREE.IcosahedronGeometry(.50, 2); original.deleteAttribute('normal'); original.deleteAttribute('uv');
    const geometry = mergeVertices(original), positions = geometry.getAttribute('position'); original.dispose();
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i), factor = .86 + .12 * Math.sin(x * 13 + z * 7) * Math.cos(y * 17 - x * 5) + .055 * Math.sin(z * 25 + y * 11);
      positions.setXYZ(i, x * factor * 1.14, y * factor * .48, z * factor * .90);
    } geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#3e473b', roughness: 1, envMapIntensity: .035 })); mesh.position.y = .145; mesh.rotation.set(.06, .35, -.2); root.add(mesh);
  } else {
    const woodMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', map: botanicalTexture('bark', new THREE.Color('#63472e')), roughness: 1, envMapIntensity: .035 });
    root.add(branchMesh([new THREE.Vector3(-.54, .065, -.1), new THREE.Vector3(-.24, .17, -.01), new THREE.Vector3(.07, .25, .06), new THREE.Vector3(.23, .37, .10), new THREE.Vector3(.53, .46, .02)], .13, woodMaterial));
    root.add(branchMesh([new THREE.Vector3(-.19, .20, .02), new THREE.Vector3(-.12, .43, -.02), new THREE.Vector3(.02, .57, -.13), new THREE.Vector3(.09, .72, -.10)], .058, woodMaterial));
    root.add(branchMesh([new THREE.Vector3(.08, .26, .07), new THREE.Vector3(.15, .41, .19), new THREE.Vector3(.35, .54, .25)], .036, woodMaterial));
    root.add(branchMesh([new THREE.Vector3(-.45, .10, -.07), new THREE.Vector3(-.32, .17, .19), new THREE.Vector3(-.12, .20, .28)], .038, woodMaterial));
  }
  return finish(root);
}
