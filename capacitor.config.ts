import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ncm.converter',
  appName: 'NCM转换器',
  webDir: 'dist/renderer',
  server: {
    androidScheme: 'https',
  },
};

export default config;
