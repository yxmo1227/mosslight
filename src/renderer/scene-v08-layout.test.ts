import assert from 'node:assert/strict';
import test from 'node:test';
import { mossDrapeOffsets2D, nearestSupport2D, supportContactHeight2D, supportPoint2D, supportProfile2D } from './scene-2d-layout';
import { decorationBounds2D, posePoint2D } from './scene-object-art';
import { WOOD_PRESETS, woodPresetForm } from '../shared/catalog';
import { woodGeometry2D, woodPathPoint2D } from './scene-2d-wood';

test('forgiving snap selects a nearby real column, never a transparent fork-hole shelf',()=>{
  const alpha=new Uint8ClampedArray(80*60);for(let x=10;x<70;x++)if(x<30||x>44)for(let y=25;y<60;y++)alpha[y*80+x]=255;
  const s={id:'fork',root:{x:300,y:400},scale:1,profile:supportProfile2D(alpha,80,60,40,55)};
  for(const point of[{x:300,y:350},{x:263,y:372},{x:332,y:352}]){const selected=nearestSupport2D([s],point,new Set());assert(selected);const actual=supportPoint2D(s,selected.x);assert.notEqual(supportContactHeight2D(s,actual.x),null);assert(Math.hypot(actual.x-point.x,actual.y-point.y)<43);}
  assert.equal(supportContactHeight2D(s,300),null);assert.equal(nearestSupport2D([s],{x:300,y:350},new Set(['fork'])),undefined);
  assert.equal(nearestSupport2D([s],{x:300,y:350},new Set(),42,()=>false),undefined);
});

test('moss drape remains smooth over thin tall prongs without changing physical support occupancy',()=>{
  const alpha=new Uint8ClampedArray(160*170);for(let x=15;x<145;x++)for(let y=(x>75&&x<80?10:120);y<170;y++)if(x<48||x>62)alpha[y*160+x]=255;
  const s={id:'prong',root:{x:300,y:400},scale:1,profile:supportProfile2D(alpha,160,170,80,155)},anchor=supportPoint2D(s,.25),before=alpha.slice();
  for(const scale of[.4,1,2]){const field=mossDrapeOffsets2D(s,anchor,300,150,scale,45,255);assert(field.every(Number.isFinite));assert(Math.max(...field)-Math.min(...field)<=48);for(let x=46;x<255;x++)assert(Math.abs(field[x]-field[x-1])<5,'no isolated vertical strip jump at a fork');}
  assert.equal(supportContactHeight2D(s,275),null);assert.deepEqual(alpha,before);
});

test('new wood curves and full-pose bounds contain the same painted branch graph',()=>{
  const signatures=new Set<string>();
  for(const preset of WOOD_PRESETS){const wood=woodPresetForm(preset.id),geometry=woodGeometry2D(wood);signatures.add(JSON.stringify(geometry.paths[geometry.paths.length-1]));
    for(const angle of[-180,-87,0,71,180])for(const flipX of[false,true]){const pose={angle,flipX},b=decorationBounds2D({kind:'wood',wood,pose});for(const path of geometry.paths)for(let i=0;i<=30;i++){const p=posePoint2D(woodPathPoint2D(path,i/30),pose);assert(p.x>=b.left&&p.x<=b.right&&p.y>=b.top&&p.y<=b.bottom);}}
  }assert.equal(signatures.size,4,'silhouettes differ in their trunk contour/orientation, not only branch counts');
});
