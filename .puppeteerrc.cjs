const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Changes the cache location for Puppeteer to survive Heroku's build process
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
  
  // Explicitly kill Chrome so it stops asking for version 127
  chrome: {
    skipDownload: true,
  },
  
  // Explicitly tell it to download Firefox Stable
  firefox: {
    skipDownload: false,
  },
};
