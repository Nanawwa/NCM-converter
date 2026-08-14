export type AudioFormat =
  | 'mp3'
  | 'flac'
  | 'ogg'
  | 'wav'
  | 'ape'
  | 'wma'
  | 'm4a'
  | 'aac'
  | 'unknown';

export interface NCMFileInfo {
  filePath: string;
  fileName: string;
  songName: string;
  artist: string;
  album: string;
  format: AudioFormat;
  cover?: Buffer;
  coverMime?: string;
  audioData: Buffer;
}

export interface ConvertTask {
  id: string;
  filePath: string;
  status: 'pending' | 'converting' | 'done' | 'error';
  progress: number;
  error?: string;
  outputPath?: string;
}

/** 解析完成后推送给渲染层的信息(封面用于列表缩略图) */
export interface ConvertInfoPayload {
  id: string;
  songName: string;
  artist: string;
  album: string;
  format: AudioFormat;
  hasCover: boolean;
  cover?: Uint8Array;
  coverMime?: string;
}
