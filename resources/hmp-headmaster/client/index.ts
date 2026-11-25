declare const Imports: {
  get<T = any>(resourceName: string): T;
};

declare const Events: {
  on(eventName: string, handler: (...args: any[]) => void): void;
  emitServer(eventName: string, payload?: string): void;
};

declare const Web: {
  createView(url: string, opts?: { visible?: boolean; focus?: boolean; zIndex?: number }): number;
  destroyView(viewId: number): void;
  showView(viewId: number): void;
  hideView(viewId: number): void;
  focusView(viewId: number): void;
  on(viewId: number, eventName: string, handler: (...args: any[]) => void): void;
  emit(viewId: number, eventName: string, payload?: unknown): void;
};

const RESOURCE_NAME = "hmp-headmaster";
const VIEW_URL = `fw://resources/${RESOURCE_NAME}/ui/index.html`;

const HmpLib = Imports.get<any>("hmp-lib");
const Input = HmpLib?.input;

let view = -1;
let pageReady = false;
let isOpen = false;
let pendingOpenPayload: unknown = null;
let panelLease: { release(): boolean } | null = null;
let freezeLease: { release(): boolean } | null = null;

function parsePayload<T>(raw: unknown): T | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as T;
  return null;
}

function setPanelControls(locked: boolean): void {
  if (locked && !panelLease) {
    panelLease = Input?.controls?.acquire({ resource: RESOURCE_NAME, id: "panel" }) ?? null;
  } else if (!locked && panelLease) {
    try { panelLease.release(); } catch {}
    panelLease = null;
  }
}

function setFreezeControls(frozen: boolean): void {
  if (frozen && !freezeLease) {
    freezeLease = Input?.controls?.acquire({ resource: RESOURCE_NAME, id: "freeze" }) ?? null;
  } else if (!frozen && freezeLease) {
    try { freezeLease.release(); } catch {}
    freezeLease = null;
  }
}

function flushPendingOpen(): void {
  if (view < 0 || !pageReady || !pendingOpenPayload) return;
  const payload = pendingOpenPayload;
  pendingOpenPayload = null;
  isOpen = true;
  setPanelControls(true);
  Web.showView(view);
  Web.focusView(view);
  Web.emit(view, "open", payload);
}

function closePanel(): void {
  isOpen = false;
  pendingOpenPayload = null;
  if (view >= 0) {
    try { Web.hideView(view); } catch {}
  }
  setPanelControls(false);
}

function wireView(viewId: number): void {
  Web.on(viewId, "ready", () => {
    pageReady = true;
    flushPendingOpen();
  });

  Web.on(viewId, "action", (raw: unknown) => {
    const data = parsePayload<{ action: string; payload?: Record<string, unknown> }>(raw);
    if (!data?.action) return;
    Events.emitServer("hmp-headmaster:server:action", JSON.stringify(data));
  });

  Web.on(viewId, "close", () => {
    closePanel();
  });
}

function ensureView(): number {
  if (view >= 0) return view;
  try {
    view = Web.createView(VIEW_URL, { visible: false, focus: false, zIndex: 260 });
  } catch (err) {
    console.warn(`[${RESOURCE_NAME}] Web.createView failed: ${String(err)}`);
    view = -1;
  }
  if (view >= 0) {
    pageReady = false;
    wireView(view);
  }
  return view;
}

Events.on("hmp-headmaster:client:open", (raw: unknown) => {
  const payload = parsePayload(raw);
  if (!payload) return;
  pendingOpenPayload = payload;
  const id = ensureView();
  if (id < 0) return;

  if (pageReady) {
    flushPendingOpen();
  } else {
    isOpen = true;
    setPanelControls(true);
    Web.showView(id);
    Web.focusView(id);
  }
});

Events.on("hmp-headmaster:client:state", (raw: unknown) => {
  const payload = parsePayload(raw);
  if (view < 0 || !payload) return;
  Web.emit(view, "state", payload);
});

Events.on("hmp-headmaster:client:freeze", (raw: unknown) => {
  const payload = parsePayload<{ frozen: boolean }>(raw);
  if (!payload) return;
  setFreezeControls(Boolean(payload.frozen));
});

// Optional shortcut registration via hmp-lib shortcuts if available
try {
  const shortcutKey = "F6";
  if (shortcutKey && typeof HmpLib?.shortcuts?.register === "function") {
    HmpLib.shortcuts.register({
      resource: RESOURCE_NAME,
      id: "toggle-panel",
      key: shortcutKey,
      onPress: () => {
        if (isOpen) {
          closePanel();
        } else {
          Events.emitServer("hmp-headmaster:server:requestOpen", "{}");
        }
      },
    });
  }
} catch {
  // Chat commands /headmaster and /hm always remain available
}

Events.on("resourceStop", (name?: string) => {
  if (!name || name === RESOURCE_NAME) {
    closePanel();
    setFreezeControls(false);
    if (view >= 0) {
      try { Web.destroyView(view); } catch {}
      view = -1;
      pageReady = false;
    }
  }
});

ensureView();
console.info(`[${RESOURCE_NAME}] client ready`);
