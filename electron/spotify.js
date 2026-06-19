// Spotify Web API — OAuth PKCE + playback control.
//
// Auth flow:
//   1. authenticate() opens Spotify login in the browser
//   2. Spotify redirects to violet://callback?code=...
//   3. Windows routes the URL back to this process via second-instance
//   4. handleCallback(url) exchanges the code for tokens
//   5. Tokens are persisted to userData/spotify-tokens.json
//      and auto-refreshed before every API call
//
// All API actions (searchAndPlay, pause, resume, …) call apiCall()
// which transparently handles token refresh.

'use strict';

const { app, shell } = require('electron');
const crypto           = require('crypto');
const https            = require('https');
const fs               = require('fs');
const path             = require('path');

// ─── Config ──────────────────────────────────────────────────────────────────

const CLIENT_ID    = 'bc92dd62237f4bf7ac5460af6a4aaeb4';
const REDIRECT_URI = 'violet://callback';
const SCOPES       = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'user-library-read',
].join(' ');

// ─── State ───────────────────────────────────────────────────────────────────

let _tokens       = null;   // { access_token, refresh_token, expires_at }
let _codeVerifier = null;
let _authResolve  = null;
let _authReject   = null;

// ─── Token persistence ────────────────────────────────────────────────────────

function _tokensPath() {
  return path.join(app.getPath('userData'), 'spotify-tokens.json');
}

function loadTokens() {
  try {
    const raw = fs.readFileSync(_tokensPath(), 'utf8');
    _tokens = JSON.parse(raw);
    console.log('[spotify] loaded saved tokens');
  } catch {
    _tokens = null;
  }
}

function _saveTokens(tokens) {
  _tokens = tokens;
  try {
    fs.writeFileSync(_tokensPath(), JSON.stringify(tokens), 'utf8');
  } catch (err) {
    console.warn('[spotify] could not persist tokens:', err.message);
  }
}

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

function _generateVerifier() {
  // 64 random bytes → 86-char base64url string (within 43-128 spec)
  return crypto.randomBytes(64).toString('base64url');
}

function _deriveChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ─── OAuth ────────────────────────────────────────────────────────────────────

function authenticate() {
  _codeVerifier = _generateVerifier();

  const params = new URLSearchParams({
    client_id:             CLIENT_ID,
    response_type:         'code',
    redirect_uri:          REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge:        _deriveChallenge(_codeVerifier),
    scope:                 SCOPES,
  });

  const authUrl = `https://accounts.spotify.com/authorize?${params}`;

  console.log('[spotify] opening auth URL in browser');

  shell.openExternal(authUrl);

  return new Promise((resolve, reject) => {
    // Cancel any in-flight auth before starting a new one so the
    // old promise doesn't hang forever with no way to reject it.
    if (_authReject) {
      _authReject(new Error('auth restarted'));
      _authResolve = null;
      _authReject  = null;
    }

    _authResolve = resolve;
    _authReject  = reject;

    // Time out after 5 minutes so the promise doesn't hang forever.
    setTimeout(() => {
      if (_authReject) {
        _authReject(new Error('Spotify auth timed out (5 min)'));
        _authResolve = null;
        _authReject  = null;
      }
    }, 5 * 60 * 1000);
  });
}

async function handleCallback(url) {
  console.log('[spotify] callback received:', url);

  let urlObj;
  try {
    urlObj = new URL(url);
  } catch {
    console.error('[spotify] malformed callback URL:', url);
    return;
  }

  const error = urlObj.searchParams.get('error');
  const code  = urlObj.searchParams.get('code');

  const fail = (msg) => {
    const err = new Error(msg);
    if (_authReject) { _authReject(err); _authResolve = null; _authReject = null; }
    console.error('[spotify]', msg);
  };

  if (error) { fail(`Spotify denied access: ${error}`); return; }
  if (!code)  { fail('Callback URL missing auth code'); return; }
  if (!_codeVerifier) { fail('No code verifier — auth may have restarted'); return; }

  try {
    const tokens = await _exchangeCode(code, _codeVerifier);
    _codeVerifier = null;
    _saveTokens(tokens);
    console.log('[spotify] authenticated successfully');
    if (_authResolve) { _authResolve(tokens); _authResolve = null; _authReject = null; }
  } catch (err) {
    fail(err.message);
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function _post(url, fields) {
  return new Promise((resolve, reject) => {
    const body    = new URLSearchParams(fields).toString();
    const urlObj  = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function _apiRequest(method, apiPath, token, body = null) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.spotify.com',
      path:     `/v1${apiPath}`,
      method,
      headers:  {
        Authorization: `Bearer ${token}`,
        ...(bodyStr
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
          : {}),
      },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        // 204 No Content is a success with no body
        if (res.statusCode === 204) return resolve(null);
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─── Token management ─────────────────────────────────────────────────────────

async function _exchangeCode(code, verifier) {
  const res = await _post('https://accounts.spotify.com/api/token', {
    grant_type:    'authorization_code',
    code,
    redirect_uri:  REDIRECT_URI,
    client_id:     CLIENT_ID,
    code_verifier: verifier,
  });

  if (res.status !== 200) {
    throw new Error(`Token exchange failed (${res.status}): ${JSON.stringify(res.body)}`);
  }

  return {
    access_token:  res.body.access_token,
    refresh_token: res.body.refresh_token,
    expires_at:    Date.now() + res.body.expires_in * 1000,
  };
}

async function _refresh() {
  if (!_tokens?.refresh_token) {
    throw new Error('No refresh token — please reconnect Spotify from the tray menu.');
  }

  const res = await _post('https://accounts.spotify.com/api/token', {
    grant_type:    'refresh_token',
    refresh_token: _tokens.refresh_token,
    client_id:     CLIENT_ID,
  });

  if (res.status !== 200) {
    throw new Error(`Token refresh failed (${res.status}): ${JSON.stringify(res.body)}`);
  }

  _saveTokens({
    access_token:  res.body.access_token,
    refresh_token: res.body.refresh_token || _tokens.refresh_token,
    expires_at:    Date.now() + res.body.expires_in * 1000,
  });
}

async function _getToken() {
  if (!_tokens) {
    throw new Error(
      'Spotify is not connected. Ask Hamza to connect Spotify from the tray menu.'
    );
  }

  // Refresh proactively if the token expires within 60 seconds.
  if (_tokens.expires_at - Date.now() < 60_000) {
    await _refresh();
  }

  return _tokens.access_token;
}

async function _api(method, apiPath, body = null) {
  const token = await _getToken();
  const res   = await _apiRequest(method, apiPath, token, body);

  if (res === null) return null; // 204 No Content — success

  if (res.status >= 400) {
    const reason =
      res.body?.error?.message ||
      JSON.stringify(res.body);
    throw new Error(`Spotify API error (${res.status}): ${reason}`);
  }

  return res.body;
}

// ─── Device management ────────────────────────────────────────────────────────
//
// The Spotify Web API requires an "active device" before playback can be
// started. A device becomes active when the user has interacted with a
// Spotify client recently. If no device is active we transfer playback to
// the first available one, wait briefly for the transfer to register, then
// return its ID so the caller can target it explicitly in the play request.

async function _ensureActiveDevice() {

  const data    = await _api('GET', '/me/player/devices');
  const devices = data?.devices || [];

  console.log(
    '[spotify] available devices:',
    devices.map((d) => `${d.name} (active=${d.is_active})`)
  );

  if (!devices.length) {
    throw new Error(
      'No Spotify devices found. Open the Spotify app on your PC or phone first.'
    );
  }

  const active = devices.find((d) => d.is_active);

  if (active) {
    return active.id;
  }

  // No active device — transfer playback to the first available one.
  // play:false leaves it paused so the subsequent play call starts fresh.

  const target = devices[0];

  console.log('[spotify] transferring playback to:', target.name);

  await _api('PUT', '/me/player', {
    device_ids: [target.id],
    play:       false,
  });

  // Give Spotify a moment to register the transfer before we fire play.

  await new Promise((r) => setTimeout(r, 800));

  return target.id;

}

// ─── Public API actions ───────────────────────────────────────────────────────

async function searchAndPlay(query, type = 'track') {

  const validTypes = ['track', 'artist', 'album', 'playlist'];
  const t = validTypes.includes(type) ? type : 'track';

  // Resolve the device first so the play request targets it explicitly.
  // This handles the common case where Spotify is open but idle (no
  // active device) without asking the user to manually press play first.

  const deviceId = await _ensureActiveDevice();

  const playPath = `/me/player/play?device_id=${deviceId}`;

  const data = await _api(
    'GET',
    `/search?q=${encodeURIComponent(query)}&type=${t}&limit=1`
  );

  if (t === 'track') {
    const track = data?.tracks?.items?.[0];
    if (!track) throw new Error(`No track found for "${query}"`);
    await _api('PUT', playPath, { uris: [track.uri] });
    return {
      playing: track.name,
      artist:  track.artists?.[0]?.name || 'unknown',
    };
  }

  if (t === 'artist') {
    const artist = data?.artists?.items?.[0];
    if (!artist) throw new Error(`No artist found: "${query}"`);
    await _api('PUT', playPath, { context_uri: artist.uri });
    return { playing: `music by ${artist.name}` };
  }

  if (t === 'album') {
    const album = data?.albums?.items?.[0];
    if (!album) throw new Error(`No album found: "${query}"`);
    await _api('PUT', playPath, { context_uri: album.uri });
    return {
      playing: album.name,
      artist:  album.artists?.[0]?.name || 'unknown',
    };
  }

  if (t === 'playlist') {
    const playlist = data?.playlists?.items?.[0];
    if (!playlist) throw new Error(`No playlist found: "${query}"`);
    await _api('PUT', playPath, { context_uri: playlist.uri });
    return { playing: `playlist: ${playlist.name}` };
  }

}

async function pause() {
  await _api('PUT', '/me/player/pause');
  return { paused: true };
}

async function resume() {
  const deviceId = await _ensureActiveDevice();
  await _api('PUT', `/me/player/play?device_id=${deviceId}`);
  return { resumed: true };
}

async function skipNext() {
  await _api('POST', '/me/player/next');
  return { skipped: 'next' };
}

async function skipPrevious() {
  await _api('POST', '/me/player/previous');
  return { skipped: 'previous' };
}

async function setVolume(percent) {
  const vol = Math.max(0, Math.min(100, Math.round(Number(percent))));
  await _api('PUT', `/me/player/volume?volume_percent=${vol}`);
  return { volume: vol };
}

async function getCurrentTrack() {
  const data = await _api('GET', '/me/player/currently-playing');
  if (!data || !data.item) return { playing: false };
  return {
    playing:     true,
    track:       data.item.name,
    artist:      data.item.artists?.[0]?.name,
    album:       data.item.album?.name,
    progress_ms: data.progress_ms,
    duration_ms: data.item.duration_ms,
    is_playing:  data.is_playing,
  };
}

function isAuthenticated() {
  return !!_tokens;
}

function disconnect() {
  _tokens = null;
  try { fs.unlinkSync(_tokensPath()); } catch { /* already gone */ }
  console.log('[spotify] disconnected — tokens cleared');
}

module.exports = {
  loadTokens,
  authenticate,
  handleCallback,
  isAuthenticated,
  disconnect,
  searchAndPlay,
  pause,
  resume,
  skipNext,
  skipPrevious,
  setVolume,
  getCurrentTrack,
};
