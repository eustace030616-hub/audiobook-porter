# Clam iOS shell

Capacitor 8 + Swift Package Manager. The React UI is loaded from the configured
public Clam origin; native code owns the audio session, AirPods route recovery
and lock-screen remote commands.

## Free personal-team install

1. Xcode → Settings → Accounts → add your Apple ID.
2. Open `ios/App/App.xcodeproj`; target App → Signing & Capabilities.
3. Select your **Personal Team**, enable automatic signing, and use a unique bundle ID if `com.eustace.clam` is taken.
4. Connect the iPhone, enable Developer Mode, trust the Mac, then Run.

The free build expires after 7 days and must be reinstalled. TestFlight and App Store distribution are not available on the free plan. If Xcode says the iOS platform is missing, install the platform component first.

## Build

```bash
cd clam-web
CLAM_NATIVE_URL=https://your-public-clam-host pnpm build
CLAM_NATIVE_URL=https://your-public-clam-host npx cap sync ios
open ios/App/App.xcodeproj
```

Select your signing team in Xcode, then build to a device. `CLAM_NATIVE_URL` is
read when `cap sync` runs and is copied into `ios/App/App/capacitor.config.json`.

The default is the Tailscale hostname. The current public Tailscale Funnel
ingress is blocked from UCD Wi-Fi and from the iPhone hotspot; use a public
Cloudflare hostname for real-device testing.

## Native behaviour

- `AVAudioSession` category `.playback`, mode `.spokenAudio`, background audio.
- `.oldDeviceUnavailable` records whether playback was active.
- `.newDeviceAvailable` resumes the web player through `window.__clamNative`.
- `MPRemoteCommandCenter` play/pause/toggle/next/previous call the same bridge.
- The web player exposes `window.__clamNative`; no UI rewrite.

## Known gaps

- This is still WKWebView audio, not a full AVPlayer implementation. A native
  `AVPlayer` engine is the next step if WebKit still drops the route.
- App icon/asset catalog compilation depends on the Xcode iOS platform being
  installed; this Mac lacks the iOS platform component.
- TestFlight/App Store signing has not been configured.
