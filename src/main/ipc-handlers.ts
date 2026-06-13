import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { convertNCMFile } from './ncm-decrypt';
import { ConvertTask } from '../shared/types';

function findNCMFiles(dir: string): string[] {
  const results: string[] = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      results.push(...findNCMFiles(fullPath));
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
      title: '选择NCM文件',
      filters: [{ name: 'NCM Files', extensions: ['ncm'] }],
      properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择包含NCM文件的文件夹',
      properties: ['openDirectory'],
    });
    if (result.canceled) return [];
    return findNCMFiles(result.filePaths[0]);
  });

  ipcMain.handle('select-output-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择输出目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('open-output-dir', async (_event, dir: string) => {
    shell.openPath(dir);
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

  ipcMain.handle('convert-files', async (_event, files: string[], outputDir: string, concurrency: number) => {
    if (isConverting) return { error: '已有转换任务进行中' };
    isConverting = true;

    if (!outputDir) {
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
      mainWindow.webContents.send('convert-progress', { id: task.id, progress: 0, status: 'converting' });

      try {
        const outputPath = await convertNCMFile(task.filePath, outputDir, (progress) => {
          task.progress = progress;
          mainWindow.webContents.send('convert-progress', { id: task.id, progress, status: 'converting' });
        });
        task.status = 'done';
        task.progress = 100;
        task.outputPath = outputPath;
        mainWindow.webContents.send('convert-complete', { id: task.id, outputPath });
      } catch (err: any) {
        task.status = 'error';
        task.error = err.message;
        mainWindow.webContents.send('convert-error', { id: task.id, error: err.message });
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

    for (let i = 0; i < Math.min(concurrency, total); i++) {
      running.push(runNext());
    }

    await Promise.all(running);
    return { success: true };
  });
}
