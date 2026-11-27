import "obsidian";

declare global {
  const TurndownService: typeof import("turndown").default;

  interface Window {
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      o?: DomElementInfo | string,
      callback?: (el: HTMLElementTagNameMap[K]) => void,
    ): HTMLElementTagNameMap[K];
    createDiv(
      o?: DomElementInfo | string,
      callback?: (el: HTMLDivElement) => void,
    ): HTMLDivElement;
    createSpan(
      o?: DomElementInfo | string,
      callback?: (el: HTMLSpanElement) => void,
    ): HTMLSpanElement;
    createFragment(callback?: (el: DocumentFragment) => void): DocumentFragment;
  }
}

declare module "obsidian" {
  interface Notice {
    addButton(text: string, callback: (evt: MouseEvent) => void): this;
    buttonContainerEl: HTMLElement | null;
  }
  interface FileSystemAdapter {
    reconcileInternalFile(normalizedPath: string): Promise<void>;
  }
  interface MarkdownPostProcessorContext {
    replaceCode?: (code: string) => void;
  }
  interface ViewStateResult {
    done?: () => void;
  }
  interface WorkspaceLeaf {
    updateHeader(): void;
    recordHistory(state: unknown): void;
    id: string;
    group: string | null;
    pinned: boolean;
    _empty?: EmptyView;
  }
  interface EmptyView {
    getViewType(): string;
    actionListEl: HTMLElement;
    onOpen(): Promise<void>;
  }
  interface PlatformInternals {
    hasPhysicalKeyboard: boolean;
  }
  interface PopoverSuggest<T> {
    suggestEl: HTMLElement;
    suggestions?: {
      forceSetSelectedItem?(at: number, event: Event | null): void;
    };
  }
  interface ItemView {
    titleEl: HTMLElement;
  }
  interface WorkspaceContainer {
    focus(): void;
  }
  interface TextFileView {
    dirty: boolean;
    lastSavedData: string | null;
    loadFileInternal(file: TFile, clear: boolean): Promise<void>;
  }
  interface FileView {
    allowNoFile: boolean;
  }
  interface Vault {
    getConfig(key: "readableLineLength"): boolean;
    getAbstractFileByPathInsensitive(path: string): TAbstractFile | null;
  }
  interface Workspace {
    hoverLinkSources: Record<string, HoverLinkSource>;
    requestActiveLeafEvents: { run(): void };
    getActiveFileView(): FileView | null;
    readWorkspaceFile?(): Promise<unknown>;

    on<E extends import("../menu-events.ts").ZotLitMenuEvent>(
      name: E,
      callback: (
        menu: Menu,
        info: import("../menu-events.ts").ZotLitMenuEvents[E],
      ) => any,
      ctx?: any,
    ): EventRef;

    on(
      name: "quick-preview",
      callback: (file: TFile, source: string) => void,
      ctx?: any,
    ): EventRef;
  }
  interface MetadataCache {
    onCleanCache(callback: () => void): void;
    getCachedFiles?(): string[];
    getFrontmatterPropertyValuesForKey?(key: string): string[];
    getTags?(): Record<string, number>;
  }
  interface App {
    viewRegistry?: {
      getViewCreatorByType(
        type: string,
      ): ((leaf: WorkspaceLeaf) => View) | undefined;
    };
    embedRegistry?: Partial<EmbedRegistry>;
    metadataTypeManager?: Partial<MetadataTypeManager>;
  }
  interface MetadataTypeManager {
    getAssignedWidget(name: string): string | null;
    on(event: "changed", callback: (name: string) => void): EventRef;
    offref(ref: EventRef): void;
  }
  interface EmbedRegistry {
    registerExtension(extension: string, creator: EmbedCreator): void;
    unregisterExtension(extension: string): void;
    isExtensionRegistered(extension: string): boolean;
  }
  interface EmbedContext {
    app: App;
    containerEl: HTMLElement;
    linktext: string;
    sourcePath: string;
    depth: number;
    displayMode?: boolean;
  }
  interface EmbedComponent extends Component {
    loadFile(): Promise<void> | void;
  }
  type EmbedCreator = (
    context: EmbedContext,
    file: TFile,
    subpath: string,
  ) => EmbedComponent | null;
  interface GraphView extends ItemView {
    onOptionsChange?(): void;
    renderer?: GraphRenderer;
    dataEngine?: GraphEngine;
  }
  interface LocalGraphView extends FileView {
    renderer?: GraphRenderer;
    engine?: GraphEngine;
  }
  interface GraphEngine {
    app?: App;
    render?(): unknown;
    options?: GraphOptions;
    filterOptions?: GraphControlSection;
    colorGroupOptions?: GraphColorGroupSection;
    displayOptions?: GraphControlSection;
    setOptions?(options: GraphOptions): void;
    getOptions?(): GraphOptions;
    onOptionsChange?(): void;
    hoverPopover?: HoverPopover | null;
  }
  type GraphOptions = Record<string, unknown>;
  interface GraphControlSection {
    childrenEl: HTMLElement;
    optionListeners: Record<string, GraphOptionListener>;
    setDefaultOptions(): void;
  }
  interface GraphColorGroupSection {
    childrenEl: HTMLElement;
    getColoredQueries(): GraphColorGroup[];
    setColorQueries(queries: GraphColorGroup[]): void;
  }
  interface GraphColorGroup {
    query: string;
    color: GraphColor | null;
  }
  type GraphOptionListener = (value?: any) => any;
  interface GraphRenderer {
    nodes?: GraphDrawnNode[];
    onNodeClick?: GraphNodeCallback;
    onNodeRightClick?: GraphNodeCallback;
    setData?(data: GraphData): void;
    onNodeHover?: GraphNodeCallback;
    onNodeUnhover?: () => void;
    changed?(): void;
    containerEl?: HTMLElement;
    nodeLookup?: Record<string, { x: number; y: number } | undefined>;
    scale?: number;
    fTextShowMult?: number;
    panX?: number;
    panY?: number;
    links?: GraphLink[];
    getHighlightNode?(): GraphDrawnNode | null;
  }
  interface GraphLink {
    source: GraphDrawnNode;
    target: GraphDrawnNode;
    line?: GraphLinkSprite | null;
  }
  interface GraphDrawnNode {
    id: string;
    initGraphics?(): boolean;
    clearGraphics?(): void;
    getTextStyle?(): GraphTextStyle;
    text?: GraphTextDisplay | null;
  }
  interface GraphTextStyle {
    fontFamily: string | string[];
    fontSize: number;
    fontWeight?: string;
    fill: number | string;
    wordWrap?: boolean;
    align?: string;
  }
  interface GraphTextDisplay {
    x: number;
    y: number;
    alpha: number;
    visible: boolean;
    zIndex: number;
    eventMode: string;
    scale: { x: number; y: number; set(x: number, y?: number): void };
    parent: GraphTextContainer | null;
    destroy(options?: object): void;
    style?: GraphTextStyle;
  }
  interface GraphTextContainer extends GraphTextDisplay {
    updateTransform?(): void;
    addChild(child: GraphTextDisplay): unknown;
    removeChild(child: GraphTextDisplay): unknown;
  }
  interface GraphLinkSprite {
    tint: number;
  }
  type GraphNodeCallback = (evt: MouseEvent, id: string, type: string) => void;
  interface GraphData {
    nodes: Record<string, GraphDataNode>;
  }
  interface GraphDataNode {
    type: string;
    color?: GraphColor | null;
  }
  interface GraphColor {
    a: number;
    rgb: number;
  }

  interface App {
    appId: string;
    plugins: {
      plugins: Record<string, unknown>;
      manifests: Record<string, PluginManifest>;
      on(name: "changed", callback: () => unknown): EventRef;
      offref(ref: EventRef): void;
    };
    internalPlugins: {
      getEnabledPluginById(id: string): unknown;
    };
    setting: SettingsModal;
    commands: {
      executeCommandById(id: string): boolean;
      editorCommands: Record<string, Command>;
    };
    hotkeyManager: {
      getHotkeys(id: string): ExtendedHotkey[] | undefined;
      getDefaultHotkeys(id: string): ExtendedHotkey[] | undefined;
      printHotkeyForCommand(id: string): string;
    };
  }
  interface ExtendedHotkey extends Hotkey {
    code?: string;
  }

  interface SettingsModal extends Modal {
    activeTab: SettingTab | null;
    searchIndex: SettingsSearchIndex;
    openTabById(id: string): SettingTab | null;
    openTab(tab: SettingTab): void;
    removeSettingTab(tab: SettingTab): void;
    navigateToSearchResult(
      group: Pick<SettingsSearchGroup, "tab" | "pagePath">,
      result?: Pick<SettingsSearchResult, "entry">,
    ): void;
    scrollToDefinition(tab: SettingTab, definition: SettingDefinition): void;
  }

  interface SettingsSearchIndex {
    tabs: SettingTab[];
    getEntries(): SettingsSearchEntry[];
    search(query: string): SettingsSearchGroup[];
  }

  interface SettingsSearchEntry {
    tab: SettingTab;
    definition: SettingDefinition;
    page?: SettingDefinitionPage;
    pagePath: string[];
  }

  interface SettingsSearchGroup {
    tab: SettingTab;
    page?: SettingDefinitionPage;
    pagePath: string[];
    tabNameMatch: SearchResult | null;
    results: SettingsSearchResult[];
    bestScore: number;
  }

  interface SettingsSearchResult {
    entry: SettingsSearchEntry;
    nameMatch: SearchResult | null;
    descMatch: SearchResult | null;
    score: number;
    matches: SearchMatches;
  }

  interface SettingDefinitionBase {
    id: string;
  }
  interface SettingDefinitionGroup {
    id: string;
  }
  interface SettingDefinitionPage {
    id: string;
  }

  interface SettingTab {
    id: string;
    name: string;
  }

  interface ClickableToken {
    type: string;
    text: string;
    start: EditorPosition;
    end: EditorPosition;
  }
  interface Editor {
    getClickableTokenAt(pos: EditorPosition): ClickableToken | null;
    cm: import("@codemirror/view").EditorView;
  }
  interface MarkdownView {
    editMode?: MarkdownEditView;
  }
  interface MarkdownEditView {
    triggerClickableToken(
      token: ClickableToken,
      newLeaf: boolean | PaneType,
    ): void;
  }
  interface MenuItem {
    setSubmenu(): Menu;
  }
  interface Menu {
    addSections(sections: readonly string[]): this;
    scope: Scope;
  }
  interface EditorSuggest<T> {
    suggestions: { useSelectedItem(evt: KeyboardEvent | MouseEvent): void };
  }
  enum PopoverState {
    Showing = 0,
    Shown = 1,
    Hiding = 2,
    Hidden = 3,
  }
  interface HoverPopover {
    targetEl: HTMLElement | null;
    onTarget: boolean;
    isFocused: boolean;
    setIsFocused(focused: boolean): void;
    timer: number;
    onMouseIn: (event: MouseEvent) => void;
    onMouseOut: (event: MouseEvent) => void;
    transition(): void;
    show(): void;
    position(): void;
    hide(): void;
    watchResize(el: HTMLElement): void;
    staticPos: Point | null;
  }
}
