/*!
 * @name Test Source
 * @description Local bridge test
 * @version 1.0.0
 * @author Codex
 */
lx.on(lx.EVENT_NAMES.request, async ({ source, action, info }) => {
  if (action !== 'musicUrl') throw new Error('unsupported')
  return `https://example.com/${source}/${info.type}.mp3`
})
lx.send(lx.EVENT_NAMES.inited, {
  sources: {
    tx: { type: 'music', actions: ['musicUrl'], qualitys: ['128k', '320k', 'flac'] },
    wy: { type: 'music', actions: ['musicUrl'], qualitys: ['128k', '320k', 'flac'] },
  },
})
