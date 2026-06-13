import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  selectFiles: () => ipcRenderer.invoke('select-files'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectOutputDir: () => ipcRenderer.invoke('select-output-dir'),
  convertFiles: (files: string[], outputDir: string, concurrency: number) =>
    ipcRenderer.invoke('convert-files', files, outputDir, concurrency),
  openOutputDir: (dir: string) => ipcRenderer.invoke('open-output-dir', dir),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  onConvertStart: (callback: (data: any) => void) => {
    ipcRenderer.on('convert-start', (_event, data) => callback(data));
  },
  onConvertProgress: (callback: (data: any) => void) => {
    ipcRenderer.on('convert-progress', (_event, data) => callback(data));
  },
  onConvertComplete: (callback: (data: any) => void) => {
    ipcRenderer.on('convert-complete', (_event, data) => callback(data));
  },
  onConvertError: (callback: (data: any) => void) => {
    ipcRenderer.on('convert-error', (_event, data) => callback(data));
  },
  onConvertAllDone: (callback: () => void) => {
    ipcRenderer.on('convert-all-done', () => callback());
  },
});
