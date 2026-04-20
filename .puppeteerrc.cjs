const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Save the browser directly into the Heroku app folder so it isn't lost
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
  
  // Completely disable Chrome download
  chrome: {
    skipDownload: true,
  },
  
  // ONLY download Firefox Stable
  firefox: {
    skipDownload: false,
  },
};
