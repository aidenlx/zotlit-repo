(async () => {
  const probe = async () => {
    const root = await navigator.storage.getDirectory();
    const names = [];
    for await (const [name, handle] of root.entries()) names.push(name + ":" + handle.kind);
    return { opfs: names, syncAccess: "createSyncAccessHandle" in FileSystemFileHandle.prototype };
  };
  const vaultPath = null;

  const text = vaultPath
    ? await app.vault.adapter.read(vaultPath)
    : "onmessage = async () => { try { postMessage({ value: await (" + probe + ")() }); }" +
      " catch (e) { postMessage({ error: e.name + ': ' + e.message }); } };";
  const worker = new Worker(URL.createObjectURL(new Blob([text], { type: "text/javascript" })));
  const events = [];
  worker.addEventListener("error", (e) =>
    events.push({ message: e.message, line: e.lineno, column: e.colno }),
  );
  const answer = await new Promise((resolve) => {
    worker.onmessage = (e) => resolve(e.data);
    worker.postMessage(1);
    setTimeout(() => resolve({ noMessage: true }), 10000);
  });
  worker.terminate();
  return { answer, errorEvents: events };
})()
