// spotify_play tool — search Spotify for a track/artist/album/playlist
// and start playback immediately via the Web API.
//
// Requires the user to have connected Spotify via the tray menu first.
// If no active device is found, Spotify must be open on a device.

const spotify = require('../spotify');

const VALID_TYPES = new Set(['track', 'artist', 'album', 'playlist']);

async function spotifyPlay(args) {

  const query = typeof args.query === 'string' ? args.query.trim() : '';

  if (!query) {
    throw new Error('query is required');
  }

  if (query.length > 200) {
    throw new Error('query too long (max 200 chars)');
  }

  const type = VALID_TYPES.has(args.type) ? args.type : 'track';

  return await spotify.searchAndPlay(query, type);

}

module.exports = spotifyPlay;
