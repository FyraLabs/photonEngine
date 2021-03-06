import { EventEmitter } from "tsee";
import { EngineTab, EngineTabOptions } from "../models/tab";
import { EngineWindow, Offset } from "../models/window";

export interface EngineTabManagerOptions {
  window: EngineWindow;
}

export class EngineTabManager extends EventEmitter<{
  tabAdded: (tab: EngineTab, index: number) => void;
  tabRemoved: (tab: EngineTab, index: number) => void;
  activeTabChanged: (tab: EngineTab, index: number) => void;
}> {
  #tabs: EngineTab[] = [];
  #window: EngineWindow;
  #changeOffsetHandler: (offset: Offset) => void;

  constructor(options: EngineTabManagerOptions) {
    super();

    this.#window = options.window;
    this.#changeOffsetHandler = (offset: Offset) =>
      this.handleChangeOffset(offset);
    this.#window.on("offsetChanged", this.#changeOffsetHandler);
  }

  calculateBounds(offset: Offset) {
    const bounds = this.#window.browserWindow.getBounds();
    return {
      x: offset.left,
      y: offset.top,
      width: bounds.width - offset.left - offset.right,
      height: bounds.height - offset.top - offset.bottom,
    };
  }

  private handleChangeOffset = (offset: Offset) => {
    const bounds = this.calculateBounds(offset);
    this.#tabs.forEach((t) => t.browserView.setBounds(bounds));
  };

  // NOTE: Stupid affine type hack FTW!
  close() {
    this.#window.off("offsetChanged", this.#changeOffsetHandler);
  }

  hasTab(tab: string | EngineTab) {
    return !!(typeof tab === "string"
      ? this.#tabs.find(({ id }) => id === tab)
      : this.#tabs.find(
          (t) => tab.browserView.webContents.id === t.browserView.webContents.id
        ));
  }

  getTabFromIndex(index: number) {
    return this.#tabs[index];
  }

  getTabIndex(id: string) {
    return this.#tabs.findIndex((tab) => tab.id === id);
  }

  getTab(id: string) {
    return this.#tabs.find((tab) => tab.id === id);
  }

  get length() {
    return this.#tabs.length;
  }

  get tabs() {
    return this.#tabs;
  }

  setActiveTab(tab: string | EngineTab) {
    if (!this.hasTab(tab)) throw new Error("Tab not in tab manager");
    const newActiveTab = typeof tab === "string" ? this.getTab(tab) : tab;

    if (!newActiveTab) throw new Error("Tab not in tab manager");

    if (this.activeTab?.browserView)
      this.#window.browserWindow.removeBrowserView(this.activeTab?.browserView);
    this.#window.browserWindow.addBrowserView(newActiveTab.browserView);
    newActiveTab.browserView.setBounds(
      this.calculateBounds(this.#window.offset)
    );
    newActiveTab.browserView.webContents.focus();

    this.emit(
      "activeTabChanged",
      newActiveTab,
      this.getTabIndex(newActiveTab.id)
    );
  }

  get window() {
    return this.#window;
  }

  get activeTab() {
    const activeViews = this.#window.browserWindow.getBrowserViews();
    if (activeViews.length === 0) return;

    const activeIDs = activeViews.map((view) => view.webContents.id);

    return this.#tabs.find((t) =>
      activeIDs.includes(t.browserView.webContents.id)
    );
  }

  createTab(
    options: Omit<EngineTabOptions, "bounds" | "tabManager"> & {
      at?: number;
      active: boolean;
      webpage: { file: string } | { url: string };
    }
  ) {
    const tab = new EngineTab({
      ...options,
      tabManager: this,
    });

    if ("file" in options.webpage)
      tab.browserView.webContents.loadFile(options.webpage.file);
    else tab.browserView.webContents.loadURL(options.webpage.url);

    if (options.at) {
      this.#tabs.splice(options.at, 0, tab);
    } else {
      this.#tabs.push(tab);
    }

    const index = options.at || this.#tabs.length - 1;
    this.emit("tabAdded", tab, index);
    if (options.active) this.setActiveTab(this.#tabs[index]);

    return {
      index,
      tab,
    };
  }

  deleteTab(tab: string | EngineTab) {
    if (!this.hasTab(tab)) throw new Error("Tab not in tab manager");

    const index =
      typeof tab === "string" ? this.getTabIndex(tab) : this.#tabs.indexOf(tab);
    const resolvedTab = typeof tab === "string" ? this.getTab(tab)! : tab;

    if (this.activeTab === resolvedTab) {
      const nextActiveTab = this.#tabs[index - 1] || this.#tabs[index + 1];
      if (!nextActiveTab)
        this.#window.browserWindow.removeBrowserView(resolvedTab.browserView);
      else this.setActiveTab(nextActiveTab);
    }

    this.#tabs.splice(index, 1);
    resolvedTab.destroy();
    this.emit("tabRemoved", resolvedTab, index);

    // NOTE: I don't see a way to manually destroy the webcontents, maybe it's destroyed on GC?
  }
}
