// The only bridge between the page and the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('api', {
  settings: { get: call('settings:get'), set: call('settings:set') },
  library: {
    list: call('library:list'),
    pick: call('library:pick'),
    addFile: call('library:add-file'),
    read: call('library:read'),
    upsert: call('library:upsert'),
    remove: call('library:remove'),
    saveCover: call('library:save-cover'),
    reveal: call('library:reveal'),
    takePending: call('library:take-pending'),
  },
  annotations: { get: call('annotations:get'), set: call('annotations:set') },
  stats: { get: call('stats:get'), set: call('stats:set') },
  fonts: { list: call('fonts:list'), import: call('fonts:import'), remove: call('fonts:remove') },
  file: { save: call('file:save'), openJson: call('file:open-json') },
  openExternal: call('shell:open'),
  window: {
    fullscreen: call('window:fullscreen'),
    isFullscreen: call('window:is-fullscreen'),
    onTop: call('window:on-top'),
    chrome: call('window:chrome'),
    capture: call('window:capture'),
  },
  bookCache: { get: call('bookcache:get'), set: call('bookcache:set') },
  info: call('app:info'),
  graphics: { get: call('graphics:get'), set: call('graphics:set') },
  relaunch: call('app:relaunch'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  on: (channel, fn) => {
    const allowed = ['menu', 'library:open-path', 'window:fullscreen'];
    if (!allowed.includes(channel)) return () => {};
    const listener = (_e, ...args) => fn(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
