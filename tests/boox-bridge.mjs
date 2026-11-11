// The Android app's native bridge on a BOOX tablet, stood in for in the browser tests: the page
// believes it runs in the app on a BOOX, records each BooxPen call in window.__boox.calls, and
// window.__boox.emit(event, points) hands it strokes as the SDK would. Pass to page.addInitScript.
export function fakeBooxBridge() {
  const methods = ['status', 'interaction', 'start', 'setWidth', 'setRegion', 'pause', 'resume', 'refresh', 'stop'];
  const calls = [];
  const listeners = new Map();
  let nextId = 1;
  window.__boox = {
    calls,
    emit(event, points) {
      for (const callback of listeners.get(event) ?? []) callback({ points });
    },
  };
  window.androidBridge = { postMessage() {} };
  window.Capacitor = {
    PluginHeaders: [{
      name: 'BooxPen',
      methods: [
        ...methods.map((name) => ({ name, rtype: 'promise' })),
        { name: 'addListener', rtype: 'callback' },
        { name: 'removeListener', rtype: 'callback' },
      ],
    }],
    async nativePromise(plugin, method, options) {
      if (plugin !== 'BooxPen') throw new Error(`${plugin} is not stood in for`);
      calls.push({ method, options });
      if (method === 'start' && window.__failStart) throw new Error('The BOOX pen couldn\'t start.');
      // window.__startDelay (ms): the SDK takes that long to come up, and calls meanwhile are
      // refused, as the native side did before it checked on the main thread. window.__boox.region
      // is the region the pen really has.
      // Only the latest start counts: one stopped while it was coming up (full screen remounts the
      // page) must not take the pen back to its own region when it finishes.
      if (method === 'start') {
        const start = {};
        window.__boox.pendingStart = start;
        window.__boox.starting = true;
        if (window.__startDelay) await new Promise((resolve) => setTimeout(resolve, window.__startDelay));
        if (window.__boox.pendingStart === start) {
          window.__boox.pendingStart = null;
          window.__boox.starting = false;
          window.__boox.region = options.region;
        }
      } else if (['setWidth', 'setRegion', 'pause', 'resume', 'refresh'].includes(method) && window.__boox.starting) {
        throw new Error('The BOOX pen isn\'t started.');
      }
      if (method === 'setRegion') window.__boox.region = options.region;
      if (method === 'stop') window.__boox.region = null;
      return method === 'status' ? { onyx: true, active: false } : undefined;
    },
    nativeCallback(plugin, method, options, callback) {
      const id = String(nextId++);
      if (method === 'addListener') {
        const list = listeners.get(options.eventName) ?? [];
        list.push(callback);
        listeners.set(options.eventName, list);
      }
      return Promise.resolve(id);
    },
  };
}
