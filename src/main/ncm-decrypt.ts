import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { NCMFileInfo, AudioFormat } from '../shared/types';
import { embedTags } from './tags';

// Correct keys from ncmdump reference implementation (taurusxin/ncmdump)
const CORE_KEY = Buffer.from([0x68, 0x7a, 0x48, 0x52, 0x41, 0x6d, 0x73, 0x6f, 0x35, 0x6b, 0x49, 0x6e, 0x62, 0x61, 0x78, 0x57]);
const MOD_KEY = Buffer.from([0x23, 0x31, 0x34, 0x6c, 0x6a, 0x6b, 0x5f, 0x21, 0x5c, 0x5d, 0x26, 0x30, 0x55, 0x3c, 0x27, 0x28]);

/**
 * AES-128-ECB 解密,与 ncmdump 参考实现行为一致:
 * 只处理完整的 16 字节块,尾部不足一块的数据忽略;PKCS7 填充字节 >16 时视为无填充。
 * (Node 默认的 final() 在输入不是 16 的倍数时会直接抛错,导致个别文件转换失败)
 */
function aesEcbDecrypt(key: Buffer, data: Buffer): Buffer {
  const blockLen = data.length & ~15;
  if (blockLen === 0) return Buffer.alloc(0);
  const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(data.subarray(0, blockLen)), decipher.final()]);
  const pad = decrypted[decrypted.length - 1];
  const drop = pad > 0 && pad <= 16 ? pad : 0;
  return decrypted.slice(0, decrypted.length - drop);
}

// RC4 KSA - builds the key box used for audio decryption
function buildKeyBox(key: Buffer): Uint8Array {
  const keyBox = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    keyBox[i] = i;
  }

  let lastByte = 0;
  let keyOffset = 0;
  const keyLen = key.length;

  for (let i = 0; i < 256; i++) {
    const swap = keyBox[i];
    const c = (swap + lastByte + key[keyOffset++]) & 0xff;
    if (keyOffset >= keyLen) keyOffset = 0;
    keyBox[i] = keyBox[c];
    keyBox[c] = swap;
    lastByte = c;
  }

  return keyBox;
}

// 从音频数据头部探测真实格式
function detectFormat(buf: Buffer): AudioFormat {
  if (buf.length >= 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return 'mp3'; // ID3
  if (buf.length >= 4 && buf[0] === 0x66 && buf[1] === 0x4c && buf[2] === 0x61 && buf[3] === 0x43) return 'flac'; // fLaC
  if (buf.length >= 4 && buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return 'ogg'; // OggS
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x41 && buf[10] === 0x56 && buf[11] === 0x45
  ) return 'wav'; // RIFF....WAVE
  if (buf.length >= 4 && buf[0] === 0x4d && buf[1] === 0x41 && buf[2] === 0x43 && buf[3] === 0x20) return 'ape'; // MAC 
  if (
    buf.length >= 16 &&
    buf[0] === 0x30 && buf[1] === 0x26 && buf[2] === 0xb2 && buf[3] === 0x75 &&
    buf[4] === 0x8e && buf[5] === 0x66 && buf[6] === 0xcf && buf[7] === 0x11
  ) return 'wma'; // ASF GUID
  if (buf.length >= 12 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'm4a'; // ....ftyp
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) return 'aac'; // ADTS
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3'; // MPEG sync
  return 'unknown';
}

const FORMAT_EXT: Record<AudioFormat, string> = {
  mp3: 'mp3',
  flac: 'flac',
  ogg: 'ogg',
  wav: 'wav',
  ape: 'ape',
  wma: 'wma',
  m4a: 'm4a',
  aac: 'aac',
  unknown: 'bin',
};

export async function parseNCM(
  filePath: string,
  onProgress?: (ratio: number) => void
): Promise<NCMFileInfo> {
  const fd = fs.openSync(filePath, 'r');
  const report = (r: number) => onProgress?.(Math.max(0, Math.min(1, r)));

  try {
    // 1. 校验魔数(8 字节)
    const magic = Buffer.alloc(8);
    fs.readSync(fd, magic, 0, 8, 0);
    if (magic.readUInt32LE(0) !== 0x4e455443 || magic.readUInt32LE(4) !== 0x4d414446) {
      throw new Error('不是有效的 NCM 文件');
    }

    let offset = 10; // 魔数后跳过 2 字节
    report(0.02);

    // 2. 密钥
    const keyLenBuf = Buffer.alloc(4);
    fs.readSync(fd, keyLenBuf, 0, 4, offset);
    offset += 4;
    const keyLen = keyLenBuf.readUInt32LE(0);
    if (keyLen <= 0 || keyLen > 1024 * 1024) {
      throw new Error('文件损坏:密钥长度非法');
    }

    const keyData = Buffer.alloc(keyLen);
    fs.readSync(fd, keyData, 0, keyLen, offset);
    offset += keyLen;
    for (let i = 0; i < keyLen; i++) keyData[i] ^= 0x64;
    report(0.05);

    const decryptedKeyData = aesEcbDecrypt(CORE_KEY, keyData);
    if (decryptedKeyData.length <= 17) {
      throw new Error('文件损坏:无法解析密钥');
    }
    const keyBox = buildKeyBox(Buffer.from(decryptedKeyData.slice(17)));
    report(0.08);

    // 3. 元数据
    const metaLenBuf = Buffer.alloc(4);
    fs.readSync(fd, metaLenBuf, 0, 4, offset);
    offset += 4;
    const metaLen = metaLenBuf.readUInt32LE(0);

    let songName = '';
    let artist = '';
    let album = '';
    let metaFormat: string | undefined;

    if (metaLen > 0 && metaLen < 16 * 1024 * 1024) {
      const metaData = Buffer.alloc(metaLen);
      fs.readSync(fd, metaData, 0, metaLen, offset);
      offset += metaLen;
      for (let i = 0; i < metaLen; i++) metaData[i] ^= 0x63;

      const base64Data = metaData.slice(22).toString('utf8').replace(/\0+$/, '');
      const decodedData = Buffer.from(base64Data, 'base64');
      const decryptedMeta = aesEcbDecrypt(MOD_KEY, decodedData);
      const metaStr = decryptedMeta.slice(6).toString('utf8').replace(/\0+$/, '');

      try {
        const metaJson = JSON.parse(metaStr);
        if (typeof metaJson.musicName === 'string') songName = metaJson.musicName;
        if (Array.isArray(metaJson.artist)) {
          artist = metaJson.artist
            .map((a: any) => (Array.isArray(a) ? a[0] : a))
            .filter((a: any) => typeof a === 'string')
            .join('/');
        } else if (typeof metaJson.artist === 'string') {
          artist = metaJson.artist;
        }
        if (typeof metaJson.album === 'string') {
          album = metaJson.album;
        } else if (metaJson.album && typeof metaJson.album.name === 'string') {
          album = metaJson.album.name;
        }
        if (typeof metaJson.format === 'string') metaFormat = metaJson.format.toLowerCase();
      } catch {
        // 元数据损坏时忽略,使用文件名兜底
      }
      report(0.12);
    } else {
      offset += metaLen; // 理论上 metaLen<=0,防御性跳过
    }

    // 4. CRC32(4 字节)+ 图片版本(1 字节)
    offset += 5;

    // 5. 封面
    let cover: Buffer | undefined;
    let coverMime: string | undefined;

    const coverFrameLenBuf = Buffer.alloc(4);
    fs.readSync(fd, coverFrameLenBuf, 0, 4, offset);
    offset += 4;
    const coverFrameLen = coverFrameLenBuf.readUInt32LE(0);

    const imageLenBuf = Buffer.alloc(4);
    fs.readSync(fd, imageLenBuf, 0, 4, offset);
    offset += 4;
    const imageLen = imageLenBuf.readUInt32LE(0);

    if (imageLen > 0 && imageLen < 64 * 1024 * 1024) {
      cover = Buffer.alloc(imageLen);
      fs.readSync(fd, cover, 0, imageLen, offset);
      offset += imageLen;
      coverMime = cover[0] === 0x89 && cover[1] === 0x50 ? 'image/png' : 'image/jpeg';
    }
    offset += coverFrameLen - imageLen;
    report(0.15);

    // 6. 音频数据:逐块读取并解密
    const chunkSize = 0x8000;
    const buffer = Buffer.alloc(chunkSize);
    const fileSize = fs.fstatSync(fd).size;
    const audioStart = offset;
    const totalAudio = Math.max(1, fileSize - audioStart);
    const audioChunks: Buffer[] = [];
    let readTotal = 0;

    while (offset < fileSize) {
      const toRead = Math.min(chunkSize, fileSize - offset);
      const bytesRead = fs.readSync(fd, buffer, 0, toRead, offset);
      if (bytesRead <= 0) break;
      offset += bytesRead;
      readTotal += bytesRead;

      const decrypted = Buffer.alloc(bytesRead);
      for (let i = 0; i < bytesRead; i++) {
        const j = (i + 1) & 0xff;
        decrypted[i] = buffer[i] ^ keyBox[(keyBox[j] + keyBox[(keyBox[j] + j) & 0xff]) & 0xff];
      }
      audioChunks.push(decrypted);
      report(0.15 + 0.65 * (readTotal / totalAudio));
    }

    const audioData = Buffer.concat(audioChunks);
    report(0.8);

    // 7. 格式探测:优先真实音频头,其次元数据里的 format 字段
    let format = detectFormat(audioData);
    if (format === 'unknown' && metaFormat && metaFormat in FORMAT_EXT && metaFormat !== 'unknown') {
      format = metaFormat as AudioFormat;
    }

    return {
      filePath,
      fileName: path.basename(filePath),
      songName,
      artist,
      album,
      format,
      cover,
      coverMime,
      audioData,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function sanitizeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim();
}

/** 找到不冲突的输出路径(重名时自动追加序号) */
function uniquePath(outputDir: string, fileName: string): string {
  const ext = path.extname(fileName);
  const base = fileName.slice(0, fileName.length - ext.length);
  let candidate = path.join(outputDir, fileName);
  let i = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(outputDir, `${base} (${i})${ext}`);
    i++;
  }
  return candidate;
}

export function saveAudioFile(info: NCMFileInfo, outputDir: string): string {
  fs.mkdirSync(outputDir, { recursive: true });

  const ext = FORMAT_EXT[info.format];
  const hasRealMeta = info.songName || info.artist;

  let base: string;
  if (hasRealMeta) {
    const title = sanitizeName(info.songName || path.basename(info.fileName, '.ncm'));
    const who = info.artist ? sanitizeName(info.artist) : '';
    base = who && info.songName ? `${who} - ${title}` : title;
  } else {
    base = sanitizeName(path.basename(info.fileName, '.ncm')) || 'untitled';
  }

  const outputPath = uniquePath(outputDir, `${base}.${ext}`);
  const withTags = embedTags(info.format, info.audioData, {
    title: info.songName || undefined,
    artist: info.artist || undefined,
    album: info.album || undefined,
    cover: info.cover,
    coverMime: info.coverMime,
  });

  fs.writeFileSync(outputPath, withTags);
  return outputPath;
}

export async function convertNCMFile(
  filePath: string,
  outputDir: string,
  onProgress: (progress: number) => void
): Promise<string> {
  onProgress(2);

  const info = await parseNCM(filePath, (r) => onProgress(2 + Math.round(r * 78))); // 2..80
  onProgress(82);

  const outputPath = saveAudioFile(info, outputDir); // 82..92
  onProgress(92);

  fs.statSync(outputPath); // 确认落盘
  onProgress(100);

  return outputPath;
}
