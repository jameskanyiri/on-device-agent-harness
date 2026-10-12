# on-device-ai

An Expo app for experimenting with on-device AI using
[React Native ExecuTorch](https://docs.swmansion.com/react-native-executorch/docs/fundamentals/getting-started).
Models are downloaded once, then run entirely on the phone. No server and no API keys are involved, and it works offline.

- Expo SDK 57, React Native 0.86 (New Architecture)
- `react-native-executorch` 0.10.x
- Tested on iPhone 15 Pro (iOS 27). ExecuTorch needs **iOS 17+**.

## App structure

A chat screen with a slide-out sidebar (no tabs). Conversations are saved on the phone and can be reopened; switching model keeps the current chat and replays it into the new model.

| File | What it is |
|---|---|
| `src/app/_layout.tsx` | Root stack (no header) |
| `src/app/index.tsx` | Screen shell: header, sliding sidebar, model picker; remounts the chat per conversation/model |
| `src/components/side-drawer.tsx` | Gesture-driven drawer with UIKit-style physics (velocity projection, critically damped spring, rubber-banding, parallax) |
| `src/components/chat/chat-view.tsx` | One model session + one conversation: streaming, loading states, composer |
| `src/components/chat/sidebar.tsx` | Sidebar: search, Models, saved conversations (long-press to delete), New Chat |
| `src/components/chat/` (others) | `brand`, `composer`, `markdown` (native GFM rendering via `react-native-enriched-markdown`, `remend` repairs half-streamed syntax), `header-actions` (glass capsule: New chat + native SwiftUI ⋯ menu; empty-chat model pill menu), `message-item`, long-press action sheet in `message-item` (Copy / Read aloud / Share / Regenerate / Edit), `thinking-indicator`, `quick-actions` |
| `src/lib/chat-models.ts` | Model catalog + check for which models are already downloaded |
| `src/components/ui/` | `glass` (Liquid Glass surface via `expo-glass-effect`, solid fallback), `circle-button` |
| `src/app/settings/` | Settings sheet built with `@expo/ui` SwiftUI `Form` (native grouped list, toggles, menu pickers) |
| `src/components/chat/context-ring.tsx` | Context meter in the composer: model KV-cache usage from `getKVCacheState()` (orange ≥75%, red ≥90%; tap for numbers) |
| `src/components/chat/dictation.tsx` | Voice input: on-device Whisper (tiny, English) streaming from the mic (`react-native-audio-api`) |
| `src/components/chat/speaker.tsx` | Read aloud: on-device Kokoro TTS streamed to the speaker |
| `src/lib/photos.ts` | Photo attach: pick/take (`expo-image-picker`), downscale (`expo-image-manipulator`), decode to RGBA (Skia) for LFM 2.5 Vision |
| `src/components/chat/conversation-row.tsx` + `src/lib/conversation-sections.ts` | Sidebar rows (swipe: Pin / Rename / Delete) grouped Pinned / Today / Yesterday / … |
| `src/components/ui/edge-fade.tsx` | ChatGPT-style scroll edges: progressive blur (`expo-blur` + masked gradient) fading into the background under the floating header and composer |
| `src/components/ui/icon.tsx` | App icons by role → native SF Symbols (`expo-symbols`) |
| `src/components/ui/pressable-scale.tsx` | Spring press feedback used by buttons (UI-thread, respects Reduce Motion) |
| `src/lib/haptics.ts` | Light taps for the drawer, send/stop, and list picks (`expo-haptics`) |
| `src/lib/conversations.ts` | Conversation storage (`Documents/conversations.json` on the phone) |

Reopening a chat or switching model reloads the model from the phone's storage (a few seconds) and prefills the past messages via `initialMessages`.

## Day-to-day: start the app

The app is a **development build** (not Expo Go), so it must already be installed on the phone. See [Rebuilding](#rebuilding-the-native-app) if it isn't.

1. Start the dev server:

   ```bash
   npx expo start --dev-client
   ```

2. Make sure the iPhone is on the **same Wi-Fi** as the Mac.
3. Open **on-device-ai** on the phone. Tap your Mac's server in the dev launcher, or enter `http://<mac-ip>:8081` by hand (find the IP with `ipconfig getifaddr en0`).

JavaScript changes reload instantly. Press `r` in the terminal to force a reload.

## Performance

- **Measure in Release, not the dev build.** The dev build runs JS in dev mode through Metro. For real numbers: `npm run ios:release` (cable plugged in; bundles JS into the app).
- **Streaming** (`src/components/chat/chat-view.tsx`): tokens are buffered and committed every 50 ms (`FLUSH_INTERVAL_MS`); the in-progress reply renders as the list footer, so finished rows (memoized `MessageItem`) never re-render while tokens arrive.
- **Scrolling** follows new content only while you're at the bottom, without stacked scroll animations.
- **Reopening chats** replays only the most recent ~6k characters (`REPLAY_CHAR_BUDGET`) into the model, keeping loads fast and inside the context window. Older messages stay visible.
- **Metrics:** each reply shows time to first token and tokens/sec; model load time is logged as `[perf] … ready in … ms` in the dev-server terminal.

## Rebuilding the native app

Rebuild only when you:
- add or upgrade a package that contains native code,
- change `app.json` / config plugins, or
- the app stops opening (free Apple accounts sign builds for **7 days**).

With the iPhone plugged in and unlocked:

```bash
npx expo run:ios --device
```

This runs `expo prebuild` and `pod install`, compiles the app, and installs it on the phone. The first build takes several minutes. Later builds are faster.

## First-time setup (already done on this Mac)

Kept here in case you need to set up again on another machine:

- **Xcode** from the App Store, opened once to accept the license and install components.
- `brew install cocoapods watchman`
- **Xcode → Settings → Apple Accounts**: sign in (a free Apple ID works).
- **iPhone**: Settings → Privacy & Security → **Developer Mode** on.
- After the first install: **Settings → General → VPN & Device Management** → your Apple ID → **Trust**.

## Gotchas we hit

| Problem | Fix |
|---|---|
| `npm` skipped executorch's `postinstall`, so the native libs weren't downloaded | Approved via `allowScripts` in `package.json` (`npm approve-scripts react-native-executorch`) |
| `pod install`: "required a higher minimum deployment target" | `expo-build-properties` plugin in `app.json` sets `ios.deploymentTarget` to `17.0` |
| Signing team lost after regenerating `ios/` | `ios.appleTeamId` is set in `app.json` |
| Endless `codesign wants to access key…` prompts | Keychain Access → login → Keys → *Apple Development* private key → Access Control → **Allow all applications** |
| "invalid code signature… not explicitly trusted" on launch | Trust the developer on the phone (see first-time setup) |
| "Could not connect to development server" with a `169.254.x.x` URL | That's the USB link, not Wi-Fi. Start the server with `REACT_NATIVE_PACKAGER_HOSTNAME=$(ipconfig getifaddr en0) npx expo start --dev-client`, then enter `http://<mac-ip>:8081` in the dev launcher |
| App opens to the blue splash screen and immediately closes (crash in `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`) | iOS 27 requires the UIScene lifecycle. Set `ios.enableSceneSupport: true` under `expo-build-properties` in `app.json` (Expo SDK 57 only; built into SDK 58+) |

`ios/` is generated. Don't edit it by hand; configure through `app.json` instead.

## Useful commands

```bash
npx expo install <package>   # add packages (picks SDK-compatible versions)
npx tsc --noEmit             # typecheck
npx expo lint                # lint
npx expo-doctor              # diagnose config/dependency issues
```

## Learn more

- [React Native ExecuTorch docs](https://docs.swmansion.com/react-native-executorch/docs/fundamentals/getting-started), including the models and tasks under *Extensions*
- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)
