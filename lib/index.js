// dsh-simple-memory — Host half (skeleton)
// Feature development happens as a dynamic Cordis plugin first;
// the verified implementation lands here as a static bundle.
export default {
  apply(ctx) {
    ctx.on('ready', () => {
      console.log('[dsh-simple-memory] host loaded (skeleton)')
    })
  },
}
