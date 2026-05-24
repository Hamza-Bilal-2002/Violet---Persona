// spotify_search tool — open Spotify with a search query.
//
// Strategy: hand the Spotify URI scheme (`spotify:search:<query>`)
// to Windows' `start` command. The Spotify desktop app registers
// the spotify: protocol on install, so this brings it to focus
// and navigates to the search results page.
//
// Limitation: the URI scheme cannot trigger playback — only
// search. To actually start music, the model is told (in
// tools.py) to call media_control('play_pause') as a follow-up.
//
// URL-encoding: queries can contain anything (spaces, quotes,
// emoji). encodeURIComponent escapes everything to a safe
// alphanumeric + percent-escape form, so the resulting URI is
// trivially safe to interpolate into the cmd command.

const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync =
  promisify(exec);

const QUERY_MAX_LEN =
  200;

async function spotifySearch(args) {

  const rawQuery =
    args && typeof args.query === 'string'
      ? args.query.trim()
      : '';

  if (!rawQuery) {

    throw new Error(
      'query is required and must be a non-empty string'
    );

  }

  if (rawQuery.length > QUERY_MAX_LEN) {

    throw new Error(
      `query is too long (max ${QUERY_MAX_LEN} chars)`
    );

  }

  // After encodeURIComponent the result contains only ASCII
  // alphanumeric + `-_.!~*'()` + `%XX`. None are cmd
  // metacharacters in this position, so interpolation is safe.

  const encoded =
    encodeURIComponent(rawQuery);

  const uri =
    `spotify:search:${encoded}`;

  const command =
    `start "" "${uri}"`;

  try {

    await execAsync(
      command,
      {
        windowsHide: true,
        timeout: 5000,
      }
    );

  } catch (err) {

    const reason =
      err && err.message
        ? err.message
        : String(err);

    throw new Error(
      `spotify search failed: ${reason}`
    );

  }

  return {
    searched:
      rawQuery,
  };

}

module.exports = spotifySearch;
