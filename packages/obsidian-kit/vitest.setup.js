globalThis.window ??= globalThis;
globalThis.activeWindow ??= globalThis;
globalThis.activeDocument ??= globalThis.document;

globalThis.createEl ??= (tag, o, callback) => {
  const el = document.createElement(tag);
  const info = typeof o === "string" ? { cls: o } : (o ?? {});
  if (info.cls !== undefined) {
    el.className = Array.isArray(info.cls) ? info.cls.join(" ") : info.cls;
  }
  if (info.text !== undefined) {
    if (typeof info.text === "string") el.textContent = info.text;
    else el.append(info.text);
  }
  if (info.attr) {
    for (const [name, value] of Object.entries(info.attr)) {
      if (value === null) el.removeAttribute(name);
      else el.setAttribute(name, String(value));
    }
  }
  if (info.title !== undefined) el.title = info.title;
  if (
    info.value !== undefined &&
    (el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLOptionElement)
  ) {
    el.value = info.value;
  }
  if (info.type !== undefined && el instanceof HTMLInputElement) {
    el.type = info.type;
  }
  if (info.placeholder !== undefined && el instanceof HTMLInputElement) {
    el.placeholder = info.placeholder;
  }
  if (
    info.href !== undefined &&
    (el instanceof HTMLAnchorElement || el instanceof HTMLLinkElement)
  ) {
    el.href = info.href;
  }
  callback?.(el);
  if (info.parent) {
    if (info.prepend) info.parent.insertBefore(el, info.parent.firstChild);
    else info.parent.appendChild(el);
  }
  return el;
};
globalThis.createDiv ??= (o, callback) =>
  globalThis.createEl("div", o, callback);
globalThis.createSpan ??= (o, callback) =>
  globalThis.createEl("span", o, callback);
globalThis.createFragment ??= (callback) => {
  const fragment = document.createDocumentFragment();
  callback?.(fragment);
  return fragment;
};

if (typeof Window !== "undefined") {
  const winProto = Window.prototype;
  winProto.createEl ??= globalThis.createEl;
  winProto.createDiv ??= globalThis.createDiv;
  winProto.createSpan ??= globalThis.createSpan;
  winProto.createFragment ??= globalThis.createFragment;
}

if (typeof Node !== "undefined") {
  const proto = Node.prototype;
  proto.instanceOf ??= function (type) {
    const localType = this.win?.[type.name];
    return (
      (typeof localType === "function" && this instanceof localType) ||
      this instanceof type
    );
  };
  if (!Object.getOwnPropertyDescriptor(proto, "doc")) {
    Object.defineProperty(proto, "doc", {
      configurable: true,
      get() {
        return this.ownerDocument ?? document;
      },
    });
  }
  if (!Object.getOwnPropertyDescriptor(proto, "win")) {
    Object.defineProperty(proto, "win", {
      configurable: true,
      get() {
        return this.doc.defaultView ?? window;
      },
    });
  }
  proto.createEl ??= function (tag, o, callback) {
    const info = typeof o === "string" ? { cls: o } : (o ?? {});
    return globalThis.createEl(tag, { ...info, parent: this }, callback);
  };
  proto.createDiv ??= function (o, callback) {
    return proto.createEl.call(this, "div", o, callback);
  };
  proto.createSpan ??= function (o, callback) {
    return proto.createEl.call(this, "span", o, callback);
  };
  proto.setText ??= function (val) {
    if (typeof val === "string") this.textContent = val;
    else {
      this.textContent = "";
      this.append(val);
    }
  };
}

if (typeof Element !== "undefined") {
  const proto = Element.prototype;
  proto.addClass ??= function (...classes) {
    this.classList.add(...classes);
  };
  proto.addClasses ??= function (classes) {
    this.classList.add(...classes);
  };
  proto.removeClass ??= function (...classes) {
    this.classList.remove(...classes);
  };
  proto.toggleClass ??= function (classes, value) {
    for (const cls of Array.isArray(classes) ? classes : [classes])
      this.classList.toggle(cls, value);
  };
  proto.hasClass ??= function (cls) {
    return this.classList.contains(cls);
  };
  proto.empty ??= function () {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
  proto.setAttr ??= function (name, value) {
    if (value === null) this.removeAttribute(name);
    else this.setAttribute(name, String(value));
  };
}

if (typeof HTMLElement !== "undefined") {
  HTMLElement.prototype.onWindowMigrated ??= () => () => {};
  HTMLElement.prototype.toggle ??= function (visible) {
    this.style.display = visible ? "" : "none";
  };
  HTMLElement.prototype.isShown ??= function () {
    for (let el = this; el; el = el.parentElement)
      if (el.style.display === "none") return false;
    return true;
  };
  HTMLElement.prototype.setCssProps ??= function (props) {
    for (const [name, value] of Object.entries(props))
      this.style.setProperty(name, value);
  };
}

globalThis.requestIdleCallback ??= (callback) =>
  setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 0);
globalThis.cancelIdleCallback ??= (handle) => clearTimeout(handle);

if (globalThis.document && !globalThis.document.fonts)
  Object.defineProperty(globalThis.document, "fonts", {
    value: new EventTarget(),
    configurable: true,
  });
