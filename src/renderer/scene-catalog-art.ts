import type { DecorationKind } from '../shared/types';

type Points = readonly (readonly [number, number])[];
const TAU = Math.PI * 2;
function shape(ctx: CanvasRenderingContext2D, points: Points, color: string): void {
  ctx.fillStyle = color; ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill();
}
function stroke(ctx: CanvasRenderingContext2D, points: Points, color: string, width: number): void {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
}
function oval(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string): void {
  ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
}
function block(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, depth: number, colors: readonly string[]): void {
  shape(ctx, [[x, y], [x + width, y], [x + width, y + height], [x, y + height]], colors[1]);
  shape(ctx, [[x + width, y], [x + width + depth, y - depth * .5], [x + width + depth, y + height - depth * .5], [x + width, y + height]], colors[2]);
  shape(ctx, [[x, y], [x + depth, y - depth * .5], [x + width + depth, y - depth * .5], [x + width, y]], colors[0]);
}
function face(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  oval(ctx, x, y, size, size * 1.1, '#dcb88a');
  oval(ctx, x - size * .35, y, size * .065, size * .09, '#635c43'); oval(ctx, x + size * .35, y, size * .065, size * .09, '#635c43');
}
function fairy(ctx: CanvasRenderingContext2D): void {
  for (const side of [-1, 1]) {
    ctx.save(); ctx.translate(side * .064, -.34); ctx.rotate(side * .65);
    oval(ctx, side * .1, -.08, .102, .20, 'rgba(166,197,166,.74)'); oval(ctx, side * .12, .08, .095, .117, 'rgba(207,222,185,.83)');
    stroke(ctx, [[0, .04], [side * .09, -.11], [side * .13, -.21]], 'rgba(112,147,117,.58)', .004); ctx.restore();
  }
  stroke(ctx, [[-.034, -.16], [-.075, -.007]], '#d9b58b', .022); stroke(ctx, [[.04, -.15], [.12, -.038]], '#d9b58b', .022);
  shape(ctx, [[-.06, -.40], [.07, -.40], [.155, -.16], [.06, -.19], [0, -.13], [-.105, -.16]], '#9bab70');
  shape(ctx, [[.027, -.39], [.07, -.40], [.155, -.16], [.06, -.19]], '#718963');
  face(ctx, .008, -.47, .065); oval(ctx, .005, -.526, .075, .033, '#ab7650'); oval(ctx, -.058, -.476, .027, .057, '#ab7650');
  stroke(ctx, [[-.049, -.353], [-.139, -.31]], '#d9b58b', .024); stroke(ctx, [[.068, -.345], [.17, -.40]], '#d9b58b', .024);
  stroke(ctx, [[.17, -.405], [.256, -.51]], '#aa9565', .009);
  shape(ctx, [[.26, -.55], [.274, -.516], [.305, -.508], [.274, -.495], [.258, -.465], [.243, -.499], [.217, -.512], [.246, -.522]], '#d9c987');
}
function gardener(ctx: CanvasRenderingContext2D): void {
  stroke(ctx, [[-.06, -.13], [-.074, .019]], '#716d4c', .052); stroke(ctx, [[.056, -.13], [.07, .019]], '#716d4c', .052);
  shape(ctx, [[-.095, -.49], [.092, -.49], [.124, -.12], [-.127, -.12]], '#bd9864');
  shape(ctx, [[-.069, -.41], [.061, -.41], [.085, -.16], [-.087, -.16]], '#829066');
  stroke(ctx, [[-.045, -.48], [-.066, -.35]], '#829066', .021); stroke(ctx, [[.041, -.48], [.06, -.35]], '#829066', .021);
  block(ctx, -.039, -.29, .074, .064, .005, ['#99a27a', '#71805b', '#657654']);
  face(ctx, 0, -.547, .075); oval(ctx, 0, -.617, .164, .026, '#c4ab75'); oval(ctx, 0, -.65, .09, .063, '#d6bf89'); stroke(ctx, [[-.085, -.625], [.089, -.625]], '#a58d61', .018);
  stroke(ctx, [[.109, -.43], [.19, -.30]], '#bd9864', .042); stroke(ctx, [[-.11, -.43], [-.18, -.245]], '#bd9864', .042);
  oval(ctx, .214, -.254, .084, .069, '#779385'); oval(ctx, .214, -.31, .067, .019, '#9bab8b');
  stroke(ctx, [[.29, -.276], [.35, -.315]], '#779385', .021); oval(ctx, .353, -.322, .022, .012, '#5d786d');
  ctx.strokeStyle = '#6b8374'; ctx.lineWidth = .014; ctx.beginPath(); ctx.arc(.161, -.284, .053, .5, Math.PI * 1.8); ctx.stroke();
}
function reader(ctx: CanvasRenderingContext2D): void {
  block(ctx, -.19, -.05, .34, .07, .05, ['#b8b194', '#8a957b', '#707c66']);
  shape(ctx, [[-.105, -.36], [.105, -.36], [.14, -.08], [-.15, -.08]], '#91a398');
  stroke(ctx, [[-.095, -.13], [-.186, -.064], [-.09, -.012]], '#8c785d', .052); stroke(ctx, [[.097, -.13], [.181, -.058], [.08, -.003]], '#8c785d', .052);
  face(ctx, -.004, -.412, .076); oval(ctx, -.006, -.477, .085, .04, '#756344'); oval(ctx, -.065, -.434, .025, .067, '#756344');
  shape(ctx, [[-.177, -.25], [-.016, -.276], [.157, -.248], [.13, -.092], [-.021, -.119], [-.15, -.091]], '#8a7155');
  shape(ctx, [[-.167, -.255], [-.015, -.271], [-.019, -.13], [-.143, -.107]], '#e7dcb7'); shape(ctx, [[-.015, -.271], [.148, -.25], [.126, -.104], [-.019, -.13]], '#d0c69f');
  for (let i = 0; i < 4; i++) { stroke(ctx, [[-.137, -.224 + i * .024], [-.044, -.235 + i * .026]], '#afa57f', .003); stroke(ctx, [[.018, -.235 + i * .026], [.117, -.22 + i * .024]], '#a79c79', .003); }
  oval(ctx, -.153, -.19, .024, .039, '#dab58a'); oval(ctx, .146, -.18, .023, .04, '#dab58a');
}
function cat(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = '#ad855e'; ctx.lineWidth = .046; ctx.beginPath(); ctx.moveTo(.087, -.05); ctx.bezierCurveTo(.32, .018, .29, -.21, .17, -.19); ctx.stroke();
  oval(ctx, 0, -.177, .12, .191, '#c39d73'); oval(ctx, -.026, -.15, .068, .132, '#e0c9a0');
  shape(ctx, [[-.117, -.35], [-.102, -.517], [-.022, -.418], [.093, -.506], [.119, -.35]], '#bd966d');
  oval(ctx, 0, -.361, .124, .112, '#cba77d'); shape(ctx, [[-.09, -.425], [-.082, -.481], [-.047, -.427]], '#bf8f7b'); shape(ctx, [[.048, -.429], [.081, -.473], [.089, -.42]], '#bf8f7b');
  stroke(ctx, [[-.08, -.354], [-.046, -.358]], '#655d43', .009); stroke(ctx, [[.042, -.356], [.079, -.351]], '#655d43', .009);
  shape(ctx, [[-.013, -.328], [.014, -.328], [0, -.316]], '#946c58');
  for (const side of [-1, 1]) for (let i = 0; i < 2; i++) stroke(ctx, [[side * .035, -.319 + i * .014], [side * .128, -.326 + i * .025]], '#a38a6a', .003);
  oval(ctx, -.063, .014, .055, .025, '#b78f67'); oval(ctx, .061, .014, .055, .025, '#b78f67');
}
function dog(ctx: CanvasRenderingContext2D): void {
  stroke(ctx, [[.082, -.105], [.232, -.23], [.258, -.205]], '#9e7d58', .044);
  oval(ctx, 0, -.163, .127, .18, '#c5af86'); oval(ctx, -.025, -.12, .072, .12, '#ded1ac');
  oval(ctx, 0, -.362, .123, .119, '#cbb38a'); oval(ctx, -.113, -.339, .052, .12, '#927454'); oval(ctx, .112, -.338, .052, .12, '#927454');
  oval(ctx, -.03, -.391, .043, .054, '#b6996c'); oval(ctx, -.004, -.316, .07, .047, '#e0cfaa');
  oval(ctx, -.046, -.366, .01, .012, '#555444'); oval(ctx, .047, -.366, .01, .012, '#555444'); oval(ctx, 0, -.326, .027, .018, '#645c45');
  stroke(ctx, [[-.088, -.237], [.082, -.237]], '#82947b', .028); oval(ctx, .002, -.217, .014, .021, '#c0a263');
  oval(ctx, -.081, .015, .067, .031, '#bba078'); oval(ctx, .072, .015, .067, .031, '#bba078');
}
function archDoor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h * .64); ctx.bezierCurveTo(x, y - h * 1.10, x + w, y - h * 1.10, x + w, y - h * .64); ctx.lineTo(x + w, y); ctx.closePath(); ctx.fill();
  stroke(ctx, [[x + w * .5, y], [x + w * .5, y - h * .76]], 'rgba(224,212,166,.35)', .008); oval(ctx, x + w * .78, y - h * .34, .009, .012, '#cfb477');
}
function mushroomHouse(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#cbb99b'; ctx.beginPath(); ctx.moveTo(-.27, .032); ctx.quadraticCurveTo(-.19, -.16, -.19, -.4); ctx.lineTo(.23, -.40); ctx.quadraticCurveTo(.2, -.12, .29, .04); ctx.closePath(); ctx.fill();
  shape(ctx, [[.123, -.41], [.23, -.4], [.29, .04], [.14, .029]], '#a49576');
  oval(ctx, 0, -.417, .45, .095, '#c8b394');
  ctx.fillStyle = '#ae6d52'; ctx.beginPath(); ctx.moveTo(-.47, -.43); ctx.bezierCurveTo(-.39, -.80, .30, -.88, .48, -.43); ctx.quadraticCurveTo(.025, -.35, -.47, -.43); ctx.fill();
  ctx.fillStyle = '#c18460'; ctx.beginPath(); ctx.moveTo(-.47, -.43); ctx.bezierCurveTo(-.38, -.74, .02, -.8, .20, -.69); ctx.quadraticCurveTo(-.16, -.65, -.17, -.397); ctx.closePath(); ctx.fill();
  for (const [x, y, rx, ry] of [[-.27, -.554, .055, .026], [-.08, -.676, .062, .028], [.13, -.604, .047, .026], [.31, -.51, .045, .027], [-.03, -.494, .038, .019]]) oval(ctx, x, y, rx, ry, '#dcc7a0');
  archDoor(ctx, -.104, .04, .148, .295, '#6d8b83'); oval(ctx, .145, -.26, .06, .062, '#718779'); stroke(ctx, [[.145, -.31], [.145, -.21]], '#dbc9a3', .009); stroke(ctx, [[.098, -.26], [.193, -.26]], '#dbc9a3', .009);
  oval(ctx, -.24, .027, .053, .025, '#81995e'); oval(ctx, .235, .036, .074, .029, '#99aa68');
}
function treehouse(ctx: CanvasRenderingContext2D): void {
  shape(ctx, [[-.10, -.49], [.09, -.49], [.065, -.06], [.15, .045], [-.16, .045], [-.06, -.06]], '#887050');
  stroke(ctx, [[-.006, -.01], [.008, -.45]], '#ad9166', .019);
  block(ctx, -.32, -.43, .56, .063, .12, ['#b9a57a', '#8a7855', '#6e654b']);
  block(ctx, -.26, -.73, .41, .30, .13, ['#c9b58a', '#b5a179', '#8c8261']);
  shape(ctx, [[-.37, -.72], [-.05, -.97], [.34, -.80], [.41, -.67], [.10, -.73], [-.064, -.87]], '#6f876a');
  shape(ctx, [[-.37, -.72], [-.05, -.97], [.10, -.73]], '#96a47a'); stroke(ctx, [[-.36, -.72], [-.063, -.87], [.10, -.73], [.40, -.67]], '#b9ba89', .016);
  archDoor(ctx, -.196, -.427, .115, .22, '#6c7b61'); oval(ctx, .057, -.578, .055, .064, '#748f87'); stroke(ctx, [[.057, -.633], [.057, -.525]], '#d4c596', .006); stroke(ctx, [[.006, -.578], [.108, -.578]], '#d4c596', .006);
  stroke(ctx, [[.18, -.40], [.24, .024]], '#9d8560', .018); stroke(ctx, [[.282, -.40], [.339, .024]], '#9d8560', .018);
  for (let i = 0; i < 5; i++) stroke(ctx, [[.18 + i * .012, -.37 + i * .078], [.286 + i * .012, -.37 + i * .078]], '#b6a17b', .018);
  for (let i = 0; i < 5; i++) oval(ctx, -.28 + i * .071, -.417, .042, .014, i % 2 ? '#829461' : '#a7b67b');
}
function arcLamp(ctx: CanvasRenderingContext2D): void {
  oval(ctx, -.12, .018, .123, .038, '#6c7a65'); oval(ctx, -.12, .007, .098, .028, '#9a9d7f');
  ctx.strokeStyle = '#64705f'; ctx.lineWidth = .02; ctx.beginPath(); ctx.moveTo(-.12, .014); ctx.lineTo(-.12, -.69); ctx.bezierCurveTo(-.12, -.96, .27, -.96, .27, -.686); ctx.stroke();
  stroke(ctx, [[-.124, -.06], [-.124, -.69]], '#a6ac87', .005);
  shape(ctx, [[.213, -.745], [.316, -.745], [.408, -.623], [.139, -.623]], '#839078');
  shape(ctx, [[.213, -.745], [.245, -.745], [.223, -.623], [.139, -.623]], '#a9ae85');
  oval(ctx, .27, -.62, .134, .028, '#e4cea0'); oval(ctx, .27, -.609, .075, .024, '#f0d994');
}
function slenderSteps(ctx: CanvasRenderingContext2D): void {
  for (let i = 0; i < 6; i++) block(ctx, -.22 + i * .035, -i * .08, .245, .050, .087, ['#c5c6ad', '#94a18a', '#6e8372']);
  for (let i = 0; i < 3; i++) oval(ctx, -.195 + i * .077, .048, .024, .009, '#95a371');
}
function celestial(ctx: CanvasRenderingContext2D, kind: 'sun' | 'moon' | 'star'): void {
  if (kind === 'sun') {
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU, dx = Math.cos(a), dy = Math.sin(a); stroke(ctx, [[dx * .21, -.29 + dy * .21], [dx * .273, -.29 + dy * .273]], i % 2 ? '#ceaa66' : '#dbc17d', .018); }
    oval(ctx, 0, -.29, .17, .17, '#d6b267'); oval(ctx, -.022, -.307, .144, .146, '#e5c77e');
    stroke(ctx, [[-.069, -.29], [-.035, -.293]], '#a08750', .01); stroke(ctx, [[.037, -.293], [.07, -.29]], '#a08750', .01);
    ctx.strokeStyle = '#b5955b'; ctx.lineWidth = .008; ctx.beginPath(); ctx.arc(0, -.269, .043, .14, Math.PI - .14); ctx.stroke();
  } else if (kind === 'moon') {
    ctx.fillStyle = '#c6cdb4'; ctx.beginPath(); ctx.moveTo(.065, -.60); ctx.bezierCurveTo(-.28, -.62, -.36, -.035, .06, -.032); ctx.bezierCurveTo(-.09, -.15, -.135, -.40, .065, -.60); ctx.fill();
    ctx.strokeStyle = '#e0dfbc'; ctx.lineWidth = .012; ctx.beginPath(); ctx.moveTo(.035, -.577); ctx.bezierCurveTo(-.22, -.54, -.25, -.12, -.027, -.067); ctx.stroke();
    oval(ctx, -.161, -.269, .03, .039, 'rgba(132,151,132,.25)'); oval(ctx, -.119, -.43, .019, .022, 'rgba(132,151,132,.2)');
  } else {
    const points: [number, number][] = Array.from({ length: 10 }, (_, i) => { const angle = -Math.PI / 2 + i / 10 * TAU, radius = i % 2 ? .12 : .27; return [Math.cos(angle) * radius, -.28 + Math.sin(angle) * radius]; });
    shape(ctx, points, '#c8aa6a'); shape(ctx, [points[0], points[1], points[2], [0, -.28], points[8], points[9]], '#e4cb89');
    stroke(ctx, [[0, -.50], [0, -.29], [.105, -.258]], '#ead69c', .008);
  }
}

/** All props are original Canvas shapes, without downloaded images or characters. */
export function drawCatalogArt2D(ctx: CanvasRenderingContext2D, kind: DecorationKind): boolean {
  switch (kind) {
    case 'fairy': fairy(ctx); break;
    case 'gardener': gardener(ctx); break;
    case 'reader': reader(ctx); break;
    case 'cat': cat(ctx); break;
    case 'dog': dog(ctx); break;
    case 'mushroom-house': mushroomHouse(ctx); break;
    case 'treehouse': treehouse(ctx); break;
    case 'arc-lamp': arcLamp(ctx); break;
    case 'slender-steps': slenderSteps(ctx); break;
    case 'sun': case 'moon': case 'star': celestial(ctx, kind); break;
    default: return false;
  }
  return true;
}
