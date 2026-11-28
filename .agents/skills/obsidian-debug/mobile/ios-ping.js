(async () => ({
  vault: app.vault.getName(),
  visibility: document.visibilityState,
  timeOrigin: performance.timeOrigin,
  plugins: Object.keys(app.plugins.plugins),
}))()
