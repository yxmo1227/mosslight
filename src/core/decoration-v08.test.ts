import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAction, createInitialState, advanceSimulation } from './simulation';
import { validateAction, validateState, validateWoodForm } from './validation';
import { DECORATION_ITEMS, isFloatingDecoration, STONE_VARIANTS, STUMP_VARIANTS, WOOD_PRESETS } from '../shared/catalog';
import { decodeSave, encodeSave } from '../desktop/storage';

const now=1000, add=(kind:string,extra:Record<string,unknown>={})=>({type:'add-decoration',kind,x:.5,y:.5,...extra});
test('all new stone/stump variants and decorative kinds resolve atomically and round-trip',()=>{
  let state=createInitialState(now);const terrain=structuredClone(state.terrain);
  for(const [kind,list] of [['stone',STONE_VARIANTS],['stump',STUMP_VARIANTS]] as const)for(const {id}of list){
    state=applyAction(state,add(kind,{variant:id}),now);assert.equal(state.decorations.at(-1)!.variant,id);
  }
  // Retain the published v0.8 fixture rather than exceeding per-bottle capacity
  // whenever a later catalog gains new items. v0.10 tests every new kind separately.
  for(const id of ['pavilion','statue','traveler','cottage','lantern','steps','path']){state=applyAction(state,add(id),now);assert.equal(state.decorations.at(-1)!.kind,id);}
  assert.equal(state.decorations.length,13);assert.deepEqual(state.terrain,terrain);
  assert.deepEqual(decodeSave(encodeSave(state)),state);
});
test('variants are exact, family-specific plain data on both actions and imported state',()=>{
  for(const [kind,variant]of [['stone','fallen'],['stump','flat'],['wood','boulder'],['cottage','upright'],['stone',null],['stump',undefined],['stone','__proto__'],['stone',{}]])assert.throws(()=>validateAction(add(kind as string,{variant})));
  assert.throws(()=>validateAction(add('wood',{woodPreset:'single',variant:'flat'})));
  let calls=0;const hostile={type:'add-decoration',kind:'stone',x:.5,y:.5,get variant(){calls++;return'boulder';}};assert.throws(()=>validateAction(hostile));assert.equal(calls,0);
  for(const value of [undefined,null,'invalid','fallen']){const state=createInitialState(now);state.decorations=[{id:'s',kind:'stone',x:.5,y:.5,scale:1,...({variant:value}as object)}];assert.throws(()=>validateState(state));}
});
test('wood outer orientation preserves authored shape, attachment, descendants and ecology',()=>{
  let state=applyAction(createInitialState(now),add('wood'),now), wood=state.decorations[0];
  state=applyAction(state,{type:'add-plant',kind:'sheet-moss',x:.5,y:.5,support:{parentId:wood.id,x:.3}},now);
  for(const angle of [-180,-90,0,90,180])for(const flipX of [true,false]){
    const before=structuredClone(state), pose={angle,flipX};const next=applyAction(state,{type:'object-pose',id:wood.id,value:pose},now);
    assert.deepEqual(next.decorations[0],{...before.decorations[0],pose});assert.equal(next.decorations[0].wood,undefined);
    assert.deepEqual(next.plants,before.plants);assert.deepEqual(next.ecology,before.ecology);assert.deepEqual(state,before);
    pose.angle=12;assert.equal(next.decorations[0].pose!.angle,angle);assert.deepEqual(decodeSave(encodeSave(next)),next);
  }
});
test('orientation rejects hostile objects, invalid angles, nonwood and stale IDs atomically',()=>{
  const state=applyAction(createInitialState(now),add('stone'),now), before=structuredClone(state);
  for(const value of [{angle:181,flipX:false},{angle:-181,flipX:true},{angle:NaN,flipX:false},{angle:0,flipX:1},{angle:0,flipX:false,extra:1},{angle:0},null])assert.throws(()=>validateAction({type:'object-pose',id:'a',value}));
  for(const id of [state.decorations[0].id,'missing'])assert.throws(()=>applyAction(state,{type:'object-pose',id,value:{angle:0,flipX:true}},now));
  assert.deepEqual(state,before);let calls=0;assert.throws(()=>validateAction({type:'object-pose',id:'a',value:{get angle(){calls++;return 0;},flipX:false}}));assert.equal(calls,0);
  const bad=structuredClone(state);bad.decorations[0].pose={angle:0,flipX:false};assert.throws(()=>validateState(bad));
});
test('new wood bends are bounded, deeply copied and optional for legacy forms',()=>{
  const old={length:1,angle:0,branches:[]};assert.deepEqual(validateWoodForm(old),old);
  for(const bend of [-.35,0,.35])assert.equal(validateWoodForm({...old,bend}).bend,bend);
  for(const bend of [-.351,.351,NaN,Infinity,undefined,null,'0'])assert.throws(()=>validateWoodForm({...old,bend}));
  assert.equal(new Set(WOOD_PRESETS.map(item=>item.form.bend)).size,4);
});
test('confirmed reset clears every solid and water object but preserves preferences and original state',()=>{
  let state=applyAction(createInitialState(now),{type:'starter'},now);state=applyAction(state,add('cottage'),now);
  state=applyAction(state,{type:'pour-water',x:.5,amount:16},now);state.preferences={widgetSize:'large',alwaysOnTop:false,launchAtLogin:true,reducedMotion:true};const before=structuredClone(state);
  const next=applyAction(state,{type:'reset'},now+10);assert.equal(next.terrain.columns.length,48);assert(next.terrain.columns.every(column=>column.length===0));
  assert.deepEqual(next.plants,[]);assert.deepEqual(next.decorations,[]);assert.equal(next.pond,undefined);assert.deepEqual(next.preferences,before.preferences);
  assert.deepEqual(state,before);assert.deepEqual(decodeSave(encodeSave(next)),next);
});
test('stone-like decorations can get wet but never decay or change shape',()=>{
  for(const kind of ['stone',...DECORATION_ITEMS.map(item=>item.id)].filter(kind=>!isFloatingDecoration(kind))){
    let state=applyAction(createInitialState(now),add(kind),now);state=applyAction(state,{type:'spray-decoration',decorationId:state.decorations[0].id,amount:.025},now);
    const after=advanceSimulation(state,1000*60*60*24, 'offline', now+1000*60*60*24);assert.equal(after.decorations[0].condition!.decay,0);assert.equal(after.decorations[0].kind,kind);
    const bad=structuredClone(state);bad.decorations[0].condition!.decay=.1;assert.throws(()=>validateState(bad));
  }
});
