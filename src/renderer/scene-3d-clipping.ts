import * as THREE from 'three';
import { containsPoint, groundPoint } from './scene-3d-profile';
import type { VesselProfile } from './scene-3d-profile';
import type { Terrain } from '../shared/types';

/** Original profile clipping shared by opaque colour and shadow shaders. This
 * keeps a dragged leaf/log inside the glass instead of changing the saved item.
 * It is a visual cut, not plant collision/bending physics. */
export class VesselClipper {
  private profile: VesselProfile;
  private readonly uniforms = {
    mossRings: { value: Array.from({ length: 16 }, () => new THREE.Vector2()) },
    mossRingCount: { value: 0 }, mossDepth: { value: .65 }, mossExponent: { value: 2 }, mossFacets: { value: 0 },
    mossGround: { value: Array.from({ length: 49 }, () => new THREE.Vector2()) }, mossGroundCount: { value: 0 },
  };
  constructor(profile: VesselProfile) { this.profile = profile; this.update(profile); }
  update(profile: VesselProfile, terrain?: Terrain): void {
    this.profile = profile; this.uniforms.mossRingCount.value = profile.rings.length; this.uniforms.mossDepth.value = profile.depth; this.uniforms.mossExponent.value = profile.exponent; this.uniforms.mossFacets.value = profile.segments <= 12 ? profile.segments : 0;
    profile.rings.forEach(([y, radius], i) => this.uniforms.mossRings.value[i].set(y, radius));
    this.uniforms.mossGroundCount.value = terrain ? 49 : 0;
    if (terrain) for (let i = 0; i <= 48; i++) { const point = groundPoint(profile, terrain, i / 48, .5); this.uniforms.mossGround.value[i].set(point.x, point.y); }
  }
  contains(point: { x: number; y: number; z: number }): boolean {
    if (!containsPoint(this.profile, point, .048)) return false;
    const ground = this.uniforms.mossGround.value, count = this.uniforms.mossGroundCount.value; if (!count) return true;
    let height = ground[count - 1].y;
    if (point.x <= ground[0].x) height = ground[0].y;
    else for (let i = 1; i < count; i++) if (point.x <= ground[i].x) { const t = (point.x - ground[i - 1].x) / Math.max(.000001, ground[i].x - ground[i - 1].x); height = ground[i - 1].y + (ground[i].y - ground[i - 1].y) * t; break; }
    return point.y >= height - .014;
  }
  private material(material: THREE.Material): void {
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = 'varying vec3 vMossClipPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
        #include <project_vertex>
        vec4 mossPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mossPosition = instanceMatrix * mossPosition;
        #endif
        vMossClipPosition = (modelMatrix * mossPosition).xyz;
      `);
      shader.fragmentShader = `
        varying vec3 vMossClipPosition;
        uniform vec2 mossRings[16];
        uniform int mossRingCount;
        uniform float mossDepth;
        uniform float mossExponent;
        uniform float mossFacets;
        uniform vec2 mossGround[49];
        uniform int mossGroundCount;
        bool mossAboveGround(vec3 p) {
          if (mossGroundCount == 0) return true;
          float height = mossGround[mossGroundCount - 1].y;
          if (p.x <= mossGround[0].x) height = mossGround[0].y;
          else for (int i = 1; i < 49; i++) {
            if (i >= mossGroundCount) break;
            if (p.x <= mossGround[i].x) {
              float t = (p.x - mossGround[i - 1].x) / max(0.000001, mossGround[i].x - mossGround[i - 1].x);
              height = mix(mossGround[i - 1].y, mossGround[i].y, t); break;
            }
          }
          return p.y >= height - 0.014;
        }
        bool mossInsideVessel(vec3 p) {
          if (p.y < mossRings[0].x || p.y > mossRings[mossRingCount - 1].x) return false;
          float radius = mossRings[mossRingCount - 1].y;
          for (int i = 1; i < 16; i++) {
            if (i >= mossRingCount) break;
            if (p.y <= mossRings[i].x) {
              float t = (p.y - mossRings[i - 1].x) / (mossRings[i].x - mossRings[i - 1].x);
              radius = mix(mossRings[i - 1].y, mossRings[i].y, t); break;
            }
          }
          radius -= 0.048;
          vec2 q = vec2(p.x, p.z / mossDepth);
          if (mossFacets > 0.5) {
            float stepAngle = 6.28318530718 / mossFacets;
            float angle = atan(q.y, q.x);
            float fromNormal = mod(angle, stepAngle) - stepAngle * 0.5;
            float boundary = radius * cos(stepAngle * 0.5) / cos(fromNormal);
            return length(q) <= boundary;
          }
          return pow(abs(q.x) / radius, mossExponent) + pow(abs(q.y) / radius, mossExponent) <= 1.0;
        }
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (!mossInsideVessel(vMossClipPosition)) discard;\nif (!mossAboveGround(vMossClipPosition)) discard;');
    };
    material.customProgramCacheKey = () => 'mosslight-original-vessel-ground-clip-v2';
    material.needsUpdate = true;
  }
  apply(group: THREE.Group): void {
    const seen = new Set<THREE.Material>(), depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), distance = new THREE.MeshDistanceMaterial();
    this.material(depth); this.material(distance);
    group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.customDepthMaterial = depth; object.customDistanceMaterial = distance;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (!seen.has(material)) { seen.add(material); this.material(material); }
    });
  }
}
