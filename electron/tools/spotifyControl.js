// spotify_control tool — control Spotify playback via the Web API.
//
// Actions: pause, resume, next, previous, volume, current_track.
// Requires Spotify to be connected (tray "Connect Spotify") and an
// active device (Spotify app open somewhere).

const spotify = require('../spotify');

async function spotifyControl(args) {

  const action = args.action;

  switch (action) {

    case 'pause':
      return await spotify.pause();

    case 'resume':
      return await spotify.resume();

    case 'next':
      return await spotify.skipNext();

    case 'previous':
      return await spotify.skipPrevious();

    case 'volume': {
      const pct = args.volume_percent;
      if (typeof pct !== 'number' || pct < 0 || pct > 100) {
        throw new Error('volume_percent must be a number between 0 and 100');
      }
      return await spotify.setVolume(pct);
    }

    case 'current_track':
      return await spotify.getCurrentTrack();

    default:
      throw new Error(
        `Unknown spotify_control action: "${action}". ` +
        'Valid: pause, resume, next, previous, volume, current_track'
      );

  }

}

module.exports = spotifyControl;
