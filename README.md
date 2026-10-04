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
- **Search**: full-length songs from [Audius](https://audius.co), [Jamendo](https://www.jamendo.com) or the
  [Internet Archive](https://archive.org/details/audio)
- **Live Radio**: 50,000+ real stations worldwide (Top 40, hip-hop, country, news…) from [Radio Browser](https://www.radio-browser.info)
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

## Where the music comes from

All sources are free and legal, and everything plays inside Tunely.

| Source | What you get | Setup |
| --- | --- | --- |
| **Audius** | Full songs from independent artists, trending charts by genre | None |
| **Live Radio** (Radio Browser) | 50,000+ live stations, including mainstream hits stations | None |
| **Jamendo** | 600,000+ full songs from independent artists (Creative Commons) | Free Client ID, see below |
| **Internet Archive** | Live concerts (e.g. Grateful Dead), classic and public-domain recordings | None |
| **Your files** | MP3/M4A/WAV/FLAC/OGG from your device | None |

### Jamendo Client ID (one time, free)

1. Sign up at [devportal.jamendo.com](https://devportal.jamendo.com/) and create an app (any name).
2. Copy its **Client ID**.
3. In Tunely: **Search → Jamendo**, paste it and tap **Save**. It's stored on your device.

Spotify, Apple Music, YouTube Music and Deezer aren't included: they only allow full songs inside their own apps
(or for paying developers), so a third-party app can't play them.

### Radio note

Many stations stream over plain `http://`. The Android app plays them all; the website version only lists `https://`
stations, because browsers block insecure audio on secure pages.

## Files

| File | What it does |
| --- | --- |
| `www/index.html` | Page layout: sidebar, main area, queue, player bar |
| `www/styles.css` | Dark Spotify-like theme and phone layout |
| `www/app.js` | Audius, playback, screens, playlists, likes, local files, Android back button |
| `www/sources.js` | Live radio, Jamendo and Internet Archive |
| `android/` | Android app project ([Capacitor](https://capacitorjs.com) wraps the web app into an APK) |
| `assets/` | Source app icon and splash image |
| `.github/workflows/android.yml` | Builds the APK on GitHub and publishes it to Releases |
