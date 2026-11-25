# hmp-headmaster — Hogwarts Headmaster Administration System

Production-ready administration panel for **ArcaneMP (HogwartsMP Foundations)** powered by **Discord ID** authorization — engineered to run cleanly alongside Foundations' built-in `hmp-admin` without resource name collisions.

## Root Admin Configuration (Required Before First Use)

No third-party Discord IDs are baked into this resource. Configure your server owner / co-owner Discord IDs using either option below:

1. **Before exporting (Workbench Configurator)**: Enter your 17–20 digit **Primary Root Admin Discord ID** (and any co-owners) in the Headmaster Configurator so it is pre-written to `data/hmp-headmaster.json`.
2. **After installing on your server**:
   - Join the server and run `/hm myid` in chat to print your detected 17–20 digit Discord ID.
   - Open `data/hmp-headmaster.json` and add your ID inside `"rootAdminDiscordIds": ["YOUR_DISCORD_ID"]`.
   - Restart `hmp-headmaster` (or the server).

> **Note**: `rootAdminDiscordIds` is currently empty in `data/hmp-headmaster.json`. Add your Discord ID before granting in-game staff roles.

Configured Root Admins are protected from in-game demotion, freezes, kicks, and bans, and automatically sync with `hmp-core` `admin` (Grade 4) when `syncCoreAdminGroup` is enabled.

## Role Hierarchy (RBAC)

| Role | Grade | Capabilities |
| :--- | :---: | :--- |
| **Root Admin** | 4 | Configured via `data/hmp-headmaster.json` · Full panel + protected from moderation |
| **Headmaster** | 3 | Discord-ID bans/unbans, large Galleon grants (>10k), world reset/PvP, staff management |
| **Professor** | 2 | Teleports, revive, Galleons, flying brooms/gear, House Cup points, Force Re-Sort, spell grants, weather/time |
| **Prefect** | 1 | Go To, Bring, Freeze/Unfreeze, Direct Notices, Warnings, Kick |

## Included Modules

1. **Players & Moderation**: Live student roster search, Vault & Coin Purse balances, Go To / Bring, Hogwarts landmark & X/Y/Z coordinate teleport, Freeze/Unfreeze (`player.hold` + `hmp-lib` input lock), Revive, Direct Owl-Post Notices, Warnings, Kick, timed/permanent online & offline Discord-ID Bans (`expiresAtMs` support), **Galleons & Banking** (`hmp-banking` Vault + `native:galleons` Coin Purse), **Flying Broom Granting** (`hmp-inventory`), Gear/Item Granting, and optional No-Clip bridge.
2. **Houses & House Cup (`hmp-houses` + `hmp-sorting`)**: Live House Cup standings, point adjustments with optional global broadcast, direct House assignment/clearing, and **Force Re-Sort**.
3. **Spells & Curriculum (`hmp-spells`)**: Live searchable spell catalog, per-spell grant/revoke, one-click curriculum packs, and personal grant clearing.
4. **World & Server (`hmp-world` + `hmp-pvp`)**: Weather profiles, seasons, time presets, world reset, server-wide announcements, and Lethal PvP toggle.
5. **Staff Roster & Audit Log**: Live Discord-ID staff management persisted atomically to `data/hmp-headmaster-staff.json`, Discord-ID bans in `data/hmp-headmaster-bans.json`, and bounded audit history in `data/hmp-headmaster-audit.json`.

## Optional Resource Bridges

- `dg-notify`: Routes toast alerts through your custom notification HUD when loaded (falls back to native chat/events automatically).
- `dg-discord`: Mirrors in-game warnings, kicks, bans, unbans, PvP toggles, and staff roster changes to Discord audit webhooks cleanly without duplicate logs.
- `hmp-academy`: Optional attendance/year integration hooks.

## Installation

1. Extract the archive into your ArcaneMP server root so you have:
   - `resources/hmp-headmaster/`
   - `data/hmp-headmaster.json`
2. Install dependencies, verify types, and build inside `resources/hmp-headmaster`:
   ```bash
   cd resources/hmp-headmaster
   npm install
   npm run typecheck
   npm run build
   ```
3. Configure `rootAdminDiscordIds` in `data/hmp-headmaster.json` if not set before export.
4. Start/restart your server and press **`F6`** or run **`/headmaster`** (or **`/hm`**).

## Chat Commands

- `/headmaster` or `/hm` — Open the Headmaster Administration Panel
- `/hm myid` — Print your detected Discord ID in chat
- `/hm addadmin <discordId> <headmaster|professor|prefect> [Name]` — Add staff (Root Admin only)
- `/hm removeadmin <discordId>` — Remove staff and revoke synced Core admin grade (Root Admin only)

## Cross-Resource Exports API

Other Foundations resources can access Headmaster via `Imports.get("hmp-headmaster")`:

- `staff.list()`, `staff.getRole(player)`, `staff.isStaff(player)`, `staff.rootDiscordIds()`
- `bans.list()`, `bans.checkDiscordId(discordId)`, `bans.kick({ targetId, reason, actorName, actorDiscordId })`, `bans.ban(...)`, `bans.unban({ discordId, banId, actorName, actorDiscordId })`
- `audit.recent(limit)`
