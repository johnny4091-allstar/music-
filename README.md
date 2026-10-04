# Tunely 🎵

A Spotify-style music player for **Android** and the web. No account, no API key.

## 📱 Install on Android

1. On your phone, open this repo on GitHub → **Releases** → **Tunely (latest build)** → tap **Tunely.apk**.
2. Open the downloaded file. If Android asks, allow your browser/Files app to **install unknown apps**.
3. Tap **Install**, then open **Tunely**.

A new APK is built automatically by GitHub Actions every time code changes (see the **Actions** tab).
New builds install as an update over the old one, so your likes and playlists are kept.

## Features

- **Home**: trending songs, filterable by genre
- **Search**: full-length songs from [Audius](https://audius.co), a free, legal music platform
- **Liked Songs** and **Playlists**: create, rename, delete, add/remove songs (saved in your browser)
- **Local Files**: play MP3/M4A/WAV/FLAC/OGG files from your own device
- **Player**: play/pause, next/previous, shuffle, repeat (all / one), seek, volume, queue panel
- Lock-screen and headphone controls (Media Session API)
- Keyboard: `Space` play/pause, `Shift+→` next, `Shift+←` previous
- Works on Android (APK), phones and desktops
- Android back button goes back to Home, then moves the app to the background so music keeps playing

## Run it in a browser

Open `www/index.html`, or serve the folder:

```bash
npm run serve
# then open http://localhost:8000
```

## Build the APK yourself

Needs Node 22, JDK 21 and the Android SDK (easiest: install Android Studio).

```bash
npm install
npm run build:apk
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Or run `npx cap open android` to open the project in Android Studio and press ▶ with your phone plugged in.

The app is signed with a test key stored in the repo (`android/app/tunely-debug.keystore`) so every build can update the
installed app. Make your own private key before publishing to the Google Play Store.

## Why not Spotify or YouTube Music?

- **Spotify**'s API only plays full songs through its own Web Playback SDK, which requires every listener to log in
  with Spotify **Premium** and you to register a developer app. It can be added later as an extra source.
- **YouTube Music** has no public playback API; downloading or streaming its audio breaks YouTube's Terms of Service.

Audius gives full-length tracks for free with no key, so it's the source used here.

## Files

| File | What it does |
| --- | --- |
| `www/index.html` | Page layout: sidebar, main area, queue, player bar |
| `www/styles.css` | Dark Spotify-like theme and phone layout |
| `www/app.js` | Music API, playback, playlists, likes, local files, Android back button |
| `android/` | Android app project ([Capacitor](https://capacitorjs.com) wraps the web app into an APK) |
| `assets/` | Source app icon and splash image |
| `.github/workflows/android.yml` | Builds the APK on GitHub and publishes it to Releases |
