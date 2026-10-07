import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BOTTLE_SHAPES } from '../shared/catalog';
import { VesselClipper } from './scene-3d-clipping';
import { profileFor, radiusAt, seededRandom, wallDepthAt } from './scene-3d-profile';

test('colour and shadow shaders clip actual transformed/instanced world positions', () => {
  const clipper = new VesselClipper(profileFor('round')), group = new THREE.Group(), material = new THREE.MeshPhysicalMaterial(), mesh = new THREE.Mesh(new THREE.SphereGeometry(.1), material);
  group.add(mesh); clipper.apply(group);
  const shaders: { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> }[] = [];
  for (const value of [material, mesh.customDepthMaterial!, mesh.customDistanceMaterial!]) {
    const shader = { vertexShader: '#include <project_vertex>', fragmentShader: '#include <clipping_planes_fragment>', uniforms: {} };
    value.onBeforeCompile(shader as Parameters<THREE.Material['onBeforeCompile']>[0], {} as THREE.WebGLRenderer); shaders.push(shader);
    assert.match(shader.vertexShader, /instanceMatrix \* mossPosition/); assert.match(shader.vertexShader, /modelMatrix \* mossPosition/);
    assert.match(shader.fragmentShader, /if \(!mossInsideVessel\(vMossClipPosition\)\) discard/);
  }
  assert.equal(shaders[0].uniforms.mossRings, shaders[1].uniforms.mossRings);
  clipper.update(profileFor('glass-box', { lower: .55, middle: 1.25, upper: .55, facets: 12 }));
  assert.equal(shaders[0].uniforms.mossFacets.value, 12);
  assert.equal(shaders[0].uniforms.mossRingCount.value, 6);
  assert.equal((shaders[0].uniforms.mossRings.value as THREE.Vector2[])[0].y, 1.13 * .55);
  mesh.geometry.dispose(); material.dispose(); mesh.customDepthMaterial!.dispose(); mesh.customDistanceMaterial!.dispose();
});
test('mesh ray clipping excludes fragments outside the matching round/box/faceted wall', () => {
  for (const shape of BOTTLE_SHAPES) {
    const profile = profileFor(shape), clipper = new VesselClipper(profile), rng = seededRandom(723);
    for (let i = 0; i < 100; i++) {
      const y = .2 + rng() * 2.5, x = (rng() * 2 - 1) * (radiusAt(profile, y) - .06), edge = wallDepthAt(profile, x, y, .048);
      assert.equal(clipper.contains({ x, y, z: edge + .02 }), false);
      assert.equal(clipper.contains({ x, y, z: edge * .9 }), true);
    }
    assert.equal(clipper.contains({ x: 0, y: -.1, z: 0 }), false);
    assert.equal(clipper.contains({ x: 0, y: 8, z: 0 }), false);
  }
});
test('buried wood/leaves are occluded by the same uneven terrain in colour, shadow and picking', () => {
  const profile = profileFor('open-cylinder'), clipper = new VesselClipper(profile);
  const terrain = { columns: Array.from({ length: 48 }, (_, i) => Array.from({ length: i < 18 || i > 30 ? 26 : 4 }, () => 'soil' as const)) };
  clipper.update(profile, terrain);
  assert.equal(clipper.contains({ x: -1, y: .6, z: .2 }), false);
  assert.equal(clipper.contains({ x: 0, y: .6, z: .2 }), true);
  assert.equal(clipper.contains({ x: 1, y: 1.6, z: .2 }), true);
});
