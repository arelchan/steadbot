import { deflateSync } from 'node:zlib';
import qrcode from 'qrcode-generator';

/**
 * A QR code as a PNG, with no image library.
 *
 * The pairing card shows a code that a phone has to read off the screen, so it has to be a real image in the
 * conversation, not a link. Everything here is the little that takes: the encoder gives a matrix of dark modules,
 * and a PNG of flat 8-bit grey is a header, one deflated block of rows, and a checksum.
 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = (buf: Buffer) => {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Grey 8-bit PNG from one byte per pixel. */
function greyPng(px: Buffer, width: number, height: number): Buffer {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter: none
    px.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type: greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Encode `text` as a QR PNG about `size` px wide (quiet zone included, as the spec wants). */
export function qrPng(text: string, size = 560): Buffer {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const margin = 4;
  const scale = Math.max(2, Math.floor(size / (n + margin * 2)));
  const width = (n + margin * 2) * scale;
  const px = Buffer.alloc(width * width, 0xff);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      const y0 = (r + margin) * scale;
      const x0 = (c + margin) * scale;
      for (let y = y0; y < y0 + scale; y++) px.fill(0x00, y * width + x0, y * width + x0 + scale);
    }
  return greyPng(px, width, width);
}
