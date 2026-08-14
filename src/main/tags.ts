/**
 * 音频标签写入:MP3(ID3v2.3)+ FLAC(VORBIS_COMMENT / PICTURE)
 * 纯 Node 实现,不依赖第三方库。
 */

export interface TagMeta {
  title?: string;
  artist?: string;
  album?: string;
  cover?: Buffer;
  coverMime?: string;
}

// ---------- 工具 ----------

function syncsafe32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b[0] = (n >>> 21) & 0x7f;
  b[1] = (n >>> 14) & 0x7f;
  b[2] = (n >>> 7) & 0x7f;
  b[3] = n & 0x7f;
  return b;
}

function imageDimensions(mime: string, data: Buffer): { width: number; height: number; depth: number } {
  if (mime === 'image/png' && data.length >= 24 && data.readUInt32BE(12) === 0x49484452) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), depth: 24 };
  }
  if (mime === 'image/jpeg' && data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let off = 2;
    while (off + 9 <= data.length) {
      if (data[off] !== 0xff) {
        off++;
        continue;
      }
      const marker = data[off + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        off += 2;
        continue;
      }
      if (off + 4 > data.length) break;
      const segLen = data.readUInt16BE(off + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (off + 9 > data.length) break;
        return {
          width: data.readUInt16BE(off + 7),
          height: data.readUInt16BE(off + 5),
          depth: data[off + 4] * 8,
        };
      }
      off += 2 + segLen;
    }
  }
  return { width: 0, height: 0, depth: 24 };
}

// ---------- MP3 / ID3v2.3 ----------

function id3TextFrame(id: string, text: string): Buffer {
  const body = Buffer.concat([
    Buffer.from([0x01]), // encoding: UTF-16 with BOM
    Buffer.from([0xff, 0xfe]), // little-endian BOM(与下方 utf16le 编码一致)
    Buffer.from(text, 'utf16le'),
  ]);
  const header = Buffer.alloc(10);
  header.write(id, 0, 'latin1');
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

function id3ApicFrame(mime: string, data: Buffer): Buffer {
  const body = Buffer.concat([
    Buffer.from([0x00]), // encoding: latin1
    Buffer.from(mime, 'latin1'),
    Buffer.from([0x00]), // mime 结束
    Buffer.from([0x03]), // picture type: front cover
    Buffer.from([0x00]), // description(空)
    data,
  ]);
  const header = Buffer.alloc(10);
  header.write('APIC', 0, 'latin1');
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

/**
 * 去掉文件头已有的 ID3v2 标签(不保留原帧,统一用新标签替换)。
 * 返回剥离后的音频数据。
 */
function stripID3v2(buf: Buffer): Buffer {
  if (buf.length < 10 || buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return buf;
  const size =
    ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  const tagLen = 10 + size;
  if (tagLen > buf.length) return buf;
  return buf.slice(tagLen);
}

export function embedMP3Tags(audio: Buffer, meta: TagMeta): Buffer {
  const frames: Buffer[] = [];
  if (meta.title) frames.push(id3TextFrame('TIT2', meta.title));
  if (meta.artist) frames.push(id3TextFrame('TPE1', meta.artist));
  if (meta.album) frames.push(id3TextFrame('TALB', meta.album));
  if (meta.cover && meta.cover.length > 0) {
    frames.push(id3ApicFrame(meta.coverMime === 'image/png' ? 'image/png' : 'image/jpeg', meta.cover));
  }
  if (frames.length === 0) return audio;

  const body = Buffer.concat(frames);
  const header = Buffer.concat([
    Buffer.from('ID3', 'latin1'),
    Buffer.from([0x03, 0x00, 0x00]), // v2.3, no flags
    syncsafe32(body.length),
  ]);
  return Buffer.concat([header, body, stripID3v2(audio)]);
}

// ---------- FLAC ----------

function vorbisCommentBlock(meta: TagMeta): Buffer {
  const vendor = Buffer.from('NCM Converter', 'utf8');
  const entries: Buffer[] = [];
  if (meta.title) entries.push(Buffer.from(`TITLE=${meta.title}`, 'utf8'));
  if (meta.artist) entries.push(Buffer.from(`ARTIST=${meta.artist}`, 'utf8'));
  if (meta.album) entries.push(Buffer.from(`ALBUM=${meta.album}`, 'utf8'));

  // 规范顺序:vendor_length → vendor 字符串 → count → 条目
  const vendorLen = Buffer.alloc(4);
  vendorLen.writeUInt32LE(vendor.length, 0);
  const count = Buffer.alloc(4);
  count.writeUInt32LE(entries.length, 0);

  const parts: Buffer[] = [vendorLen, vendor, count];
  for (const e of entries) {
    const l = Buffer.alloc(4);
    l.writeUInt32LE(e.length, 0);
    parts.push(l, e);
  }
  return Buffer.concat(parts);
}

function flacPictureBlock(mime: string, data: Buffer): Buffer {
  const { width, height, depth } = imageDimensions(mime, data);
  const mimeBuf = Buffer.from(mime, 'latin1');

  // 规范顺序:type → mime长度 → mime → desc长度 → desc → width → height → depth → colors → data长度 → data
  const head = Buffer.alloc(8);
  head.writeUInt32BE(3, 0); // front cover
  head.writeUInt32BE(mimeBuf.length, 4);

  const descLen = Buffer.alloc(4); // desc 长度 = 0

  const tail = Buffer.alloc(20);
  tail.writeUInt32BE(width, 0);
  tail.writeUInt32BE(height, 4);
  tail.writeUInt32BE(depth, 8);
  tail.writeUInt32BE(0, 12); // 颜色数(非调色板时为 0)
  tail.writeUInt32BE(data.length, 16);

  return Buffer.concat([head, mimeBuf, descLen, tail, data]);
}

function flacBlockHeader(type: number, len: number, isLast: boolean): Buffer {
  const b = Buffer.alloc(4);
  b[0] = (type & 0x7f) | (isLast ? 0x80 : 0);
  b[1] = (len >>> 16) & 0xff;
  b[2] = (len >>> 8) & 0xff;
  b[3] = len & 0xff;
  return b;
}

export function embedFLACTags(audio: Buffer, meta: TagMeta): Buffer {
  if (audio.length < 4 || audio[0] !== 0x66 || audio[1] !== 0x4c || audio[2] !== 0x61 || audio[3] !== 0x43) {
    return audio;
  }

  // 解析元数据块链
  let offset = 4;
  const blocks: { type: number; data: Buffer }[] = [];
  let last = false;
  while (offset + 4 <= audio.length && !last) {
    const hdr = audio[offset];
    last = (hdr & 0x80) !== 0;
    const type = hdr & 0x7f;
    const len = (audio[offset + 1] << 16) | (audio[offset + 2] << 8) | audio[offset + 3];
    if (offset + 4 + len > audio.length) break; // 损坏,放弃写标签
    blocks.push({ type, data: audio.slice(offset + 4, offset + 4 + len) });
    offset += 4 + len;
  }
  if (blocks.length === 0 || blocks[0].type !== 0) return audio;
  const audioFrames = audio.slice(offset);

  // 去掉旧评论/图片块,保留其它块(STREAMINFO/SEEKTABLE 等)
  const kept = blocks.filter((b) => b.type !== 4 && b.type !== 6);
  const comment = vorbisCommentBlock(meta);
  const picture =
    meta.cover && meta.cover.length > 0
      ? flacPictureBlock(meta.coverMime === 'image/png' ? 'image/png' : 'image/jpeg', meta.cover)
      : null;

  // 每个元数据块 = 4 字节头 + 数据,成对入列
  const parts: Buffer[] = [Buffer.from('fLaC')];
  let blockCount = 0;
  let inserted = false;

  for (const b of kept) {
    parts.push(flacBlockHeader(b.type, b.data.length, false), b.data);
    blockCount++;
    if (!inserted && b.type === 0) {
      // STREAMINFO 之后插入评论与封面(FLAC 规范要求 STREAMINFO 是第一个块)
      if (comment.length > 0) {
        parts.push(flacBlockHeader(4, comment.length, false), comment);
        blockCount++;
      }
      if (picture) {
        parts.push(flacBlockHeader(6, picture.length, false), picture);
        blockCount++;
      }
      inserted = true;
    }
  }
  if (!inserted) {
    if (comment.length > 0) {
      parts.push(flacBlockHeader(4, comment.length, false), comment);
      blockCount++;
    }
    if (picture) {
      parts.push(flacBlockHeader(6, picture.length, false), picture);
      blockCount++;
    }
  }

  // 最后一个元数据块置 last 标志(块头位于 parts 中的奇数索引:1 + 2*(blockCount-1))
  const lastHeaderIdx = 1 + (blockCount - 1) * 2;
  parts[lastHeaderIdx][0] |= 0x80;

  parts.push(audioFrames);
  return Buffer.concat(parts);
}

export function embedTags(format: string, audio: Buffer, meta: TagMeta): Buffer {
  if (format === 'mp3') return embedMP3Tags(audio, meta);
  if (format === 'flac') return embedFLACTags(audio, meta);
  return audio;
}
