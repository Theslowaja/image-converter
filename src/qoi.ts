// Exact port of Qoi.h from Velover Template (ExtactImageData)
// Note: Velover Template uses Little-Endian for 32-bit values in the header.

const MAGIC_WORD = 0x66696f71; // 'q', 'o', 'i', 'f'
const QOI_OP_RGB = 0b11111110;
const QOI_OP_RGBA = 0b11111111;
const QOI_OP_INDEX = 0b00000000;
const QOI_OP_LUMA = 0b10000000;
const QOI_OP_RUN = 0b11000000;
const QOI_OP_DIFF = 0b01000000;

const QOI_HEADER_SIZE = 14;
const QOI_ENDING = [0, 0, 0, 0, 0, 0, 0, 1];

interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

function colorEquals(c1: Color, c2: Color): boolean {
  return c1.r === c2.r && c1.g === c2.g && c1.b === c2.b && c1.a === c2.a;
}

function getColorHash(c: Color): number {
  return (c.r * 3 + c.g * 5 + c.b * 7 + c.a * 11) % 64;
}

export function qoiEncode(
  data: Uint8Array,
  width: number,
  height: number,
  channels: 3 | 4,
  colorspace: number = 1
): Uint8Array {
  const lastColorOffset = width * height * channels - channels;
  const maxSize = width * height * (channels + 1) + QOI_HEADER_SIZE + QOI_ENDING.length;
  const bytes = new Uint8Array(maxSize);
  let index = 0;

  const writeByte = (value: number) => {
    bytes[index++] = value & 0xff;
  };

  const write32 = (value: number) => {
    writeByte((value & 0x000000ff) >> 0);
    writeByte((value & 0x0000ff00) >> 8);
    writeByte((value & 0x00ff0000) >> 16);
    writeByte((value & 0xff000000) >> 24);
  };

  const readByte = (offset: number) => data[offset];

  // Header (14 bytes)
  write32(MAGIC_WORD);
  write32(width);
  write32(height);
  writeByte(channels);
  writeByte(colorspace);

  let previousColor: Color = { r: 0, g: 0, b: 0, a: 255 };
  const seenColors: Color[] = Array.from({ length: 64 }, () => ({ r: 0, g: 0, b: 0, a: 0 }));

  let run = 0;

  for (let offset = 0; offset <= lastColorOffset; offset += channels) {
    const thisColor: Color = {
      r: readByte(offset + 0),
      g: readByte(offset + 1),
      b: readByte(offset + 2),
      a: channels === 4 ? readByte(offset + 3) : previousColor.a
    };

    if (colorEquals(thisColor, previousColor)) {
      run += 1;
      if (offset === lastColorOffset) {
        writeByte(QOI_OP_RUN | (run - 1));
        continue;
      }
      if (run === 62) {
        writeByte(QOI_OP_RUN | (run - 1));
        run = 0;
      }
      continue;
    }

    if (run !== 0) {
      writeByte(QOI_OP_RUN | (run - 1));
      run = 0;
    }

    const diffR = thisColor.r - previousColor.r;
    const diffG = thisColor.g - previousColor.g;
    const diffB = thisColor.b - previousColor.b;
    const diffA = thisColor.a - previousColor.a;

    previousColor = { ...thisColor };

    const hash = getColorHash(thisColor);
    if (colorEquals(seenColors[hash], thisColor)) {
      writeByte(QOI_OP_INDEX | hash);
      continue;
    }
    seenColors[hash] = { ...thisColor };

    if (diffA !== 0) {
      writeByte(QOI_OP_RGBA);
      writeByte(thisColor.r);
      writeByte(thisColor.g);
      writeByte(thisColor.b);
      writeByte(thisColor.a);
      continue;
    }

    const drDg = diffR - diffG;
    const dbDg = diffB - diffG;

    if (
      diffR >= -2 &&
      diffR <= 1 &&
      diffG >= -2 &&
      diffG <= 1 &&
      diffB >= -2 &&
      diffB <= 1
    ) {
      writeByte(
        QOI_OP_DIFF |
          ((diffB + 2) << 0) |
          ((diffG + 2) << 2) |
          ((diffR + 2) << 4)
      );
      continue;
    }

    if (
      diffG >= -32 &&
      diffG <= 31 &&
      drDg >= -8 &&
      drDg <= 7 &&
      dbDg >= -8 &&
      dbDg <= 7
    ) {
      writeByte(QOI_OP_LUMA | (diffG + 32));
      writeByte(((drDg + 8) << 4) + ((dbDg + 8) << 0));
      continue;
    }

    writeByte(QOI_OP_RGB);
    writeByte(thisColor.r);
    writeByte(thisColor.g);
    writeByte(thisColor.b);
  }

  for (const endingByte of QOI_ENDING) {
    writeByte(endingByte);
  }

  return bytes.subarray(0, index);
}
