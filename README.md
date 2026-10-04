# Tunely 🎵

A Spotify-style music player that runs in your browser. No account, no API key, no build step.

## Features

- **Home**: trending songs, filterable by genre
- **Search**: full-length songs from [Audius](https://audius.co), a free, legal music platform
- **Liked Songs** and **Playlists**: create, rename, delete, add/remove songs (saved in your browser)
- **Local Files**: play MP3/M4A/WAV/FLAC/OGG files from your own device
- **Player**: play/pause, next/previous, shuffle, repeat (all / one), seek, volume, queue panel
- Lock-screen and headphone controls (Media Session API)
- Keyboard: `Space` play/pause, `Shift+→` next, `Shift+←` previous
- Works on phones and desktops

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

### Put it online for free (GitHub Pages)

Repo **Settings → Pages → Deploy from a branch →** pick your branch and `/ (root)`. Your app will be live at
`https://<your-username>.github.io/music-/`.

## Why not Spotify or YouTube Music?

- **Spotify**'s API only plays full songs through its own Web Playback SDK, which requires every listener to log in
  with Spotify **Premium** and you to register a developer app. It can be added later as an extra source.
- **YouTube Music** has no public playback API; downloading or streaming its audio breaks YouTube's Terms of Service.

Audius gives full-length tracks for free with no key, so it's the source used here.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page layout: sidebar, main area, queue, player bar |
| `styles.css` | Dark Spotify-like theme and phone layout |
| `app.js` | Music API, playback, playlists, likes, local files |
