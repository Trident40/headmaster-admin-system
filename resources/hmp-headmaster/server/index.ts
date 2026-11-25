import fs from "node:fs";
import path from "node:path";

declare const Imports: {
  get<T = any>(resourceName: string): T;
};

declare const Exports: {
  register(name: string, api: Record<string, unknown>): void;
};

declare const Events: {
  on(eventName: string, handler: (...args: any[]) => void): void;
  onClient(eventName: string, handler: (player: AdminPlayer, ...args: any[]) => void): void;
};

declare const PlayerManager: {
  getAll(): AdminPlayer[];
  getById?(id: number): AdminPlayer | undefined;
};

declare const InventoryCatalog:
  | {
      list?(filter?: { inventoryable?: boolean }): Array<{
        itemId: string;
        itemType?: string;
        kind?: string;
        holder?: string;
      }>;
    }
  | undefined;

type AdminRole = "root" | "headmaster" | "professor" | "prefect";
type HouseId = "gryffindor" | "slytherin" | "ravenclaw" | "hufflepuff";

interface AdminPlayerInventory {
  list?(): Array<{ itemId?: string; id?: string; amount?: number; equipped?: boolean }>;
  has?(itemId: string, amount?: number): boolean;
  give?(
    itemId: string,
    amount: number,
    options: { identified?: boolean; unique?: boolean; variation?: string },
    cb: (err: unknown, result: { revision: number } | null) => void
  ): void;
  patch?(
    ops: Array<Record<string, unknown>>,
    options: Record<string, unknown>,
    cb: (err: unknown, result: { revision: number } | null) => void
  ): void;
  waitForRevision?(revision: number): Promise<unknown>;
}

interface AdminPlayer {
  id: number;
  nickname?: string;
  discordId?: string;
  steamId?: string;
  ping?: number;
  virtualWorld?: number;
  health?: number;
  maxHealth?: number;
  dead?: boolean;
  position?: { x: number; y: number; z: number };
  inventory?: AdminPlayerInventory;
  emit?(eventName: string, payload?: string): void;
  sendChat?(message: string): void;
  kick?(reason?: string): void;
  revive?(): boolean;
  teleport?(
    x: number,
    y: number,
    z: number,
    options?: { snapToGround?: boolean; groundSnapDistance?: number }
  ): number;
  hold?(options: {
    owner: string;
    x: number;
    y: number;
    z: number;
    radius: number;
    radiusZ: number;
    mode: string;
  }): boolean;
  releaseHold?(owner: string): boolean;
}

interface StaffRecord {
  discordId: string;
  label: string;
  role: AdminRole;
  addedAt: string;
  addedBy?: string;
  immutable?: boolean;
}

interface BanRecord {
  id: string;
  discordId: string;
  playerName: string;
  reason: string;
  bannedBy: string;
  bannedByDiscordId: string;
  createdAt: string;
  expiresAtMs: number | null;
}

interface AuditRecord {
  id: string;
  timestamp: string;
  actorName: string;
  actorDiscordId: string;
  category: "player" | "houses" | "spells" | "world" | "staff";
  action: string;
  target: string;
  details: string;
}

interface RuntimeConfig {
  $schema?: string;
  enabled: boolean;
  commands: { primary: string; short: string };
  openHotkey: string;
  rootAdminDiscordIds: string[];
  syncCoreAdminGroup: boolean;
  broadcastHousePoints: boolean;
  announceGlobalBans: boolean;
  auditRetentionLimit: number;
  seedStaff: Array<{ discordId: string; label: string; role: AdminRole }>;
  landmarks: Array<{ id: string; name: string; region: string; x: number; y: number; z: number }>;
  spellPacks: Array<{ id: string; name: string; description: string; spells: string[] }>;
  quickGearItems: Array<{ id: string; label: string }>;
  brooms?: Array<{ id: string; label: string }>;
  weatherProfiles: string[];
  seasons: string[];
}

const RESOURCE_NAME = "hmp-headmaster";
const FREEZE_HOLD_OWNER = `${RESOURCE_NAME}:freeze`;

const ROLE_GRADE: Record<AdminRole, number> = {
  prefect: 1,
  professor: 2,
  headmaster: 3,
  root: 4,
};

const HOUSES: HouseId[] = ["gryffindor", "slytherin", "ravenclaw", "hufflepuff"];

function safeImport(name: string): any {
  try {
    return Imports.get<any>(name);
  } catch {
    return null;
  }
}

const Hmp = safeImport("hmp-lib");
const Core = safeImport("hmp-core");
const Houses = safeImport("hmp-houses");
const Sorting = safeImport("hmp-sorting");
const Spells = safeImport("hmp-spells");
const Inventory = safeImport("hmp-inventory");
const Banking = safeImport("hmp-banking");
const World = safeImport("hmp-world");
const Pvp = safeImport("hmp-pvp");
const ScrollNotify = safeImport("dg-notify") || safeImport("hmp-notify");
const UI = safeImport("hmp-ui");
const HmpAdmin = safeImport("hmp-admin");

const logger = Hmp?.logger?.create
  ? Hmp.logger.create(RESOURCE_NAME)
  : {
      info: (msg: string) => console.log(`[${RESOURCE_NAME}] ${msg}`),
      warn: (msg: string) => console.warn(`[${RESOURCE_NAME}] ${msg}`),
      error: (msg: string) => console.error(`[${RESOURCE_NAME}] ${msg}`),
      debug: (msg: string) => console.debug(`[${RESOURCE_NAME}] ${msg}`),
    };

const DATA_DIR = path.resolve(process.cwd(), "data");
const CONFIG_PATH = path.join(DATA_DIR, `${RESOURCE_NAME}.json`);
const STAFF_STORE_PATH = path.join(DATA_DIR, `${RESOURCE_NAME}-staff.json`);
const BAN_STORE_PATH = path.join(DATA_DIR, `${RESOURCE_NAME}-bans.json`);
const AUDIT_STORE_PATH = path.join(DATA_DIR, `${RESOURCE_NAME}-audit.json`);

const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  "$schema": "https://github.com/arcane-mp/foundations/hmp-headmaster.schema.json",
  "enabled": true,
  "commands": {
    "primary": "headmaster",
    "short": "hm"
  },
  "openHotkey": "F6",
  "rootAdminDiscordIds": [],
  "syncCoreAdminGroup": true,
  "broadcastHousePoints": true,
  "announceGlobalBans": false,
  "auditRetentionLimit": 250,
  "seedStaff": [],
  "landmarks": [
    {
      "id": "great-hall",
      "name": "Great Hall Dais",
      "region": "Hogwarts Castle",
      "x": 367850,
      "y": -417920,
      "z": -80120
    },
    {
      "id": "central-hall",
      "name": "Central Hall Fountain",
      "region": "Hogwarts Castle",
      "x": 362110,
      "y": -414500,
      "z": -80840
    },
    {
      "id": "transfiguration-courtyard",
      "name": "Transfiguration Courtyard",
      "region": "Hogwarts Grounds",
      "x": 356420,
      "y": -410280,
      "z": -81420
    },
    {
      "id": "quidditch-pitch",
      "name": "Quidditch Pitch",
      "region": "Hogwarts Grounds",
      "x": 332800,
      "y": -435100,
      "z": -83200
    },
    {
      "id": "hogsmeade-square",
      "name": "Hogsmeade Town Square",
      "region": "Hogsmeade",
      "x": 421500,
      "y": -362400,
      "z": -82950
    },
    {
      "id": "forbidden-forest",
      "name": "Forbidden Forest Edge",
      "region": "Highlands",
      "x": 378200,
      "y": -372600,
      "z": -84600
    }
  ],
  "spellPacks": [
    {
      "id": "year-1",
      "name": "Year 1 Essentials",
      "description": "Lumos, Revelio, Reparo, Levioso, Accio, Wingardium Leviosa",
      "spells": [
        "Lumos",
        "Revelio",
        "Reparo",
        "Levioso",
        "Accio",
        "WingardiumLeviosa"
      ]
    },
    {
      "id": "dueling-club",
      "name": "Dueling Club Kit",
      "description": "Expelliarmus, Levioso, Accio, Depulso, Incendio, Confringo, Glacius",
      "spells": [
        "Expelliarmus",
        "Levioso",
        "Accio",
        "Depulso",
        "Incendio",
        "Confringo",
        "Glacius"
      ]
    },
    {
      "id": "owl-mastery",
      "name": "All Standard Spells",
      "description": "Every non-unforgivable utility, control, force, and damage spell",
      "spells": [
        "Lumos",
        "Revelio",
        "Reparo",
        "Disillusionment",
        "WingardiumLeviosa",
        "Alohomora",
        "Levioso",
        "Glacius",
        "ArrestoMomentum",
        "Transformation",
        "Accio",
        "Depulso",
        "Descendo",
        "Flipendo",
        "Incendio",
        "Expelliarmus",
        "Confringo",
        "Diffindo",
        "Bombarda"
      ]
    },
    {
      "id": "unforgivables",
      "name": "Unforgivable Curses",
      "description": "Crucio, Imperio, and Avada Kedavra (Restricted)",
      "spells": [
        "Crucio",
        "Imperio",
        "AvadaKedavra"
      ]
    }
  ],
  "quickGearItems": [
    {
      "id": "Back_001_Basic",
      "label": "House School Robe"
    },
    {
      "id": "Back_002_Rare",
      "label": "Prefect House Cloak"
    },
    {
      "id": "Outfit_002_Basic",
      "label": "Hogwarts Uniform"
    },
    {
      "id": "Head_034_Basic",
      "label": "Pointed Wizard Hat"
    }
  ],
  "brooms": [
    {
      "id": "native:broommoontrimmer",
      "label": "Moon Trimmer"
    },
    {
      "id": "native:broomyewweaver",
      "label": "Yew Weaver"
    },
    {
      "id": "native:broomwindwisp",
      "label": "Wind Wisp"
    },
    {
      "id": "native:broomemberdash",
      "label": "Ember Dash"
    },
    {
      "id": "native:broomlicketyswift",
      "label": "Lickety Swift"
    },
    {
      "id": "native:broombrightspark",
      "label": "Bright Spark"
    },
    {
      "id": "native:broomnightdancer",
      "label": "Night Dancer"
    },
    {
      "id": "native:broomwildfire",
      "label": "Wildfire"
    },
    {
      "id": "native:broomsilverarrow",
      "label": "Silver Arrow"
    }
  ],
  "weatherProfiles": [
    "Clear",
    "PartlyCloudy",
    "Overcast",
    "LightRain",
    "Rain",
    "Thunderstorm",
    "Fog",
    "LightSnow",
    "Snow",
    "Blizzard"
  ],
  "seasons": [
    "Spring",
    "Summer",
    "Autumn",
    "Winter"
  ]
};

function loadJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch (err) {
    logger.warn(`Could not parse ${filePath}: ${String(err)}`);
    return fallback;
  }
}

function saveJsonFile(filePath: string, value: unknown): void {
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
    logger.error(`Failed to persist ${filePath}: ${String(err)}`);
  }
}

function loadRuntimeConfig(): RuntimeConfig {
  const raw = loadJsonFile<Partial<RuntimeConfig>>(CONFIG_PATH, {});
  const safeRaw = raw && typeof raw === "object" ? raw : {};
  const mergedCommands = {
    primary: String(safeRaw.commands?.primary || DEFAULT_RUNTIME_CONFIG.commands.primary || "headmaster").trim(),
    short: String(safeRaw.commands?.short || DEFAULT_RUNTIME_CONFIG.commands.short || "hm").trim(),
  };
  return {
    enabled: safeRaw.enabled !== undefined ? Boolean(safeRaw.enabled) : DEFAULT_RUNTIME_CONFIG.enabled,
    commands: mergedCommands,
    openHotkey: String(safeRaw.openHotkey || DEFAULT_RUNTIME_CONFIG.openHotkey || "F6").trim(),
    rootAdminDiscordIds: Array.isArray(safeRaw.rootAdminDiscordIds)
      ? safeRaw.rootAdminDiscordIds.map((id) => String(id || "").trim()).filter((id) => isValidDiscordId(id))
      : DEFAULT_RUNTIME_CONFIG.rootAdminDiscordIds.filter((id) => isValidDiscordId(id)),
    syncCoreAdminGroup:
      safeRaw.syncCoreAdminGroup !== undefined
        ? Boolean(safeRaw.syncCoreAdminGroup)
        : DEFAULT_RUNTIME_CONFIG.syncCoreAdminGroup,
    broadcastHousePoints:
      safeRaw.broadcastHousePoints !== undefined
        ? Boolean(safeRaw.broadcastHousePoints)
        : DEFAULT_RUNTIME_CONFIG.broadcastHousePoints,
    announceGlobalBans:
      safeRaw.announceGlobalBans !== undefined
        ? Boolean(safeRaw.announceGlobalBans)
        : DEFAULT_RUNTIME_CONFIG.announceGlobalBans,
    auditRetentionLimit: Math.max(
      50,
      Math.min(5000, Math.trunc(Number(safeRaw.auditRetentionLimit ?? DEFAULT_RUNTIME_CONFIG.auditRetentionLimit) || 250))
    ),
    seedStaff: Array.isArray(safeRaw.seedStaff) ? safeRaw.seedStaff : DEFAULT_RUNTIME_CONFIG.seedStaff,
    landmarks: Array.isArray(safeRaw.landmarks) && safeRaw.landmarks.length ? safeRaw.landmarks : DEFAULT_RUNTIME_CONFIG.landmarks,
    spellPacks: Array.isArray(safeRaw.spellPacks) && safeRaw.spellPacks.length ? safeRaw.spellPacks : DEFAULT_RUNTIME_CONFIG.spellPacks,
    quickGearItems:
      Array.isArray(safeRaw.quickGearItems) && safeRaw.quickGearItems.length
        ? safeRaw.quickGearItems
        : DEFAULT_RUNTIME_CONFIG.quickGearItems,
    brooms: Array.isArray(safeRaw.brooms) && safeRaw.brooms.length ? safeRaw.brooms : DEFAULT_RUNTIME_CONFIG.brooms,
    weatherProfiles:
      Array.isArray(safeRaw.weatherProfiles) && safeRaw.weatherProfiles.length
        ? safeRaw.weatherProfiles
        : DEFAULT_RUNTIME_CONFIG.weatherProfiles,
    seasons: Array.isArray(safeRaw.seasons) && safeRaw.seasons.length ? safeRaw.seasons : DEFAULT_RUNTIME_CONFIG.seasons,
  };
}

function isValidDiscordId(value: string): boolean {
  return /^\d{17,20}$/.test(String(value || "").trim());
}

const config = loadRuntimeConfig();
const ROOT_DISCORD_IDS: readonly string[] = Object.freeze(
  Array.from(new Set(config.rootAdminDiscordIds.filter((id) => isValidDiscordId(id))))
);

const frozenPlayers = new Set<number>();
const warningCounts = new Map<string, number>();
let lethalPvpActive = false;
let seq = 0;

const staffMap = new Map<string, StaffRecord>();
let bans: BanRecord[] = (() => {
  const loaded = loadJsonFile<BanRecord[]>(BAN_STORE_PATH, []);
  return Array.isArray(loaded) ? loaded : [];
})();
let auditLog: AuditRecord[] = (() => {
  const loaded = loadJsonFile<AuditRecord[]>(AUDIT_STORE_PATH, []);
  return Array.isArray(loaded) ? loaded : [];
})();

function isRootAdmin(discordId: string): boolean {
  const clean = String(discordId || "").trim();
  return ROOT_DISCORD_IDS.includes(clean);
}

function hydrateStaffRoster(): void {
  staffMap.clear();
  for (let i = 0; i < ROOT_DISCORD_IDS.length; i += 1) {
    const rootId = ROOT_DISCORD_IDS[i];
    staffMap.set(rootId, {
      discordId: rootId,
      label: i === 0 ? "Server Owner (Root)" : "Co-Owner (Root)",
      role: "root",
      addedAt: "Config",
      immutable: true,
    });
  }

  for (const seed of config.seedStaff || []) {
    const id = String(seed?.discordId || "").trim();
    if (isValidDiscordId(id) && !staffMap.has(id)) {
      staffMap.set(id, {
        discordId: id,
        label: String(seed.label || "Staff").slice(0, 64),
        role: seed.role === "root" || !["headmaster", "professor", "prefect"].includes(seed.role) ? "headmaster" : seed.role,
        addedAt: "Config",
      });
    }
  }

  const persistedRaw = loadJsonFile<StaffRecord[]>(STAFF_STORE_PATH, []);
  const persisted = Array.isArray(persistedRaw) ? persistedRaw : [];
  for (const entry of persisted) {
    const id = String(entry?.discordId || "").trim();
    if (!isValidDiscordId(id) || isRootAdmin(id)) continue;
    staffMap.set(id, {
      discordId: id,
      label: String(entry.label || "Staff").slice(0, 64),
      role: entry.role === "root" || !["headmaster", "professor", "prefect"].includes(entry.role) ? "headmaster" : entry.role,
      addedAt: entry.addedAt || new Date().toISOString(),
      addedBy: entry.addedBy,
    });
  }
}

function persistStaffRoster(): void {
  const writable = Array.from(staffMap.values()).filter((s) => !s.immutable);
  saveJsonFile(STAFF_STORE_PATH, writable);
}

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

function sendClient(player: AdminPlayer, eventName: string, payload: unknown): void {
  if (typeof player?.emit === "function") {
    player.emit(eventName, JSON.stringify(payload));
  }
}

function notifyPlayer(
  player: AdminPlayer,
  title: string,
  description: string,
  tone: "info" | "success" | "warning" | "error" | "decree" | "house" | "magic" = "info",
  extra?: { house?: HouseId; sender?: string }
): void {
  try {
    const scrollApi = ScrollNotify || safeImport("dg-notify") || safeImport("hmp-notify");
    if (scrollApi?.notify) {
      void scrollApi.notify(player, {
        title,
        description,
        tone,
        house: extra?.house,
        sender: extra?.sender || "Office of the Headmaster",
      });
      return;
    }
  } catch {
    // Fallback to hmp-ui below
  }
  if (UI?.notify) {
    try {
      const uiTone = tone === "decree" || tone === "house" || tone === "magic" ? "info" : tone;
      UI.notify(player, { title, description, tone: uiTone });
      return;
    } catch {
      // Fallback to chat below
    }
  }
  player.sendChat?.(`[${title}] ${description}`);
}

/**
 * Resolves a player's Discord ID from either the live client identity property
 * (player.discordId) or hmp-core's remembered account identity links.
 */
async function resolveDiscordId(player: AdminPlayer): Promise<string | null> {
  const direct = String(player?.discordId ?? "").trim();
  if (isValidDiscordId(direct)) return direct;

  try {
    const session = Core?.sessions?.get?.(player);
    const accountId = session?.account?.id;
    if (accountId && typeof Core?.accounts?.identities === "function") {
      const links = (await Core.accounts.identities(accountId)) as Array<{
        provider?: string;
        subject?: string;
      }>;
      const discordLink = links?.find(
        (l) =>
          typeof l?.provider === "string" &&
          l.provider.toLowerCase().includes("discord") &&
          isValidDiscordId(String(l.subject ?? ""))
      );
      if (discordLink?.subject) return String(discordLink.subject).trim();
    }
  } catch {
    // Safe fallback if hmp-core session isn't ready yet
  }

  return null;
}

async function getStaffRecord(player: AdminPlayer): Promise<StaffRecord | null> {
  const discordId = await resolveDiscordId(player);
  if (!discordId) return null;
  if (isRootAdmin(discordId)) {
    return staffMap.get(discordId) ?? {
      discordId,
      label: "Server Owner (Root)",
      role: "root",
      addedAt: "Config",
      immutable: true,
    };
  }
  return staffMap.get(discordId) ?? null;
}

async function requireRole(
  player: AdminPlayer,
  minRole: AdminRole
): Promise<{ staff: StaffRecord; discordId: string }> {
  const staff = await getStaffRecord(player);
  if (!staff || ROLE_GRADE[staff.role] < ROLE_GRADE[minRole]) {
    throw new Error(`Requires ${minRole} permission or higher.`);
  }
  return { staff, discordId: staff.discordId };
}

async function syncCoreAdminGroupForPlayer(player: AdminPlayer): Promise<void> {
  if (!config.syncCoreAdminGroup || !Core?.sessions?.get || !Core?.groups?.setAccount) return;
  const staff = await getStaffRecord(player);
  if (!staff) return;
  try {
    const session = Core.sessions.get(player);
    const accountId = session?.account?.id;
    if (!accountId) return;
    await Core.groups.setAccount(accountId, "admin", ROLE_GRADE[staff.role], {
      source: RESOURCE_NAME,
    });
  } catch (err) {
    logger.debug?.(`Core admin group sync skipped for #${player.id}: ${String(err)}`);
  }
}

async function revokeCoreAdminGroupForDiscordId(targetDiscordId: string): Promise<void> {
  if (!config.syncCoreAdminGroup || !Core?.sessions?.get || !Core?.groups?.setAccount) return;
  for (const online of PlayerManager.getAll?.() ?? []) {
    try {
      const onlineDiscord = await resolveDiscordId(online);
      if (onlineDiscord !== targetDiscordId) continue;
      const session = Core.sessions.get(online);
      const accountId = session?.account?.id;
      if (accountId) {
        await Core.groups.setAccount(accountId, "admin", 0, { source: RESOURCE_NAME });
      }
      notifyPlayer(online, "Staff Access Revoked", "Your Headmaster staff permissions were removed.", "warning");
    } catch {}
  }
}

function forwardDiscordAudit(
  category: "staff" | "houses",
  title: string,
  description: string,
  actorName: string,
  fields?: Array<{ name: string; value: string; inline?: boolean }>
): void {
  try {
    const discordApi = safeImport("dg-discord");
    if (typeof discordApi?.pushAudit === "function") {
      void discordApi.pushAudit(category === "houses" ? "staff" : "staff", title, description, actorName, fields);
    }
  } catch {}
}

function broadcastGlobalBanNotice(playerName: string, reason: string, hours: number): void {
  if (!config.announceGlobalBans) return;
  const duration = hours > 0 ? `${hours}h` : "Permanent";
  const desc = `${playerName} was expelled (${duration}) — ${reason}`;
  for (const online of PlayerManager.getAll?.() ?? []) {
    notifyPlayer(online, "Ministry Ban Enforced", desc, "warning", {
      sender: "Office of the Headmaster",
    });
  }
}

function recordAudit(
  actorName: string,
  actorDiscordId: string,
  category: AuditRecord["category"],
  action: string,
  target: string,
  details: string
): AuditRecord {
  const entry: AuditRecord = {
    id: `aud-${Date.now().toString(36)}-${(++seq).toString(36)}`,
    timestamp: new Date().toISOString().slice(11, 19),
    actorName: String(actorName || "Staff").slice(0, 64),
    actorDiscordId: String(actorDiscordId || "unknown").slice(0, 32),
    category,
    action: String(action).slice(0, 64),
    target: String(target).slice(0, 96),
    details: String(details).slice(0, 240),
  };
  auditLog.unshift(entry);
  const limit = Math.max(50, Math.min(5000, Number(config.auditRetentionLimit) || 250));
  if (auditLog.length > limit) auditLog = auditLog.slice(0, limit);
  saveJsonFile(AUDIT_STORE_PATH, auditLog);
  logger.info(`[AUDIT] ${entry.actorName} (${entry.actorDiscordId}) -> ${entry.action} on ${entry.target}: ${entry.details}`);
  return entry;
}

function getActiveBan(discordId: string): BanRecord | null {
  const now = Date.now();
  const active: BanRecord[] = [];
  let changed = false;
  for (const ban of bans) {
    if (ban.expiresAtMs !== null && ban.expiresAtMs <= now) {
      changed = true;
      continue;
    }
    active.push(ban);
  }
  if (changed) {
    bans = active;
    saveJsonFile(BAN_STORE_PATH, bans);
  }
  return bans.find((b) => b.discordId === discordId) ?? null;
}

async function enforceBanIfNeeded(player: AdminPlayer): Promise<boolean> {
  const discordId = await resolveDiscordId(player);
  if (!discordId || isRootAdmin(discordId)) return false;
  const ban = getActiveBan(discordId);
  if (!ban) return false;
  const until = ban.expiresAtMs
    ? `Expires ${new Date(ban.expiresAtMs).toUTCString()}`
    : "Permanent";
  player.kick?.(`Banned from server: ${ban.reason} (${until})`);
  return true;
}

function findPlayerById(targetId: number): AdminPlayer | null {
  if (!Number.isSafeInteger(targetId)) return null;
  const all = PlayerManager.getAll?.() ?? [];
  return all.find((p) => Number(p.id) === Number(targetId)) ?? null;
}

async function buildDashboardSnapshot(actor: AdminPlayer, staff: StaffRecord) {
  const allPlayers = PlayerManager.getAll?.() ?? [];
  const players = await Promise.all(
    allPlayers.map(async (p) => {
      const discordId = (await resolveDiscordId(p)) ?? "Unknown";
      let house: string | null = null;
      let characterName = p.nickname || `Student #${p.id}`;
      try {
        const mem = await Houses?.membership?.get?.(p);
        house = mem?.house ?? null;
      } catch {}
      try {
        const sess = Core?.sessions?.get?.(p);
        if (sess?.character?.name) characterName = sess.character.name;
      } catch {}
      let grantedSpells: string[] = [];
      try {
        grantedSpells = (await Spells?.grants?.list?.(p)) ?? [];
      } catch {}
      let bankGalleons = 0;
      try {
        if (typeof Banking?.accounts?.personal === "function") {
          const acc = await Banking.accounts.personal(p, "galleons");
          if (acc && Number.isFinite(Number(acc.balance))) {
            bankGalleons = Math.max(0, Math.trunc(Number(acc.balance)));
          }
        }
      } catch {}
      let purseGalleons = 0;
      try {
        if (typeof Inventory?.inventory?.count === "function") {
          const cnt = await Inventory.inventory.count(p, "native:galleons");
          if (Number.isFinite(Number(cnt))) {
            purseGalleons = Math.max(0, Math.trunc(Number(cnt)));
          }
        }
      } catch {}
      return {
        id: p.id,
        nickname: p.nickname || `Player #${p.id}`,
        characterName,
        discordId,
        house,
        ping: Number(p.ping ?? 0),
        virtualWorld: Number(p.virtualWorld ?? 0),
        coords: p.position
          ? {
              x: Math.round(p.position.x),
              y: Math.round(p.position.y),
              z: Math.round(p.position.z),
            }
          : { x: 0, y: 0, z: 0 },
        frozen: frozenPlayers.has(p.id),
        dead: Boolean(p.dead || (typeof p.health === "number" && p.health <= 0)),
        spells: grantedSpells,
        bankGalleons,
        purseGalleons,
        warnings: warningCounts.get(discordId) ?? 0,
        staffRole: staffMap.get(discordId)?.role ?? null,
      };
    })
  );

  let standings: Array<{ house: string; points: number }> = HOUSES.map((h) => ({
    house: h,
    points: 0,
  }));
  let houseHistory: unknown[] = [];
  try {
    if (Houses?.points?.standings) {
      standings = await Houses.points.standings();
    }
    if (Houses?.points?.history) {
      houseHistory = await Houses.points.history(undefined, 15);
    }
  } catch {}

  let spellCatalog: Array<{ id: string; name: string }> = [];
  try {
    const rawCatalog = Spells?.catalog?.list?.() ?? [];
    spellCatalog = rawCatalog.map((entry: any) => ({
      id: entry.lockId || entry.id || entry.name,
      name: entry.name || entry.lockId || entry.id,
    }));
  } catch {}

  let environment: Record<string, unknown> = {
    weather: "Clear",
    season: "Autumn",
    hour: 12,
    minute: 0,
    timeScale: 1,
  };
  try {
    if (World?.environment?.state) {
      environment = World.environment.state();
    }
  } catch {}

  return {
    actor: {
      id: actor.id,
      nickname: actor.nickname || staff.label,
      discordId: staff.discordId,
      role: staff.role,
      grade: ROLE_GRADE[staff.role],
    },
    players,
    standings,
    houseHistory,
    spellCatalog,
    spellPacks: config.spellPacks,
    landmarks: config.landmarks,
    quickGearItems: config.quickGearItems,
    brooms: config.brooms && config.brooms.length ? config.brooms : [{"id":"native:broommoontrimmer","label":"Moon Trimmer"},{"id":"native:broomyewweaver","label":"Yew Weaver"},{"id":"native:broomwindwisp","label":"Wind Wisp"},{"id":"native:broomemberdash","label":"Ember Dash"},{"id":"native:broomlicketyswift","label":"Lickety Swift"},{"id":"native:broombrightspark","label":"Bright Spark"},{"id":"native:broomnightdancer","label":"Night Dancer"},{"id":"native:broomwildfire","label":"Wildfire"},{"id":"native:broomsilverarrow","label":"Silver Arrow"}],
    weatherProfiles: config.weatherProfiles,
    seasons: config.seasons,
    environment,
    lethalPvpActive,
    staffRoster: Array.from(staffMap.values()),
    bans: bans.filter((b) => b.expiresAtMs === null || b.expiresAtMs > Date.now()),
    auditLog: auditLog.slice(0, 60),
    hasSortingResource: Boolean(Sorting?.ceremony?.start),
    hasBankingResource: Boolean(Banking?.accounts?.personal && Banking?.transactions?.credit),
    hasNoclipBridge: Boolean(HmpAdmin?.actions?.noclip || HmpAdmin?.noclip),
  };
}

async function sendDashboardState(actor: AdminPlayer, staff: StaffRecord, toast?: { tone: string; message: string }) {
  const snapshot = await buildDashboardSnapshot(actor, staff);
  sendClient(actor, "hmp-headmaster:client:state", {
    snapshot,
    toast: toast ?? null,
  });
}

async function openAdminPanel(player: AdminPlayer): Promise<void> {
  if (!config.enabled) return;
  const staff = await getStaffRecord(player);
  if (!staff) {
    const id = await resolveDiscordId(player);
    notifyPlayer(
      player,
      "Access Denied",
      id
        ? `Your Discord ID (${id}) is not on the Headmaster staff roster.`
        : "No Discord ID was detected on your session.",
      "error"
    );
    return;
  }

  const snapshot = await buildDashboardSnapshot(player, staff);
  sendClient(player, "hmp-headmaster:client:open", {
    snapshot,
    hotkey: config.openHotkey,
  });
}

function resolveInventoryDefinition(rawInput: string): {
  registeredName: string | null;
  nativeId: string;
  label: string;
  isGear: boolean;
} {
  const query = rawInput.trim();
  const queryLower = query.toLowerCase();

  // 1. Check hmp-inventory registry first (matches curated names, native:<id>, aliases, nativeId, or label)
  try {
    if (typeof Inventory?.items?.get === "function") {
      const direct =
        Inventory.items.get(query) ??
        Inventory.items.get(queryLower) ??
        Inventory.items.get(`native:${queryLower}`);
      if (direct) {
        return {
          registeredName: direct.name,
          nativeId: direct.nativeId || query,
          label: direct.label || direct.nativeId || direct.name,
          isGear: Boolean(direct.unique || direct.kind === "gear"),
        };
      }
    }
    if (typeof Inventory?.items?.list === "function") {
      const all = (Inventory.items.list() ?? []) as Array<{
        name: string;
        nativeId?: string;
        label?: string;
        kind?: string;
        unique?: boolean;
      }>;
      const found = all.find(
        (d) =>
          d.name?.toLowerCase() === queryLower ||
          d.nativeId?.toLowerCase() === queryLower ||
          d.label?.toLowerCase() === queryLower
      );
      if (found) {
        return {
          registeredName: found.name,
          nativeId: found.nativeId || query,
          label: found.label || found.nativeId || found.name,
          isGear: Boolean(found.unique || found.kind === "gear"),
        };
      }
    }
  } catch {
    // Fall through to InventoryCatalog
  }

  // 2. Fallback to HogwartsMP native InventoryCatalog
  const strippedLower = queryLower.replace(/^native:/, "");
  if (typeof InventoryCatalog === "object" && typeof InventoryCatalog?.list === "function") {
    try {
      const catalog = InventoryCatalog.list({ inventoryable: true }) ?? [];
      const match = catalog.find(
        (entry) =>
          entry?.itemId?.toLowerCase() === queryLower ||
          entry?.itemId?.toLowerCase() === strippedLower
      );
      if (match?.itemId) {
        return {
          registeredName: `native:${match.itemId.toLowerCase()}`,
          nativeId: match.itemId,
          label: match.itemId,
          isGear: match.kind === "gear" || match.holder === "ActorBackpack",
        };
      }
    } catch {
      // Fall through to raw ID
    }
  }

  const looksLikeGear = /^(Back|Outfit|Head|Neck|Hand|Face)_/i.test(query);
  return {
    registeredName: queryLower.startsWith("native:") ? query : null,
    nativeId: query.replace(/^native:/i, ""),
    label: query,
    isGear: looksLikeGear,
  };
}

/**
 * Grants an item to a player ALREADY IDENTIFIED so Hogwarts Legacy never shows
 * "Unidentified (category) item". Uses hmp-inventory's official Inventory.inventory.add
 * pipeline first (identical to Foundations hmp-admin), which calls player.inventory.give
 * with { identified: true, unique: true } for gear items.
 */
async function grantInventoryItem(
  target: AdminPlayer,
  rawItemId: string,
  equip = false,
  amount = 1
): Promise<string> {
  const qty = Math.max(1, Math.trunc(Number(amount) || 1));
  const resolved = resolveInventoryDefinition(rawItemId);

  // Path 1 (Preferred): Official hmp-inventory API (identifies gear & emits inventory events)
  if (!equip && resolved.registeredName && typeof Inventory?.inventory?.add === "function") {
    try {
      await Inventory.inventory.add(target, resolved.registeredName, qty, {
        identified: true,
      });
      if (typeof Inventory?.native?.save === "function") {
        await Inventory.native.save(target);
      }
      return resolved.label || resolved.nativeId;
    } catch (err) {
      logger.warn(`hmp-inventory.add fallback for "${rawItemId}": ${String(err)}`);
    }
  }

  const inv = target.inventory;
  if (!inv) {
    throw new Error("Target player inventory API is unavailable.");
  }

  // Path 2: Native player.inventory.give with identified: true & unique: isGear
  if (!equip && typeof inv.give === "function") {
    const result = await new Promise<{ revision: number } | null>((resolve, reject) => {
      inv.give!(
        resolved.nativeId,
        qty,
        { identified: true, unique: resolved.isGear },
        (err, res) => (err ? reject(err) : resolve(res))
      );
    });
    if (result?.revision !== undefined && typeof inv.waitForRevision === "function") {
      await inv.waitForRevision(result.revision);
    }
    if (typeof Inventory?.native?.save === "function") {
      await Inventory.native.save(target);
    }
    return resolved.label || resolved.nativeId;
  }

  // Path 3: Native player.inventory.patch (used when auto-equipping or give() is absent)
  if (typeof inv.patch !== "function") {
    throw new Error("Target player inventory patch/give API is unavailable.");
  }

  const result = await new Promise<{ revision: number } | null>((resolve, reject) => {
    inv.patch!(
      [
        {
          op: "give",
          itemId: resolved.nativeId,
          count: qty,
          identified: true,
          unique: resolved.isGear,
          equipped: Boolean(equip),
        },
      ],
      {},
      (err, res) => (err ? reject(err) : resolve(res))
    );
  });

  if (result?.revision !== undefined && typeof inv.waitForRevision === "function") {
    await inv.waitForRevision(result.revision);
  }
  if (typeof Inventory?.native?.save === "function") {
    await Inventory.native.save(target);
  }

  return resolved.label || resolved.nativeId;
}

// Central server-authoritative action dispatcher for the Headmaster NUI
Events.onClient("hmp-headmaster:server:action", async (actor: AdminPlayer, raw: unknown) => {
  const req = parsePayload<{ action: string; payload?: Record<string, any> }>(raw);
  if (!req?.action) return;

  try {
    const staff = await getStaffRecord(actor);
    if (!staff) throw new Error("Unauthorized: Discord ID is not in staff roster.");

    const p = req.payload ?? {};
    const actorName = actor.nickname || staff.label;
    let feedback = "Action completed.";

    switch (req.action) {
      case "refresh": {
        await sendDashboardState(actor, staff);
        return;
      }

      // ---------------- PLAYER MANAGEMENT ----------------
      case "player:goto": {
        await requireRole(actor, "prefect");
        const target = findPlayerById(Number(p.targetId));
        if (!target || !target.position) throw new Error("Target player not found.");
        actor.teleport?.(target.position.x + 120, target.position.y, target.position.z + 40, {
          snapToGround: true,
          groundSnapDistance: 2000,
        });
        recordAudit(actorName, staff.discordId, "player", "Teleport To", target.nickname || `#${target.id}`, "Moved to target location");
        feedback = `Teleported to ${target.nickname || `#${target.id}`}.`;
        break;
      }

      case "player:bring": {
        await requireRole(actor, "prefect");
        const target = findPlayerById(Number(p.targetId));
        if (!target || !actor.position) throw new Error("Target player not found.");
        if (target.id === actor.id) throw new Error("Cannot bring yourself.");
        target.teleport?.(actor.position.x + 120, actor.position.y, actor.position.z + 40, {
          snapToGround: true,
          groundSnapDistance: 2000,
        });
        notifyPlayer(target, "Summoned", `${actorName} brought you to their location.`, "info");
        recordAudit(actorName, staff.discordId, "player", "Bring Player", target.nickname || `#${target.id}`, "Summoned to staff location");
        feedback = `Brought ${target.nickname || `#${target.id}`} to your position.`;
        break;
      }

      case "player:teleportLandmark": {
        await requireRole(actor, "professor");
        const target = findPlayerById(Number(p.targetId)) ?? actor;
        const landmark = config.landmarks.find((l) => l.id === String(p.landmarkId));
        if (!landmark) throw new Error("Unknown Hogwarts landmark.");
        target.teleport?.(landmark.x, landmark.y, landmark.z, {
          snapToGround: true,
          groundSnapDistance: 2000,
        });
        notifyPlayer(target, "Apparated", `Teleported to ${landmark.name}.`, "info");
        recordAudit(actorName, staff.discordId, "player", "Landmark Teleport", target.nickname || `#${target.id}`, landmark.name);
        feedback = `Sent ${target.nickname || `#${target.id}`} to ${landmark.name}.`;
        break;
      }

      case "player:teleportCoords": {
        await requireRole(actor, "professor");
        const target = findPlayerById(Number(p.targetId)) ?? actor;
        const x = Number(p.x);
        const y = Number(p.y);
        const z = Number(p.z);
        if (![x, y, z].every(Number.isFinite)) throw new Error("Invalid X/Y/Z coordinates.");
        target.teleport?.(x, y, z, { snapToGround: true, groundSnapDistance: 2000 });
        recordAudit(actorName, staff.discordId, "player", "Coordinate Teleport", target.nickname || `#${target.id}`, `${x}, ${y}, ${z}`);
        feedback = `Teleported ${target.nickname || `#${target.id}`} to (${x}, ${y}, ${z}).`;
        break;
      }

      case "player:freeze": {
        await requireRole(actor, "prefect");
        const target = findPlayerById(Number(p.targetId));
        if (!target) throw new Error("Target player not found.");
        const targetDiscord = await resolveDiscordId(target);
        if (targetDiscord && isRootAdmin(targetDiscord) && !isRootAdmin(staff.discordId)) {
          throw new Error("You cannot freeze a Root Admin.");
        }
        const shouldFreeze = !frozenPlayers.has(target.id);
        if (shouldFreeze) {
          if (target.position && typeof target.hold === "function") {
            target.hold({
              owner: FREEZE_HOLD_OWNER,
              x: target.position.x,
              y: target.position.y,
              z: target.position.z,
              radius: 25,
              radiusZ: 100,
              mode: "clamp",
            });
          }
          frozenPlayers.add(target.id);
          sendClient(target, "hmp-headmaster:client:freeze", { frozen: true });
          notifyPlayer(target, "Petrificus Totalus", "You have been frozen by a staff member.", "warning");
        } else {
          target.releaseHold?.(FREEZE_HOLD_OWNER);
          frozenPlayers.delete(target.id);
          sendClient(target, "hmp-headmaster:client:freeze", { frozen: false });
          notifyPlayer(target, "Finite Incantatem", "You have been unfrozen.", "success");
        }
        recordAudit(actorName, staff.discordId, "player", shouldFreeze ? "Freeze" : "Unfreeze", target.nickname || `#${target.id}`, String(p.reason || "Staff action").slice(0, 180));
        feedback = `${shouldFreeze ? "Froze" : "Unfroze"} ${target.nickname || `#${target.id}`}.`;
        break;
      }

      case "player:revive": {
        await requireRole(actor, "professor");
        const target = findPlayerById(Number(p.targetId));
        if (!target) throw new Error("Target player not found.");
        if (typeof target.revive !== "function") throw new Error("Host does not expose player.revive().");
        target.revive();
        notifyPlayer(target, "Revived", `Restored to full health by ${actorName}.`, "success");
        recordAudit(actorName, staff.discordId, "player", "Revive", target.nickname || `#${target.id}`, "Restored player");
        feedback = `Revived ${target.nickname || `#${target.id}`}.`;
        break;
      }

      case "player:warn": {
        await requireRole(actor, "prefect");
        const target = findPlayerById(Number(p.targetId));
        if (!target) throw new Error("Target player not found.");
        const reason = String(p.reason || "Please follow server rules.").trim().slice(0, 220) || "Please follow server rules.";
        const discordId = (await resolveDiscordId(target)) ?? `id:${target.id}`;
        warningCounts.set(discordId, (warningCounts.get(discordId) ?? 0) + 1);
        notifyPlayer(target, "Official Staff Warning", reason, "warning");
        target.sendChat?.(`[WARNING from ${actorName}] ${reason}`);
        recordAudit(actorName, staff.discordId, "player", "Warn", target.nickname || `#${target.id}`, reason);
        forwardDiscordAudit("staff", "Student Warned", `**${target.nickname || `#${target.id}`}** was warned in-game.`, actorName, [
          { name: "Reason", value: reason, inline: false },
        ]);
        feedback = `Issued warning to ${target.nickname || `#${target.id}`}.`;
        break;
      }

      case "player:notice": {
        await requireRole(actor, "prefect");
        const target = findPlayerById(Number(p.targetId));
        if (!target) throw new Error("Target player not found.");
        const message = String(p.message || "").trim().slice(0, 240);
        if (!message) throw new Error("Notice message cannot be empty.");
        notifyPlayer(target, `Owl Post from ${actorName}`, message, "info");
        recordAudit(actorName, staff.discordId, "player", "Direct Notice", target.nickname || `#${target.id}`, message);
        feedback = `Sent notice to ${target.nickname || `#${target.id}`}.`;
        break;
      }

      case "player:kick": {
        await requireRole(actor, "prefect");
        const target = findPlayerById(Number(p.targetId));
        if (!target) throw new Error("Target player not found.");
        if (target.id === actor.id) throw new Error("You cannot kick yourself.");
        const targetDiscord = await resolveDiscordId(target);
        if (targetDiscord && isRootAdmin(targetDiscord)) {
          throw new Error("Root Admin is protected from kicks.");
        }
        const reason = String(p.reason || "Removed by Hogwarts staff.").trim().slice(0, 220) || "Removed by Hogwarts staff.";
        const targetLabel = target.nickname || `#${target.id}`;
        recordAudit(actorName, staff.discordId, "player", "Kick", targetLabel, reason);
        forwardDiscordAudit("staff", "Student Kicked", `**${targetLabel}** was kicked in-game.`, actorName, [
          { name: "Reason", value: reason, inline: false },
        ]);
        target.kick?.(reason);
        feedback = `Kicked ${targetLabel}.`;
        break;
      }

      case "player:ban": {
        await requireRole(actor, "headmaster");
        const hasTargetId = p.targetId !== undefined && p.targetId !== null && p.targetId !== "";
        const target = hasTargetId ? findPlayerById(Number(p.targetId)) : null;
        const manualDiscordId = String(p.discordId || "").trim();
        const targetDiscord = target ? await resolveDiscordId(target) : manualDiscordId;
        if (!targetDiscord || !isValidDiscordId(targetDiscord)) {
          throw new Error("Valid 17-20 digit Discord ID is required to issue a ban.");
        }
        if (targetDiscord === staff.discordId || target?.id === actor.id) {
          throw new Error("You cannot ban yourself.");
        }
        if (isRootAdmin(targetDiscord)) {
          throw new Error("Root Admin cannot be banned.");
        }
        const rawHours = Number(p.hours ?? 0);
        if (!Number.isFinite(rawHours) || rawHours < 0) {
          throw new Error("Ban duration (hours) must be 0 or greater.");
        }
        const hours = Math.min(87600, Math.round(rawHours));
        const reason = String(p.reason || "Expelled by Headmaster.").trim().slice(0, 220) || "Expelled by Headmaster.";
        const expiresAtMs = hours > 0 ? Date.now() + hours * 3600_000 : null;
        const playerName = String(target?.nickname || p.playerName || targetDiscord).trim().slice(0, 64) || targetDiscord;

        const ban: BanRecord = {
          id: `ban-${Date.now().toString(36)}-${(++seq).toString(36)}`,
          discordId: targetDiscord,
          playerName,
          reason,
          bannedBy: actorName,
          bannedByDiscordId: staff.discordId,
          createdAt: new Date().toISOString(),
          expiresAtMs,
        };
        bans = [ban, ...bans.filter((b) => b.discordId !== targetDiscord)];
        saveJsonFile(BAN_STORE_PATH, bans);

        recordAudit(
          actorName,
          staff.discordId,
          "player",
          hours > 0 ? `Ban (${hours}h)` : "Permanent Ban",
          `${playerName} (${targetDiscord})`,
          reason
        );
        forwardDiscordAudit(
          "staff",
          hours > 0 ? `Timed Ban (${hours}h)` : "Permanent Ban",
          `**${playerName}** (${targetDiscord}) was banned in-game.`,
          actorName,
          [{ name: "Reason", value: reason, inline: false }]
        );

        target?.kick?.(`Banned: ${reason}${hours > 0 ? ` (${hours} hours)` : " (Permanent)"}`);
        if (!target && isValidDiscordId(targetDiscord)) {
          for (const online of PlayerManager.getAll?.() ?? []) {
            const onlineDiscord = await resolveDiscordId(online);
            if (onlineDiscord === targetDiscord) {
              online.kick?.(`Banned: ${reason}${hours > 0 ? ` (${hours} hours)` : " (Permanent)"}`);
            }
          }
        }
        broadcastGlobalBanNotice(playerName, reason, hours);
        feedback = `Banned ${playerName} (${targetDiscord}).`;
        break;
      }

      case "player:unban": {
        await requireRole(actor, "headmaster");
        const discordId = String(p.discordId || "").trim();
        const existing = bans.find((b) => b.discordId === discordId || b.id === String(p.banId || ""));
        if (!existing) throw new Error("Ban record not found.");
        bans = bans.filter((b) => b.id !== existing.id);
        saveJsonFile(BAN_STORE_PATH, bans);
        recordAudit(actorName, staff.discordId, "player", "Unban", `${existing.playerName} (${existing.discordId})`, "Ban revoked");
        forwardDiscordAudit("staff", "Ban Revoked", `**${existing.playerName}** (${existing.discordId}) was unbanned in-game.`, actorName);
        feedback = `Unbanned ${existing.playerName}.`;
        break;
      }

      case "player:giveItem": {
        await requireRole(actor, "professor");
        const target = findPlayerById(Number(p.targetId));
        if (!target) throw new Error("Target player not found.");
        const itemId = String(p.itemId || "").trim();
        if (!itemId) throw new Error("Item ID is required.");
        const grantedId = await grantInventoryItem(target, itemId, Boolean(p.equipped));
        notifyPlayer(
          target,
          "Item Granted",
          `${actorName} granted you ${grantedId} in your Gear menu.`,
          "success"
        );
        recordAudit(actorName, staff.discordId, "player", "Give Item", target.nickname || `#${target.id}`, grantedId);
        feedback = `Granted ${grantedId} to ${target.nickname || `#${target.id}`}.`;
        break;
      }

      case "player:giveBroom": {
        await requireRole(actor, "professor");
        const target = findPlayerById(Number(p.targetId));
        if (!target) throw new Error("Target player not found.");
        const broomId = String(p.broomId || "").trim();
        if (!broomId) throw new Error("Broom ID is required.");
        const catalogBrooms =
          config.brooms && config.brooms.length
            ? config.brooms
            : [{"id":"native:broommoontrimmer","label":"Moon Trimmer"},{"id":"native:broomyewweaver","label":"Yew Weaver"},{"id":"native:broomwindwisp","label":"Wind Wisp"},{"id":"native:broomemberdash","label":"Ember Dash"},{"id":"native:broomlicketyswift","label":"Lickety Swift"},{"id":"native:broombrightspark","label":"Bright Spark"},{"id":"native:broomnightdancer","label":"Night Dancer"},{"id":"native:broomwildfire","label":"Wildfire"},{"id":"native:broomsilverarrow","label":"Silver Arrow"}];
        const broomMeta = catalogBrooms.find(
          (b) => b.id.toLowerCase() === broomId.toLowerCase()
        );
        const grantedName = await grantInventoryItem(target, broomId, false, 1);
        const displayName = broomMeta?.label || grantedName;
        notifyPlayer(
          target,
          "Flying Broom Granted",
          `${actorName} granted you the ${displayName} broom.`,
          "success"
        );
        recordAudit(
          actorName,
          staff.discordId,
          "player",
          "Give Broom",
          target.nickname || `#${target.id}`,
          `${displayName} (${broomId})`
        );
        feedback = `Granted ${displayName} to ${target.nickname || `#${target.id}`}.`;
        break;
      }

      case "player:money": {
        const amount = Math.trunc(Number(p.amount) || 0);
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error("Enter a positive Galleon amount.");
        }
        await requireRole(actor, amount > 10000 ? "headmaster" : "professor");
        const target = findPlayerById(Number(p.targetId));
        if (!target) throw new Error("Target player not found.");
        const operation = String(p.operation || "give") === "remove" ? "remove" : "give";
        const destination = String(p.destination || "bank") === "purse" ? "purse" : "bank";
        const reason = String(p.reason || "").trim() || (operation === "give" ? "Headmaster grant" : "Headmaster deduction");
        const targetLabel = target.nickname || `#${target.id}`;

        if (destination === "bank") {
          if (!Banking?.accounts?.personal || !Banking?.transactions?.credit || !Banking?.transactions?.debit) {
            throw new Error("Gringotts Banking (hmp-banking) is not loaded on this server.");
          }
          const account = await Banking.accounts.personal(target, "galleons");
          if (!account) throw new Error("Could not resolve target player's Gringotts Vault.");
          const ref = `${RESOURCE_NAME}:${Date.now().toString(36)}:${(++seq).toString(36)}`;
          if (operation === "give") {
            await Banking.transactions.credit(account, amount, {
              resource: RESOURCE_NAME,
              reference: ref,
              memo: reason,
              actor,
            });
          } else {
            if (Number(account.balance ?? 0) < amount) {
              throw new Error(`Player only has ${Math.trunc(Number(account.balance ?? 0))} G in their Gringotts Vault.`);
            }
            await Banking.transactions.debit(account, amount, {
              resource: RESOURCE_NAME,
              reference: ref,
              memo: reason,
              actor,
            });
          }
        } else {
          if (typeof Inventory?.inventory?.add !== "function" || typeof Inventory?.inventory?.remove !== "function") {
            throw new Error("hmp-inventory is unavailable for Coin Purse transactions.");
          }
          if (operation === "give") {
            await Inventory.inventory.add(target, "native:galleons", amount);
          } else {
            const currentPurse =
              typeof Inventory?.inventory?.count === "function"
                ? Math.max(0, Math.trunc(Number(await Inventory.inventory.count(target, "native:galleons")) || 0))
                : 0;
            if (currentPurse < amount) {
              throw new Error(`Player only has ${currentPurse} G in their Coin Purse.`);
            }
            await Inventory.inventory.remove(target, "native:galleons", amount);
          }
          if (typeof Inventory?.native?.save === "function") {
            await Inventory.native.save(target);
          }
        }

        const placeLabel = destination === "bank" ? "Gringotts Vault" : "Coin Purse";
        const signed = `${operation === "give" ? "+" : "-"}${amount.toLocaleString()} G`;
        notifyPlayer(
          target,
          operation === "give" ? "Galleons Received" : "Galleons Deducted",
          `${actorName} ${operation === "give" ? "credited" : "deducted"} ${amount.toLocaleString()} G ${operation === "give" ? "to" : "from"} your ${placeLabel}.`,
          operation === "give" ? "success" : "warning"
        );
        recordAudit(
          actorName,
          staff.discordId,
          "player",
          operation === "give" ? "Give Galleons" : "Deduct Galleons",
          targetLabel,
          `${signed} (${placeLabel}) — ${reason}`
        );
        feedback = `${operation === "give" ? "Credited" : "Deducted"} ${amount.toLocaleString()} G ${operation === "give" ? "to" : "from"} ${targetLabel}'s ${placeLabel}.`;
        break;
      }

      case "self:noclip": {
        await requireRole(actor, "professor");
        if (typeof HmpAdmin?.actions?.noclip === "function") {
          await HmpAdmin.actions.noclip(actor, "Toggled via Headmaster Panel");
          feedback = "Toggled No-Clip via hmp-admin.";
        } else {
          throw new Error("No-Clip bridge requires hmp-admin to be running.");
        }
        break;
      }

      // ---------------- HOUSES & HOUSE CUP ----------------
      case "houses:points": {
        await requireRole(actor, "prefect");
        if (!Houses?.points?.adjust) throw new Error("hmp-houses points API unavailable.");
        const house = String(p.house || "").toLowerCase() as HouseId;
        if (!HOUSES.includes(house)) throw new Error("Invalid Hogwarts house.");
        const amount = Math.trunc(Number(p.amount));
        if (!Number.isSafeInteger(amount) || amount === 0) {
          throw new Error("Points adjustment must be a non-zero integer.");
        }
        if (staff.role === "prefect" && Math.abs(amount) > 25) {
          throw new Error("Prefects may adjust at most +/- 25 points at once.");
        }
        const reason = String(p.reason || "Headmaster House Cup adjustment").trim();
        const reference = `headmaster:${Date.now().toString(36)}:${(++seq).toString(36)}`;
        const tx = await Houses.points.adjust(house, amount, {
          reference,
          resource: RESOURCE_NAME,
          actor,
          reason,
        });
        recordAudit(
          actorName,
          staff.discordId,
          "houses",
          `House Points ${amount > 0 ? `+${amount}` : amount}`,
          house,
          `${reason} (Total: ${tx?.balanceAfter ?? "?"})`
        );
        if (config.broadcastHousePoints) {
          const houseLabel = house.charAt(0).toUpperCase() + house.slice(1);
          const msg = `${amount > 0 ? `+${amount}` : amount} points ${amount > 0 ? "to" : "from"} ${houseLabel} — ${reason}`;
          for (const online of PlayerManager.getAll?.() ?? []) {
            notifyPlayer(online, `${houseLabel} House Cup`, msg, "house", {
              house,
              sender: "House Cup Ledger",
            });
          }
        }
        feedback = `Updated ${house} by ${amount > 0 ? `+${amount}` : amount} points.`;
        break;
      }

      case "houses:assign": {
        await requireRole(actor, "professor");
        if (!Houses?.membership?.set) throw new Error("hmp-houses membership API unavailable.");
        const target = findPlayerById(Number(p.targetId));
        if (!target) throw new Error("Target player not found.");
        const house = String(p.house || "").toLowerCase() as HouseId;
        if (!HOUSES.includes(house)) throw new Error("Invalid Hogwarts house.");
        const reason = String(p.reason || `Assigned by ${actorName}`);
        await Houses.membership.set(target, house, { resource: RESOURCE_NAME, actor, reason });
        await Houses.membership.sync?.(target);
        if (p.grantRobe) {
          try {
            await grantInventoryItem(target, "Back_001_Basic", false);
          } catch {}
        }
        notifyPlayer(target, "House Updated", `You have been assigned to ${house.toUpperCase()} by ${actorName}.`, "house", {
          house,
          sender: "Office of the Headmaster",
        });
        recordAudit(actorName, staff.discordId, "houses", "Assign House", target.nickname || `#${target.id}`, house);
        feedback = `Assigned ${target.nickname || `#${target.id}`} to ${house}.`;
        break;
      }

      case "houses:clear": {
        await requireRole(actor, "headmaster");
        if (!Houses?.membership?.clear) throw new Error("hmp-houses clear API unavailable.");
        const target = findPlayerById(Number(p.targetId));
        if (!target) throw new Error("Target player not found.");
        await Houses.membership.clear(target, { resource: RESOURCE_NAME, actor, reason: "Cleared by Headmaster" });
        notifyPlayer(target, "House Cleared", "Your house assignment was cleared by staff.", "warning");
        recordAudit(actorName, staff.discordId, "houses", "Clear House", target.nickname || `#${target.id}`, "House removed");
        feedback = `Cleared house membership for ${target.nickname || `#${target.id}`}.`;
        break;
      }

      case "houses:forceResort": {
        await requireRole(actor, "professor");
        if (!Sorting?.ceremony?.start) {
          throw new Error(`${"hmp-sorting"} is not loaded on this server.`);
        }
        const target = findPlayerById(Number(p.targetId));
        if (!target) throw new Error("Target player not found.");
        const started = await Sorting.ceremony.start(target, true);
        if (!started) throw new Error("Student is already in an active Sorting Ceremony.");
        recordAudit(actorName, staff.discordId, "houses", "Force Re-Sort", target.nickname || `#${target.id}`, "Triggered hmp-sorting ceremony");
        feedback = `Triggered Sorting Hat Ceremony for ${target.nickname || `#${target.id}`}.`;
        break;
      }

      // ---------------- SPELLS ----------------
      case "spells:grant": {
        await requireRole(actor, "professor");
        if (!Spells?.grants?.grant) throw new Error("hmp-spells resource is not available.");
        const target = findPlayerById(Number(p.targetId));
        if (!target) throw new Error("Target player not found.");
        const spellId = String(p.spellId || "").trim();
        if (!spellId) throw new Error("Spell name is required.");
        await Spells.grants.grant(target, spellId, { resource: RESOURCE_NAME, actor, reason: "Granted via Headmaster Panel" });
        await Spells.policy?.sync?.(target);
        notifyPlayer(target, "Spell Learned", `${actorName} granted you ${spellId}.`, "magic", {
          sender: "Hogwarts Curriculum",
        });
        recordAudit(actorName, staff.discordId, "spells", "Grant Spell", target.nickname || `#${target.id}`, spellId);
        feedback = `Granted ${spellId} to ${target.nickname || `#${target.id}`}.`;
        break;
      }

      case "spells:revoke": {
        await requireRole(actor, "professor");
        if (!Spells?.grants?.revoke) throw new Error("hmp-spells resource is not available.");
        const target = findPlayerById(Number(p.targetId));
        if (!target) throw new Error("Target player not found.");
        const spellId = String(p.spellId || "").trim();
        await Spells.grants.revoke(target, spellId, { resource: RESOURCE_NAME, actor, reason: "Revoked via Headmaster Panel" });
        await Spells.policy?.sync?.(target);
        recordAudit(actorName, staff.discordId, "spells", "Revoke Spell", target.nickname || `#${target.id}`, spellId);
        feedback = `Revoked ${spellId} from ${target.nickname || `#${target.id}`}.`;
        break;
      }

      case "spells:grantPack": {
        await requireRole(actor, "professor");
        if (!Spells?.grants?.grant) throw new Error("hmp-spells resource is not available.");
        const target = findPlayerById(Number(p.targetId));
        if (!target) throw new Error("Target player not found.");
        const pack = config.spellPacks.find((sp) => sp.id === String(p.packId));
        if (!pack) throw new Error("Spell pack not found.");
        if (pack.id === "unforgivables" && ROLE_GRADE[staff.role] < ROLE_GRADE.headmaster) {
          throw new Error("Only Headmasters or Root Admin can grant Unforgivable Curses.");
        }
        let grantedCount = 0;
        for (const spellId of pack.spells) {
          try {
            await Spells.grants.grant(target, spellId, { resource: RESOURCE_NAME, actor, reason: `Pack: ${pack.name}` });
            grantedCount += 1;
          } catch {}
        }
        await Spells.policy?.sync?.(target);
        notifyPlayer(target, "Curriculum Unlocked", `${actorName} granted the ${pack.name} spell pack.`, "magic", {
          sender: "Hogwarts Curriculum",
        });
        recordAudit(actorName, staff.discordId, "spells", "Grant Spell Pack", target.nickname || `#${target.id}`, `${pack.name} (${grantedCount} spells)`);
        feedback = `Granted ${pack.name} (${grantedCount} spells) to ${target.nickname || `#${target.id}`}.`;
        break;
      }

      case "spells:clear": {
        await requireRole(actor, "headmaster");
        if (!Spells?.grants?.clear) throw new Error("hmp-spells resource is not available.");
        const target = findPlayerById(Number(p.targetId));
        if (!target) throw new Error("Target player not found.");
        const removed = await Spells.grants.clear(target, { resource: RESOURCE_NAME, actor, reason: "Cleared via Headmaster Panel" });
        await Spells.policy?.sync?.(target);
        recordAudit(actorName, staff.discordId, "spells", "Clear Spells", target.nickname || `#${target.id}`, `Removed ${removed} grants`);
        feedback = `Cleared ${removed} personal spell grant(s).`;
        break;
      }

      // ---------------- WORLD & SERVER ----------------
      case "world:weather": {
        await requireRole(actor, "headmaster");
        if (!World?.environment?.setWeather) throw new Error("hmp-world environment API unavailable.");
        const weather = String(p.weather || "Clear").trim().slice(0, 64) || "Clear";
        World.environment.setWeather(weather);
        recordAudit(actorName, staff.discordId, "world", "Set Weather", "Server World", weather);
        feedback = `Weather set to ${weather}.`;
        break;
      }

      case "world:season": {
        await requireRole(actor, "headmaster");
        if (!World?.environment?.setSeason) throw new Error("hmp-world environment API unavailable.");
        const season = String(p.season || "Autumn").trim().slice(0, 32) || "Autumn";
        World.environment.setSeason(season);
        recordAudit(actorName, staff.discordId, "world", "Set Season", "Server World", season);
        feedback = `Season set to ${season}.`;
        break;
      }

      case "world:time": {
        await requireRole(actor, "headmaster");
        if (!World?.environment?.setTime) throw new Error("hmp-world environment API unavailable.");
        const hour = Math.max(0, Math.min(23, Math.trunc(Number(p.hour ?? 12))));
        const minute = Math.max(0, Math.min(59, Math.trunc(Number(p.minute ?? 0))));
        World.environment.setTime(hour, minute, 0);
        if (p.timeScale !== undefined && World?.environment?.setTimeScale) {
          World.environment.setTimeScale(Math.max(0, Math.min(20, Number(p.timeScale))));
        }
        const label = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
        recordAudit(actorName, staff.discordId, "world", "Set Time", "Server World", label);
        feedback = `Server time set to ${label}.`;
        break;
      }

      case "world:reset": {
        await requireRole(actor, "headmaster");
        if (!World?.environment?.reset) throw new Error("hmp-world environment API unavailable.");
        World.environment.reset();
        recordAudit(actorName, staff.discordId, "world", "Reset World", "Server World", "Restored hmp-world baseline");
        feedback = "World environment restored to baseline.";
        break;
      }

      case "world:announce": {
        await requireRole(actor, "professor");
        const title = String(p.title || "Hogwarts Announcement").trim().slice(0, 80) || "Hogwarts Announcement";
        const message = String(p.message || "").trim().slice(0, 320);
        const tone = (["info", "success", "warning", "error"].includes(String(p.tone)) ? p.tone : "info") as
          | "info"
          | "success"
          | "warning"
          | "error";
        if (!message) throw new Error("Announcement text cannot be empty.");
        const scrollTone = tone === "info" ? "decree" : tone;
        for (const online of PlayerManager.getAll?.() ?? []) {
          notifyPlayer(online, title, message, scrollTone, {
            sender: "Office of the Headmaster",
          });
          online.sendChat?.(`[${title}] ${message}`);
        }
        recordAudit(actorName, staff.discordId, "world", "Global Announcement", "All Players", `${title}: ${message}`);
        feedback = "Broadcasted parchment scroll decree to all online students.";
        break;
      }

      case "world:pvpLethal": {
        await requireRole(actor, "headmaster");
        if (!Pvp?.mode?.setLethal) throw new Error("hmp-pvp resource is not available.");
        const enabled = Boolean(p.enabled);
        Pvp.mode.setLethal(enabled, {
          resource: RESOURCE_NAME,
          reason: `Toggled by ${actorName}`,
        });
        lethalPvpActive = enabled;
        recordAudit(actorName, staff.discordId, "world", "Lethal PvP", "Server Policy", enabled ? "ENABLED" : "DISABLED");
        forwardDiscordAudit("staff", "Lethal PvP Updated", `Lethal PvP mode is now **${enabled ? "ENABLED" : "DISABLED"}**.`, actorName);
        feedback = `Lethal PvP mode ${enabled ? "enabled" : "disabled"}.`;
        break;
      }

      // ---------------- STAFF ROSTER (DISCORD ID) ----------------
      case "staff:add": {
        await requireRole(actor, "headmaster");
        const targetDiscordId = String(p.discordId || "").trim();
        const label = String(p.label || "Hogwarts Staff").trim().slice(0, 64) || "Hogwarts Staff";
        const role = String(p.role || "prefect") as AdminRole;

        if (!isValidDiscordId(targetDiscordId)) {
          throw new Error("Discord ID must be a 17–20 digit numeric snowflake.");
        }
        if (isRootAdmin(targetDiscordId)) {
          throw new Error("Configured Root Admin cannot be modified in-game.");
        }
        if (!["headmaster", "professor", "prefect"].includes(role)) {
          throw new Error("Role must be headmaster, professor, or prefect.");
        }
        if (staff.role !== "root" && targetDiscordId === staff.discordId) {
          throw new Error("You cannot modify your own staff rank.");
        }
        if (staff.role !== "root" && ROLE_GRADE[role] >= ROLE_GRADE[staff.role]) {
          throw new Error("You may only appoint roles strictly below your own.");
        }

        staffMap.set(targetDiscordId, {
          discordId: targetDiscordId,
          label,
          role,
          addedAt: new Date().toISOString().slice(0, 10),
          addedBy: actorName,
        });
        persistStaffRoster();

        for (const online of PlayerManager.getAll?.() ?? []) {
          const onlineDiscord = await resolveDiscordId(online);
          if (onlineDiscord === targetDiscordId) {
            await syncCoreAdminGroupForPlayer(online);
            notifyPlayer(online, "Staff Appointment", `You have been appointed ${role.toUpperCase()} by ${actorName}.`, "success");
          }
        }

        recordAudit(actorName, staff.discordId, "staff", "Add Staff", `${label} (${targetDiscordId})`, `Role: ${role}`);
        forwardDiscordAudit("staff", "Staff Added", `**${label}** (${targetDiscordId}) appointed **${role}**.`, actorName);
        feedback = `Added ${label} (${targetDiscordId}) as ${role}.`;
        break;
      }

      case "staff:remove": {
        await requireRole(actor, "headmaster");
        const targetDiscordId = String(p.discordId || "").trim();
        if (isRootAdmin(targetDiscordId)) {
          throw new Error(`Configured Root Admin (${targetDiscordId}) cannot be removed in-game; edit data/${RESOURCE_NAME}.json instead.`);
        }
        if (staff.role !== "root" && targetDiscordId === staff.discordId) {
          throw new Error("You cannot remove your own staff access.");
        }
        const existing = staffMap.get(targetDiscordId);
        if (!existing) throw new Error("Staff entry not found.");
        if (staff.role !== "root" && ROLE_GRADE[existing.role] >= ROLE_GRADE[staff.role]) {
          throw new Error("You can only remove staff below your own role.");
        }
        staffMap.delete(targetDiscordId);
        persistStaffRoster();
        await revokeCoreAdminGroupForDiscordId(targetDiscordId);
        recordAudit(actorName, staff.discordId, "staff", "Remove Staff", `${existing.label} (${targetDiscordId})`, `Removed ${existing.role}`);
        forwardDiscordAudit("staff", "Staff Removed", `**${existing.label}** (${targetDiscordId}) removed from roster.`, actorName);
        feedback = `Removed ${existing.label} from staff roster.`;
        break;
      }

      default:
        throw new Error(`Unknown admin action: ${req.action}`);
    }

    await sendDashboardState(actor, staff, { tone: "success", message: feedback });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const staff = await getStaffRecord(actor);
    if (staff) {
      await sendDashboardState(actor, staff, { tone: "error", message });
    } else {
      notifyPlayer(actor, "Headmaster Error", message, "error");
    }
  }
});

// Client hotkey request to open the Headmaster Admin Panel
Events.onClient("hmp-headmaster:server:requestOpen", async (player: AdminPlayer) => {
  await openAdminPanel(player);
});

// Chat commands: /headmaster, /hm, /hm myid, /hm addadmin <discordId> <role> [label], /hm removeadmin <discordId>
Events.on("chatCommand", (player: AdminPlayer, _message: unknown, rawCommand: unknown, rawArgs: unknown) => {
  const cmd = String(rawCommand || "").toLowerCase();
  const primary = (config.commands.primary || "headmaster").toLowerCase();
  const short = (config.commands.short || "hm").toLowerCase();
  if (cmd !== primary && cmd !== short) return;

  const args = Array.isArray(rawArgs) ? rawArgs.map((a) => String(a)) : [];
  const sub = (args[0] || "").toLowerCase();

  void (async () => {
    if (sub === "myid" || sub === "id") {
      const discordId = await resolveDiscordId(player);
      const staff = await getStaffRecord(player);
      player.sendChat?.(
        discordId
          ? `[${RESOURCE_NAME}] Your Discord ID is ${discordId}${staff ? ` (Role: ${staff.role})` : ""}.`
          : `[${RESOURCE_NAME}] No Discord ID detected. Make sure Discord is running before launching HogwartsMP.`
      );
      return;
    }

    if (sub === "addadmin" && args.length >= 3) {
      const { staff } = await requireRole(player, "headmaster");
      const targetId = args[1].trim();
      const role = args[2].toLowerCase() as AdminRole;
      const label = args.slice(3).join(" ").trim().slice(0, 64) || "Hogwarts Staff";
      if (!isValidDiscordId(targetId)) {
        player.sendChat?.(`[${RESOURCE_NAME}] Invalid Discord ID. Usage: /${short} addadmin <discordId> <headmaster|professor|prefect> [label]`);
        return;
      }
      if (isRootAdmin(targetId)) {
        player.sendChat?.(`[${RESOURCE_NAME}] Root Admin cannot be modified.`);
        return;
      }
      if (!["headmaster", "professor", "prefect"].includes(role)) {
        player.sendChat?.(`[${RESOURCE_NAME}] Role must be headmaster, professor, or prefect.`);
        return;
      }
      if (staff.role !== "root" && targetId === staff.discordId) {
        player.sendChat?.(`[${RESOURCE_NAME}] You cannot modify your own role.`);
        return;
      }
      if (staff.role !== "root" && ROLE_GRADE[role] >= ROLE_GRADE[staff.role]) {
        player.sendChat?.(`[${RESOURCE_NAME}] You can only grant roles strictly below your own.`);
        return;
      }
      staffMap.set(targetId, {
        discordId: targetId,
        label,
        role,
        addedAt: new Date().toISOString().slice(0, 10),
        addedBy: player.nickname || staff.label,
      });
      persistStaffRoster();
      for (const online of PlayerManager.getAll?.() ?? []) {
        const onlineDiscord = await resolveDiscordId(online);
        if (onlineDiscord === targetId) {
          await syncCoreAdminGroupForPlayer(online);
        }
      }
      recordAudit(player.nickname || staff.label, staff.discordId, "staff", "Add Staff (Chat)", `${label} (${targetId})`, `Role: ${role}`);
      player.sendChat?.(`[${RESOURCE_NAME}] Added ${label} (${targetId}) as ${role}.`);
      return;
    }

    if (sub === "removeadmin" && args.length >= 2) {
      const { staff } = await requireRole(player, "headmaster");
      const targetId = args[1].trim();
      if (isRootAdmin(targetId)) {
        player.sendChat?.(`[${RESOURCE_NAME}] Configured Root Admin cannot be removed in-game.`);
        return;
      }
      if (staff.role !== "root" && targetId === staff.discordId) {
        player.sendChat?.(`[${RESOURCE_NAME}] You cannot remove your own staff access.`);
        return;
      }
      const existing = staffMap.get(targetId);
      if (!existing) {
        player.sendChat?.(`[${RESOURCE_NAME}] Discord ID ${targetId} is not on the staff roster.`);
        return;
      }
      if (staff.role !== "root" && ROLE_GRADE[existing.role] >= ROLE_GRADE[staff.role]) {
        player.sendChat?.(`[${RESOURCE_NAME}] You cannot remove a staff member of equal or higher rank.`);
        return;
      }
      staffMap.delete(targetId);
      persistStaffRoster();
      await revokeCoreAdminGroupForDiscordId(targetId);
      recordAudit(player.nickname || staff.label, staff.discordId, "staff", "Remove Staff (Chat)", `${existing.label} (${targetId})`, `Removed ${existing.role}`);
      player.sendChat?.(`[${RESOURCE_NAME}] Removed ${existing.label} (${targetId}) from staff.`);
      return;
    }

    await openAdminPanel(player);
  })().catch((err) => {
    player.sendChat?.(`[${RESOURCE_NAME}] ${err instanceof Error ? err.message : String(err)}`);
  });
});

Events.on("playerConnect", (player: AdminPlayer) => {
  void enforceBanIfNeeded(player);
});

Events.on("hmp:character:loaded", (payload: unknown) => {
  const player = (payload as { session?: { player?: AdminPlayer }; player?: AdminPlayer })?.session?.player
    ?? (payload as { player?: AdminPlayer })?.player;
  if (!player) return;
  void (async () => {
    const banned = await enforceBanIfNeeded(player);
    if (!banned) {
      await syncCoreAdminGroupForPlayer(player);
    }
  })();
});

Events.on("playerDisconnect", (player: AdminPlayer) => {
  frozenPlayers.delete(player.id);
});

Events.on("resourceStop", (name?: string) => {
  if (!name || name === RESOURCE_NAME) {
    for (const p of PlayerManager.getAll?.() ?? []) {
      if (frozenPlayers.has(p.id)) {
        p.releaseHold?.(FREEZE_HOLD_OWNER);
        sendClient(p, "hmp-headmaster:client:freeze", { frozen: false });
      }
    }
    frozenPlayers.clear();
  }
});

hydrateStaffRoster();

Exports.register("staff", {
  getRole: async (player: AdminPlayer) => (await getStaffRecord(player))?.role ?? null,
  isStaff: async (player: AdminPlayer) => Boolean(await getStaffRecord(player)),
  list: () => Array.from(staffMap.values()),
  rootDiscordIds: () => [...ROOT_DISCORD_IDS],
});

Exports.register("bans", {
  list: () => bans.filter((b) => b.expiresAtMs === null || b.expiresAtMs > Date.now()),
  checkDiscordId: (discordId: string) => getActiveBan(discordId),
  kick: (opts: { targetId: number; reason?: string; actorName?: string; actorDiscordId?: string }) => {
    const target = findPlayerById(Number(opts?.targetId));
    if (!target) return { ok: false, error: "Target player not found online." };
    const targetDirectDiscord = String(target.discordId ?? "").trim();
    if (targetDirectDiscord && isRootAdmin(targetDirectDiscord)) {
      return { ok: false, error: "Root Admin is protected from kicks." };
    }
    const reason = String(opts?.reason || "Removed by Hogwarts staff.").trim().slice(0, 220) || "Removed by Hogwarts staff.";
    const actorName = String(opts?.actorName || "Discord Staff").slice(0, 64);
    const actorDiscordId = String(opts?.actorDiscordId || "discord").slice(0, 32);
    recordAudit(actorName, actorDiscordId, "player", "Kick", target.nickname || `#${target.id}`, reason);
    target.kick?.(reason);
    return { ok: true, playerName: target.nickname || `#${target.id}` };
  },
  ban: (opts: {
    discordId: string;
    playerName?: string;
    reason?: string;
    actorName?: string;
    actorDiscordId?: string;
    hours?: number;
  }) => {
    const targetDiscord = String(opts?.discordId || "").trim();
    if (!targetDiscord || !isValidDiscordId(targetDiscord)) {
      return { ok: false, error: "Valid Discord ID is required to record a ban." };
    }
    if (isRootAdmin(targetDiscord)) {
      return { ok: false, error: "Root Admin cannot be banned." };
    }
    const reason = String(opts?.reason || "Expelled by Headmaster.").trim().slice(0, 220) || "Expelled by Headmaster.";
    const rawHours = Number(opts?.hours ?? 0);
    const hours = Number.isFinite(rawHours) && rawHours > 0 ? Math.min(87600, Math.round(rawHours)) : 0;
    const expiresAtMs = hours > 0 ? Date.now() + hours * 3600_000 : null;
    const actorName = String(opts?.actorName || "Discord Staff").slice(0, 64);
    const actorDiscordId = String(opts?.actorDiscordId || "discord").slice(0, 32);
    const playerName = String(opts?.playerName || targetDiscord).trim().slice(0, 64) || targetDiscord;

    const ban: BanRecord = {
      id: `ban-${Date.now().toString(36)}-${(++seq).toString(36)}`,
      discordId: targetDiscord,
      playerName,
      reason,
      bannedBy: actorName,
      bannedByDiscordId: actorDiscordId,
      createdAt: new Date().toISOString(),
      expiresAtMs,
    };
    bans = [ban, ...bans.filter((b) => b.discordId !== targetDiscord)];
    saveJsonFile(BAN_STORE_PATH, bans);
    recordAudit(
      actorName,
      actorDiscordId,
      "player",
      hours > 0 ? `Ban (${hours}h)` : "Permanent Ban",
      `${playerName} (${targetDiscord})`,
      reason
    );
    broadcastGlobalBanNotice(playerName, reason, hours);
    return { ok: true, ban };
  },
  unban: (opts: { discordId?: string; banId?: string; actorName?: string; actorDiscordId?: string }) => {
    const discordId = String(opts?.discordId || "").trim();
    const banId = String(opts?.banId || "").trim();
    const existing = bans.find((b) => (discordId && b.discordId === discordId) || (banId && b.id === banId));
    if (!existing) return { ok: false, error: "Ban record not found for that Discord ID." };
    bans = bans.filter((b) => b.id !== existing.id);
    saveJsonFile(BAN_STORE_PATH, bans);
    recordAudit(
      String(opts?.actorName || "Discord Staff").slice(0, 64),
      String(opts?.actorDiscordId || "discord").slice(0, 32),
      "player",
      "Unban",
      `${existing.playerName} (${existing.discordId})`,
      "Ban revoked"
    );
    return { ok: true, unbanned: existing };
  },
});

Exports.register("audit", {
  recent: (limit = 50) => auditLog.slice(0, Math.max(1, Math.min(500, Math.trunc(Number(limit) || 50)))),
});

if (ROOT_DISCORD_IDS.length === 0) {
  logger.warn(
    `${RESOURCE_NAME} has no rootAdminDiscordIds configured yet in data/${RESOURCE_NAME}.json! Run /${config.commands.short} myid in-game, add your 17-20 digit Discord ID to data/${RESOURCE_NAME}.json -> rootAdminDiscordIds, and restart the resource.`
  );
} else {
  logger.info(
    `${RESOURCE_NAME} ready · Root Admin IDs: ${ROOT_DISCORD_IDS.join(", ")} · ${staffMap.size} staff loaded · Commands: /${config.commands.primary}, /${config.commands.short}`
  );
}
