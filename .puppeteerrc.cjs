/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Completely disable Chrome download
  chrome: {
    skipDownload: true,
  },
  // ONLY download Firefox
  firefox: {
    skipDownload: false,
  },
};
