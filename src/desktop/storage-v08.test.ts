import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { applyAction, createInitialState } from '../core/simulation';
import { DECORATION_ITEMS, STONE_VARIANTS, STUMP_VARIANTS } from '../shared/catalog';
import { decodeSave, encodeSave, hasV08Features, LocalStore, readSaveFile } from './storage';
const old=()=>{const state=createInitialState(1000);state.decorations=[{id:'wood',kind:'wood' as const,x:.5,y:.5,scale:1,wood:{length:1.2,angle:35,branches:[{at:.4,length:.6,angle:-50}]},condition:{wetness:.3,decay:.1}}];return state;};
const bytes=(state:ReturnType<typeof old>)=>JSON.stringify(JSON.parse(encodeSave(state)),null,4)+'\r\n';
const features=[
  ...STONE_VARIANTS.map(item=>({type:'add-decoration',kind:'stone',variant:item.id,x:.4,y:.5})),
  ...STUMP_VARIANTS.map(item=>({type:'add-decoration',kind:'stump',variant:item.id,x:.4,y:.5})),
  ...DECORATION_ITEMS.map(item=>({type:'add-decoration',kind:item.id,x:.4,y:.5})),
  {type:'object-pose',id:'wood',value:{angle:0,flipX:false}},
  {type:'wood-form',id:'wood',value:{length:1,angle:0,branches:[],bend:0}},
];
function fixture(){const directory=mkdtempSync(join(tmpdir(),'mosslight-storage-v08-'));return{store:new LocalStore(directory),cleanup(){const rel=relative(resolve(tmpdir()),resolve(directory));assert(rel.startsWith('mosslight-storage-v08-')&&!rel.startsWith('..')&&!isAbsolute(rel));rmSync(directory,{recursive:true});}};}
test('v071 shapes, plain resize and empty reset remain v071-compatible until new fields are used',()=>{
  assert(!hasV08Features(old()));assert(!hasV08Features(applyAction(old(),{type:'resize-decoration',id:'wood',scale:2},1000)));
  assert(!hasV08Features(applyAction(old(),{type:'reset'},1000)));
});
for(const [index,action]of features.entries())test(`v08 feature ${index} preserves exact compatible originals once before saving`,()=>{
  const f=fixture();try{
    const primary=bytes(old()),backupState=old();backupState.name='Earlier forest';const backup=bytes(backupState);
    writeFileSync(f.store.primary,primary);writeFileSync(f.store.backup,backup);
    const next=applyAction(old(),action,1000);assert(hasV08Features(next));f.store.save(next);f.store.save(next);
    assert.equal(readFileSync(join(f.store.directory,'terrarium.before-v0.8-primary.json'),'utf8'),primary);
    assert.equal(readFileSync(join(f.store.directory,'terrarium.before-v0.8-backup.json'),'utf8'),backup);
    assert.deepEqual(new LocalStore(f.store.directory).load().state,next);assert.deepEqual(decodeSave(encodeSave(next)),next);
    assert(!readdirSync(f.store.directory).includes('terrarium.before-v0.7-primary.json'),'v071 wood cannot pretend to be v06-compatible');
  }finally{f.cleanup();}
});
test('failed pre-v08 preservation never overwrites either save or conflicting target',()=>{
  for(const generation of ['primary','backup'])for(const conflict of ['invalid',bytes(applyAction(old(),features[0],1000))]){
    const f=fixture();try{
      const original=bytes(old()),target=join(f.store.directory,`terrarium.before-v0.8-${generation}.json`);
      writeFileSync(f.store.primary,original);writeFileSync(f.store.backup,original);writeFileSync(target,conflict);
      assert.throws(()=>f.store.save(applyAction(old(),features[0],1000)),/Autosave is paused/);
      assert.equal(readFileSync(f.store.primary,'utf8'),original);assert.equal(readFileSync(f.store.backup,'utf8'),original);assert.equal(readFileSync(target,'utf8'),conflict);
      assert.throws(()=>f.store.save(old()),/Autosave is paused/);
    }finally{f.cleanup();}
  }
});
test('new v08 saves cannot become any older downgrade copy; existing v071 original is immutable',()=>{
  const f=fixture();try{
    const next=applyAction(old(),features[0],1000),original=bytes(old()),target=join(f.store.directory,'terrarium.before-v0.8-primary.json');
    writeFileSync(target,original);writeFileSync(f.store.primary,bytes(next));writeFileSync(f.store.backup,bytes(next));f.store.save(next);
    assert.equal(readFileSync(target,'utf8'),original);assert.deepEqual(readSaveFile(f.store.primary),next);
    assert.deepEqual(readdirSync(f.store.directory).filter(name=>name.startsWith('terrarium.before-')),['terrarium.before-v0.8-primary.json']);
  }finally{f.cleanup();}
});
