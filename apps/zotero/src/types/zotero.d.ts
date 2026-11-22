declare global {
  const __DEV__: boolean;

  namespace Zotero {
    namespace Profile {
      const dir: string;
    }
  }

  namespace _ZoteroTypes {
    namespace Reader {
      interface InternalReader<T extends keyof ViewTypeMap> {
        _updateState(
          state: Partial<InternalReader<T>["_state"]>,
          init?: boolean,
        ): void;
      }
    }

    namespace MenuManager {
      interface LibraryMenuContext {
        collectionTreeRows?: Zotero.CollectionTreeRow[];
      }

      interface BaseMenuContext {
        setL10nArgs(l10nArgs: string): void;
      }
    }
  }

  interface nsIWindowMediator {
    getEnumerator(aWindowType: null): nsISimpleEnumerator;
    getMostRecentWindow(aWindowType: null): mozIDOMWindowProxy;
  }

  interface Window {
    readonly MozXULElement: {
      insertFTLIfNeeded(path: string): void;
    };
  }

  const Services: {
    console: {
      logStringMessage(message: string): void;
    };
    wm: nsIWindowMediator;
    focus: nsIFocusManager;
    scriptloader: {
      loadSubScript(url: string, targetObj?: object, charset?: string): void;
    };
  };
}

export {};
