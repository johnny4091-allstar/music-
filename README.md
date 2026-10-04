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
- **Search**: full-length songs from [Audius](https://audius.co), a free, legal music platform, or Spotify
- **Spotify**: your playlists, liked songs and top tracks; play them through the Spotify app (Premium)
- **Liked Songs** and **Playlists**: create, rename, delete, add/remove songs (saved in your browser)
- **Local Files**: play MP3/M4A/WAV/FLAC/OGG files from your own device
- **Player**: play/pause, next/previous, shuffle, repeat (all / one), seek, volume, queue panel
- Lock-screen and headphone controls (Media Session API)
- Keyboard: `Space` play/pause, `Shift+→` next, `Shift+←` previous
- Works on Android (APK), phones and desktops
- Android back button goes back to Home, then moves the app to the background so music keeps playing

## 🟢 Spotify

Open the **Spotify** tab in Tunely to connect your account. You can then browse your Spotify playlists, liked songs and
top tracks, and search all of Spotify (the Search tab gets an **Audius / Spotify** switch).

- **Spotify Premium:** Tunely sends songs to the Spotify app on your phone (or any Spotify device: computer, speaker)
  and works as the remote: play/pause, next/previous, seek, repeat, volume, queue. Spotify only allows its music to be
  played by its own apps, so the Spotify app must be installed and logged in.
- **Spotify Free:** you can browse and search; tapping a song opens it in the Spotify app.

**One-time setup:** Spotify requires each app to have its own Client ID, and the Spotify account that creates it
**must have Premium** (Spotify rejects every request from a development-mode app whose owner is on Spotify Free, with
"Active premium subscription required for the owner of the app").

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) → **Create app**.
2. Add the redirect URI(s): `com.tunely.app://callback` for the Android app, plus the web address where you open
   Tunely in a browser (e.g. `https://<you>.github.io/music-/www/`; for local testing use `http://127.0.0.1:8000/`,
   since Spotify doesn't accept `localhost`).
3. Tick **Web API**, save, and add each listener's Spotify email under **User Management** (required while the app
   is in Spotify's development mode, which only allows a small number of users).
4. Copy the **Client ID** into Tunely's Spotify tab and tap **Connect Spotify**.

The Spotify tab shows these steps with copy buttons. Sign-in uses OAuth PKCE, so there's no secret or server; the
login is saved only on your device.

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

- **Audius** (default): full-length tracks for free, no key or account needed. Plays inside Tunely.
- **Spotify** (optional): played by the Spotify app, controlled from Tunely (see above).
- **Your own files**: played inside Tunely.
- **YouTube Music** isn't supported: it has no public playback API, and streaming its audio breaks YouTube's Terms of Service.

## Files

| File | What it does |
| --- | --- |
| `www/index.html` | Page layout: sidebar, main area, queue, player bar |
| `www/styles.css` | Dark Spotify-like theme and phone layout |
| `www/app.js` | Music API, playback, playlists, likes, local files, Android back button |
| `www/spotify.js` | Spotify sign-in (PKCE), library/search, and remote playback control |
| `android/` | Android app project ([Capacitor](https://capacitorjs.com) wraps the web app into an APK) |
| `assets/` | Source app icon and splash image |
| `.github/workflows/android.yml` | Builds the APK on GitHub and publishes it to Releases |
