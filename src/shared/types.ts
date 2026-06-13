export interface NCMFileInfo {
  filePath: string;
  fileName: string;
  songName: string;
  artist: string;
  album: string;
  format: 'mp3' | 'flac' | 'unknown';
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
