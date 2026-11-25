// Self-contained NUI controller for Headmaster Administration Panel
(function () {
  const FALLBACK_SPELLS = [{"id":"Lumos","name":"Lumos"},{"id":"Revelio","name":"Revelio"},{"id":"Reparo","name":"Reparo"},{"id":"Disillusionment","name":"Disillusionment"},{"id":"WingardiumLeviosa","name":"Wingardium Leviosa"},{"id":"Alohomora","name":"Alohomora"},{"id":"Levioso","name":"Levioso"},{"id":"Glacius","name":"Glacius"},{"id":"ArrestoMomentum","name":"Arresto Momentum"},{"id":"Transformation","name":"Transformation"},{"id":"Accio","name":"Accio"},{"id":"Depulso","name":"Depulso"},{"id":"Descendo","name":"Descendo"},{"id":"Flipendo","name":"Flipendo"},{"id":"Incendio","name":"Incendio"},{"id":"Expelliarmus","name":"Expelliarmus"},{"id":"Confringo","name":"Confringo"},{"id":"Diffindo","name":"Diffindo"},{"id":"Bombarda","name":"Bombarda"},{"id":"Crucio","name":"Crucio"},{"id":"Imperio","name":"Imperio"},{"id":"AvadaKedavra","name":"Avada Kedavra"}];
  const FALLBACK_BROOMS = [{"id":"native:broommoontrimmer","label":"Moon Trimmer"},{"id":"native:broomyewweaver","label":"Yew Weaver"},{"id":"native:broomwindwisp","label":"Wind Wisp"},{"id":"native:broomemberdash","label":"Ember Dash"},{"id":"native:broomlicketyswift","label":"Lickety Swift"},{"id":"native:broombrightspark","label":"Bright Spark"},{"id":"native:broomnightdancer","label":"Night Dancer"},{"id":"native:broomwildfire","label":"Wildfire"},{"id":"native:broomsilverarrow","label":"Silver Arrow"}];

  const state = {
    tab: "players",
    snapshot: null,
    selectedPlayerId: null,
    selectedLandmarkId: null,
    selectedBroomId: "native:broommoontrimmer",
    moneyDestination: "bank",
    moneyAmount: "500",
    itemId: "Back_001_Basic",
    coordX: "",
    coordY: "",
    coordZ: "",
    modReason: "",
    banHours: "0",
    offlineBanDiscordId: "",
    offlineBanName: "",
    offlineBanReason: "",
    offlineBanHours: "0",
    pointsHouse: "gryffindor",
    pointsReason: "",
    announceTitle: "Headmaster Decree",
    announceMsg: "",
    staffRole: "professor",
    staffIdInput: "",
    staffLabelInput: "",
    playerFilter: "",
    spellFilter: "",
  };

  const els = {
    actorMeta: document.getElementById("hm-actor-meta"),
    tabs: document.getElementById("hm-tabs"),
    body: document.getElementById("hm-body"),
    toast: document.getElementById("hm-toast"),
    refresh: document.getElementById("hm-refresh"),
    close: document.getElementById("hm-close"),
  };

  function emitClient(eventName, payload) {
    try {
      if (typeof callEvent === "function") {
        callEvent(eventName, JSON.stringify(payload || {}));
        return;
      }
    } catch (_) {}
  }

  function sendAction(action, payload) {
    emitClient("action", { action, payload: payload || {} });
  }

  function showToast(toast) {
    if (!toast || !toast.message) return;
    els.toast.textContent = toast.message;
    els.toast.className = "hm-toast" + (toast.tone === "error" ? " error" : "");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      els.toast.classList.add("hidden");
    }, 4000);
  }

  function escapeHtml(val) {
    return String(val == null ? "" : val)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatBanExpiry(expiresAtMs) {
    if (!expiresAtMs) return "Permanent";
    const ms = Number(expiresAtMs) - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return "Expired";
    const mins = Math.ceil(ms / 60000);
    if (mins < 60) return mins + "m left";
    const hrs = Math.ceil(mins / 60);
    if (hrs < 48) return hrs + "h left";
    return new Date(Number(expiresAtMs)).toLocaleDateString();
  }

  function closeAllDropdowns() {
    els.body.querySelectorAll(".hm-dd.open").forEach(function (dd) {
      dd.classList.remove("open");
    });
  }

  // Custom dark in-DOM dropdown helper (eliminates Windows CEF white <select> menus)
  function renderDropdownHtml(id, options, selectedValue, placeholder) {
    const items = options || [];
    const active = items.find(function (o) { return String(o.value) === String(selectedValue); }) || items[0] || null;
    const label = active ? active.label : (placeholder || "Select...");
    const val = active ? String(active.value) : "";
    return (
      '<div class="hm-dd" id="' + escapeHtml(id) + '" data-value="' + escapeHtml(val) + '">' +
        '<button type="button" class="hm-dd-trigger" data-dd-trigger="' + escapeHtml(id) + '">' +
          '<span class="hm-dd-label">' + escapeHtml(label) + '</span>' +
          '<span class="hm-dd-caret">&#9662;</span>' +
        '</button>' +
        '<div class="hm-dd-menu">' +
          (items.length
            ? items.map(function (opt) {
                const isSel = String(opt.value) === val;
                return (
                  '<button type="button" class="hm-dd-item' + (isSel ? " selected" : "") + '" data-dd-opt="' + escapeHtml(id) + '" data-val="' + escapeHtml(opt.value) + '" data-label="' + escapeHtml(opt.label) + '">' +
                    '<span>' + escapeHtml(opt.label) + '</span>' +
                    (isSel ? '<span style="color:#C8A252;">&#10003;</span>' : '') +
                  '</button>'
                );
              }).join("")
            : '<div class="hm-dd-item" style="color:#7F889D;cursor:default;">No options available</div>') +
        '</div>' +
      '</div>'
    );
  }

  function bindDropdown(id, onSelect) {
    const root = document.getElementById(id);
    if (!root) return;
    const trigger = root.querySelector("[data-dd-trigger]");
    if (trigger) {
      trigger.addEventListener("click", function (e) {
        e.stopPropagation();
        const wasOpen = root.classList.contains("open");
        closeAllDropdowns();
        if (!wasOpen) root.classList.add("open");
      });
    }
    root.querySelectorAll("[data-dd-opt]").forEach(function (optBtn) {
      optBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        const val = optBtn.getAttribute("data-val") || "";
        const label = optBtn.getAttribute("data-label") || "";
        root.setAttribute("data-value", val);
        const lblEl = root.querySelector(".hm-dd-label");
        if (lblEl) lblEl.textContent = label;
        root.querySelectorAll(".hm-dd-item").forEach(function (item) {
          item.classList.toggle("selected", item === optBtn);
        });
        root.classList.remove("open");
        if (typeof onSelect === "function") onSelect(val, label);
      });
    });
  }

  function getDropdownValue(id) {
    const el = document.getElementById(id);
    return el ? (el.getAttribute("data-value") || "") : "";
  }

  document.addEventListener("click", function () {
    closeAllDropdowns();
  });

  function bindDraftInput(id, stateKey) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", function (e) {
      state[stateKey] = e.target.value;
    });
  }

  function getSelectedPlayer() {
    const list = (state.snapshot && state.snapshot.players) || [];
    const match = list.find(function (p) { return p.id === state.selectedPlayerId; });
    if (match) return match;
    if (list.length > 0) {
      state.selectedPlayerId = list[0].id;
      return list[0];
    }
    return null;
  }

  function buildPlayerRosterHtml() {
    const snap = state.snapshot;
    const sel = getSelectedPlayer();
    const filtered = (snap.players || []).filter(function (p) {
      if (!state.playerFilter) return true;
      const q = state.playerFilter.toLowerCase();
      return (
        String(p.id).includes(q) ||
        (p.nickname || "").toLowerCase().includes(q) ||
        (p.characterName || "").toLowerCase().includes(q) ||
        (p.discordId || "").includes(q)
      );
    });
    if (!filtered.length) return '<p class="hm-meta">No matching students.</p>';
    return filtered
      .map(function (p) {
        return (
          '<button type="button" class="hm-row-btn' + (sel && sel.id === p.id ? " selected" : "") + '" data-select-player="' + p.id + '">' +
            '<div class="hm-row-top"><span>#' + p.id + " · " + escapeHtml(p.characterName) + '</span><span>' + escapeHtml(p.house || "Unsorted") + "</span></div>" +
            '<div class="hm-row-sub">' + escapeHtml(p.nickname) + " · Discord " + escapeHtml(p.discordId) + (p.frozen ? " · FROZEN" : "") + "</div>" +
          "</button>"
        );
      })
      .join("");
  }

  function bindPlayerRosterButtons() {
    const rosterEl = document.getElementById("hm-player-roster");
    if (!rosterEl) return;
    rosterEl.querySelectorAll("[data-select-player]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.selectedPlayerId = Number(btn.getAttribute("data-select-player"));
        renderCurrentTab();
      });
    });
  }

  function renderPlayersTab() {
    const snap = state.snapshot;
    const sel = getSelectedPlayer();
    const landmarks = snap.landmarks || [];
    const gear = snap.quickGearItems || [];
    const brooms = (snap.brooms && snap.brooms.length) ? snap.brooms : FALLBACK_BROOMS;
    const rosterHtml = buildPlayerRosterHtml();

    const detailHtml = sel
      ? (
        "<h2>" + escapeHtml(sel.characterName) + " (#" + sel.id + " · " + escapeHtml(sel.nickname) + ")</h2>" +
        '<div class="hm-row-sub">Discord ID: ' + escapeHtml(sel.discordId) + " · House: " + escapeHtml(sel.house || "Unsorted") + " · Vault: " + Number(sel.bankGalleons || 0).toLocaleString() + " G · Purse: " + Number(sel.purseGalleons || 0).toLocaleString() + " G · Coords: " + sel.coords.x + ", " + sel.coords.y + ", " + sel.coords.z + " · Ping: " + sel.ping + "ms</div>" +
        "<h3>Quick Actions</h3>" +
        '<div class="hm-btn-grid">' +
          '<button type="button" class="hm-btn-secondary" data-act="player:goto">Go To Player</button>' +
          '<button type="button" class="hm-btn-secondary" data-act="player:bring">Bring Here</button>' +
          '<button type="button" class="hm-btn-secondary" data-act="player:freeze">' + (sel.frozen ? "Unfreeze" : "Freeze") + "</button>" +
          '<button type="button" class="hm-btn-secondary" data-act="player:revive">Revive</button>' +
          (snap.hasSortingResource ? '<button type="button" class="hm-btn-secondary" data-act="houses:forceResort">Force Re-Sort</button>' : "") +
          (snap.hasNoclipBridge ? '<button type="button" class="hm-btn-secondary" data-act="self:noclip">Toggle My No-Clip</button>' : "") +
        "</div>" +
        "<h3>Teleport to Hogwarts Landmark or Coordinates</h3>" +
        '<div class="hm-form-row">' +
          renderDropdownHtml(
            "hm-landmark-select",
            landmarks.map(function (l) { return { value: l.id, label: l.name + " (" + l.region + ")" }; }),
            state.selectedLandmarkId || (landmarks[0] && landmarks[0].id) || "",
            "Select landmark..."
          ) +
          '<button type="button" class="hm-btn-primary" id="hm-btn-tp-landmark" style="flex:0 0 auto;">Teleport</button>' +
        "</div>" +
        '<div class="hm-form-row" style="margin-top:8px;">' +
          '<input id="hm-coord-x" class="hm-input hm-mono" type="number" step="1" value="' + escapeHtml(state.coordX) + '" placeholder="X (' + escapeHtml(sel.coords.x) + ')" />' +
          '<input id="hm-coord-y" class="hm-input hm-mono" type="number" step="1" value="' + escapeHtml(state.coordY) + '" placeholder="Y (' + escapeHtml(sel.coords.y) + ')" />' +
          '<input id="hm-coord-z" class="hm-input hm-mono" type="number" step="1" value="' + escapeHtml(state.coordZ) + '" placeholder="Z (' + escapeHtml(sel.coords.z) + ')" />' +
          '<button type="button" class="hm-btn-secondary" id="hm-btn-tp-coords" style="flex:0 0 auto;">TP Coords</button>' +
        "</div>" +
        "<h3>Galleons & Banking (hmp-banking / native:galleons)</h3>" +
        '<div class="hm-form-row">' +
          renderDropdownHtml(
            "hm-money-dest",
            [
              { value: "bank", label: "Gringotts Bank (Vault)" },
              { value: "purse", label: "Coin Purse (Pocket)" },
            ],
            state.moneyDestination,
            "Select destination..."
          ) +
          '<input id="hm-money-amount" class="hm-input hm-mono" type="number" min="1" step="50" value="' + escapeHtml(state.moneyAmount) + '" placeholder="Amount" style="flex:0 0 110px;" />' +
          '<button type="button" class="hm-btn-primary" id="hm-btn-give-money" style="flex:0 0 auto;">Give Galleons</button>' +
          '<button type="button" class="hm-btn-danger" id="hm-btn-take-money" style="flex:0 0 auto;">Deduct</button>' +
        "</div>" +
        '<div class="hm-btn-grid">' +
          '<button type="button" class="hm-btn-secondary" data-quick-money="100">+100 G</button>' +
          '<button type="button" class="hm-btn-secondary" data-quick-money="500">+500 G</button>' +
          '<button type="button" class="hm-btn-secondary" data-quick-money="1000">+1,000 G</button>' +
          '<button type="button" class="hm-btn-secondary" data-quick-money="5000">+5,000 G</button>' +
        "</div>" +
        "<h3>Grant Flying Broom (hmp-inventory)</h3>" +
        '<div class="hm-form-row">' +
          renderDropdownHtml(
            "hm-broom-select",
            brooms.map(function (b) { return { value: b.id, label: b.label }; }),
            state.selectedBroomId || (brooms[0] && brooms[0].id) || "",
            "Select flying broom..."
          ) +
          '<button type="button" class="hm-btn-primary" id="hm-btn-give-broom" style="flex:0 0 auto;">Give Broom</button>' +
        "</div>" +
        '<div class="hm-btn-grid">' +
          brooms.slice(0, 5).map(function (b) { return '<button type="button" class="hm-btn-secondary" data-quick-broom="' + escapeHtml(b.id) + '">' + escapeHtml(b.label) + "</button>"; }).join("") +
        "</div>" +
        "<h3>Grant Gear / Item (hmp-inventory)</h3>" +
        '<div class="hm-form-row">' +
          '<input id="hm-item-id" class="hm-input" placeholder="Native Item ID (e.g. Back_001_Basic)" value="' + escapeHtml(state.itemId) + '" />' +
          '<button type="button" class="hm-btn-primary" id="hm-btn-give-item" style="flex:0 0 auto;">Give Item</button>' +
        "</div>" +
        '<div class="hm-btn-grid">' +
          gear.map(function (g) { return '<button type="button" class="hm-btn-secondary" data-quick-item="' + escapeHtml(g.id) + '">' + escapeHtml(g.label) + "</button>"; }).join("") +
        "</div>" +
        "<h3>Moderation & Notice</h3>" +
        '<div class="hm-form-row">' +
          '<input id="hm-mod-reason" class="hm-input" value="' + escapeHtml(state.modReason) + '" placeholder="Reason or direct owl-post message..." />' +
          '<input id="hm-ban-hours" class="hm-input" type="number" min="0" value="' + escapeHtml(state.banHours) + '" placeholder="Hours (0=Perm)" style="flex:0 0 110px;" />' +
        "</div>" +
        '<div class="hm-btn-grid">' +
          '<button type="button" class="hm-btn-secondary" id="hm-btn-notice">Send Notice</button>' +
          '<button type="button" class="hm-btn-secondary" id="hm-btn-warn">Issue Warning</button>' +
          '<button type="button" class="hm-btn-danger" id="hm-btn-kick">Kick</button>' +
          '<button type="button" class="hm-btn-danger" id="hm-btn-ban">Ban Discord ID</button>' +
        "</div>"
      )
      : '<p class="hm-meta">Select an online student to manage.</p>';

    const bansHtml = (snap.bans || []).length
      ? '<table class="hm-table"><thead><tr><th>Player</th><th>Discord ID</th><th>Reason</th><th>Expires</th><th></th></tr></thead><tbody>' +
        snap.bans.map(function (b) {
          return '<tr><td>' + escapeHtml(b.playerName) + '</td><td class="hm-mono">' + escapeHtml(b.discordId) + '</td><td>' + escapeHtml(b.reason) + '</td><td class="hm-mono">' + escapeHtml(formatBanExpiry(b.expiresAtMs)) + '</td><td><button type="button" class="hm-btn-secondary" data-unban="' + escapeHtml(b.discordId) + '">Unban</button></td></tr>';
        }).join("") +
        "</tbody></table>"
      : '<p class="hm-meta" style="margin-top:8px;">No active Discord ID bans.</p>';

    const offlineBanFormHtml =
      '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border-subtle);">' +
        '<div class="hm-row-sub" style="margin-bottom:6px;">Ban Offline Player by Discord ID</div>' +
        '<div class="hm-form-row">' +
          '<input id="hm-offban-id" class="hm-input hm-mono" value="' + escapeHtml(state.offlineBanDiscordId) + '" placeholder="Discord ID (17-20 digits)" />' +
          '<input id="hm-offban-name" class="hm-input" value="' + escapeHtml(state.offlineBanName) + '" placeholder="Name (optional)" style="flex:0 0 140px;" />' +
          '<input id="hm-offban-hours" class="hm-input hm-mono" type="number" min="0" value="' + escapeHtml(state.offlineBanHours) + '" placeholder="Hours" style="flex:0 0 84px;" />' +
        "</div>" +
        '<div class="hm-form-row" style="margin-top:8px;">' +
          '<input id="hm-offban-reason" class="hm-input" value="' + escapeHtml(state.offlineBanReason) + '" placeholder="Ban reason..." />' +
          '<button type="button" class="hm-btn-danger" id="hm-btn-offban" style="flex:0 0 auto;">Ban Discord ID</button>' +
        "</div>" +
      "</div>";

    els.body.innerHTML =
      '<div class="hm-split">' +
        '<div class="hm-panel">' +
          '<h2>Online Students (' + (snap.players || []).length + ")</h2>" +
          '<input id="hm-player-search" class="hm-input" placeholder="Filter by name, ID, or Discord ID..." value="' + escapeHtml(state.playerFilter) + '" />' +
          '<div class="hm-list" id="hm-player-roster">' + rosterHtml + "</div>" +
        "</div>" +
        '<div style="display:flex;flex-direction:column;gap:16px;">' +
          '<div class="hm-panel">' + detailHtml + "</div>" +
          '<div class="hm-panel"><h2>Active Discord ID Bans</h2>' + bansHtml + offlineBanFormHtml + "</div>" +
        "</div>" +
      "</div>";

    const searchEl = document.getElementById("hm-player-search");
    if (searchEl) {
      searchEl.addEventListener("input", function (e) {
        state.playerFilter = e.target.value;
        const rosterEl = document.getElementById("hm-player-roster");
        if (rosterEl) {
          rosterEl.innerHTML = buildPlayerRosterHtml();
          bindPlayerRosterButtons();
        }
      });
    }

    bindPlayerRosterButtons();

    els.body.querySelectorAll("[data-act]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!sel) return;
        sendAction(btn.getAttribute("data-act"), { targetId: sel.id });
      });
    });

    bindDropdown("hm-landmark-select", function (val) {
      state.selectedLandmarkId = val;
    });

    bindDropdown("hm-money-dest", function (val) {
      state.moneyDestination = val || "bank";
    });

    bindDropdown("hm-broom-select", function (val) {
      state.selectedBroomId = val;
    });

    bindDraftInput("hm-coord-x", "coordX");
    bindDraftInput("hm-coord-y", "coordY");
    bindDraftInput("hm-coord-z", "coordZ");
    bindDraftInput("hm-money-amount", "moneyAmount");
    bindDraftInput("hm-item-id", "itemId");
    bindDraftInput("hm-mod-reason", "modReason");
    bindDraftInput("hm-ban-hours", "banHours");
    bindDraftInput("hm-offban-id", "offlineBanDiscordId");
    bindDraftInput("hm-offban-name", "offlineBanName");
    bindDraftInput("hm-offban-hours", "offlineBanHours");
    bindDraftInput("hm-offban-reason", "offlineBanReason");

    const tpBtn = document.getElementById("hm-btn-tp-landmark");
    if (tpBtn && sel) {
      tpBtn.addEventListener("click", function () {
        const landmarkId = getDropdownValue("hm-landmark-select");
        sendAction("player:teleportLandmark", { targetId: sel.id, landmarkId: landmarkId });
      });
    }

    const tpCoordsBtn = document.getElementById("hm-btn-tp-coords");
    if (tpCoordsBtn && sel) {
      tpCoordsBtn.addEventListener("click", function () {
        const xVal = (document.getElementById("hm-coord-x") || {}).value;
        const yVal = (document.getElementById("hm-coord-y") || {}).value;
        const zVal = (document.getElementById("hm-coord-z") || {}).value;
        if (xVal === "" || yVal === "" || zVal === "") {
          showToast({ tone: "error", message: "Enter X, Y, and Z coordinates." });
          return;
        }
        sendAction("player:teleportCoords", {
          targetId: sel.id,
          x: Number(xVal),
          y: Number(yVal),
          z: Number(zVal),
        });
      });
    }

    const giveMoneyBtn = document.getElementById("hm-btn-give-money");
    if (giveMoneyBtn && sel) {
      giveMoneyBtn.addEventListener("click", function () {
        const amount = Number((document.getElementById("hm-money-amount") || {}).value || 0);
        const destination = getDropdownValue("hm-money-dest") || "bank";
        sendAction("player:money", { targetId: sel.id, operation: "give", destination: destination, amount: amount });
      });
    }

    const takeMoneyBtn = document.getElementById("hm-btn-take-money");
    if (takeMoneyBtn && sel) {
      takeMoneyBtn.addEventListener("click", function () {
        const amount = Number((document.getElementById("hm-money-amount") || {}).value || 0);
        const destination = getDropdownValue("hm-money-dest") || "bank";
        sendAction("player:money", { targetId: sel.id, operation: "remove", destination: destination, amount: amount });
      });
    }

    els.body.querySelectorAll("[data-quick-money]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!sel) return;
        const amount = Number(btn.getAttribute("data-quick-money") || 0);
        const destination = getDropdownValue("hm-money-dest") || "bank";
        sendAction("player:money", { targetId: sel.id, operation: "give", destination: destination, amount: amount });
      });
    });

    const giveBroomBtn = document.getElementById("hm-btn-give-broom");
    if (giveBroomBtn && sel) {
      giveBroomBtn.addEventListener("click", function () {
        const broomId = getDropdownValue("hm-broom-select");
        sendAction("player:giveBroom", { targetId: sel.id, broomId: broomId });
      });
    }

    els.body.querySelectorAll("[data-quick-broom]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!sel) return;
        sendAction("player:giveBroom", { targetId: sel.id, broomId: btn.getAttribute("data-quick-broom") });
      });
    });

    const giveBtn = document.getElementById("hm-btn-give-item");
    if (giveBtn && sel) {
      giveBtn.addEventListener("click", function () {
        const itemId = document.getElementById("hm-item-id").value;
        sendAction("player:giveItem", { targetId: sel.id, itemId: itemId, equipped: false });
      });
    }

    els.body.querySelectorAll("[data-quick-item]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!sel) return;
        sendAction("player:giveItem", { targetId: sel.id, itemId: btn.getAttribute("data-quick-item"), equipped: false });
      });
    });

    const reasonVal = function () { return (document.getElementById("hm-mod-reason") || {}).value || ""; };
    const hoursVal = function () { return Number((document.getElementById("hm-ban-hours") || {}).value || 0); };

    if (sel) {
      const nBtn = document.getElementById("hm-btn-notice");
      if (nBtn) nBtn.addEventListener("click", function () { sendAction("player:notice", { targetId: sel.id, message: reasonVal() }); });
      const wBtn = document.getElementById("hm-btn-warn");
      if (wBtn) wBtn.addEventListener("click", function () { sendAction("player:warn", { targetId: sel.id, reason: reasonVal() }); });
      const kBtn = document.getElementById("hm-btn-kick");
      if (kBtn) kBtn.addEventListener("click", function () { sendAction("player:kick", { targetId: sel.id, reason: reasonVal() }); });
      const bBtn = document.getElementById("hm-btn-ban");
      if (bBtn) bBtn.addEventListener("click", function () { sendAction("player:ban", { targetId: sel.id, reason: reasonVal(), hours: hoursVal() }); });
    }

    const offBanBtn = document.getElementById("hm-btn-offban");
    if (offBanBtn) {
      offBanBtn.addEventListener("click", function () {
        sendAction("player:ban", {
          discordId: (document.getElementById("hm-offban-id") || {}).value || "",
          playerName: (document.getElementById("hm-offban-name") || {}).value || "",
          reason: (document.getElementById("hm-offban-reason") || {}).value || "",
          hours: Number((document.getElementById("hm-offban-hours") || {}).value || 0),
        });
      });
    }

    els.body.querySelectorAll("[data-unban]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        sendAction("player:unban", { discordId: btn.getAttribute("data-unban") });
      });
    });
  }

  function renderHousesTab() {
    const snap = state.snapshot;
    const players = snap.players || [];
    const standings = snap.standings || [];

    const sel = getSelectedPlayer();
    const houseOptions = [
      { value: "gryffindor", label: "Gryffindor" },
      { value: "slytherin", label: "Slytherin" },
      { value: "ravenclaw", label: "Ravenclaw" },
      { value: "hufflepuff", label: "Hufflepuff" },
    ];
    const playerOptions = players.map(function (p) {
      return { value: String(p.id), label: "#" + p.id + " · " + p.characterName + " (" + (p.house || "Unsorted") + ")" };
    });

    els.body.innerHTML =
      '<div class="hm-houses-grid">' +
        standings.map(function (row) {
          return '<div class="hm-house-card"><div class="hm-row-top"><span>' + escapeHtml(row.house.toUpperCase()) + '</span></div><div class="hm-house-pts">' + Number(row.points || 0) + " pts</div></div>";
        }).join("") +
      "</div>" +
      '<div class="hm-split">' +
        '<div class="hm-panel">' +
          "<h2>House Cup Points</h2>" +
          renderDropdownHtml("hm-pts-house", houseOptions, state.pointsHouse, "Select House...") +
          '<input id="hm-pts-reason" class="hm-input" style="margin-top:8px;" value="' + escapeHtml(state.pointsReason) + '" placeholder="Reason (e.g. Brilliant Charms work)" />' +
          '<div class="hm-btn-grid">' +
            ["+5", "+10", "+25", "+50", "-5", "-10", "-25", "-50"].map(function (amt) {
              return '<button type="button" class="' + (amt.startsWith("-") ? "hm-btn-danger" : "hm-btn-primary") + '" data-pts="' + amt + '">' + amt + "</button>";
            }).join("") +
          "</div>" +
        "</div>" +
        '<div class="hm-panel">' +
          "<h2>Student House Administration</h2>" +
          renderDropdownHtml("hm-house-player", playerOptions, sel ? String(sel.id) : "", "Select Student...") +
          '<div class="hm-btn-grid" style="margin-top:12px;">' +
            ["gryffindor", "slytherin", "ravenclaw", "hufflepuff"].map(function (h) {
              return '<button type="button" class="hm-btn-secondary" data-assign-house="' + h + '">Assign ' + h.charAt(0).toUpperCase() + h.slice(1) + "</button>";
            }).join("") +
          "</div>" +
          '<div class="hm-btn-grid" style="margin-top:10px;">' +
            '<button type="button" class="hm-btn-primary" id="hm-btn-resort">Force Re-Sort (Sorting Hat)</button>' +
            '<button type="button" class="hm-btn-danger" id="hm-btn-clear-house">Clear House</button>' +
          "</div>" +
        "</div>" +
      "</div>";

    bindDropdown("hm-pts-house", function (val) {
      state.pointsHouse = val;
    });
    bindDropdown("hm-house-player", function (val) {
      state.selectedPlayerId = Number(val);
    });
    bindDraftInput("hm-pts-reason", "pointsReason");

    els.body.querySelectorAll("[data-pts]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        sendAction("houses:points", {
          house: getDropdownValue("hm-pts-house") || state.pointsHouse,
          amount: Number(btn.getAttribute("data-pts")),
          reason: document.getElementById("hm-pts-reason").value || "House Cup adjustment",
        });
      });
    });

    const targetIdVal = function () { return Number(getDropdownValue("hm-house-player") || state.selectedPlayerId || 0); };
    els.body.querySelectorAll("[data-assign-house]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        sendAction("houses:assign", {
          targetId: targetIdVal(),
          house: btn.getAttribute("data-assign-house"),
          grantRobe: true,
        });
      });
    });

    const resortBtn = document.getElementById("hm-btn-resort");
    if (resortBtn) resortBtn.addEventListener("click", function () { sendAction("houses:forceResort", { targetId: targetIdVal() }); });
    const clearBtn = document.getElementById("hm-btn-clear-house");
    if (clearBtn) clearBtn.addEventListener("click", function () { sendAction("houses:clear", { targetId: targetIdVal() }); });
  }

  function buildSpellGridHtml() {
    const snap = state.snapshot;
    const sel = getSelectedPlayer();
    const catalog = (snap.spellCatalog && snap.spellCatalog.length ? snap.spellCatalog : FALLBACK_SPELLS).filter(function (s) {
      if (!state.spellFilter) return true;
      return (s.name || s.id).toLowerCase().includes(state.spellFilter.toLowerCase());
    });
    const owned = new Set((sel && sel.spells) || []);
    if (!catalog.length) return '<p class="hm-meta">No matching spells.</p>';
    return catalog.slice(0, 60).map(function (sp) {
      const has = owned.has(sp.id) || owned.has(sp.name);
      return '<button type="button" class="' + (has ? "hm-btn-primary" : "hm-btn-secondary") + '" data-toggle-spell="' + escapeHtml(sp.id) + '" data-has="' + (has ? "1" : "0") + '">' + escapeHtml(sp.name) + (has ? " ✓" : "") + "</button>";
    }).join("");
  }

  function bindSpellGridButtons() {
    const gridEl = document.getElementById("hm-spell-grid");
    if (!gridEl) return;
    gridEl.querySelectorAll("[data-toggle-spell]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const sel = getSelectedPlayer();
        if (!sel) return;
        const has = btn.getAttribute("data-has") === "1";
        sendAction(has ? "spells:revoke" : "spells:grant", {
          targetId: sel.id,
          spellId: btn.getAttribute("data-toggle-spell"),
        });
      });
    });
  }

  function renderSpellsTab() {
    const snap = state.snapshot;
    const sel = getSelectedPlayer();

    const playerOptions = (snap.players || []).map(function (p) {
      return { value: String(p.id), label: "#" + p.id + " · " + p.characterName + " (" + (p.spells || []).length + " spells)" };
    });

    els.body.innerHTML =
      '<div class="hm-split">' +
        '<div class="hm-panel">' +
          "<h2>Select Student & Curriculum Packs</h2>" +
          renderDropdownHtml("hm-spell-player", playerOptions, sel ? String(sel.id) : "", "Select Student...") +
          "<h3>Curriculum Spell Packs</h3>" +
          '<div class="hm-list">' +
            (snap.spellPacks || []).map(function (pack) {
              return '<button type="button" class="hm-row-btn" data-spell-pack="' + escapeHtml(pack.id) + '"><div class="hm-row-top"><span>' + escapeHtml(pack.name) + '</span><span>' + pack.spells.length + ' spells</span></div><div class="hm-row-sub">' + escapeHtml(pack.description) + "</div></button>";
            }).join("") +
          "</div>" +
          '<div class="hm-btn-grid" style="margin-top:12px;"><button type="button" class="hm-btn-danger" id="hm-btn-clear-spells">Clear All Personal Grants</button></div>' +
        "</div>" +
        '<div class="hm-panel">' +
          "<h2>Spell Catalog (Click to Grant or Revoke)</h2>" +
          '<input id="hm-spell-search" class="hm-input" placeholder="Search spell name..." value="' + escapeHtml(state.spellFilter) + '" />' +
          '<div class="hm-btn-grid" id="hm-spell-grid" style="margin-top:12px;max-height:500px;overflow-y:auto;">' +
            buildSpellGridHtml() +
          "</div>" +
        "</div>" +
      "</div>";

    bindDropdown("hm-spell-player", function (val) {
      state.selectedPlayerId = Number(val);
      renderCurrentTab();
    });
    const searchEl = document.getElementById("hm-spell-search");
    if (searchEl) {
      searchEl.addEventListener("input", function (e) {
        state.spellFilter = e.target.value;
        const gridEl = document.getElementById("hm-spell-grid");
        if (gridEl) {
          gridEl.innerHTML = buildSpellGridHtml();
          bindSpellGridButtons();
        }
      });
    }
    els.body.querySelectorAll("[data-spell-pack]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!sel) return;
        sendAction("spells:grantPack", { targetId: sel.id, packId: btn.getAttribute("data-spell-pack") });
      });
    });
    bindSpellGridButtons();
    const clearBtn = document.getElementById("hm-btn-clear-spells");
    if (clearBtn && sel) {
      clearBtn.addEventListener("click", function () { sendAction("spells:clear", { targetId: sel.id }); });
    }
  }

  function renderWorldTab() {
    const snap = state.snapshot;
    const env = snap.environment || {};

    els.body.innerHTML =
      '<div class="hm-split">' +
        '<div class="hm-panel">' +
          "<h2>Weather, Season & Time (hmp-world)</h2>" +
          "<h3>Weather Profile</h3>" +
          '<div class="hm-btn-grid">' +
            (snap.weatherProfiles || []).map(function (w) {
              return '<button type="button" class="' + (env.weather === w ? "hm-btn-primary" : "hm-btn-secondary") + '" data-weather="' + escapeHtml(w) + '">' + escapeHtml(w) + "</button>";
            }).join("") +
          "</div>" +
          "<h3>Season</h3>" +
          '<div class="hm-btn-grid">' +
            (snap.seasons || []).map(function (s) {
              return '<button type="button" class="hm-btn-secondary" data-season="' + escapeHtml(s) + '">' + escapeHtml(s) + "</button>";
            }).join("") +
          "</div>" +
          "<h3>Time of Day</h3>" +
          '<div class="hm-btn-grid">' +
            [{ l: "Dawn (06:30)", h: 6, m: 30 }, { l: "Morning (09:00)", h: 9, m: 0 }, { l: "Noon (12:00)", h: 12, m: 0 }, { l: "Sunset (18:30)", h: 18, m: 30 }, { l: "Midnight (00:00)", h: 0, m: 0 }].map(function (t) {
              return '<button type="button" class="hm-btn-secondary" data-time="' + t.h + ":" + t.m + '">' + t.l + "</button>";
            }).join("") +
          "</div>" +
          '<div class="hm-btn-grid" style="margin-top:14px;"><button type="button" class="hm-btn-danger" id="hm-world-reset">Reset World Baseline</button></div>' +
        "</div>" +
        '<div class="hm-panel">' +
          "<h2>Server Broadcast & PvP Policy</h2>" +
          '<input id="hm-ann-title" class="hm-input" placeholder="Announcement Title" value="' + escapeHtml(state.announceTitle) + '" />' +
          '<input id="hm-ann-msg" class="hm-input" style="margin-top:8px;" value="' + escapeHtml(state.announceMsg) + '" placeholder="Message to broadcast to every online student..." />' +
          '<div class="hm-btn-grid" style="margin-top:10px;"><button type="button" class="hm-btn-primary" id="hm-btn-announce">Send Server Announcement</button></div>' +
          "<h3>Server PvP Lethality (hmp-pvp)</h3>" +
          '<div class="hm-btn-grid">' +
            '<button type="button" class="' + (snap.lethalPvpActive ? "hm-btn-danger" : "hm-btn-secondary") + '" id="hm-btn-pvp">' + (snap.lethalPvpActive ? "Disable Lethal PvP" : "Enable Lethal PvP") + "</button>" +
          "</div>" +
        "</div>" +
      "</div>";

    bindDraftInput("hm-ann-title", "announceTitle");
    bindDraftInput("hm-ann-msg", "announceMsg");

    els.body.querySelectorAll("[data-weather]").forEach(function (btn) {
      btn.addEventListener("click", function () { sendAction("world:weather", { weather: btn.getAttribute("data-weather") }); });
    });
    els.body.querySelectorAll("[data-season]").forEach(function (btn) {
      btn.addEventListener("click", function () { sendAction("world:season", { season: btn.getAttribute("data-season") }); });
    });
    els.body.querySelectorAll("[data-time]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const parts = btn.getAttribute("data-time").split(":");
        sendAction("world:time", { hour: Number(parts[0]), minute: Number(parts[1]) });
      });
    });
    document.getElementById("hm-world-reset").addEventListener("click", function () { sendAction("world:reset", {}); });
    document.getElementById("hm-btn-announce").addEventListener("click", function () {
      sendAction("world:announce", {
        title: document.getElementById("hm-ann-title").value,
        message: document.getElementById("hm-ann-msg").value,
        tone: "info",
      });
    });
    document.getElementById("hm-btn-pvp").addEventListener("click", function () {
      sendAction("world:pvpLethal", { enabled: !snap.lethalPvpActive });
    });
  }

  function renderStaffTab() {
    const snap = state.snapshot;
    const roleOptions = [
      { value: "headmaster", label: "Headmaster (Grade 3)" },
      { value: "professor", label: "Professor (Grade 2)" },
      { value: "prefect", label: "Prefect (Grade 1)" },
    ];
    els.body.innerHTML =
      '<div class="hm-split">' +
        '<div class="hm-panel">' +
          "<h2>Add Admin by Discord ID</h2>" +
          '<input id="hm-staff-id" class="hm-input hm-mono" value="' + escapeHtml(state.staffIdInput) + '" placeholder="Discord User ID (17-20 digits)" />' +
          '<input id="hm-staff-label" class="hm-input" style="margin-top:8px;" value="' + escapeHtml(state.staffLabelInput) + '" placeholder="Staff Name / Title" />' +
          '<div style="margin-top:8px;">' +
            renderDropdownHtml("hm-staff-role", roleOptions, state.staffRole, "Select Role...") +
          "</div>" +
          '<div class="hm-btn-grid" style="margin-top:10px;"><button type="button" class="hm-btn-primary" id="hm-btn-add-staff">Add to Staff Roster</button></div>' +
          "<h3>Active Staff Roster</h3>" +
          '<div class="hm-list">' +
            (snap.staffRoster || []).map(function (s) {
              return (
                '<div class="hm-row-btn" style="cursor:default;">' +
                  '<div class="hm-row-top"><span>' + escapeHtml(s.label) + " (" + escapeHtml(s.role.toUpperCase()) + ')</span>' +
                  (s.immutable ? '<span style="color:#C8A252;">CONFIG ROOT</span>' : '<button type="button" class="hm-btn-danger" data-rm-staff="' + escapeHtml(s.discordId) + '" style="padding:2px 8px;">Remove</button>') +
                  "</div>" +
                  '<div class="hm-row-sub">Discord ID: ' + escapeHtml(s.discordId) + "</div>" +
                "</div>"
              );
            }).join("") +
          "</div>" +
        "</div>" +
        '<div class="hm-panel">' +
          "<h2>Recent Staff Audit Log</h2>" +
          '<table class="hm-table"><thead><tr><th>Time</th><th>Staff</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody>' +
            (snap.auditLog || []).map(function (row) {
              return '<tr><td class="hm-mono">' + escapeHtml(row.timestamp) + '</td><td>' + escapeHtml(row.actorName) + '</td><td>' + escapeHtml(row.action) + '</td><td>' + escapeHtml(row.target) + '</td><td>' + escapeHtml(row.details) + "</td></tr>";
            }).join("") +
          "</tbody></table>" +
        "</div>" +
      "</div>";

    bindDropdown("hm-staff-role", function (val) {
      state.staffRole = val;
    });
    bindDraftInput("hm-staff-id", "staffIdInput");
    bindDraftInput("hm-staff-label", "staffLabelInput");

    document.getElementById("hm-btn-add-staff").addEventListener("click", function () {
      sendAction("staff:add", {
        discordId: document.getElementById("hm-staff-id").value,
        label: document.getElementById("hm-staff-label").value,
        role: getDropdownValue("hm-staff-role") || state.staffRole,
      });
    });

    els.body.querySelectorAll("[data-rm-staff]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        sendAction("staff:remove", { discordId: btn.getAttribute("data-rm-staff") });
      });
    });
  }

  function renderCurrentTab() {
    if (!state.snapshot) return;
    const prevFocus = document.activeElement;
    const activeId = prevFocus && prevFocus.id ? prevFocus.id : null;
    const selStart = prevFocus && typeof prevFocus.selectionStart === "number" ? prevFocus.selectionStart : null;
    const selEnd = prevFocus && typeof prevFocus.selectionEnd === "number" ? prevFocus.selectionEnd : null;

    const actor = state.snapshot.actor;
    if (actor) {
      els.actorMeta.textContent = actor.nickname + " · " + actor.role.toUpperCase() + " · Discord " + actor.discordId;
    }
    els.tabs.querySelectorAll(".hm-tab").forEach(function (t) {
      t.classList.toggle("active", t.getAttribute("data-tab") === state.tab);
    });

    if (state.tab === "players") renderPlayersTab();
    else if (state.tab === "houses") renderHousesTab();
    else if (state.tab === "spells") renderSpellsTab();
    else if (state.tab === "world") renderWorldTab();
    else renderStaffTab();

    if (activeId) {
      const nextEl = document.getElementById(activeId);
      if (nextEl && typeof nextEl.focus === "function") {
        nextEl.focus();
        if (selStart !== null && selEnd !== null && typeof nextEl.setSelectionRange === "function") {
          try { nextEl.setSelectionRange(selStart, selEnd); } catch (_) {}
        }
      }
    }
  }

  els.tabs.querySelectorAll(".hm-tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.tab = btn.getAttribute("data-tab");
      renderCurrentTab();
    });
  });

  els.refresh.addEventListener("click", function () {
    sendAction("refresh", {});
  });

  els.close.addEventListener("click", function () {
    emitClient("close", {});
  });

  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (els.body.querySelector(".hm-dd.open")) {
        closeAllDropdowns();
        return;
      }
      emitClient("close", {});
    }
  });

  window.addEventListener("open", function (event) {
    const payload = event && event.detail ? event.detail : null;
    if (!payload || !payload.snapshot) return;
    state.snapshot = payload.snapshot;
    renderCurrentTab();
  });

  window.addEventListener("state", function (event) {
    const payload = event && event.detail ? event.detail : null;
    if (!payload) return;
    if (payload.snapshot) state.snapshot = payload.snapshot;
    if (payload.toast) showToast(payload.toast);
    renderCurrentTab();
  });

  if (typeof callEvent === "function") {
    emitClient("ready", {});
  }
})();
