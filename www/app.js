/* Tunely — a Spotify-style music player.
 * Music comes from Audius (free, full-length, no API key) plus files on your device.
 */
(() => {
  'use strict';

  const APP_NAME = 'tunely';
  const FALLBACK_HOST = 'https://discoveryprovider.audius.co';
  const GENRES = ['All', 'Electronic', 'Hip-Hop/Rap', 'Pop', 'R&B/Soul', 'Rock', 'Alternative', 'Lo-Fi', 'House', 'Ambient', 'Jazz'];

  const $ = (sel, root = document) => root.querySelector(sel);
  const main = $('#main');
  const audio = $('#audio');
  const seek = $('#seek');
  let seeking = false;

  // ---------- persistent state ----------
  const store = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem('tunely:' + key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('tunely:' + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
    },
  };

  const state = {
    liked: store.get('liked', []),
    playlists: store.get('playlists', []),
    localTracks: [],
    queue: [],
    index: -1,
    shuffle: store.get('shuffle', false),
    repeat: store.get('repeat', 'off'), // off | all | one
    view: 'home',
    searchSource: store.get('searchSource', 'audius'),
    genre: 'All',
    host: null,
    visibleTracks: [],
  };

  const save = () => {
    store.set('liked', state.liked);
    store.set('playlists', state.playlists);
    store.set('shuffle', state.shuffle);
    store.set('repeat', state.repeat);
  };

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (sec) => {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };
  const isLiked = (t) => state.liked.some((x) => x.id === t.id);
  const current = () => state.queue[state.index];

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ---------- Audius API ----------
  async function getHost() {
    if (state.host) return state.host;
    try {
      const res = await fetch('https://api.audius.co');
      const { data } = await res.json();
      state.host = data[Math.floor(Math.random() * data.length)] || FALLBACK_HOST;
    } catch {
      state.host = FALLBACK_HOST;
    }
    return state.host;
  }

  async function api(path, params = {}) {
    const host = await getHost();
    const qs = new URLSearchParams({ ...params, app_name: APP_NAME });
    const res = await fetch(`${host}/v1${path}?${qs}`);
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return (await res.json()).data || [];
  }

  function toTrack(t) {
    return {
      id: 'audius:' + t.id,
      audiusId: t.id,
      title: t.title,
      artist: t.user?.name || 'Unknown artist',
      art: t.artwork?.['480x480'] || t.artwork?.['150x150'] || '',
      duration: t.duration || 0,
      source: 'audius',
    };
  }

  const trending = (genre) => api('/tracks/trending', genre && genre !== 'All' ? { genre, limit: 30 } : { limit: 30 }).then((d) => d.map(toTrack));
  const searchTracks = (query) => api('/tracks/search', { query, limit: 30 }).then((d) => d.map(toTrack));

  async function srcFor(track) {
    if (track.source === 'local') return track.src;
    const host = await getHost();
    return `${host}/v1/tracks/${encodeURIComponent(track.audiusId)}/stream?app_name=${APP_NAME}`;
  }

  // ---------- playback ----------
  async function playList(list, startIndex = 0) {
    if (!list.length) return;
    state.queue = list.slice();
    state.index = startIndex;
    if (state.shuffle) shuffleQueueKeepingCurrent();
    await loadAndPlay();
  }

  function shuffleQueueKeepingCurrent() {
    const cur = state.queue[state.index];
    const rest = state.queue.filter((_, i) => i !== state.index);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    state.queue = [cur, ...rest];
    state.index = 0;
  }

  async function loadAndPlay() {
    const t = current();
    if (!t) return;
    if (t.source === 'spotify') return playOnSpotify();
    if (sp.active) stopSpotify(true);
    audio.src = await srcFor(t);
    try {
      await audio.play();
    } catch (err) {
      if (err.name !== 'AbortError') toast("Couldn't play this track");
    }
    updateNowPlaying();
  }

  function togglePlay() {
    if (!current()) {
      if (state.visibleTracks.length) playList(state.visibleTracks, 0);
      return;
    }
    if (sp.active) return sp.playing ? spotifyPause() : spotifyResume();
    audio.paused ? audio.play() : audio.pause();
  }

  const setPlayButton = (playing) => {
    $('#play').textContent = playing ? '⏸' : '▶';
    $('#play').title = playing ? 'Pause' : 'Play';
  };

  function showProgress(cur, dur) {
    if (!seeking) {
      seek.value = isFinite(dur) && dur > 0 ? Math.min(1000, (cur / dur) * 1000) : 0;
      $('#cur-time').textContent = fmt(cur);
    }
    $('#dur-time').textContent = fmt(dur);
  }

  // ---------- Spotify playback (remote control of the listener's Spotify app) ----------
  const Spotify = window.TunelySpotify;
  const sp = { active: false, playing: false, progress: 0, duration: 0, at: 0, runEnd: -1, timer: null, ticks: 0, device: '' };
  const spProgress = () => Math.min(sp.duration, sp.progress + (sp.playing ? (Date.now() - sp.at) / 1000 : 0));

  function openExternal(url) {
    // In the Android app, leaving the page makes Capacitor hand the link to Android (Spotify app or browser).
    if (window.Capacitor?.isNativePlatform?.()) location.href = url;
    else window.open(url, '_blank', 'noopener');
  }

  async function playOnSpotify() {
    const t = current();
    audio.pause();
    sp.active = true;
    // Spotify plays the run of consecutive Spotify songs in the queue; Tunely follows along by polling.
    let end = state.index;
    while (end + 1 < state.queue.length && state.queue[end + 1].source === 'spotify' && end - state.index < 99) end++;
    sp.runEnd = end;
    Object.assign(sp, { playing: false, progress: 0, duration: t.duration, at: Date.now() });
    updateNowPlaying();
    showProgress(0, t.duration);
    try {
      const device = await Spotify.play(state.queue.slice(state.index, end + 1).map((x) => x.uri));
      if (current() !== t) return;
      Object.assign(sp, { playing: true, at: Date.now() });
      setPlayButton(true);
      if (device.name !== sp.device) toast(`Playing on Spotify · ${device.name}`);
      sp.device = device.name;
      Spotify.shuffleOff().catch(() => {});
      Spotify.setRepeat(state.repeat).catch(() => {});
      startSpotifyPolling();
    } catch (err) {
      stopSpotify(false);
      setPlayButton(false);
      spotifyFailed(err, t);
    }
  }

  function spotifyFailed(err, t) {
    if (err.code === 'NO_DEVICE') {
      toast('Opening Spotify… then come back and tap the song again');
      if (t) setTimeout(() => openExternal(t.url), 900);
    } else if (err.code === 'OWNER_PREMIUM') {
      toast('Spotify needs Premium on the developer account. See the Spotify tab.');
    } else if (err.code === 'PREMIUM') {
      toast('Spotify Free: opening the song in the Spotify app');
      if (t) setTimeout(() => openExternal(t.url), 900);
    } else {
      toast(err.message || "Couldn't play on Spotify");
      if (err.code === 'AUTH' && state.view.startsWith('sp')) render();
    }
  }

  function stopSpotify(pauseRemote) {
    if (pauseRemote && sp.playing) Spotify.pause().catch(() => {});
    sp.active = false;
    sp.playing = false;
    clearInterval(sp.timer);
    sp.timer = null;
  }

  async function spotifyPause() {
    sp.progress = spProgress();
    sp.playing = false;
    setPlayButton(false);
    try { await Spotify.pause(); } catch (err) { spotifyFailed(err); }
  }

  async function spotifyResume() {
    sp.at = Date.now();
    sp.playing = true;
    setPlayButton(true);
    try { await Spotify.resume(); } catch (err) { sp.playing = false; setPlayButton(false); spotifyFailed(err, current()); }
  }

  function startSpotifyPolling() {
    clearInterval(sp.timer);
    sp.ticks = 0;
    sp.timer = setInterval(() => {
      if (!sp.active) return;
      showProgress(spProgress(), sp.duration);
      if (++sp.ticks % 4 === 0 && !document.hidden) syncSpotify();
    }, 1000);
  }

  async function syncSpotify() {
    let s;
    try { s = await Spotify.playerState(); } catch { return; }
    if (!sp.active) return;
    if (!s) { sp.playing = false; setPlayButton(false); return; }
    const wasPlaying = sp.playing;
    Object.assign(sp, { playing: s.isPlaying, progress: s.progress, duration: s.duration || sp.duration, at: Date.now() });
    setPlayButton(s.isPlaying);
    const cur = current();
    if (cur && s.uri === cur.uri) {
      // The last Spotify song in a mixed queue finished: continue with the next Tunely song.
      if (wasPlaying && !s.isPlaying && s.progress === 0 && state.index === sp.runEnd && state.index < state.queue.length - 1) next(true);
      return;
    }
    const i = state.queue.findIndex((x, k) => k >= state.index && k <= sp.runEnd && x.uri === s.uri);
    if (i >= 0) {
      state.index = i;
      updateNowPlaying();
    } else if (state.index === sp.runEnd && state.index < state.queue.length - 1) {
      next(true);
    }
  }

  function next(auto = false) {
    if (!state.queue.length) return;
    if (auto && state.repeat === 'one') {
      audio.currentTime = 0;
      audio.play();
      return;
    }
    if (state.index < state.queue.length - 1) {
      state.index++;
    } else if (state.repeat === 'all' || !auto) {
      state.index = 0;
    } else {
      audio.pause();
      return;
    }
    loadAndPlay();
  }

  function prev() {
    if (!state.queue.length) return;
    if (sp.active && spProgress() > 3) {
      sp.progress = 0;
      sp.at = Date.now();
      Spotify.seek(0).catch((err) => spotifyFailed(err));
      return;
    }
    if (!sp.active && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    state.index = (state.index - 1 + state.queue.length) % state.queue.length;
    loadAndPlay();
  }

  function toggleLike(track) {
    if (!track) return;
    if (isLiked(track)) {
      state.liked = state.liked.filter((x) => x.id !== track.id);
      toast('Removed from Liked Songs');
    } else {
      if (track.source === 'local') { toast("Local files can't be saved"); return; }
      state.liked.unshift(track);
      toast('Added to Liked Songs');
    }
    save();
    updateNowPlaying();
    if (state.view === 'liked') render();
    else refreshLikeButtons();
  }

  function updateNowPlaying() {
    const t = current();
    $('#np-title').textContent = t ? t.title : 'Nothing playing';
    $('#np-artist').textContent = t ? t.artist + (t.source === 'spotify' ? ' · Spotify' : '') : 'Pick a song to start';
    const art = $('#np-art');
    if (t?.art) art.src = t.art; else art.removeAttribute('src');
    const like = $('#np-like');
    like.textContent = t && isLiked(t) ? '♥' : '♡';
    like.classList.toggle('on', !!t && isLiked(t));
    document.title = t ? `${t.title} · ${t.artist}` : 'Tunely';

    document.querySelectorAll('.track').forEach((row) => {
      row.classList.toggle('playing', !!t && row.dataset.id === t.id);
    });
    renderQueue();

    if ('mediaSession' in navigator && t) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: t.artist,
        artwork: t.art ? [{ src: t.art, sizes: '480x480' }] : [],
      });
    }
  }

  function refreshLikeButtons() {
    document.querySelectorAll('.track').forEach((row) => {
      const t = state.visibleTracks[row.dataset.index];
      const btn = row.querySelector('.like');
      if (!t || !btn) return;
      btn.textContent = isLiked(t) ? '♥' : '♡';
      btn.classList.toggle('on', isLiked(t));
    });
  }

  // ---------- views ----------
  function setView(view) {
    state.view = view;
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    render();
    main.scrollTop = 0;
  }

  function trackRows(tracks, { removable = false } = {}) {
    state.visibleTracks = tracks;
    if (!tracks.length) return '';
    const cur = current();
    return `<div class="tracks">${tracks.map((t, i) => `
      <div class="track${cur && cur.id === t.id ? ' playing' : ''}" data-index="${i}" data-id="${esc(t.id)}">
        <span class="t-num">${i + 1}</span>
        <div class="t-main">
          ${t.art ? `<img src="${esc(t.art)}" alt="" loading="lazy">` : '<img alt="">'}
          <div class="t-text"><div class="t-title">${esc(t.title)}</div><div class="t-artist">${esc(t.artist)}</div></div>
        </div>
        <button class="icon-btn like${isLiked(t) ? ' on' : ''}" data-action="like" title="Like">${isLiked(t) ? '♥' : '♡'}</button>
        <span class="t-dur">${fmt(t.duration)}</span>
        <button class="icon-btn" data-action="${removable ? 'remove' : 'add'}" title="${removable ? 'Remove from playlist' : 'Add to playlist'}">${removable ? '✕' : '＋'}</button>
      </div>`).join('')}</div>`;
  }

  function cards(tracks) {
    state.visibleTracks = tracks;
    return `<div class="grid">${tracks.map((t, i) => `
      <div class="card" data-index="${i}" data-id="${esc(t.id)}" role="button" tabindex="0">
        ${t.art ? `<img src="${esc(t.art)}" alt="" loading="lazy">` : '<div class="ph">♪</div>'}
        <div class="card-title">${esc(t.title)}</div>
        <div class="card-sub">${esc(t.artist)}</div>
        <button class="card-play" title="Play">▶</button>
      </div>`).join('')}</div>`;
  }

  let renderToken = 0;
  async function render() {
    const token = ++renderToken;
    const stale = () => token !== renderToken;
    const v = state.view;

    if (v === 'home') {
      const hour = new Date().getHours();
      const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
      main.innerHTML = `
        <h1>${greeting}</h1>
        <div class="chips">${GENRES.map((g) => `<button class="chip${g === state.genre ? ' active' : ''}" data-genre="${esc(g)}">${esc(g)}</button>`).join('')}</div>
        <h2>Trending${state.genre !== 'All' ? ' in ' + esc(state.genre) : ''}</h2>
        <div id="home-list" class="status">Loading…</div>`;
      try {
        const tracks = await trending(state.genre);
        if (stale()) return;
        $('#home-list').outerHTML = tracks.length ? cards(tracks) : '<div class="empty">No tracks found.</div>';
      } catch {
        if (stale()) return;
        $('#home-list').innerHTML = "Couldn't reach the music service. Check your connection, or play songs from <b>Local Files</b>.";
      }
      return;
    }

    if (v === 'search') {
      const q = state.lastQuery || '';
      main.innerHTML = `
        <h1>Search</h1>
        <input id="search-input" class="search-box" type="search" placeholder="What do you want to listen to?" value="${esc(q)}" autocomplete="off">
        ${Spotify.isConnected() ? `<div class="chips">${[['audius', 'Audius (free)'], ['spotify', 'Spotify']].map(([k, label]) =>
          `<button class="chip${state.searchSource === k ? ' active' : ''}" data-source="${k}">${label}</button>`).join('')}</div>` : ''}
        <div id="search-results">${q ? '<div class="status">Searching…</div>' : '<div class="empty">Search for songs or artists.</div>'}</div>`;
      const input = $('#search-input');
      input.focus();
      input.setSelectionRange(q.length, q.length);
      if (q) runSearch(q);
      return;
    }

    if (v === 'spotify') {
      if (!Spotify.isConnected()) { main.innerHTML = spotifyConnectPage(); state.visibleTracks = []; return; }
      const user = Spotify.user();
      main.innerHTML = `
        <h1>Spotify</h1>
        <div class="header-row">
          <span class="card-sub">Connected as ${esc(user?.display_name || user?.id || 'you')}${user?.product && user.product !== 'premium' ? ' · Spotify Free (songs open in the Spotify app)' : ''}</span>
          <button class="btn" data-action="sp-logout">Disconnect</button>
        </div>
        <h2>Your playlists</h2>
        <div id="sp-playlists" class="status">Loading…</div>
        <h2>Your top tracks</h2>
        <div id="sp-top" class="status">Loading…</div>`;
      state.visibleTracks = [];
      const [lists, top] = await Promise.allSettled([Spotify.playlists(), Spotify.topTracks()]);
      if (stale()) return;
      if ([lists, top].some((r) => r.status === 'rejected' && r.reason?.code === 'AUTH')) return render();
      const blocked = [lists, top].find((r) => r.status === 'rejected' && r.reason?.code === 'OWNER_PREMIUM');
      if (blocked) {
        main.innerHTML = `<h1>Spotify</h1>${ownerPremiumNotice(blocked.reason.message)}`;
        return;
      }
      $('#sp-playlists').outerHTML = `<div class="grid">
          <div class="card" data-open="sp-liked" role="button" tabindex="0"><div class="ph" style="background:linear-gradient(135deg,#450af5,#8e8ee5);color:#fff">♥</div>
            <div class="card-title">Liked Songs</div><div class="card-sub">On Spotify</div></div>
          ${(lists.value || []).map((p) => `
            <div class="card" data-open="sp-playlist:${esc(p.id)}" data-name="${esc(p.name)}" role="button" tabindex="0">
              ${p.art ? `<img src="${esc(p.art)}" alt="" loading="lazy">` : '<div class="ph">♫</div>'}
              <div class="card-title">${esc(p.name)}</div><div class="card-sub">${p.count ? p.count + ' songs' : 'Playlist'}</div>
            </div>`).join('')}
        </div>${lists.status === 'rejected' ? `<div class="empty">${esc(lists.reason.message)}</div>` : ''}`;
      $('#sp-top').outerHTML = top.status === 'fulfilled'
        ? trackRows(top.value) || '<div class="empty">Listen to more music on Spotify to see your top tracks.</div>'
        : `<div class="empty">${esc(top.reason.message)}</div>`;
      return;
    }

    if (v === 'sp-liked' || v.startsWith('sp-playlist:')) {
      if (!Spotify.isConnected()) return setView('spotify');
      const title = v === 'sp-liked' ? 'Liked Songs on Spotify' : state.spPlaylistName || 'Spotify playlist';
      main.innerHTML = `<h1>${esc(title)}</h1><div class="status">Loading…</div>`;
      state.visibleTracks = [];
      try {
        const tracks = v === 'sp-liked' ? await Spotify.likedTracks() : await Spotify.playlistTracks(v.slice('sp-playlist:'.length));
        if (stale()) return;
        main.innerHTML = listPage(title, `Spotify · ${tracks.length} songs`, trackRows(tracks), 'No songs here.',
          '<button class="btn" data-view="spotify">‹ Back to Spotify</button>');
      } catch (err) {
        if (stale()) return;
        if (err.code === 'AUTH') return setView('spotify');
        if (err.code === 'OWNER_PREMIUM') { main.innerHTML = `<h1>${esc(title)}</h1>${ownerPremiumNotice(err.message)}`; return; }
        main.innerHTML = `<h1>${esc(title)}</h1><div class="empty">${esc(err.message)}${err.code === 'FORBIDDEN' ? ' (Spotify only lets apps open playlists you own or follow.)' : ''}</div>`;
      }
      return;
    }

    if (v === 'library') {
      main.innerHTML = `
        <h1>Your Library</h1>
        <div class="grid">
          <div class="card" data-open="liked" role="button" tabindex="0"><div class="ph" style="background:linear-gradient(135deg,#450af5,#8e8ee5);color:#fff">♥</div>
            <div class="card-title">Liked Songs</div><div class="card-sub">${state.liked.length} songs</div></div>
          <div class="card" data-open="local" role="button" tabindex="0"><div class="ph">📁</div>
            <div class="card-title">Local Files</div><div class="card-sub">${state.localTracks.length} songs</div></div>
          ${state.playlists.map((p) => `
            <div class="card" data-open="playlist:${esc(p.id)}" role="button" tabindex="0">
              ${p.tracks[0]?.art ? `<img src="${esc(p.tracks[0].art)}" alt="">` : '<div class="ph">♫</div>'}
              <div class="card-title">${esc(p.name)}</div><div class="card-sub">${p.tracks.length} songs</div>
            </div>`).join('')}
        </div>`;
      state.visibleTracks = [];
      return;
    }

    if (v === 'liked') {
      main.innerHTML = listPage('Liked Songs', `${state.liked.length} songs`, trackRows(state.liked), 'Songs you like will appear here. Tap ♡ on any song.');
      return;
    }

    if (v === 'local') {
      main.innerHTML = listPage('Local Files', 'Play music stored on this device', trackRows(state.localTracks),
        'No files yet. Add MP3s or other audio files from your device.', '<button class="btn" data-action="add-files">Add files</button>');
      return;
    }

    if (v.startsWith('playlist:')) {
      const p = state.playlists.find((x) => 'playlist:' + x.id === v);
      if (!p) return setView('library');
      main.innerHTML = listPage(p.name, `Playlist · ${p.tracks.length} songs`, trackRows(p.tracks, { removable: true }),
        'This playlist is empty. Use ＋ on any song to add it here.',
        '<button class="btn" data-action="rename-playlist">Rename</button><button class="btn" data-action="delete-playlist">Delete</button>');
    }
  }

  function ownerPremiumNotice(spotifyMsg) {
    return `
      <div class="sp-connect">
        <div class="notice">
          <b>Spotify is blocking this connection.</b>
          <p>Spotify only allows apps like Tunely to use its data while the Spotify account that <b>created the developer app</b>
          (the Client ID) has an active <b>Premium</b> subscription. This is a rule on Spotify's side; Tunely can't change it.</p>
          <p class="muted">Spotify said: “${esc(spotifyMsg)}”</p>
        </div>
        <h2>How to fix it</h2>
        <ol class="sp-steps">
          <li>Upgrade the Spotify account you used on <b>developer.spotify.com</b> to Premium, then tap <b>Try again</b>. It can take a few minutes for Spotify to notice.</li>
          <li>Or create the developer app with a Spotify account that already has Premium, then tap <b>Use a different Client ID</b> and paste the new one.</li>
        </ol>
        <p class="muted">Free music from Audius and your own files keep working in the meantime.</p>
        <div class="header-row">
          <button class="btn primary" data-view="spotify">Try again</button>
          <button class="btn" data-action="sp-logout">Use a different Client ID</button>
        </div>
      </div>`;
  }

  function spotifyConnectPage() {
    const uris = [...new Set([Spotify.redirectUri(), 'com.tunely.app://callback'])];
    return `
      <h1>Connect Spotify</h1>
      <div class="sp-connect">
        <p>See your Spotify playlists, liked songs and top tracks, and search all of Spotify inside Tunely.</p>
        <ul class="sp-notes">
          <li><b>Spotify Premium:</b> Tunely plays songs through the Spotify app on your phone (or any Spotify device) and works as the remote.</li>
          <li><b>Spotify Free:</b> you can browse, and tapping a song opens it in the Spotify app.</li>
        </ul>
        <h2>One-time setup (about 2 minutes)</h2>
        <ol class="sp-steps">
          <li>Open <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a>, log in, and tap <b>Create app</b>.</li>
          <li>Give it any name and description. Under <b>Redirect URIs</b> add ${uris.length > 1 ? 'both of these' : 'this'}:
            ${uris.map((u) => `<div class="copy-row"><code>${esc(u)}</code><button class="btn" data-copy="${esc(u)}">Copy</button></div>`).join('')}
          </li>
          <li>Tick <b>Web API</b>, accept the terms and <b>Save</b>.</li>
          <li>In the app's <b>User Management</b>, add the email of every Spotify account that will use Tunely (including yours).</li>
          <li>Copy the <b>Client ID</b> from the app's settings and paste it here:</li>
        </ol>
        <div class="copy-row">
          <input id="sp-client" class="search-box" placeholder="Client ID" value="${esc(Spotify.clientId())}" autocomplete="off" spellcheck="false">
          <button class="btn primary" data-action="sp-connect">Connect Spotify</button>
        </div>
      </div>`;
  }

  function listPage(title, sub, rows, emptyMsg, extraButtons = '') {
    return `
      <h1>${esc(title)}</h1>
      <div class="header-row">
        ${rows ? '<button class="big-play" data-action="play-all" title="Play">▶</button>' : ''}
        <span class="card-sub">${esc(sub)}</span>
        ${extraButtons}
      </div>
      ${rows || `<div class="empty">${esc(emptyMsg)}</div>`}`;
  }

  let searchTimer;
  async function runSearch(q) {
    state.lastQuery = q;
    const source = Spotify.isConnected() ? state.searchSource : 'audius';
    const box = $('#search-results');
    if (!box) return;
    if (!q.trim()) { box.innerHTML = '<div class="empty">Search for songs or artists.</div>'; state.visibleTracks = []; return; }
    box.innerHTML = '<div class="status">Searching…</div>';
    try {
      const results = source === 'spotify' ? await Spotify.search(q.trim()) : await searchTracks(q.trim());
      if (state.lastQuery !== q || state.view !== 'search' || (Spotify.isConnected() ? state.searchSource : 'audius') !== source) return;
      box.innerHTML = results.length ? `<h2>Songs</h2>${trackRows(results)}` : `<div class="empty">No results for “${esc(q)}”.</div>`;
    } catch (err) {
      if (state.lastQuery === q) box.innerHTML = `<div class="empty">${source === 'spotify' ? esc(err.message) : "Couldn't reach the music service."}</div>`;
    }
  }

  function renderQueue() {
    const panel = $('#queue-panel');
    if (panel.classList.contains('hidden')) return;
    const list = $('#queue-list');
    if (!state.queue.length) { list.innerHTML = '<div class="empty">Queue is empty.</div>'; return; }
    list.innerHTML = state.queue.map((t, i) => `
      <button class="queue-item${i === state.index ? ' current' : ''}" data-qi="${i}">
        ${t.art ? `<img src="${esc(t.art)}" alt="">` : '<img alt="">'}
        <div class="t-text"><div class="t-title">${esc(t.title)}</div><div class="t-artist">${esc(t.artist)}</div></div>
      </button>`).join('');
  }

  // ---------- playlists ----------
  function createPlaylist(withTrack) {
    const name = prompt('Playlist name', `My Playlist #${state.playlists.length + 1}`);
    if (!name || !name.trim()) return null;
    const p = { id: Date.now().toString(36), name: name.trim(), tracks: withTrack ? [withTrack] : [] };
    state.playlists.push(p);
    save();
    renderPlaylistLinks();
    toast(withTrack ? `Added to ${p.name}` : `Created ${p.name}`);
    return p;
  }

  function renderPlaylistLinks() {
    $('#playlist-list').innerHTML = state.playlists.map((p) =>
      `<button class="playlist-link${state.view === 'playlist:' + p.id ? ' active' : ''}" data-view="playlist:${esc(p.id)}">♫ ${esc(p.name)}</button>`).join('');
  }

  function showAddMenu(track, anchor) {
    closeMenu();
    if (track.source === 'local') { toast("Local files can't be added to playlists"); return; }
    const menu = document.createElement('div');
    menu.id = 'add-menu';
    menu.style.cssText = 'position:fixed;z-index:20;background:#282828;border-radius:6px;padding:4px;min-width:200px;box-shadow:0 12px 24px rgba(0,0,0,.5)';
    menu.innerHTML = `<button class="queue-item" data-pl="__new">＋ New playlist</button>` +
      state.playlists.map((p) => `<button class="queue-item" data-pl="${esc(p.id)}">${esc(p.name)}</button>`).join('');
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = Math.min(r.bottom, window.innerHeight - menu.offsetHeight - 8) + 'px';
    menu.style.left = Math.max(8, r.right - menu.offsetWidth) + 'px';
    menu.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pl]');
      if (!btn) return;
      closeMenu();
      if (btn.dataset.pl === '__new') { createPlaylist(track); return; }
      const p = state.playlists.find((x) => x.id === btn.dataset.pl);
      if (p.tracks.some((x) => x.id === track.id)) { toast(`Already in ${p.name}`); return; }
      p.tracks.push(track);
      save();
      toast(`Added to ${p.name}`);
    });
  }
  const closeMenu = () => $('#add-menu')?.remove();

  // ---------- local files ----------
  function addLocalFiles(files) {
    const added = [...files].filter((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i.test(f.name)).map((f) => {
      const track = {
        id: 'local:' + f.name + ':' + f.size,
        title: f.name.replace(/\.[^.]+$/, ''),
        artist: 'Local file',
        art: '',
        duration: 0,
        source: 'local',
        src: URL.createObjectURL(f),
      };
      const probe = new Audio();
      probe.preload = 'metadata';
      probe.src = track.src;
      probe.onloadedmetadata = () => { track.duration = probe.duration; if (state.view === 'local') render(); };
      return track;
    }).filter((t) => !state.localTracks.some((x) => x.id === t.id));
    state.localTracks.push(...added);
    toast(`Added ${added.length} file${added.length === 1 ? '' : 's'}`);
    setView('local');
  }

  // ---------- events ----------
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#add-menu') && !e.target.closest('[data-action="add"]')) closeMenu();

    const link = e.target.closest('a[target=_blank]');
    if (link && window.Capacitor?.isNativePlatform?.()) { e.preventDefault(); openExternal(link.href); return; }

    const nav = e.target.closest('[data-view]');
    if (nav) { setView(nav.dataset.view); renderPlaylistLinks(); return; }

    const open = e.target.closest('[data-open]');
    if (open) {
      if (open.dataset.name) state.spPlaylistName = open.dataset.name; setView(open.dataset.open); renderPlaylistLinks(); return; }

    const source = e.target.closest('[data-source]');
    if (source) {
      state.searchSource = source.dataset.source;
      store.set('searchSource', state.searchSource);
      document.querySelectorAll('[data-source]').forEach((b) => b.classList.toggle('active', b === source));
      runSearch($('#search-input')?.value || '');
      return;
    }

    const copy = e.target.closest('[data-copy]');
    if (copy) {
      navigator.clipboard?.writeText(copy.dataset.copy).then(() => toast('Copied'), () => toast('Copy failed, select the text instead'));
      return;
    }

    const genre = e.target.closest('[data-genre]');
    if (genre) { state.genre = genre.dataset.genre; render(); return; }

    const qi = e.target.closest('[data-qi]');
    if (qi) { state.index = +qi.dataset.qi; loadAndPlay(); return; }

    const action = e.target.closest('[data-action]');
    const row = e.target.closest('.track, .card[data-index]');
    const track = row ? state.visibleTracks[row.dataset.index] : null;

    if (action) {
      const a = action.dataset.action;
      if (a === 'like') return toggleLike(track);
      if (a === 'add') return showAddMenu(track, action);
      if (a === 'play-all') return playList(state.visibleTracks, 0);
      if (a === 'add-files') return $('#file-input').click();
      if (a === 'sp-connect') {
        const id = $('#sp-client').value.trim();
        if (!/^[0-9a-f]{32}$/i.test(id)) return toast('That doesn\'t look like a Spotify Client ID (32 letters/numbers)');
        return Spotify.login(id).catch((err) => toast(err.message));
      }
      if (a === 'sp-logout') {
        if (sp.active) stopSpotify(true);
        Spotify.logout();
        toast('Disconnected from Spotify');
        return render();
      }
      if (a === 'remove' || a === 'rename-playlist' || a === 'delete-playlist') {
        const p = state.playlists.find((x) => 'playlist:' + x.id === state.view);
        if (!p) return;
        if (a === 'remove') {
          p.tracks.splice(+row.dataset.index, 1);
        } else if (a === 'rename-playlist') {
          const name = prompt('Rename playlist', p.name);
          if (!name || !name.trim()) return;
          p.name = name.trim();
        } else {
          if (!confirm(`Delete “${p.name}”?`)) return;
          state.playlists = state.playlists.filter((x) => x !== p);
          save();
          renderPlaylistLinks();
          return setView('library');
        }
        save();
        renderPlaylistLinks();
        return render();
      }
    }

    if (row && track) playList(state.visibleTracks, +row.dataset.index);
  });

  main.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.card')) { e.preventDefault(); e.target.click(); }
  });

  main.addEventListener('input', (e) => {
    if (e.target.id !== 'search-input') return;
    clearTimeout(searchTimer);
    const q = e.target.value;
    searchTimer = setTimeout(() => runSearch(q), 350);
  });

  $('#new-playlist').addEventListener('click', () => {
    const p = createPlaylist();
    if (p) setView('playlist:' + p.id), renderPlaylistLinks();
  });
  $('#file-input').addEventListener('change', (e) => { addLocalFiles(e.target.files); e.target.value = ''; });

  $('#play').addEventListener('click', togglePlay);
  $('#next').addEventListener('click', () => next());
  $('#prev').addEventListener('click', prev);
  $('#np-like').addEventListener('click', () => toggleLike(current()));

  $('#shuffle').addEventListener('click', () => {
    state.shuffle = !state.shuffle;
    if (state.shuffle && state.queue.length) shuffleQueueKeepingCurrent();
    syncModeButtons();
    save();
    renderQueue();
    toast(state.shuffle ? 'Shuffle on' : 'Shuffle off');
  });
  $('#repeat').addEventListener('click', () => {
    state.repeat = { off: 'all', all: 'one', one: 'off' }[state.repeat];
    if (sp.active) Spotify.setRepeat(state.repeat).catch(() => {});
    syncModeButtons();
    save();
    toast({ off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' }[state.repeat]);
  });
  function syncModeButtons() {
    $('#shuffle').classList.toggle('on', state.shuffle);
    $('#repeat').classList.toggle('on', state.repeat !== 'off');
    $('#repeat').textContent = state.repeat === 'one' ? '↻¹' : '↻';
  }

  $('#queue-btn').addEventListener('click', () => {
    $('#queue-panel').classList.toggle('hidden');
    $('#queue-btn').classList.toggle('on');
    renderQueue();
  });
  $('#close-queue').addEventListener('click', () => {
    $('#queue-panel').classList.add('hidden');
    $('#queue-btn').classList.remove('on');
  });

  // seek & volume
  seek.addEventListener('input', () => {
    seeking = true;
    $('#cur-time').textContent = fmt((seek.value / 1000) * ((sp.active ? sp.duration : audio.duration) || 0));
  });
  seek.addEventListener('change', () => {
    seeking = false;
    if (sp.active) {
      Object.assign(sp, { progress: (seek.value / 1000) * sp.duration, at: Date.now() });
      Spotify.seek(sp.progress * 1000).catch((err) => spotifyFailed(err));
    } else if (isFinite(audio.duration)) {
      audio.currentTime = (seek.value / 1000) * audio.duration;
    }
  });

  const volume = $('#volume');
  let volumeTimer;
  audio.volume = store.get('volume', 0.8);
  volume.value = audio.volume * 100;
  volume.addEventListener('input', () => {
    audio.volume = volume.value / 100;
    audio.muted = false;
    store.set('volume', audio.volume);
    if (sp.active) {
      clearTimeout(volumeTimer);
      volumeTimer = setTimeout(() => Spotify.setVolume(volume.value).catch(() => toast("This device doesn't allow volume control")), 300);
    }
  });
  $('#mute').addEventListener('click', () => { audio.muted = !audio.muted; });
  audio.addEventListener('volumechange', () => {
    $('#mute').textContent = audio.muted || audio.volume === 0 ? '🔇' : '🔊';
  });

  audio.addEventListener('timeupdate', () => { if (!sp.active) showProgress(audio.currentTime, audio.duration); });
  audio.addEventListener('loadedmetadata', () => { if (!sp.active) showProgress(audio.currentTime, audio.duration); });
  audio.addEventListener('play', () => setPlayButton(true));
  audio.addEventListener('pause', () => { if (!sp.active) setPlayButton(false); });
  audio.addEventListener('ended', () => next(true));
  let errorStreak = 0;
  audio.addEventListener('playing', () => { errorStreak = 0; });
  audio.addEventListener('error', () => {
    if (!audio.getAttribute('src')) return;
    if (++errorStreak >= Math.min(5, state.queue.length)) { toast("Couldn't play these tracks"); return; }
    toast('Track unavailable, skipping…');
    setTimeout(() => next(true), 800);
  });

  // keyboard shortcuts (ignored while typing)
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input[type=search], input[type=text], textarea')) return;
    if (e.code === 'Space' && !e.target.matches('button, .card')) { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight' && e.shiftKey) next();
    else if (e.key === 'ArrowLeft' && e.shiftKey) prev();
  });

  // lock-screen / headphone controls
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => (sp.active ? spotifyResume() : audio.play()));
    navigator.mediaSession.setActionHandler('pause', () => (sp.active ? spotifyPause() : audio.pause()));
    navigator.mediaSession.setActionHandler('nexttrack', () => next());
    navigator.mediaSession.setActionHandler('previoustrack', prev);
  }

  // Android back button (only inside the app): go back to Home, then send the app
  // to the background instead of closing it so the music keeps playing.
  const nativeApp = window.Capacitor?.Plugins?.App;

  async function finishSpotifyLogin(url) {
    if (!Spotify.isCallbackUrl(url)) return;
    try {
      await Spotify.handleRedirect(url);
      if (Spotify.user()) toast('Spotify connected');
    } catch (err) {
      toast(err.message);
    }
    setView('spotify');
  }
  if (Spotify.isCallbackUrl(location.href)) {
    const url = location.href;
    history.replaceState(null, '', location.pathname);
    finishSpotifyLogin(url);
  }
  if (nativeApp) {
    nativeApp.addListener('appUrlOpen', ({ url }) => finishSpotifyLogin(url));
    nativeApp.getLaunchUrl?.().then((r) => r?.url && finishSpotifyLogin(r.url)).catch(() => {});
    nativeApp.addListener('backButton', () => {
      if ($('#add-menu')) closeMenu();
      else if (!$('#queue-panel').classList.contains('hidden')) $('#close-queue').click();
      else if (state.view.startsWith('sp-')) setView('spotify');
      else if (state.view !== 'home') { setView('home'); renderPlaylistLinks(); }
      else nativeApp.minimizeApp();
    });
  }

  // ---------- start ----------
  syncModeButtons();
  renderPlaylistLinks();
  render();
})();
