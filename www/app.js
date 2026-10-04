/* Tunely — a Spotify-style music player.
 * Music comes from Audius (free, full-length, no API key), live radio, Jamendo, the Internet Archive
 * (see sources.js) and files on your device.
 */
(() => {
  'use strict';

  const APP_NAME = 'tunely';
  const FALLBACK_HOST = 'https://discoveryprovider.audius.co';
  const GENRES = ['All', 'Electronic', 'Hip-Hop/Rap', 'Pop', 'R&B/Soul', 'Rock', 'Alternative', 'Lo-Fi', 'House', 'Ambient', 'Jazz'];

  const Sources = window.TunelySources;
  const RADIO_TAGS = [['', 'Top stations'], ['top 40', 'Top 40'], ['pop', 'Pop'], ['hiphop', 'Hip-Hop'], ['rnb', 'R&B'], ['rock', 'Rock'],
    ['country', 'Country'], ['dance', 'Dance'], ['latin', 'Latin'], ['jazz', 'Jazz'], ['classical', 'Classical'], ['lofi', 'Lo-Fi'], ['news', 'News']];
  const SEARCH_SOURCES = [['audius', 'Audius'], ['jamendo', 'Jamendo'], ['archive', 'Internet Archive']];

  const $ = (sel, root = document) => root.querySelector(sel);
  const main = $('#main');
  const audio = $('#audio');

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
    genre: 'All',
    radioTag: '',
    searchSource: store.get('searchSource', 'audius'),
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
    if (track.src) return track.src; // local files, radio, Jamendo, Internet Archive
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
    audio.src = await srcFor(t);
    updateNowPlaying();
    showLive(!!t.live);
    try {
      await audio.play();
      Sources.countRadioClick(t);
    } catch (err) {
      if (err.name !== 'AbortError' && err.name !== 'NotSupportedError') toast("Couldn't play this one");
    }
  }

  function showLive(live) {
    seek.disabled = live;
    seek.closest('.progress').classList.toggle('live', live);
    if (live) {
      seek.value = 0;
      $('#cur-time').textContent = '';
      $('#dur-time').textContent = '● LIVE';
    }
  }

  function togglePlay() {
    if (!current()) {
      if (state.visibleTracks.length) playList(state.visibleTracks, 0);
      return;
    }
    audio.paused ? audio.play() : audio.pause();
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
    if (audio.currentTime > 3 && !current()?.live) {
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
    $('#np-artist').textContent = t ? t.artist : 'Pick a song to start';
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
        ${t.art ? `<img src="${esc(t.art)}" alt="" loading="lazy">` : `<div class="ph">${t.live ? '📻' : '♪'}</div>`}
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
        <div id="home-list" class="status">Loading…</div>
        <h2>Explore more</h2>
        <div class="grid">
          <div class="card" data-open="radio" role="button" tabindex="0"><div class="ph tile" style="background:linear-gradient(135deg,#e91429,#f59b23)">📻</div>
            <div class="card-title">Live Radio</div><div class="card-sub">Top 40, hip-hop, country and more</div></div>
          <div class="card" data-open="search" data-source="jamendo" role="button" tabindex="0"><div class="ph tile" style="background:linear-gradient(135deg,#0d72ea,#8d67ab)">🎸</div>
            <div class="card-title">Jamendo</div><div class="card-sub">600,000+ independent songs</div></div>
          <div class="card" data-open="search" data-source="archive" role="button" tabindex="0"><div class="ph tile" style="background:linear-gradient(135deg,#535353,#a0a0a0)">🏛️</div>
            <div class="card-title">Internet Archive</div><div class="card-sub">Live concerts and classic recordings</div></div>
        </div>`;
      try {
        // Audius tracks have no src; the home grid owns visibleTracks.
        const tracks = await trending(state.genre);
        if (stale()) return;
        $('#home-list').outerHTML = tracks.length ? cards(tracks) : '<div class="empty">No tracks found.</div>';
      } catch {
        if (stale()) return;
        $('#home-list').innerHTML = "Couldn't reach Audius. Check your connection, or try <b>Live Radio</b> or <b>Local Files</b>.";
      }
      return;
    }

    if (v === 'radio') {
      const label = (RADIO_TAGS.find(([t]) => t === state.radioTag) || [, 'Stations'])[1];
      main.innerHTML = `
        <h1>Live Radio</h1>
        <input id="radio-input" class="search-box" type="search" placeholder="Search stations (e.g. BBC, KISS FM, jazz)" value="${esc(state.radioQuery || '')}" autocomplete="off">
        <div class="chips">${RADIO_TAGS.map(([t, l]) => `<button class="chip${!state.radioQuery && t === state.radioTag ? ' active' : ''}" data-radio-tag="${esc(t)}">${esc(l)}</button>`).join('')}</div>
        <h2>${state.radioQuery ? `Stations matching “${esc(state.radioQuery)}”` : esc(label)}</h2>
        <div id="radio-list" class="status">Tuning in…</div>`;
      state.visibleTracks = [];
      try {
        const stations = await Sources.radioStations(state.radioQuery ? { name: state.radioQuery } : { tag: state.radioTag });
        if (stale()) return;
        $('#radio-list').outerHTML = stations.length ? cards(stations) : '<div class="empty">No stations found.</div>';
      } catch {
        if (stale()) return;
        $('#radio-list').innerHTML = "Couldn't reach the radio directory. Check your connection.";
      }
      return;
    }

    if (v.startsWith('archive:')) {
      const id = v.slice('archive:'.length);
      main.innerHTML = `<h1>${esc(state.archiveTitle || 'Internet Archive')}</h1><div class="status">Loading…</div>`;
      state.visibleTracks = [];
      try {
        const item = await Sources.archiveItem(id);
        if (stale()) return;
        main.innerHTML = listPage(item.title, ['Internet Archive', item.creator, `${item.tracks.length} tracks`].filter(Boolean).join(' · '),
          trackRows(item.tracks), 'This recording has no playable MP3 files.',
          `<button class="btn" data-view="search">‹ Back to search</button><a class="btn" href="https://archive.org/details/${encodeURIComponent(id)}" target="_blank" rel="noopener">View on archive.org</a>`);
      } catch {
        if (stale()) return;
        main.innerHTML = '<h1>Internet Archive</h1><div class="empty">Couldn\'t load this recording. Check your connection.</div>';
      }
      return;
    }

    if (v === 'search') {
      const q = state.lastQuery || '';
      main.innerHTML = `
        <h1>Search</h1>
        <input id="search-input" class="search-box" type="search" placeholder="What do you want to listen to?" value="${esc(q)}" autocomplete="off">
        <div class="chips">${SEARCH_SOURCES.map(([k, l]) => `<button class="chip${state.searchSource === k ? ' active' : ''}" data-search-source="${k}">${l}</button>`).join('')}</div>
        <div id="search-results"></div>`;
      const input = $('#search-input');
      input.focus();
      input.setSelectionRange(q.length, q.length);
      runSearch(q);
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

  function jamendoSetup(message = '') {
    return `
      <div class="setup">
        <h2>Connect Jamendo (free, one time)</h2>
        ${message ? `<p class="notice">${esc(message)}</p>` : ''}
        <p class="muted">Jamendo has 600,000+ full-length songs from independent artists, free and legal to stream. It needs a free Client ID; no payment or Premium.</p>
        <ol class="steps">
          <li>Open <a href="https://devportal.jamendo.com/" target="_blank" rel="noopener">devportal.jamendo.com</a> and sign up (free).</li>
          <li>Create a new app with any name (website can be <code>https://github.com</code>).</li>
          <li>Copy its <b>Client ID</b> and paste it here:</li>
        </ol>
        <div class="input-row">
          <input id="jamendo-id" class="search-box" placeholder="Jamendo Client ID" value="${esc(Sources.jamendoClientId())}" autocomplete="off" spellcheck="false">
          <button class="btn primary" data-action="jamendo-save">Save</button>
        </div>
      </div>`;
  }

  let searchTimer;
  let searchToken = 0;
  async function runSearch(q) {
    state.lastQuery = q;
    const box = $('#search-results');
    if (!box) return;
    const token = ++searchToken;
    const source = state.searchSource;
    state.visibleTracks = [];
    if (source === 'jamendo' && !Sources.jamendoClientId()) { box.innerHTML = jamendoSetup(); return; }
    const query = q.trim();
    const hint = { audius: 'Search for songs or artists.', jamendo: 'Popular on Jamendo this week', archive: 'Most-played recordings on the Internet Archive' }[source];
    if (!query && source === 'audius') { box.innerHTML = `<div class="empty">${hint}</div>`; return; }
    box.innerHTML = '<div class="status">Searching…</div>';
    try {
      let html;
      if (source === 'archive') {
        const items = await Sources.archiveSearch(query, query ? {} : { collection: 'etree' });
        if (token !== searchToken) return;
        html = items.length ? `<h2>${query ? 'Recordings' : hint}</h2><div class="grid">${items.map((it) => `
          <div class="card" data-open="archive:${esc(it.id)}" data-title="${esc(it.title)}" role="button" tabindex="0">
            <img src="${esc(it.art)}" alt="" loading="lazy">
            <div class="card-title">${esc(it.title)}</div><div class="card-sub">${esc(it.creator || 'Internet Archive')}</div>
          </div>`).join('')}</div>` : '';
      } else {
        const results = source === 'jamendo' ? await (query ? Sources.jamendoSearch(query) : Sources.jamendoPopular()) : await searchTracks(query);
        if (token !== searchToken) return;
        html = results.length ? `<h2>${query ? 'Songs' : hint}</h2>${trackRows(results)}` : '';
      }
      if (state.view !== 'search') return;
      box.innerHTML = html || `<div class="empty">No results for “${esc(query)}”.</div>`;
    } catch (err) {
      if (token !== searchToken) return;
      box.innerHTML = err.code === 'JAMENDO_KEY' ? jamendoSetup(err.message) : `<div class="empty">Couldn't reach ${esc(SEARCH_SOURCES.find(([k]) => k === source)[1])}. Check your connection.</div>`;
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

    const nav = e.target.closest('[data-view]');
    if (nav) { setView(nav.dataset.view); renderPlaylistLinks(); return; }

    const open = e.target.closest('[data-open]');
    if (open) {
      if (open.dataset.title) state.archiveTitle = open.dataset.title;
      if (open.dataset.source) { state.searchSource = open.dataset.source; store.set('searchSource', state.searchSource); } setView(open.dataset.open); renderPlaylistLinks(); return; }

    const link = e.target.closest('a[target=_blank]');
    if (link && window.Capacitor?.isNativePlatform?.()) { e.preventDefault(); location.href = link.href; return; }

    const radioTag = e.target.closest('[data-radio-tag]');
    if (radioTag) { state.radioTag = radioTag.dataset.radioTag; state.radioQuery = ''; render(); return; }

    const searchSource = e.target.closest('[data-search-source]');
    if (searchSource) {
      state.searchSource = searchSource.dataset.searchSource;
      store.set('searchSource', state.searchSource);
      document.querySelectorAll('[data-search-source]').forEach((b) => b.classList.toggle('active', b === searchSource));
      runSearch($('#search-input')?.value || '');
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
      if (a === 'jamendo-save') {
        const id = $('#jamendo-id').value.trim();
        if (!id) return toast('Paste your Jamendo Client ID first');
        Sources.setJamendoClientId(id);
        toast('Jamendo saved');
        return runSearch($('#search-input')?.value || '');
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
    if (e.target.id === 'radio-input') {
      clearTimeout(searchTimer);
      const q = e.target.value.trim();
      searchTimer = setTimeout(() => {
        state.radioQuery = q;
        render().then(() => { const el = $('#radio-input'); if (el) { el.focus(); el.setSelectionRange(q.length, q.length); } });
      }, 450);
      return;
    }
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
  const seek = $('#seek');
  let seeking = false;
  seek.addEventListener('input', () => {
    seeking = true;
    $('#cur-time').textContent = fmt((seek.value / 1000) * (audio.duration || 0));
  });
  seek.addEventListener('change', () => {
    if (isFinite(audio.duration)) audio.currentTime = (seek.value / 1000) * audio.duration;
    seeking = false;
  });

  const volume = $('#volume');
  audio.volume = store.get('volume', 0.8);
  volume.value = audio.volume * 100;
  volume.addEventListener('input', () => {
    audio.volume = volume.value / 100;
    audio.muted = false;
    store.set('volume', audio.volume);
  });
  $('#mute').addEventListener('click', () => { audio.muted = !audio.muted; });
  audio.addEventListener('volumechange', () => {
    $('#mute').textContent = audio.muted || audio.volume === 0 ? '🔇' : '🔊';
  });

  audio.addEventListener('timeupdate', () => {
    if (seeking || current()?.live) return;
    const d = audio.duration;
    seek.value = isFinite(d) && d > 0 ? (audio.currentTime / d) * 1000 : 0;
    $('#cur-time').textContent = fmt(audio.currentTime);
  });
  audio.addEventListener('loadedmetadata', () => { if (!current()?.live) $('#dur-time').textContent = fmt(audio.duration); });
  audio.addEventListener('play', () => { $('#play').textContent = '⏸'; $('#play').title = 'Pause'; });
  audio.addEventListener('pause', () => { $('#play').textContent = '▶'; $('#play').title = 'Play'; });
  audio.addEventListener('ended', () => next(true));
  let errorStreak = 0;
  audio.addEventListener('playing', () => { errorStreak = 0; });
  audio.addEventListener('error', () => {
    if (!audio.getAttribute('src')) return;
    if (++errorStreak >= Math.min(5, state.queue.length)) { toast("Couldn't play these tracks"); return; }
    toast(current()?.live ? 'Station is off the air, trying the next one…' : 'Track unavailable, skipping…');
    setTimeout(() => next(true), 800);
  });

  // Station logos and cover art are often missing; hide broken images instead of showing an icon.
  document.addEventListener('error', (e) => {
    if (e.target.id === 'np-art') e.target.removeAttribute('src');
    else if (e.target.tagName === 'IMG' && e.target.closest('#main, #queue-list')) e.target.style.visibility = 'hidden';
  }, true);

  // keyboard shortcuts (ignored while typing)
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input[type=search], input[type=text], textarea')) return;
    if (e.code === 'Space' && !e.target.matches('button, .card')) { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight' && e.shiftKey) next();
    else if (e.key === 'ArrowLeft' && e.shiftKey) prev();
  });

  // lock-screen / headphone controls
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('nexttrack', () => next());
    navigator.mediaSession.setActionHandler('previoustrack', prev);
  }

  // Android back button (only inside the app): go back to Home, then send the app
  // to the background instead of closing it so the music keeps playing.
  const nativeApp = window.Capacitor?.Plugins?.App;
  if (nativeApp) {
    nativeApp.addListener('backButton', () => {
      if ($('#add-menu')) closeMenu();
      else if (!$('#queue-panel').classList.contains('hidden')) $('#close-queue').click();
      else if (state.view.startsWith('archive:')) setView('search');
      else if (state.view !== 'home') { setView('home'); renderPlaylistLinks(); }
      else nativeApp.minimizeApp();
    });
  }

  // ---------- start ----------
  syncModeButtons();
  renderPlaylistLinks();
  render();
})();
