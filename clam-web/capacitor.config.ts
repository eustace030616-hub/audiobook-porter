import type { CapacitorConfig } from '@capacitor/cli';

const appUrl =
  process.env.CLAM_NATIVE_URL ||
  'https://clam.flowwing.uk';

const config: CapacitorConfig = {
  appId: 'com.eustace.clam',
  appName: 'Clam',
  webDir: 'dist',
  server: {
    url: appUrl,
    cleartext: false,
  },
  ios: {
    contentInset: 'never',
    backgroundColor: '#fafafa',
  },
};

export default config;
