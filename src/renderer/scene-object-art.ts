import type { Decoration, DecorationKind } from '../shared/types';
import type { BotanicalExtent } from './scene-botany';
import { woodGeometry2D } from './scene-2d-wood';
import { drawCatalogArt2D } from './scene-catalog-art';

type P = { x: number; y: number };
const TAU = Math.PI * 2;
const BOUNDS: Record<DecorationKind, BotanicalExtent> = {
  stone: { left: -.43, right: .43, top: -.35, bottom: .08 },
  wood: { left: -.49, right: .46, top: -.4, bottom: .075 },
  stump: { left: -.45, right: .45, top: -.64, bottom: .085 },
  pavilion: { left: -.55, right: .55, top: -.96, bottom: .09 },
  statue: { left: -.28, right: .28, top: -.84, bottom: .07 },
  traveler: { left: -.3, right: .3, top: -.76, bottom: .075 },
  cottage: { left: -.55, right: .55, top: -.8, bottom: .08 },
  lantern: { left: -.24, right: .24, top: -.83, bottom: .065 },
  steps: { left: -.46, right: .46, top: -.43, bottom: .07 },
  path: { left: -.54, right: .54, top: -.14, bottom: .09 },
  fairy: { left: -.40, right: .40, top: -.70, bottom: .065 },
  gardener: { left: -.26, right: .40, top: -.75, bottom: .075 },
  reader: { left: -.25, right: .25, top: -.56, bottom: .08 },
  cat: { left: -.18, right: .31, top: -.56, bottom: .075 },
  dog: { left: -.20, right: .30, top: -.52, bottom: .075 },
  'mushroom-house': { left: -.51, right: .52, top: -.89, bottom: .09 },
  treehouse: { left: -.42, right: .45, top: -1.02, bottom: .085 },
  'arc-lamp': { left: -.29, right: .45, top: -1.0, bottom: .085 },
  'slender-steps': { left: -.27, right: .32, top: -.49, bottom: .085 },
  sun: { left: -.31, right: .31, top: -.61, bottom: .065 },
  moon: { left: -.32, right: .14, top: -.65, bottom: .065 },
  star: { left: -.30, right: .30, top: -.59, bottom: .065 },
};
export function posePoint2D(point: P, pose?: Decoration['pose']): P {
  const angle = Math.max(-180, Math.min(180, pose?.angle ?? 0)) * Math.PI / 180, x = point.x * (pose?.flipX ? -1 : 1);
  return { x: x * Math.cos(angle) - point.y * Math.sin(angle), y: x * Math.sin(angle) + point.y * Math.cos(angle) };
}
/** Palette, actual raster and collision profile share these unscaled bounds. */
export function decorationBounds2D(decoration: Pick<Decoration, 'kind' | 'variant' | 'wood' | 'pose'>): BotanicalExtent {
  let bounds = { ...BOUNDS[decoration.kind] };
  if (decoration.kind === 'stone') {
    if (decoration.variant === 'flat') bounds = { left: -.53, right: .53, top: -.18, bottom: .065 };
    if (decoration.variant === 'spire') bounds = { left: -.29, right: .29, top: -.83, bottom: .065 };
    if (decoration.variant === 'pebbles') bounds = { left: -.48, right: .48, top: -.27, bottom: .085 };
  }
  if (decoration.kind === 'stump' && decoration.variant === 'fallen') bounds = { left: -.64, right: .64, top: -.34, bottom: .10 };
  if (decoration.kind !== 'wood') return bounds;
  if (decoration.wood) bounds = woodGeometry2D(decoration.wood).bounds;
  const corners = [{ x: bounds.left, y: bounds.top }, { x: bounds.right, y: bounds.top }, { x: bounds.left, y: bounds.bottom }, { x: bounds.right, y: bounds.bottom }].map(p => posePoint2D(p, decoration.pose));
  return { left: Math.min(...corners.map(p => p.x)), right: Math.max(...corners.map(p => p.x)), top: Math.min(...corners.map(p => p.y)), bottom: Math.max(...corners.map(p => p.y)) };
}
function shape(ctx: CanvasRenderingContext2D, points: readonly (readonly [number, number])[], color: string): void {
  ctx.fillStyle = color; ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill();
}
function oval(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string): void { ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill(); }
function stroke(ctx: CanvasRenderingContext2D, points: readonly (readonly [number, number])[], color: string, width: number): void { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); }
function block(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, depth: number, colors: readonly [string, string, string]): void {
  shape(ctx, [[x,y],[x+w,y],[x+w,y+h],[x,y+h]], colors[1]);
  shape(ctx, [[x+w,y],[x+w+depth,y-depth*.5],[x+w+depth,y+h-depth*.5],[x+w,y+h]], colors[2]);
  shape(ctx, [[x,y],[x+depth,y-depth*.5],[x+w+depth,y-depth*.5],[x+w,y]], colors[0]);
}
function rings(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  oval(ctx,x,y,rx,ry,'#c5a273'); ctx.strokeStyle='#896848'; ctx.lineWidth=.005;
  for(let i=1;i<=5;i++){ctx.beginPath();ctx.ellipse(x-.008,y,rx*i/6,ry*i/6,-.025,0,TAU);ctx.stroke();}
}
/** One complete volume with continuous bark from the cut top to its real base.
 * Contact reshapes only the bottom contour; it never appends a thin rectangle. */
export function drawUprightStump2D(ctx: CanvasRenderingContext2D, bottom?: readonly P[]): void {
  const base = bottom?.length ? bottom : [{x:-.42,y:.04},{x:-.30,y:.058},{x:-.14,y:.026},{x:.04,y:.061},{x:.18,y:.027},{x:.42,y:.052}];
  const left=base[0], right=base[base.length-1], yAt=(x:number):number=>{let i=1;while(i<base.length&&base[i].x<x)i++;const a=base[Math.max(0,i-1)],b=base[Math.min(base.length-1,i)];return a.y+(b.y-a.y)*Math.max(0,Math.min(1,(x-a.x)/Math.max(.001,b.x-a.x)));};
  ctx.beginPath();ctx.moveTo(-.27,-.53);ctx.bezierCurveTo(-.27,-.22,left.x*.91,left.y-.065,left.x,left.y);
  for(const p of base)ctx.lineTo(p.x,p.y);ctx.bezierCurveTo(right.x*.93,right.y-.09,.27,-.24,.28,-.53);ctx.closePath();
  const bark=ctx.createLinearGradient(-.39,0,.42,0);bark.addColorStop(0,'#715032');bark.addColorStop(.35,'#987047');bark.addColorStop(.7,'#805736');bark.addColorStop(1,'#60442e');ctx.fillStyle=bark;ctx.fill();ctx.save();ctx.clip();
  for(let i=0;i<27;i++){const t=i/26, topX=-.27+t*.55, footX=left.x+t*(right.x-left.x), end=yAt(footX);ctx.strokeStyle=i%3?'rgba(56,39,26,.24)':'rgba(219,178,113,.30)';ctx.lineWidth=i%4===0?.009:.004;ctx.beginPath();ctx.moveTo(topX,-.54);ctx.bezierCurveTo(topX+.013*Math.sin(i),-.28,footX*.91,end-(end+.53)*.25,footX,end+.012);ctx.stroke();}
  for(let i=0;i<5;i++){const x=-.18+i*.082,y=-.30+(i%3)*.075;ctx.strokeStyle='rgba(56,39,26,.25)';ctx.lineWidth=.004;ctx.beginPath();ctx.ellipse(x,y,.013,.026,0,0,TAU);ctx.stroke();}
  ctx.restore(); rings(ctx,0,-.53,.281,.078);stroke(ctx,[[.12,-.546],[.20,-.565],[.268,-.563]],'#65472f',.009);
}
function fallenLog(ctx:CanvasRenderingContext2D):void{
  ctx.beginPath();ctx.moveTo(-.48,-.24);ctx.bezierCurveTo(-.22,-.33,.20,-.32,.49,-.22);ctx.lineTo(.50,.036);ctx.bezierCurveTo(.1,.08,-.23,.065,-.50,.027);ctx.closePath();
  const fill=ctx.createLinearGradient(0,-.30,0,.07);fill.addColorStop(0,'#a37b50');fill.addColorStop(.5,'#80603e');fill.addColorStop(1,'#57432e');ctx.fillStyle=fill;ctx.fill();
  for(let i=0;i<11;i++){const y=-.24+i*.027;stroke(ctx,[[-.49,y],[-.16,y-.026],[.18,y-.018],[.49,y+.013]],i%3?'rgba(58,41,26,.27)':'rgba(213,174,111,.28)',.005);}
  rings(ctx,-.5,-.108,.103,.151);oval(ctx,-.5,-.108,.039,.065,'#655038');
  shape(ctx,[[.13,-.265],[.15,-.33],[.205,-.30],[.20,-.25]],'#745435');
  for(let i=0;i<8;i++)oval(ctx,-.33+i*.085,-.277+Math.sin(i)*.017,.027,.01,i%2?'#778848':'#92a55c');
}
function stoneVariant(ctx:CanvasRenderingContext2D,variant:Decoration['variant']):void{
  if(variant==='flat') {shape(ctx,[[-.50,-.045],[-.37,-.14],[.18,-.165],[.48,-.07],[.40,.028],[-.32,.055]],'#7f8876');shape(ctx,[[-.50,-.045],[-.37,-.14],[.18,-.165],[.48,-.07],[.10,-.018],[-.33,.006]],'#aab09a');shape(ctx,[[.48,-.07],[.40,.028],[-.32,.055],[-.33,.006],[.10,-.018]],'#626e5a');stroke(ctx,[[-.29,-.089],[-.03,-.105],[.25,-.066]],'#c6c9ae',.01);return;}
  if(variant==='spire'){shape(ctx,[[-.23,.045],[-.20,-.39],[-.07,-.77],[.06,-.81],[.18,-.55],[.25,-.04],[.14,.058]],'#7b8370');shape(ctx,[[-.23,.045],[-.20,-.39],[-.07,-.77],[.02,-.58],[-.04,-.07]],'#a7ae94');shape(ctx,[[.02,-.58],[.06,-.81],[.18,-.55],[.25,-.04],[.14,.058],[-.04,-.07]],'#5f6f5e');stroke(ctx,[[-.12,-.48],[-.08,-.28],[-.12,-.08]],'#d0cdb1',.008);return;}
  const stones=[[-.26,-.038,.19,.10],[-.04,-.12,.19,.13],[.24,-.026,.21,.105],[-.045,.024,.14,.06]];
  for(let i=0;i<stones.length;i++){const[x,y,rx,ry]=stones[i];oval(ctx,x,y,rx,ry,['#7e8778','#a0a794','#7b8574','#aeb19a'][i]);oval(ctx,x-rx*.15,y-ry*.3,rx*.73,ry*.46,'rgba(215,215,183,.30)');}
}
function pavilion(ctx:CanvasRenderingContext2D):void{
  block(ctx,-.39,.012,.65,.045,.12,['#b8b798','#92977b','#727e65']);
  for(const x of[-.25,.25])block(ctx,x,-.61,.047,.64,.05,['#b69a6d','#8c704e','#65563d']);
  stroke(ctx,[[-.24,-.29],[.29,-.29]],'#ae9164',.033);
  shape(ctx,[[-.49,-.58],[-.22,-.70],[0,-.88],[.25,-.73],[.50,-.60],[.24,-.61],[-.22,-.59]],'#405b49');
  shape(ctx,[[-.49,-.58],[-.22,-.70],[0,-.88],[.02,-.69],[-.20,-.58]],'#7c9270');
  stroke(ctx,[[-.50,-.58],[-.23,-.56],[.06,-.585],[.50,-.60]],'#b6ab79',.018);stroke(ctx,[[0,-.89],[.025,-.94]],'#6a684b',.028);
  for(let i=0;i<6;i++){const x=-.30+i*.12;stroke(ctx,[[x*.33,-.77],[x,-.60]],'rgba(211,215,167,.28)',.009);}
}
function statue(ctx:CanvasRenderingContext2D):void{
  block(ctx,-.20,-.018,.32,.05,.08,['#bebfab','#939f8b','#687e6b']);
  shape(ctx,[[-.16,-.065],[-.15,-.27],[-.11,-.43],[.10,-.43],[.17,-.19],[.16,-.045]],'#9da68f');shape(ctx,[[.05,-.44],[.13,-.35],[.17,-.19],[.16,-.045],[.035,-.038]],'#708771');
  oval(ctx,0,-.555,.13,.17,'#a9b197');oval(ctx,-.032,-.591,.062,.11,'#c6c7a9');
  stroke(ctx,[[-.059,-.56],[-.035,-.557]],'#60705e',.008);stroke(ctx,[[.025,-.56],[.05,-.565]],'#60705e',.008);stroke(ctx,[[-.07,-.21],[.02,-.265],[.08,-.19]],'#718269',.022);
  oval(ctx,-.13,-.02,.054,.022,'#7e934f');
}
function traveler(ctx:CanvasRenderingContext2D):void{
  stroke(ctx,[[-.07,-.15],[-.095,.02]],'#62543d',.046);stroke(ctx,[[.052,-.15],[.10,.024]],'#62543d',.047);
  shape(ctx,[[-.12,-.50],[.10,-.5],[.18,-.14],[.01,-.10],[-.19,-.16]],'#b5794b');shape(ctx,[[.055,-.49],[.10,-.5],[.18,-.14],[.025,-.115]],'#885d40');
  oval(ctx,-.016,-.54,.080,.092,'#e0b985');oval(ctx,-.015,-.606,.145,.027,'#b39755');
  shape(ctx,[[-.125,-.612],[-.051,-.742],[-.028,-.752],[.098,-.607]],'#c7ae69');
  shape(ctx,[[-.028,-.752],[.098,-.607],[.026,-.603]],'#a5894b');
  stroke(ctx,[[-.091,-.624],[.059,-.618]],'#dfc780',.008);
  stroke(ctx,[[.16,-.39],[.25,-.44],[.21,.042]],'#6a6446',.018);stroke(ctx,[[-.13,-.37],[-.19,-.22]],'#d5ad79',.032);oval(ctx,.086,-.36,.068,.09,'#6b7c54');
}
function cottage(ctx:CanvasRenderingContext2D):void{
  block(ctx,-.36,-.39,.53,.43,.16,['#e0cd9c','#c7b788','#a18f68']);
  shape(ctx,[[-.46,-.38],[-.15,-.70],[.35,-.60],[.50,-.31],[.08,-.39],[-.16,-.59]],'#776447');shape(ctx,[[-.46,-.38],[-.15,-.70],[.08,-.39]],'#a28d57');
  stroke(ctx,[[-.45,-.38],[-.16,-.61],[.08,-.39],[.50,-.31]],'#c3ae70',.024);
  ctx.fillStyle='#59694f';ctx.beginPath();ctx.moveTo(-.15,.045);ctx.lineTo(-.15,-.19);ctx.bezierCurveTo(-.15,-.31,.01,-.31,.01,-.19);ctx.lineTo(.01,.045);ctx.closePath();ctx.fill();stroke(ctx,[[-.135,-.06],[-.015,-.06]],'#88956a',.009);oval(ctx,-.023,-.11,.009,.009,'#dfc986');
  oval(ctx,.104,-.245,.057,.068,'#637b68');stroke(ctx,[[.104,-.307],[.104,-.18]],'#ddcf9c',.009);stroke(ctx,[[.048,-.245],[.16,-.245]],'#ddcf9c',.009);
  block(ctx,.15,-.685,.075,.12,.03,['#b6986a','#887453','#645b42']);
  for(let i=0;i<7;i++)oval(ctx,-.28+i*.07,-.405+Math.sin(i)*.018,.04,.014,i%2?'#76904d':'#94a763');
}
function lantern(ctx:CanvasRenderingContext2D):void{
  block(ctx,-.15,.014,.24,.033,.05,['#afa989','#7d8266','#5d705d']);block(ctx,-.065,-.36,.08,.38,.045,['#b4aa82','#82866c','#5a705e']);
  block(ctx,-.13,-.61,.21,.245,.055,['#e2cc8f','#c3a65c','#917c49']);
  ctx.fillStyle='#f5d48b';ctx.fillRect(-.093,-.568,.118,.161);stroke(ctx,[[-.045,-.61],[-.045,-.36]],'#735f3c',.014);
  shape(ctx,[[-.19,-.615],[0,-.76],[.19,-.615]],'#657c61');shape(ctx,[[-.19,-.615],[0,-.76],[0,-.615]],'#93a080');stroke(ctx,[[-.19,-.615],[.19,-.615]],'#bdb887',.019);oval(ctx,0,-.787,.024,.019,'#828e69');
}
function steps(ctx:CanvasRenderingContext2D):void{
  for(let i=0;i<4;i++)block(ctx,-.38+i*.09,-i*.09,.62-i*.08,.063,.10,['#c2c3a7','#929c82','#697f6a']);
  for(let i=0;i<5;i++)oval(ctx,-.30+i*.13,.045,.024,.01,i%2?'#84944f':'#a2ac62');
}
function path(ctx:CanvasRenderingContext2D):void{
  // Two diagonal lanes share one center stone: four distinct exits, viewed
  // from above at the same shallow perspective as the other small props.
  const stones=[{x:0,y:-.032}];
  for(const side of[-1,1])for(const direction of[-1,1])for(let step=1;step<=3;step++)stones.push({x:side*step*.13,y:-.032+direction*step*.026});
  stones.sort((a,b)=>a.y-b.y);
  for(let i=0;i<stones.length;i++){
    const{x,y}=stones[i];
    shape(ctx,[[x-.069,y-.008],[x,y-.018],[x+.069,y-.007],[x+.070,y+.027],[x+.004,y+.036],[x-.067,y+.023]],i%2?'#828d77':'#71836e');
    shape(ctx,[[x-.069,y-.008],[x,y-.018],[x+.069,y-.007],[x+.065,y+.011],[x+.004,y+.018],[x-.067,y+.006]],i%2?'#c9c6a4':'#b6bd9e');
    stroke(ctx,[[x-.046,y-.006],[x+.004,y-.012],[x+.044,y-.005]],'rgba(241,234,201,.48)',.004);
  }
}
/** Original warm illustrated props. Top/side faces and internal occlusion are
 * authored here; no external sprites, logos or downloaded artwork. */
export function drawObjectArt2D(ctx:CanvasRenderingContext2D,decoration:Decoration):boolean{
  if(drawCatalogArt2D(ctx,decoration.kind))return true;
  if(decoration.kind==='stone'){if(!decoration.variant||decoration.variant==='boulder')return false;stoneVariant(ctx,decoration.variant);return true;}
  if(decoration.kind==='stump'){if(decoration.variant==='fallen')fallenLog(ctx);else drawUprightStump2D(ctx);return true;}
  if(decoration.kind==='pavilion')pavilion(ctx);else if(decoration.kind==='statue')statue(ctx);else if(decoration.kind==='traveler')traveler(ctx);else if(decoration.kind==='cottage')cottage(ctx);else if(decoration.kind==='lantern')lantern(ctx);else if(decoration.kind==='steps')steps(ctx);else if(decoration.kind==='path')path(ctx);else return false;
  return true;
}
