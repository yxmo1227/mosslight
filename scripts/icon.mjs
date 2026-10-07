// Original, deterministic jar-and-sprout icon. No third-party artwork or fonts.
import { deflateSync } from 'node:zlib';
export function makeIcon() {
  const size = 256;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const ellipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const roundedRect = (x, y, left, top, right, bottom, radius) => {
    const cx = Math.max(left + radius, Math.min(right - radius, x));
    const cy = Math.max(top + radius, Math.min(bottom - radius, y));
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let color = [0, 0, 0, 0];
    if (roundedRect(x, y, 4, 4, 251, 251, 55)) color = [39, 72, 53, 255];
    if (roundedRect(x, y, 56, 79, 200, 215, 35) || roundedRect(x, y, 91, 49, 165, 98, 9)) color = [215, 229, 194, 255];
    if (roundedRect(x, y, 64, 87, 192, 207, 29) || roundedRect(x, y, 99, 57, 157, 102, 3)) color = [75, 117, 82, 255];
    if (roundedRect(x, y, 88, 39, 168, 56, 6)) color = [189, 162, 104, 255];
    if (y > 177 && roundedRect(x, y, 68, 161, 188, 203, 24)) color = [123, 151, 87, 255];
    if (ellipse(x, y, 128, 179, 46, 10)) color = [155, 181, 112, 255];
    if (x >= 125 && x <= 131 && y >= 121 && y <= 183) color = [208, 219, 153, 255];
    const leafLeft = (x - 111) * .8 + (y - 138) * .6;
    const leafAcross = -(x - 111) * .6 + (y - 138) * .8;
    if ((leafLeft / 25) ** 2 + (leafAcross / 12) ** 2 <= 1) color = [194, 213, 135, 255];
    const leafRight = (x - 145) * .8 - (y - 121) * .6;
    const leafOther = (x - 145) * .6 + (y - 121) * .8;
    if ((leafRight / 25) ** 2 + (leafOther / 12) ** 2 <= 1) color = [219, 230, 163, 255];
    if (roundedRect(x, y, 73, 101, 79, 155, 3)) color = [171, 201, 166, 255];
    raw.set(color, y * (size * 4 + 1) + 1 + x * 4);
  }
  const crc = data => {
    let value = 0xffffffff;
    for (const byte of data) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  const icoHeader = Buffer.alloc(22); icoHeader.writeUInt16LE(1, 2); icoHeader.writeUInt16LE(1, 4);
  icoHeader.writeUInt16LE(1, 10); icoHeader.writeUInt16LE(32, 12); icoHeader.writeUInt32LE(png.length, 14); icoHeader.writeUInt32LE(22, 18);
  return { png, ico: Buffer.concat([icoHeader, png]) };
}
