// The platform this installer runs on. Each platform folder has a platform.js with the same exports:
//   resolvePaths()                   Resolve's folders: { dest, oldDests, sampleNode, app, userData }
//   appFolder(app)                   the folder the packaged installer app sits in
//   resolveRunning()                 is DaVinci Resolve open?
//   quitResolve()                    asks Resolve to quit: { ok } or { ok: false, error }
//   placePlugin(stage, paths, log)   puts the finished plugin folder where Resolve reads it
//   ITEMS                            what this platform installs besides the panel
module.exports = require(process.platform === 'win32' ? '../windows/platform' : '../mac/platform');
