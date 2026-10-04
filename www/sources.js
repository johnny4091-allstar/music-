/* Extra music sources for Tunely. Each returns Tunely track objects:
 * { id, title, artist, art, duration, source, src, live? }
 *  - Radio Browser: 50,000+ live internet radio stations (no key)
 *  - Jamendo: full-length independent music under Creative Commons (free client ID)
 *  - Internet Archive: live concerts, classic and public-domain recordings (no key)
 */
(() => {
  'use strict';

  const isNative = () => !!window.Capacitor?.isNativePlatform?.();

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  }

  // ---------- Live radio (radio-browser.info) ----------
  const RADIO_FALLBACK = ['de1.api.radio-browser.info', 'nl1.api.radio-browser.info', 'at1.api.radio-browser.info'];
  let radioHost = null;

  async function radioApi(path, params) {
    if (!radioHost) {
      try {
        const servers = await getJSON('https://all.api.radio-browser.info/json/servers');
        const names = [...new Set(servers.map((s) => s.name).filter(Boolean))];
        radioHost = names[Math.floor(Math.random() * names.length)] || RADIO_FALLBACK[0];
      } catch {
        radioHost = RADIO_FALLBACK[0];
      }
    }
    const qs = new URLSearchParams(params);
    try {
      return await getJSON(`https://${radioHost}/json/${path}?${qs}`);
    } catch (err) {
      // Try the next known server once before giving up.
      const nextHost = RADIO_FALLBACK.find((h) => h !== radioHost);
      radioHost = nextHost;
      return getJSON(`https://${nextHost}/json/${path}?${qs}`);
    }
  }

  const toStation = (s) => ({
    id: 'radio:' + s.stationuuid,
    stationId: s.stationuuid,
    title: (s.name || 'Radio station').trim(),
    artist: ['Live radio', s.country, (s.tags || '').split(',').filter(Boolean).slice(0, 2).join(', ')].filter(Boolean).join(' · '),
    art: s.favicon || '',
    duration: 0,
    live: true,
    source: 'radio',
    src: s.url_resolved || s.url,
  });

  async function radioStations({ tag = '', name = '', country = '' } = {}) {
    const params = { order: 'clickcount', reverse: 'true', hidebroken: 'true', limit: '60' };
    if (tag) params.tag = tag;
    if (name) params.name = name;
    if (country) params.countrycode = country;
    // A secure web page can't load http:// audio, so the website only lists https stations.
    // The Android app allows both.
    if (!isNative()) params.is_https = 'true';
    const list = await radioApi('stations/search', params);
    const seen = new Set();
    return list
      .filter((s) => !s.hls && (s.url_resolved || s.url) && s.lastcheckok !== 0)
      .filter((s) => {
        const key = (s.name || '').trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 40)
      .map(toStation);
  }

  /** Radio Browser asks apps to report plays so popular stations rank higher. */
  function countRadioClick(track) {
    if (track.source === 'radio' && radioHost) fetch(`https://${radioHost}/json/url/${encodeURIComponent(track.stationId)}`).catch(() => {});
  }

  // ---------- Jamendo ----------
  const JAMENDO_KEY = 'tunely:jamendoClientId';
  const jamendoClientId = () => {
    try { return localStorage.getItem(JAMENDO_KEY) || window.TUNELY_CONFIG?.jamendoClientId || ''; } catch { return window.TUNELY_CONFIG?.jamendoClientId || ''; }
  };
  const setJamendoClientId = (id) => { try { localStorage.setItem(JAMENDO_KEY, id.trim()); } catch { /* storage unavailable */ } };

  async function jamendoTracks(params) {
    const qs = new URLSearchParams({ client_id: jamendoClientId(), format: 'json', limit: '30', audioformat: 'mp32', imagesize: '300', ...params });
    const data = await getJSON(`https://api.jamendo.com/v3.0/tracks/?${qs}`);
    if (data.headers?.status !== 'success') {
      const msg = data.headers?.error_message || 'Jamendo request failed';
      const badKey = /client|credential|authoriz/i.test(msg);
      const err = new Error(badKey ? `Jamendo didn't accept that Client ID. (${msg})` : msg);
      err.code = badKey ? 'JAMENDO_KEY' : 'API';
      throw err;
    }
    return (data.results || []).filter((t) => t.audio).map((t) => ({
      id: 'jamendo:' + t.id,
      title: t.name,
      artist: t.artist_name || 'Unknown artist',
      art: t.album_image || t.image || '',
      duration: Number(t.duration) || 0,
      source: 'jamendo',
      src: t.audio,
    }));
  }

  const jamendoSearch = (q) => jamendoTracks({ search: q, order: 'relevance' });
  const jamendoPopular = (tag) => jamendoTracks(tag ? { fuzzytags: tag, order: 'popularity_week' } : { order: 'popularity_week' });

  // ---------- Internet Archive ----------
  const iaArt = (id) => `https://archive.org/services/img/${encodeURIComponent(id)}`;
  const firstOf = (v) => (Array.isArray(v) ? v[0] : v) || '';

  /** Search returns albums/recordings (not single songs); open one with archiveItem(). */
  async function archiveSearch(q, { collection = '' } = {}) {
    const query = [q ? `(${q})` : '', 'mediatype:(audio)', collection ? `collection:(${collection})` : ''].filter(Boolean).join(' AND ');
    const qs = new URLSearchParams({ q: query, rows: '40', output: 'json' });
    ['identifier', 'title', 'creator', 'downloads'].forEach((f) => qs.append('fl[]', f));
    qs.append('sort[]', 'downloads desc');
    const data = await getJSON(`https://archive.org/advancedsearch.php?${qs}`);
    return (data.response?.docs || []).map((d) => ({
      id: d.identifier,
      title: firstOf(d.title) || d.identifier,
      creator: firstOf(d.creator),
      art: iaArt(d.identifier),
    }));
  }

  const parseLength = (len) => {
    if (!len) return 0;
    if (String(len).includes(':')) return String(len).split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
    return Number(len) || 0;
  };

  async function archiveItem(id) {
    const data = await getJSON(`https://archive.org/metadata/${encodeURIComponent(id)}`);
    const meta = data.metadata || {};
    const files = (data.files || []).filter((f) => /\.mp3$/i.test(f.name || ''));
    // Many items have both a high-quality "VBR MP3" and a low-bitrate copy; prefer the VBR one.
    const best = files.some((f) => f.format === 'VBR MP3') ? files.filter((f) => f.format === 'VBR MP3') : files;
    const tracks = best
      .sort((a, b) => (parseInt(a.track, 10) || 0) - (parseInt(b.track, 10) || 0) || a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map((f) => ({
        id: `archive:${id}/${f.name}`,
        title: f.title || f.name.replace(/\.mp3$/i, '').replace(/[_]+/g, ' '),
        artist: firstOf(f.creator || f.artist || meta.creator) || 'Internet Archive',
        art: iaArt(id),
        duration: parseLength(f.length),
        source: 'archive',
        src: `https://archive.org/download/${encodeURIComponent(id)}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
      }));
    return { title: firstOf(meta.title) || id, creator: firstOf(meta.creator), tracks };
  }

  window.TunelySources = {
    radioStations,
    countRadioClick,
    jamendoClientId,
    setJamendoClientId,
    jamendoSearch,
    jamendoPopular,
    archiveSearch,
    archiveItem,
  };
})();
