(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  app.setting.open();
  app.setting.openTabById("about");
  await sleep(600);
  const button = [...document.querySelectorAll(".modal .clickable-icon, .modal .extra-setting-button")].find((b) => b.querySelector("svg.lucide-timer"));
  if (!button) {
    app.setting.close();
    return "no Startup time button in Settings → General";
  }
  button.click();
  await sleep(800);
  const modal = [...document.querySelectorAll(".modal.mod-plugin-debug")].pop();
  for (const item of modal ? [...modal.querySelectorAll(".tree-item-self")] : []) {
    if (/Community plugins/.test(item.innerText)) {
      item.click();
      await sleep(200);
    }
  }
  const text = (modal?.innerText ?? "no Startup time modal").replace(/\n(\d)/g, " $1");
  modal?.querySelector(".modal-close-button")?.click();
  app.setting.close();
  return text;
})()
