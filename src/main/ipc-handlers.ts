import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { convertNCMFile, parseNCM } from './ncm-decrypt';
import { ConvertTask, ConvertInfoPayload } from '../shared/types';

function findNCMFiles(dir: string): string[] {
  const results: string[] = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      try {
        results.push(...findNCMFiles(fullPath));
      } catch {
        // 无权限的目录跳过
      }
    } else if (item.isFile() && item.name.toLowerCase().endsWith('.ncm')) {
      results.push(fullPath);
    }
  }
  return results;
}

let isConverting = false;

export function registerIPCHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('select-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 NCM 文件',
      filters: [{ name: 'NCM 文件', extensions: ['ncm'] }],
      properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择包含 NCM 文件的文件夹',
      properties: ['openDirectory'],
    });
    if (result.canceled) return [];
    try {
      return findNCMFiles(result.filePaths[0]);
    } catch {
      return [];
    }
  });

  // 拖入的路径可能是文件也可能是文件夹,统一在主进程里解析
  ipcMain.handle('scan-paths', async (_event, paths: string[]) => {
    const out = new Set<string>();
    for (const p of paths || []) {
      try {
        const stat = fs.statSync(p);
        if (stat.isDirectory()) {
          findNCMFiles(p).forEach((f) => out.add(f));
        } else if (stat.isFile() && p.toLowerCase().endsWith('.ncm')) {
          out.add(p);
        }
      } catch {
        // 忽略无效路径
      }
    }
    return Array.from(out);
  });

  ipcMain.handle('select-output-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择输出目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('open-output-dir', async (_event, dir: string) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      shell.openPath(dir);
    } catch {
      // 目录不可用时静默失败
    }
  });

  ipcMain.handle('window-minimize', () => mainWindow?.minimize());
  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.handle('window-close', () => mainWindow?.close());

  ipcMain.handle(
    'convert-files',
    async (_event, files: string[], outputDir: string, concurrency: number) => {
      if (isConverting) return { error: '已有转换任务进行中' };
      if (!Array.isArray(files) || files.length === 0) return { error: '没有可转换的文件' };
      isConverting = true;

      if (!outputDir || outputDir.trim() === '') {
        outputDir = path.dirname(files[0]);
      }

      const tasks: ConvertTask[] = files.map((f) => ({
        id: f,
        filePath: f,
        status: 'pending' as const,
        progress: 0,
      }));

      mainWindow.webContents.send('convert-start', { tasks });

      let completed = 0;
      const total = tasks.length;

      async function processTask(task: ConvertTask) {
        task.status = 'converting';
        mainWindow.webContents.send('convert-progress', {
          id: task.id,
          progress: 0,
          status: 'converting',
        });

        try {
          // 先解析出歌曲信息(渲染层更新列表显示)
          const info = await parseNCM(task.filePath);
          const payload: ConvertInfoPayload = {
            id: task.id,
            songName: info.songName,
            artist: info.artist,
            album: info.album,
            format: info.format,
            hasCover: !!info.cover,
            cover: info.cover ? new Uint8Array(info.cover) : undefined,
            coverMime: info.coverMime,
          };
          mainWindow.webContents.send('convert-info', payload);

          const outputPath = await convertNCMFile(task.filePath, outputDir, (progress) => {
            task.progress = progress;
            mainWindow.webContents.send('convert-progress', {
              id: task.id,
              progress,
              status: 'converting',
            });
          });
          task.status = 'done';
          task.progress = 100;
          task.outputPath = outputPath;
          mainWindow.webContents.send('convert-complete', { id: task.id, outputPath });
        } catch (err: any) {
          task.status = 'error';
          task.error = err?.message || String(err);
          mainWindow.webContents.send('convert-error', { id: task.id, error: task.error });
        }

        completed++;
        mainWindow.webContents.send('convert-progress', {
          id: task.id,
          progress: task.progress,
          status: task.status,
          totalProgress: Math.round((completed / total) * 100),
        });

        if (completed === total) {
          isConverting = false;
          mainWindow.webContents.send('convert-all-done');
        }
      }

      const queue = [...tasks];
      const running: Promise<void>[] = [];

      async function runNext() {
        if (queue.length === 0) return;
        const task = queue.shift()!;
        await processTask(task);
        await runNext();
      }

      for (let i = 0; i < Math.min(Math.max(1, concurrency), total); i++) {
        running.push(runNext());
      }

      await Promise.all(running);
      return { success: true };
    }
  );
}
