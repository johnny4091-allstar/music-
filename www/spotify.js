/* Spotify connection for Tunely.
 * Sign-in uses OAuth with PKCE (no server or client secret needed). Playback is remote control of the
 * listener's own Spotify app/device through the Web API, which Spotify only allows for Premium accounts.
 */
(() => {
  'use strict';

  const ACCOUNTS = 'https://accounts.spotify.com';
  const API = 'https://api.spotify.com/v1';
  const NATIVE_REDIRECT = 'com.tunely.app://callback';
  const SCOPES = [
    'user-read-private',
    'user-library-read',
    'user-top-read',
    'playlist-read-private',
    'playlist-read-collaborative',
    'user-read-playback-state',
    'user-modify-playback-state',
  ].join(' ');

  const KEY = 'tunely:spotify';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  let cfg = load(); // { clientId, accessToken, refreshToken, expiresAt, verifier, user }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* storage unavailable */ } };

  const isNative = () => !!window.Capacitor?.isNativePlatform?.();
  const redirectUri = () => (isNative() ? NATIVE_REDIRECT : location.origin + location.pathname);

  class SpotifyError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  // ---------- auth ----------
  const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  async function login(clientId) {
    cfg.clientId = clientId.trim();
    cfg.verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    persist();
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cfg.verifier)));
    const qs = new URLSearchParams({
      client_id: cfg.clientId,
      response_type: 'code',
      redirect_uri: redirectUri(),
      code_challenge_method: 'S256',
      code_challenge: challenge,
      scope: SCOPES,
    });
    // In the Android app this leaves the WebView and opens the system browser; Spotify then
    // redirects to com.tunely.app://callback, which Android hands back to Tunely.
    location.href = `${ACCOUNTS}/authorize?${qs}`;
  }

  async function tokenRequest(params) {
    const res = await fetch(`${ACCOUNTS}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: cfg.clientId, ...params }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new SpotifyError('AUTH', data.error_description || data.error || 'Spotify sign-in failed');
    cfg.accessToken = data.access_token;
    if (data.refresh_token) cfg.refreshToken = data.refresh_token;
    cfg.expiresAt = Date.now() + (data.expires_in - 60) * 1000;
    persist();
  }

  /** Finish sign-in from a redirect URL. Returns true when the URL was a Spotify callback. */
  async function handleRedirect(url) {
    const u = new URL(url);
    const code = u.searchParams.get('code');
    const error = u.searchParams.get('error');
    if (!code && !error) return false;
    if (error) throw new SpotifyError('AUTH', error === 'access_denied' ? 'Spotify sign-in was cancelled' : error);
    if (!cfg.verifier) throw new SpotifyError('AUTH', 'Sign-in expired, please try again');
    await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: cfg.verifier });
    delete cfg.verifier;
    persist();
    try {
      cfg.user = await api('/me');
      persist();
    } catch (err) {
      if (err.code === 'AUTH') throw err;
      // Signed in, but Spotify refuses data requests; the Spotify tab explains why.
    }
    return true;
  }

  async function refresh() {
    if (!cfg.refreshToken) throw new SpotifyError('AUTH', 'Please connect Spotify again');
    try {
      await tokenRequest({ grant_type: 'refresh_token', refresh_token: cfg.refreshToken });
    } catch (err) {
      logout();
      throw err;
    }
  }

  function logout() {
    cfg = { clientId: cfg.clientId };
    persist();
  }

  // ---------- Web API ----------
  async function api(path, { method = 'GET', query, body, retried = false } = {}) {
    if (!cfg.accessToken) throw new SpotifyError('AUTH', 'Not connected to Spotify');
    if (Date.now() > cfg.expiresAt) await refresh();
    const qs = query ? '?' + new URLSearchParams(query) : '';
    const res = await fetch(API + path + qs, {
      method,
      headers: { Authorization: `Bearer ${cfg.accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !retried) {
      await refresh();
      return api(path, { method, query, body, retried: true });
    }
    if (res.status === 204 || res.status === 202) return null;
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* Spotify sometimes answers errors in plain text */ }
    if (!res.ok) {
      const reason = data?.error?.reason;
      const msg = data?.error?.message || (data ? '' : text.trim().slice(0, 200)) || `Spotify request failed (${res.status})`;
      // Spotify only lets development-mode apps work while the account that created the app has Premium.
      if (/premium/i.test(msg) && /owner/i.test(msg)) throw new SpotifyError('OWNER_PREMIUM', msg);
      if (reason === 'PREMIUM_REQUIRED' || (res.status === 403 && path.startsWith('/me/player'))) throw new SpotifyError('PREMIUM', 'Playback control needs Spotify Premium');
      if (reason === 'NO_ACTIVE_DEVICE' || (res.status === 404 && path.startsWith('/me/player'))) throw new SpotifyError('NO_DEVICE', 'Open Spotify on a device first');
      throw new SpotifyError(res.status === 403 ? 'FORBIDDEN' : 'API', msg);
    }
    return data;
  }

  const toTrack = (t) => t && t.id && {
    id: 'spotify:' + t.id,
    spotifyId: t.id,
    uri: t.uri,
    title: t.name,
    artist: (t.artists || []).map((a) => a.name).join(', ') || 'Unknown artist',
    art: t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || '',
    duration: (t.duration_ms || 0) / 1000,
    url: t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`,
    source: 'spotify',
  };
  const tracksFrom = (items) => (items || []).map((it) => toTrack(it?.track || it?.item || it)).filter(Boolean);

  const search = async (q) => tracksFrom((await api('/search', { query: { q, type: 'track', limit: 10 } }))?.tracks?.items);
  const likedTracks = async () => tracksFrom((await api('/me/tracks', { query: { limit: 50 } }))?.items);
  const topTracks = async () => tracksFrom((await api('/me/top/tracks', { query: { limit: 20 } }))?.items);
  const playlists = async () => ((await api('/me/playlists', { query: { limit: 50 } }))?.items || []).filter(Boolean).map((p) => ({
    id: p.id,
    name: p.name,
    art: p.images?.[0]?.url || '',
    count: p.tracks?.total ?? p.items?.total ?? 0,
  }));

  async function playlistTracks(id) {
    // Spotify has renamed this endpoint between API versions, so try both forms.
    try {
      return tracksFrom((await api(`/playlists/${encodeURIComponent(id)}/tracks`, { query: { limit: 100 } }))?.items);
    } catch (err) {
      if (err.code === 'AUTH' || err.code === 'PREMIUM') throw err;
      return tracksFrom((await api(`/playlists/${encodeURIComponent(id)}/items`, { query: { limit: 100 } }))?.items);
    }
  }

  // ---------- playback (remote control) ----------
  let deviceId = null;

  async function pickDevice() {
    const { devices = [] } = (await api('/me/player/devices')) || {};
    const usable = devices.filter((d) => !d.is_restricted);
    const device = usable.find((d) => d.is_active) || usable.find((d) => d.type === 'Smartphone') || usable[0];
    if (!device) throw new SpotifyError('NO_DEVICE', 'Open the Spotify app first');
    deviceId = device.id;
    return device;
  }

  async function play(uris) {
    const device = await pickDevice();
    await api('/me/player/play', { method: 'PUT', query: { device_id: device.id }, body: { uris } });
    return device;
  }

  const withDevice = () => (deviceId ? { device_id: deviceId } : undefined);
  const pause = () => api('/me/player/pause', { method: 'PUT', query: withDevice() });
  const resume = () => api('/me/player/play', { method: 'PUT', query: withDevice() });
  const seek = (ms) => api('/me/player/seek', { method: 'PUT', query: { position_ms: Math.round(ms), ...withDevice() } });
  const setVolume = (pct) => api('/me/player/volume', { method: 'PUT', query: { volume_percent: Math.round(pct), ...withDevice() } });
  const setRepeat = (mode) => api('/me/player/repeat', { method: 'PUT', query: { state: { off: 'off', all: 'context', one: 'track' }[mode], ...withDevice() } });
  const shuffleOff = () => api('/me/player/shuffle', { method: 'PUT', query: { state: false, ...withDevice() } });

  async function playerState() {
    const s = await api('/me/player');
    if (!s) return null;
    return {
      isPlaying: !!s.is_playing,
      progress: (s.progress_ms || 0) / 1000,
      duration: (s.item?.duration_ms || 0) / 1000,
      uri: s.item?.uri || null,
      device: s.device?.name || '',
    };
  }

  window.TunelySpotify = {
    SpotifyError,
    isConnected: () => !!cfg.accessToken,
    clientId: () => cfg.clientId || '',
    user: () => cfg.user || null,
    redirectUri,
    isCallbackUrl: (url) => String(url).startsWith(redirectUri()) && /[?&](code|error)=/.test(url),
    login,
    logout,
    handleRedirect,
    search,
    likedTracks,
    topTracks,
    playlists,
    playlistTracks,
    play,
    pause,
    resume,
    seek,
    setVolume,
    setRepeat,
    shuffleOff,
    playerState,
  };
})();
