import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { NCMFileInfo } from '../shared/types';

// Correct keys from ncmdump reference implementation (taurusxin/ncmdump)
const CORE_KEY = Buffer.from([0x68, 0x7A, 0x48, 0x52, 0x41, 0x6D, 0x73, 0x6F, 0x35, 0x6B, 0x49, 0x6E, 0x62, 0x61, 0x78, 0x57]);
const MOD_KEY = Buffer.from([0x23, 0x31, 0x34, 0x6C, 0x6A, 0x6B, 0x5F, 0x21, 0x5C, 0x5D, 0x26, 0x30, 0x55, 0x3C, 0x27, 0x28]);

// PKCS7 unpadding for AES-ECB
function aesEcbDecrypt(key: Buffer, data: Buffer): Buffer {
  const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  // PKCS7 unpad: last byte tells how many bytes to remove
  const pad = decrypted[decrypted.length - 1];
  if (pad > 0 && pad <= 16) {
    return decrypted.slice(0, decrypted.length - pad);
  }
  return decrypted;
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

// Base64 decode helper
function base64Decode(input: string): Buffer {
  return Buffer.from(input, 'base64');
}

export async function parseNCM(filePath: string): Promise<NCMFileInfo> {
  const fd = fs.openSync(filePath, 'r');

  try {
    // Step 1: Check magic header (8 bytes)
    const magic = Buffer.alloc(8);
    fs.readSync(fd, magic, 0, 8, 0);

    // Reference reads as two uint32 LE: 0x4e455443 and 0x4d414446
    const header1 = magic.readUInt32LE(0);
    const header2 = magic.readUInt32LE(4);
    if (header1 !== 0x4e455443 || header2 !== 0x4d414446) {
      throw new Error('Not a valid NCM file');
    }

    let offset = 10; // skip 2 bytes after magic (reference: seekg(2, cur))

    // Step 2: Read key data
    const keyLenBuf = Buffer.alloc(4);
    fs.readSync(fd, keyLenBuf, 0, 4, offset);
    offset += 4;
    const keyLen = keyLenBuf.readUInt32LE(0);

    if (keyLen <= 0) {
      throw new Error('Broken NCM file: invalid key length');
    }

    const keyData = Buffer.alloc(keyLen);
    fs.readSync(fd, keyData, 0, keyLen, offset);
    offset += keyLen;

    // Step 3: XOR key data with 0x64 BEFORE AES decryption
    for (let i = 0; i < keyLen; i++) {
      keyData[i] ^= 0x64;
    }

    // Step 4: AES-ECB decrypt with CORE_KEY
    const decryptedKeyData = aesEcbDecrypt(CORE_KEY, keyData);

    // Step 5: Build key box from decrypted key, skipping first 17 bytes
    const keyBox = buildKeyBox(Buffer.from(decryptedKeyData.slice(17)));

    // Step 6: Read metadata
    const metaLenBuf = Buffer.alloc(4);
    fs.readSync(fd, metaLenBuf, 0, 4, offset);
    offset += 4;
    const metaLen = metaLenBuf.readUInt32LE(0);

    let songName = path.basename(filePath, '.ncm');
    let artist = '未知艺术家';
    let album = '未知专辑';

    if (metaLen > 0) {
      const metaData = Buffer.alloc(metaLen);
      fs.readSync(fd, metaData, 0, metaLen, offset);
      offset += metaLen;

      // Step 7: XOR metadata with 0x63
      for (let i = 0; i < metaLen; i++) {
        metaData[i] ^= 0x63;
      }

      // Step 8: Skip first 22 bytes ("163 key(Don't modify):"), then Base64 decode
      const base64Data = metaData.slice(22).toString('utf8').replace(/\0+$/, '');
      const decodedData = base64Decode(base64Data);

      // Step 9: AES-ECB decrypt with MOD_KEY
      const decryptedMeta = aesEcbDecrypt(MOD_KEY, decodedData);

      // Step 10: Skip first 6 bytes ("music:")
      const metaStr = decryptedMeta.slice(6).toString('utf8').replace(/\0+$/, '');

      try {
        const metaJson = JSON.parse(metaStr);
        if (metaJson.musicName) songName = metaJson.musicName;
        if (metaJson.artist) {
          if (Array.isArray(metaJson.artist)) {
            artist = metaJson.artist
              .map((a: any) => (Array.isArray(a) ? a[0] : a))
              .filter(Boolean)
              .join('/');
          } else {
            artist = metaJson.artist;
          }
        }
        // Reference uses "album" not "albumName"
        if (metaJson.album) album = metaJson.album;
      } catch {
        // Metadata might be corrupted
      }
    } else {
      // If no metadata, still need to advance past the 4-byte zero length
      // (already read above)
    }

    // Step 11: Skip CRC32 + image version (5 bytes total)
    offset += 5;

    // Step 12: Read cover image
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

    if (imageLen > 0) {
      cover = Buffer.alloc(imageLen);
      fs.readSync(fd, cover, 0, imageLen, offset);
      offset += imageLen;

      // Detect MIME type from magic bytes
      if (cover[0] === 0x89 && cover[1] === 0x50) {
        coverMime = 'image/png';
      } else {
        coverMime = 'image/jpeg';
      }
    }

    // Seek past remaining cover frame data
    offset += coverFrameLen - imageLen;

    // Step 13: Read and decrypt audio data until EOF
    const audioChunks: Buffer[] = [];
    const chunkSize = 0x8000;
    const buffer = Buffer.alloc(chunkSize);
    const fileSize = fs.fstatSync(fd).size;

    while (offset < fileSize) {
      const remaining = fileSize - offset;
      const toRead = Math.min(chunkSize, remaining);

      const bytesRead = fs.readSync(fd, buffer, 0, toRead, offset);
      offset += bytesRead;

      if (bytesRead <= 0) break;

      // Decrypt using key box - exact algorithm from reference
      const decrypted = Buffer.alloc(bytesRead);
      for (let i = 0; i < bytesRead; i++) {
        const j = (i + 1) & 0xff;
        decrypted[i] = buffer[i] ^ keyBox[(keyBox[j] + keyBox[(keyBox[j] + j) & 0xff]) & 0xff];
      }

      audioChunks.push(decrypted);
    }

    const audioData = Buffer.concat(audioChunks);

    // Detect format from first bytes
    let format: 'mp3' | 'flac' | 'unknown' = 'unknown';
    if (audioData.length >= 3 && audioData[0] === 0x49 && audioData[1] === 0x44 && audioData[2] === 0x33) {
      format = 'mp3'; // ID3 header
    } else if (audioData.length >= 4 && audioData[0] === 0x66 && audioData[1] === 0x4C && audioData[2] === 0x61 && audioData[3] === 0x43) {
      format = 'flac'; // fLaC header
    } else if (audioData.length >= 2 && audioData[0] === 0xff && (audioData[1] & 0xe0) === 0xe0) {
      format = 'mp3'; // MPEG sync word
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

export function saveAudioFile(info: NCMFileInfo, outputDir: string): string {
  const ext = info.format === 'unknown' ? '.bin' : `.${info.format}`;
  const safeName = `${info.artist} - ${info.songName}`.replace(/[<>:"/\\|?*]/g, '_');
  const outputPath = path.join(outputDir, `${safeName}${ext}`);

  fs.writeFileSync(outputPath, info.audioData);

  if (info.cover) {
    const coverExt = info.coverMime === 'image/png' ? '.png' : '.jpg';
    const coverPath = path.join(outputDir, `${safeName}${coverExt}`);
    fs.writeFileSync(coverPath, info.cover);
  }

  return outputPath;
}

export async function convertNCMFile(
  filePath: string,
  outputDir: string,
  onProgress: (progress: number) => void
): Promise<string> {
  onProgress(0);

  const info = await parseNCM(filePath);
  onProgress(50);

  const outputPath = saveAudioFile(info, outputDir);
  onProgress(100);

  return outputPath;
}
