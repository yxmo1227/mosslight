import * as THREE from 'three';
import type { MaterialKind, TerrariumState } from '../shared/types';
import { hasLid, MATERIAL_KINDS, TERRAIN_COLUMNS } from '../shared/catalog';
import { buildDecoration, buildPlant } from './scene-3d-botany';
import { VesselClipper } from './scene-3d-clipping';
import { ProjectedSilhouette } from './scene-3d-silhouette';
import { fitContent } from './scene-3d-placement';
import type { ContentBounds } from './scene-3d-placement';
import { clamp, containGrain, DEFAULT_GLASS_PROFILE, groundPoint, materialAt, normalizedAtWorldX, profileFor, radiusAt, ringPoint, seededRandom, smoothHeight, terrainWorldX, wallDepthAt, WORLD_GRAIN_HEIGHT } from './scene-3d-profile';
import type { GlassBand, VesselProfile } from './scene-3d-profile';
import type { Position, Selection } from './scene';

export const SCENE_WIDTH = 600, SCENE_HEIGHT = 760;
export const MATERIAL_COLOR: Record<MaterialKind, string> = { soil: '#30251c', clay: '#6f492f', gravel: '#586155', coir: '#513c28', bark: '#483023', charcoal: '#202722' };
export interface ScenePreview extends Position { selection: Selection }
export interface SculptHandle { key: GlassBand; clientX: number; clientY: number; value: number }
export interface ProjectedPoint { x: number; y: number }

function meshGeometry(vertices: number[], indices: number[], colors?: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices);
  if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals(); geometry.computeBoundingSphere(); return geometry;
}
function vesselGeometry(profile: VesselProfile, inset: number): THREE.BufferGeometry {
  const points: number[] = [], indices: number[] = [], divisions = profile.shape === 'glass-box' ? profile.rings.length - 1 : 90;
  const bottom = profile.rings[0][0], top = profile.rings[profile.rings.length - 1][0];
  for (let row = 0; row <= divisions; row++) {
    const y = profile.shape === 'glass-box' ? profile.rings[row][0] : bottom + (top - bottom) * row / divisions;
    for (let i = 0; i <= profile.segments; i++) { const p = ringPoint(profile, y, i / profile.segments * Math.PI * 2, inset); points.push(p.x, p.y, p.z); }
  }
  for (let row = 0; row < divisions; row++) for (let i = 0; i < profile.segments; i++) { const a = row * (profile.segments + 1) + i, b = a + profile.segments + 1; indices.push(a, b, a + 1, a + 1, b, b + 1); }
  return meshGeometry(points, indices);
}
function rimGeometry(profile: VesselProfile, y: number, tube: number, inset = .015): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  const count = profile.segments <= 12 ? profile.segments : 80;
  for (let i = 0; i < count; i++) { const p = ringPoint(profile, y, i / count * Math.PI * 2, inset); points.push(new THREE.Vector3(p.x, p.y, p.z)); }
  if (profile.segments <= 12) {
    const positions: number[] = [], indices: number[] = [];
    for (let i = 0; i < count; i++) for (let ring = 0; ring < 8; ring++) {
      const p = points[i], outward = new THREE.Vector3(p.x, 0, p.z / (profile.depth ** 2)).normalize();
      positions.push(p.x + outward.x * Math.cos(ring / 8 * Math.PI * 2) * tube, y + Math.sin(ring / 8 * Math.PI * 2) * tube, p.z + outward.z * Math.cos(ring / 8 * Math.PI * 2) * tube);
    }
    for (let i = 0; i < count; i++) for (let r = 0; r < 8; r++) { const a = i * 8 + r, b = ((i + 1) % count) * 8 + r, an = i * 8 + (r + 1) % 8, bn = ((i + 1) % count) * 8 + (r + 1) % 8; indices.push(a, b, an, an, b, bn); }
    return meshGeometry(positions, indices);
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true), 100, tube, 8, true);
}
function diskGeometry(profile: VesselProfile, y: number, inset = 0): THREE.BufferGeometry {
  const points = [0, y, 0], indices: number[] = [];
  for (let i = 0; i <= profile.segments; i++) { const p = ringPoint(profile, y, i / profile.segments * Math.PI * 2, inset); points.push(p.x, p.y, p.z); }
  for (let i = 1; i <= profile.segments; i++) indices.push(0, i + 1, i); return meshGeometry(points, indices);
}
function materialGeometry(kind: MaterialKind): THREE.BufferGeometry {
  if (kind === 'clay') return new THREE.SphereGeometry(1, 12, 9);
  if (kind === 'gravel' || kind === 'soil') return new THREE.SphereGeometry(1, kind === 'gravel' ? 9 : 6, kind === 'gravel' ? 6 : 4);
  if (kind === 'coir') { const geometry = new THREE.CylinderGeometry(.10, .14, 2, 4); geometry.rotateZ(Math.PI / 2); return geometry; }
  const geometry = new THREE.CylinderGeometry(kind === 'bark' ? .17 : .35, kind === 'bark' ? .24 : .44, 2, kind === 'bark' ? 4 : 6); geometry.rotateZ(Math.PI / 2); return geometry;
}
/** Shared geometry is instanced per material: constant six particle draw calls,
 * not a DOM node / draw call per grain. Counts are bounded by the saved terrain. */
function buildTerrain(profile: VesselProfile, state: TerrariumState): THREE.Group {
  const group = new THREE.Group(), vertices: number[] = [], indices: number[] = [], colors: number[] = [];
  const columns = 192, rows = 40;
  const colorAt = (u: number, level: number): THREE.Color => {
    const material = materialAt(state.terrain, u, level) ?? 'soil';
    return new THREE.Color(MATERIAL_COLOR[material]).multiplyScalar(.94 + .025 * Math.sin(u * 431 + level * 17));
  };
  // Curved front and back solid faces connect to the same y-dependent inside
  // wall as glass. Continuous cross-section interpolation removes column stairs.
  for (const side of [-1, 1]) {
    const offset = vertices.length / 3;
    for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
      const u = col / columns, top = smoothHeight(state.terrain, u), height = Math.min(top, row * WORLD_GRAIN_HEIGHT), y = .115 + height;
      const x = terrainWorldX(profile, state.terrain, u, .115 + row * WORLD_GRAIN_HEIGHT), front = wallDepthAt(profile, x, y, .043);
      // Solid earth is behind the real bead fronts, not a smooth opaque wall
      // pasted over them. Taper the recess to zero at both wall endpoints.
      const kind = materialAt(state.terrain, u, Math.max(0, height / WORLD_GRAIN_HEIGHT - .5));
      const recess = kind === 'soil' || kind === 'coir' ? .038 : kind === 'clay' ? .075 : .085;
      const z = (front - Math.min(recess, front * .22)) * side;
      vertices.push(x, y, z); const color = colorAt(u, Math.max(0, height / WORLD_GRAIN_HEIGHT - .5)); colors.push(color.r, color.g, color.b);
    }
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      if (smoothHeight(state.terrain, (col + .5) / columns) <= row * WORLD_GRAIN_HEIGHT) continue;
      const a = offset + row * (columns + 1) + col, b = a + columns + 1;
      if (side > 0) indices.push(a, a + 1, b, a + 1, b + 1, b); else indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  // Gently textured, continuous top surface with genuine front-to-back depth.
  const offset = vertices.length / 3, depthRows = 16;
  for (let depth = 0; depth <= depthRows; depth++) for (let col = 0; col <= columns; col++) {
    const u = col / columns, height = smoothHeight(state.terrain, u), p = groundPoint(profile, state.terrain, u, depth / depthRows);
    const front = wallDepthAt(profile, p.x, p.y, .043); p.z = (depth / depthRows * 2 - 1) * (front - Math.min(.065, front * .22)); p.y += Math.sin(u * 127 + depth * 3.7) * Math.min(height, .009); vertices.push(p.x, p.y, p.z);
    const color = colorAt(u, Math.max(0, height / WORLD_GRAIN_HEIGHT - 1)); colors.push(color.r, color.g, color.b);
  }
  for (let d = 0; d < depthRows; d++) for (let c = 0; c < columns; c++) { if (smoothHeight(state.terrain, (c + .5) / columns) <= 0) continue; const a = offset + d * (columns + 1) + c, b = a + columns + 1; indices.push(a, b, a + 1, a + 1, b, b + 1); }
  if (indices.length) { const mesh = new THREE.Mesh(meshGeometry(vertices, indices, colors), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, envMapIntensity: .06, side: THREE.DoubleSide })); mesh.receiveShadow = true; group.add(mesh); }
  const particles = new Map<MaterialKind, { matrix: THREE.Matrix4; color: THREE.Color }[]>(); for (const kind of MATERIAL_KINDS) particles.set(kind, []);
  const dummy = new THREE.Object3D();
  function grain(kind: MaterialKind, u: number, y: number, depth: number, seed: number, top = false): void {
    const rng = seededRandom(seed), radius = kind === 'clay' ? .044 + rng() * .015 : kind === 'gravel' ? .035 + rng() * .023 : kind === 'soil' ? .014 + rng() * .012 : kind === 'coir' ? .029 + rng() * .018 : .040 + rng() * .03;
    const x = terrainWorldX(profile, state.terrain, u, y), available = wallDepthAt(profile, x, y, .046);
    if (available < radius * .15) return;
    const z = Math.sign(depth) * Math.max(0, Math.abs(depth) * available - radius * (kind === 'coir' ? .25 : .54));
    dummy.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    const scaleY = kind === 'soil' ? .62 : kind === 'gravel' ? .7 : kind === 'bark' ? 1 : kind === 'charcoal' ? 1 : .95;
    dummy.scale.set(radius * (kind === 'bark' ? 1.45 : kind === 'coir' ? 1.7 : 1), radius * scaleY, radius * (kind === 'bark' ? .58 : kind === 'gravel' ? .83 : 1));
    const bound = Math.max(dummy.scale.x, dummy.scale.y, dummy.scale.z) * (kind === 'charcoal' ? 1.094 : kind === 'bark' ? 1.03 : kind === 'coir' ? 1.01 : 1);
    const contained = containGrain(profile, { x, y: y + (top ? radius * .18 : 0), z }, bound); dummy.position.set(contained.x, contained.y, contained.z); dummy.updateMatrix();
    // Multiplicative linear-light variation stays in the same earth pigment.
    // Adding .095 HSL lightness in linear colour space made near-white mosaic.
    const color = new THREE.Color(MATERIAL_COLOR[kind]).multiplyScalar(.92 + rng() * .15); particles.get(kind)!.push({ matrix: dummy.matrix.clone(), color });
  }
  for (let column = 0; column < TERRAIN_COLUMNS; column++) {
    const saved = state.terrain.columns[column] ?? [];
    for (let level = 0; level < saved.length; level++) {
      const kind = saved[level], rng = seededRandom(column * 1823 + level * 1771 + 393);
      for (let lane = 0; lane < (kind === 'soil' || kind === 'coir' ? 1 : 2); lane++) {
        const u = clamp((column + rng()) / TERRAIN_COLUMNS), y = .115 + (level + .04 + rng() * .92) * WORLD_GRAIN_HEIGHT;
        grain(kind, u, y, 1, column * 1907 + level * 79 + lane * 313);
      }
    }
    const kind = saved[saved.length - 1]; if (!kind) continue;
    for (let depth = 0; depth < 10; depth++) {
      const rng = seededRandom(column * 31 + depth * 313 + 997), u = (column + .1 + rng() * .8) / TERRAIN_COLUMNS;
      grain(kind, u, .115 + smoothHeight(state.terrain, u), -.92 + depth / 9 * 1.84, column * 751 + depth * 313, true);
    }
  }
  for (const kind of MATERIAL_KINDS) {
    const rows = particles.get(kind)!; if (!rows.length) continue;
    const mesh = new THREE.InstancedMesh(materialGeometry(kind), new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, envMapIntensity: .035 }), rows.length);
    rows.forEach((row, i) => { mesh.setMatrixAt(i, row.matrix); mesh.setColorAt(i, row.color); }); mesh.receiveShadow = true; mesh.castShadow = false; mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); group.add(mesh);
  }
  return group;
}

export class ThreeTerrarium {
  readonly canvas = document.createElement('canvas');
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera();
  private readonly raycaster = new THREE.Raycaster();
  private readonly silhouette = new ProjectedSilhouette(SCENE_WIDTH, SCENE_HEIGHT);
  readonly silhouetteCanvas = document.createElement('canvas');
  private silhouetteDirty = true;
  private renderSizeDirty = true;
  private readonly performance = { silhouetteTests: 0, raycasts: 0, frameMs: 0, maxFrameMs: 0, silhouetteBuilds: 0 };
  private readonly environment: THREE.WebGLRenderTarget;
  private root = new THREE.Group();
  private body = new THREE.Group();
  private terrain = new THREE.Group();
  private terrainSignature = '';
  private glassSignature = '';
  private readonly entities = new Map<string, { key: string; object: THREE.Group; bounds: ContentBounds; naturalScale: THREE.Vector3; type: Selection['type'] }>();
  private readonly builds = { terrain: 0, glass: 0, botany: 0, frames: 0 };
  private entityMeshes: THREE.Object3D[] = [];
  private profile = profileFor('round');
  private readonly clipper = new VesselClipper(this.profile);
  private state: TerrariumState | null = null;
  private signature = '';
  private previewSignature = '';
  private disposed = false;
  private readonly light = new THREE.DirectionalLight('#fff3d8', 2.4);
  private readonly fillLight = new THREE.DirectionalLight('#d4e3f2', .8);
  constructor(private readonly widget: boolean) {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'low-power', preserveDrawingBuffer: true });
    this.renderer.setSize(widget ? 320 : 600, widget ? 405 : 760, false);
    this.renderer.setClearColor(0x000000, 0); this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = !widget; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.add(new THREE.HemisphereLight('#e3efdf', '#232e21', .58)); this.light.position.set(-4, 9, 7); this.light.castShadow = !widget; this.light.shadow.mapSize.set(1024, 1024); this.light.shadow.normalBias = .035; this.light.shadow.camera.left = -4; this.light.shadow.camera.right = 4; this.light.shadow.camera.top = 7; this.light.shadow.camera.bottom = -2; this.light.shadow.camera.near = .1; this.light.shadow.camera.far = 24;
    this.fillLight.position.set(5, 4, -4); this.scene.add(this.light, this.fillLight); this.scene.add(this.root);
    // Original studio-light environment, generated locally. No network textures,
    // HDR downloads, third-party photographs, or user data are ever loaded.
    const environmentScene = new THREE.Scene(); environmentScene.background = new THREE.Color('#63715f');
    const panels: [number, number, number, number, number, string, number][] = [[-4, 3, 3, 2, 7, '#fffcec', 6], [5, 1, -2, 2, 5, '#dbefff', 3], [0, 7, 0, 8, 6, '#ffffff', 4]];
    for (const [x, y, z, w, h, color, intensity] of panels) { const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide })); panel.position.set(x, y, z); panel.lookAt(0, 1, 0); environmentScene.add(panel); }
    const generator = new THREE.PMREMGenerator(this.renderer); this.environment = generator.fromScene(environmentScene, .05, .1, 30); this.scene.environment = this.environment.texture; generator.dispose(); this.disposeGroup(environmentScene);
  }
  resize(displayWidth: number): boolean {
    const width = Math.round(clamp(displayWidth, this.widget ? 180 : 360, this.widget ? 480 : 960));
    const height = Math.round(width * SCENE_HEIGHT / SCENE_WIDTH);
    if (this.canvas.width === width && this.canvas.height === height) return false;
    this.renderer.setSize(width, height, false); this.renderSizeDirty = true; return true;
  }
  private rebuildSilhouette(): void {
    this.silhouette.clear(); this.body.updateWorldMatrix(true, true);
    const projected = new THREE.Vector3();
    const add = (geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): void => {
      const position = geometry.getAttribute('position'), index = geometry.index, points: ProjectedPoint[] = [];
      for (let i = 0; i < position.count; i++) { projected.fromBufferAttribute(position, i).applyMatrix4(matrix); points.push(this.project(projected)); }
      for (let i = 0; i < (index?.count ?? position.count); i += 3) { const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2; this.silhouette.triangle(points[a], points[b], points[c]); }
    };
    this.body.traverse(object => { if (object instanceof THREE.Mesh && !(object instanceof THREE.InstancedMesh)) add(object.geometry, object.matrixWorld); });
    // Fill the mouth's interior in the interaction silhouette, not in the image.
    const cap = diskGeometry(this.profile, this.profile.rings[this.profile.rings.length - 1][0]); add(cap, new THREE.Matrix4()); cap.dispose();
    this.silhouetteCanvas.width = SCENE_WIDTH; this.silhouetteCanvas.height = SCENE_HEIGHT;
    const context = this.silhouetteCanvas.getContext('2d');
    if (context) { const mask = context.createImageData(SCENE_WIDTH, SCENE_HEIGHT); for (let i = 0; i < this.silhouette.pixels.length; i++) { mask.data[i * 4] = 255; mask.data[i * 4 + 1] = 255; mask.data[i * 4 + 2] = 255; mask.data[i * 4 + 3] = this.silhouette.pixels[i] ? 255 : 0; } context.putImageData(mask, 0, 0); }
    this.silhouetteDirty = false; this.performance.silhouetteBuilds++;
  }
  private disposeGroup(group: THREE.Object3D): void {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    group.traverse(object => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        geometries.add(object.geometry); const list = Array.isArray(object.material) ? object.material : [object.material];
        if (object instanceof THREE.Mesh) { if (object.customDepthMaterial) materials.add(object.customDepthMaterial); if (object.customDistanceMaterial) materials.add(object.customDistanceMaterial); }
        for (const material of list) { materials.add(material); const map = (material as THREE.MeshStandardMaterial).map; if (map) textures.add(map); }
      }
    });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
  }
  private buildGlass(state: TerrariumState): THREE.Group {
    const group = new THREE.Group(), profile = this.profile, top = profile.rings[profile.rings.length - 1][0];
    // Screen-space transmission captures an opaque studio background on an
    // alpha desktop window. Thin reflective PBR surfaces retain real transparency
    // instead; the thick rim carries the stronger glass reflections.
    const glass = new THREE.MeshPhysicalMaterial({ color: '#e5eee5', roughness: .045, metalness: .025, transmission: 0, thickness: .045, ior: 1.47, transparent: true, opacity: .085, envMapIntensity: .8, clearcoat: 1, clearcoatRoughness: .04, side: THREE.FrontSide, depthWrite: false });
    glass.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        float glassGrazing = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 5.5);
        diffuseColor.a = mix(0.013, 0.29, glassGrazing);
        outgoingLight = mix(outgoingLight, vec3(0.22, 0.34, 0.27), glassGrazing * 0.58);
        #include <opaque_fragment>
      `);
    };
    glass.customProgramCacheKey = () => 'mosslight-original-clear-fresnel-v2';
    const edgeGlass = new THREE.MeshPhysicalMaterial({ color: '#bfd5c9', roughness: .055, metalness: .08, transmission: 0, thickness: .10, ior: 1.48, transparent: true, opacity: .38, envMapIntensity: .7, side: THREE.DoubleSide, depthWrite: false });
    const shell = new THREE.Mesh(vesselGeometry(profile, 0), glass); shell.renderOrder = 5; group.add(shell);
    const innerGlass = glass.clone(); innerGlass.side = THREE.BackSide; innerGlass.opacity = .009;
    const inside = new THREE.Mesh(vesselGeometry(profile, .042), innerGlass); inside.renderOrder = 4; group.add(inside);
    group.add(new THREE.Mesh(rimGeometry(profile, top, .023), edgeGlass), new THREE.Mesh(rimGeometry(profile, .12, .025), edgeGlass));
    const floor = new THREE.Mesh(diskGeometry(profile, .085), edgeGlass); group.add(floor);
    if (profile.shape === 'glass-box') {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(vesselGeometry(profile, .001), 15), new THREE.LineBasicMaterial({ color: '#b7cebd', transparent: true, opacity: .38 })); edges.renderOrder = 6; group.add(edges);
    }
    if (profile.shape === 'cat') {
      for (const side of [-1, 1]) {
        const shape = new THREE.Shape(); shape.moveTo(-.49, 0); shape.quadraticCurveTo(-.42, .78, -.18, 1.17); shape.quadraticCurveTo(.2, .85, .56, .05); shape.quadraticCurveTo(0, -.07, -.49, 0);
        const hole = new THREE.Path(); hole.moveTo(-.36, .10); hole.quadraticCurveTo(.0, .05, .39, .12); hole.quadraticCurveTo(.13, .68, -.16, 1.01); hole.quadraticCurveTo(-.32, .64, -.36, .10); shape.holes.push(hole);
        const ear = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: .14, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: .035, bevelThickness: .025, curveSegments: 14 }), edgeGlass); ear.position.set(side * 1.11, 3.71, -.055); ear.rotation.z = -side * .20; group.add(ear);
      }
    }
    if (hasLid(state.bottle)) {
      const lid = new THREE.Group(), open = state.closed ? 0 : 1;
      if (state.bottle === 'glass-box') { lid.add(new THREE.Mesh(diskGeometry(profile, top + .06, -.006), edgeGlass), new THREE.Mesh(rimGeometry(profile, top + .06, .03, -.012), edgeGlass)); const knob = new THREE.Mesh(new THREE.SphereGeometry(.085, 12, 8), edgeGlass); knob.position.set(0, top + .15, 0); knob.scale.y = .7; lid.add(knob); lid.position.y = open * .52; }
      else {
        const r = radiusAt(profile, top) * .96, corkMaterial = new THREE.MeshStandardMaterial({ color: '#a88c57', roughness: .96 });
        const cork = new THREE.Mesh(new THREE.CylinderGeometry(r, r * .99, .18, 48), corkMaterial); cork.position.set(0, top + .035, 0); lid.add(cork);
        const topTexture = document.createElement('canvas'); topTexture.width = topTexture.height = 128; const ctx = topTexture.getContext('2d');
        if (ctx) { ctx.fillStyle = '#ab925f'; ctx.fillRect(0, 0, 128, 128); const rng = seededRandom(783); for (let i = 0; i < 1600; i++) { ctx.fillStyle = rng() > .5 ? '#dac38c78' : '#59472355'; ctx.beginPath(); ctx.ellipse(rng() * 128, rng() * 128, .4 + rng() * 1.8, .4 + rng() * .8, rng() * Math.PI, 0, Math.PI * 2); ctx.fill(); } const texture = new THREE.CanvasTexture(topTexture); texture.colorSpace = THREE.SRGBColorSpace; corkMaterial.map = texture; }
        lid.position.set(open * .58, open * .42, 0); lid.rotation.z = -open * .07;
      }
      group.add(lid);
    }
    return group;
  }
  private configureCamera(): void {
    const top = this.profile.rings[this.profile.rings.length - 1][0] + (this.profile.shape === 'cat' ? .55 : .5), radius = this.profile.shape === 'glass-box' ? 2.59 : Math.max(...this.profile.rings.map(r => r[1]));
    const height = Math.max(top + .54, radius * 2.24 * SCENE_HEIGHT / SCENE_WIDTH), targetY = top * .48;
    this.camera.left = -height * SCENE_WIDTH / SCENE_HEIGHT / 2; this.camera.right = -this.camera.left; this.camera.top = height / 2; this.camera.bottom = -height / 2; this.camera.near = .1; this.camera.far = 40;
    this.camera.position.set(0, targetY + 2.25, 15); this.camera.lookAt(0, targetY, 0); this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
  }
  render(state: TerrariumState, preview: ScenePreview | null): boolean {
    if (this.disposed) return false;
    const started = performance.now(), previewSignature = JSON.stringify(preview);
    if (state === this.state && previewSignature === this.previewSignature && !this.renderSizeDirty) return false;
    const signature = JSON.stringify({ bottle: state.bottle, glassForm: state.glassForm, terrain: state.terrain, closed: state.closed, light: Math.round(state.environment.light * 12), sunlight: Math.round(state.care.sunlight * 12), plants: state.plants.map(p => ({ ...p, ageDays: 0, growth: Math.round(p.growth * 30), health: Math.round(p.health * 30), wetness: Math.round(p.wetness * 20) })), decorations: state.decorations });
    this.state = state;
    if (signature === this.signature && previewSignature === this.previewSignature && !this.renderSizeDirty) return false;
    this.signature = signature; this.previewSignature = previewSignature; this.profile = profileFor(state.bottle, state.glassForm); this.clipper.update(this.profile, state.terrain); this.configureCamera();
    const profileKey = JSON.stringify({ bottle: state.bottle, glassForm: state.glassForm });
    const terrainKey = profileKey + JSON.stringify(state.terrain), glassKey = profileKey + JSON.stringify({ closed: state.closed });
    if (terrainKey !== this.terrainSignature) { this.root.remove(this.terrain); this.disposeGroup(this.terrain); this.terrain = buildTerrain(this.profile, state); this.root.add(this.terrain); this.terrainSignature = terrainKey; this.builds.terrain++; }
    if (glassKey !== this.glassSignature) { this.root.remove(this.body); this.disposeGroup(this.body); this.body = this.buildGlass(state); this.root.add(this.body); this.glassSignature = glassKey; this.builds.glass++; this.silhouetteDirty = true; }
    const ids = new Set([...state.plants, ...state.decorations].map(entity => entity.id));
    for (const [id, entity] of this.entities) if (!ids.has(id)) { this.root.remove(entity.object); this.disposeGroup(entity.object); this.entities.delete(id); }
    this.entityMeshes = [];
    for (const entity of [...state.decorations.map(item => ({ item, type: 'decoration' as const })), ...state.plants.map(item => ({ item, type: 'plant' as const }))]) {
      const item = entity.item, key = entity.type === 'plant' ? JSON.stringify({ kind: item.kind, scale: item.scale, growth: Math.round((item as TerrariumState['plants'][number]).growth * 30), health: Math.round((item as TerrariumState['plants'][number]).health * 30), wetness: Math.round((item as TerrariumState['plants'][number]).wetness * 20) }) : JSON.stringify({ kind: item.kind, scale: item.scale });
      let cached = this.entities.get(item.id);
      if (!cached || cached.key !== key) {
        if (cached) { this.root.remove(cached.object); this.disposeGroup(cached.object); }
        const object = entity.type === 'plant' ? buildPlant(item as TerrariumState['plants'][number]) : buildDecoration(item as TerrariumState['decorations'][number]);
        this.clipper.apply(object);
        object.traverse(child => { child.userData.selection = { type: entity.type, id: item.id }; }); object.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(object); cached = { key, object, bounds: { min: box.min.clone(), max: box.max.clone() }, naturalScale: object.scale.clone(), type: entity.type }; this.entities.set(item.id, cached); this.root.add(object); this.builds.botany++;
      }
      const object = cached.object;
      const pos = preview?.selection.id === entity.item.id ? preview : entity.item;
      let point = groundPoint(this.profile, state.terrain, pos.x, pos.y), fit = fitContent(this.profile, point, cached.bounds);
      // Moving inward changes the actual ground height in a valley. Settle the
      // same complete object on that surface instead of leaving it floating.
      for (let settle = 0; settle < 3; settle++) { const x = normalizedAtWorldX(this.profile, state.terrain, fit.position.x), grounded = groundPoint(this.profile, state.terrain, x, pos.y); point = { ...fit.position, y: grounded.y }; fit = fitContent(this.profile, point, cached.bounds); }
      object.position.set(fit.position.x, fit.position.y, fit.position.z); object.scale.copy(cached.naturalScale).multiplyScalar(fit.scale);
      this.entityMeshes.push(object);
    }
    this.light.intensity = 2.7 + state.environment.light * .5 + state.care.sunlight * 1.1; this.fillLight.intensity = .35 + state.environment.light * .12;
    this.scene.updateMatrixWorld(true); if (this.silhouetteDirty) this.rebuildSilhouette(); this.renderer.render(this.scene, this.camera); this.builds.frames++; this.renderSizeDirty = false;
    this.performance.frameMs = performance.now() - started; this.performance.maxFrameMs = Math.max(this.performance.maxFrameMs, this.performance.frameMs); return true;
  }
  project(point: { x: number; y: number; z: number }): ProjectedPoint { const value = new THREE.Vector3(point.x, point.y, point.z).project(this.camera); return { x: (value.x + 1) * SCENE_WIDTH / 2, y: (1 - value.y) * SCENE_HEIGHT / 2 }; }
  private ray(point: Position): THREE.Raycaster { this.performance.raycasts++; this.raycaster.setFromCamera(new THREE.Vector2(point.x / SCENE_WIDTH * 2 - 1, 1 - point.y / SCENE_HEIGHT * 2), this.camera); return this.raycaster; }
  isBottleAt(point: Position): boolean { this.performance.silhouetteTests++; return this.silhouette.contains(point); }
  hitTest(point: Position): Selection | null {
    const hit = this.ray(point).intersectObjects(this.entityMeshes, true).find(candidate => this.clipper.contains(candidate.point)); return hit?.object.userData.selection as Selection | undefined ?? null;
  }
  defaultSpraySource(): Position {
    const targets = [...this.entities.values()].filter(entity => entity.type === 'plant');
    if (!targets.length) return { x: 300, y: 390 };
    const target = targets[Math.floor(targets.length / 2)], box = new THREE.Box3().setFromObject(target.object), top = this.project({ x: (box.min.x + box.max.x) / 2, y: box.max.y, z: (box.min.z + box.max.z) / 2 });
    const point = { x: top.x, y: top.y - 22 }; return this.isBottleAt(point) ? point : { x: top.x, y: top.y + 8 };
  }
  rootAt(position: Position): ProjectedPoint { return this.state ? this.project(groundPoint(this.profile, this.state.terrain, position.x, position.y)) : { x: 300, y: 660 }; }
  positionAt(point: Position): Position | null {
    if (!this.state || !this.isBottleAt(point)) return null;
    // Orthographic projection preserves x, while ground depth is obtained from
    // the actual projected back/front endpoints at the local terrain height.
    const worldX = this.camera.left + point.x / SCENE_WIDTH * (this.camera.right - this.camera.left), x = normalizedAtWorldX(this.profile, this.state.terrain, worldX);
    const back = this.rootAt({ x, y: 0 }), front = this.rootAt({ x, y: 1 });
    return { x, y: Math.abs(front.y - back.y) < .001 ? .5 : clamp((point.y - back.y) / (front.y - back.y)) };
  }
  movedPosition(initial: Position, dx: number, dy: number): Position {
    if (!this.state) return initial; const p = this.rootAt(initial), world = groundPoint(this.profile, this.state.terrain, initial.x, initial.y);
    const x = normalizedAtWorldX(this.profile, this.state.terrain, world.x + dx * (this.camera.right - this.camera.left) / SCENE_WIDTH), back = this.rootAt({ x, y: 0 }), front = this.rootAt({ x, y: 1 });
    return { x, y: Math.abs(front.y - back.y) < .001 ? .5 : clamp((p.y + dy - back.y) / (front.y - back.y)) };
  }
  sculptHandles(): { key: GlassBand; x: number; y: number; value: number }[] {
    if (!this.state || this.state.bottle !== 'glass-box') return []; const form = this.state.glassForm ?? DEFAULT_GLASS_PROFILE;
    return (['lower', 'middle', 'upper'] as const).map((key, i) => { const y = [1.12, 2.75, 4.22][i], point = this.project({ x: radiusAt(this.profile, y), y, z: 0 }); return { key, ...point, value: form[key] }; });
  }
  sculptValueAt(key: GlassBand, x: number): number {
    const y = key === 'lower' ? 1.12 : key === 'middle' ? 2.75 : 4.22, baseRadius = key === 'lower' ? 2.07 : key === 'middle' ? 2.02 : 1.84;
    const center = this.project({ x: 0, y, z: 0 }), unit = this.project({ x: baseRadius, y, z: 0 }); return clamp((x - center.x) / (unit.x - center.x), .55, 1.25);
  }
  diagnostics(): { drawCalls: number; triangles: number; geometries: number; textures: number; terrainBuilds: number; glassBuilds: number; botanyBuilds: number; frames: number; silhouetteTests: number; raycasts: number; frameMs: number; maxFrameMs: number; silhouetteBuilds: number; renderWidth: number; renderHeight: number } { return { drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures, terrainBuilds: this.builds.terrain, glassBuilds: this.builds.glass, botanyBuilds: this.builds.botany, frames: this.builds.frames, ...this.performance, renderWidth: this.canvas.width, renderHeight: this.canvas.height }; }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.disposeGroup(this.root); this.environment.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss(); }
}
