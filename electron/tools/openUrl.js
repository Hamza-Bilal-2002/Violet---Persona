// open_url tool — launch a URL in the user's default browser.
//
// Defensive on the URL: only http and https are accepted. Other
// schemes (file:, javascript:, mailto:, etc.) are rejected because
// shell.openExternal will happily launch them and that's a foot-gun
// — the model could be talked into running arbitrary local files
// or sending out emails.

const { shell } = require('electron');

async function openUrl(args) {

  const url =
    args && typeof args.url === 'string'
      ? args.url
      : null;

  if (!url) {

    throw new Error(
      'url is required and must be a string'
    );

  }

  let parsed;

  try {

    parsed =
      new URL(url);

  } catch (err) {

    throw new Error(
      `invalid URL: ${url}`
    );

  }

  if (
    parsed.protocol !== 'http:' &&
    parsed.protocol !== 'https:'
  ) {

    throw new Error(
      `URL scheme not allowed: ${parsed.protocol} ` +
      `(only http: and https: are permitted)`
    );

  }

  await shell.openExternal(url);

  return {
    opened:
      url,
  };

}

module.exports = openUrl;
