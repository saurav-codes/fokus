import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.lazyplanner.fokus",
  appName: "fokus",
  // Packaged fallback only: with the server block below, the app is a thin
  // shell over the deployed UI. To switch to fully bundled mode, remove the
  // server block and the app then serves these files from the APK.
  webDir: "web/dist",
  server: {
    url: "https://fokus.lazyplanner.app",
    cleartext: false,
  },
};

export default config;
