<p align="center">
  <img src="./hmp-headmaster-logo.jpg" alt="hmp-headmaster logo" width="220" />
</p>

<h1 align="center">hmp-headmaster</h1>

<p align="center">
  <strong>Production-Ready Hogwarts Headmaster Administration Panel for ArcaneMP Foundations</strong><br />
  Discord-ID RBAC · Live Moderation & Bans · Gringotts & Purse Economy · House Cup & Force Re-Sort · Spells, Brooms & World Control
</p>

---

## ✨ Highlights

- **Discord-ID Role Hierarchy (4 Tiers)** — Protected **Root Admin (Grade 4)** via `data/hmp-headmaster.json`, plus persistent **Headmaster (3)**, **Professor (2)**, and **Prefect (1)** staff stored in `data/hmp-headmaster-staff.json` (with optional `hmp-core` admin sync).
- **Zero-Collision Architecture** — Built to run cleanly alongside Foundations' `hmp-admin` without command or resource name conflicts.
- **Players & Moderation** — Live roster search, Go To / Bring, Hogwarts landmarks & X/Y/Z teleports, Freeze/Unfreeze (`hmp-lib` input lock), Revive, Owl-Post Notices, Warnings, Kick, and online/offline **timed or permanent Discord-ID Bans** (`data/hmp-headmaster-bans.json`).
- **Economy, Brooms & Gear** — Credit or deduct **Gringotts Vault** (`hmp-banking`) and **Coin Purse** (`native:galleons`), grant flying brooms and Hogwarts outfits via `hmp-inventory`.
- **Houses & House Cup** — Live House Cup standings, global broadcast point awards, manual House assignment/clearing, and **Force Re-Sort** (`hmp-houses` + `hmp-sorting`).
- **Spells & Curriculum** — Live searchable spell catalog, single-spell grant/revoke, one-click curriculum packs, and grant clearing (`hmp-spells`).
- **World, PvP & Audit Log** — Weather profiles, seasons, time presets, world reset, server announcements (`hmp-world` + `hmp-pvp`), and bounded JSON audit logs (`data/hmp-headmaster-audit.json`).
- **Optional Bridges** — Auto-integrates with `dg-notify` (custom HUD alerts) and `dg-discord` (Discord audit webhooks) with no extra config.

---

## 📦 Installation

1. Download the release archive and extract **directly into your ArcaneMP server root** so you have:
   - `resources/hmp-headmaster/`
   - `data/hmp-headmaster.json`
2. Install dependencies, verify types, and build inside `resources/hmp-headmaster`:
   ```bash
   cd resources/hmp-headmaster
   npm install
   npm run typecheck
   npm run build
   ```
3. Set your Root Admin Discord ID in `data/hmp-headmaster.json`:
   ```json
   {
     "rootAdminDiscordIds": ["YOUR_17_TO_20_DIGIT_DISCORD_ID"]
   }
   ```
   *(Tip: join your server and type `/hm myid` in chat to print your Discord ID.)*
4. Restart your server and open the panel in-game with **`F6`**, **`/headmaster`**, or **`/hm`**.

---

## 💬 Commands

| Command | Access | Description |
| :--- | :--- | :--- |
| `/headmaster` / `/hm` / `F6` | Staff | Open the Headmaster Console |
| `/hm myid` | Everyone | Print your detected Discord ID |
| `/hm addadmin <discordId> <headmaster\|professor\|prefect> [Name]` | Root Admin | Add staff member |
| `/hm removeadmin <discordId>` | Root Admin | Remove staff member |

---

## 🔌 Cross-Resource Exports

```ts
const headmaster = Imports.get("hmp-headmaster");
// headmaster.staff.list() | staff.getRole(player) | staff.isStaff(player) | staff.rootDiscordIds()
// headmaster.bans.list() | bans.checkDiscordId(id) | bans.kick(...) | bans.ban(...) | bans.unban(...)
// headmaster.audit.recent(limit)
```

---

## 📄 License

MIT
