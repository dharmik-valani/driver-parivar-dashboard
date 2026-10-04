(function () {
  var P = window.Parivar;
  var fromEl = document.getElementById("from");
  var toEl = document.getElementById("to");
  var data = null;
  var live = null;
  var mode = "snapshot";
  var LIVE_URL = window.PAYMENT_AGGREGATES_URL || "";
  var PLAY_URL = window.PLAY_METRICS_URL || "";
  var requestId = 0;
  var inputTimer = null;

  function paintPlayMetrics(payload) {
    var installsEl = document.getElementById("play-installs");
    var uninstallsEl = document.getElementById("play-uninstalls");
    var installsMeta = document.getElementById("play-installs-meta");
    var payoutEl = document.getElementById("play-payout");
    var payoutMeta = document.getElementById("play-payout-meta");
    if (!installsEl || !payoutEl) return;

    var installs = payload && payload.installs;
    if (installs && installs.windowDays > 0) {
      installsEl.textContent = P.formatCount(installs.installs || 0);
      uninstallsEl.textContent = P.formatCount(installs.uninstalls || 0);
      var active = installs.activeDeviceInstalls != null
        ? P.formatCount(installs.activeDeviceInstalls) + " active device installs. "
        : "";
      installsMeta.textContent =
        active +
        "Last " + installs.windowDays + " report days (" +
        (installs.fromDate || "?") + " to " + (installs.toDate || "?") +
        "). Play Console, not Firestore.";
    } else {
      installsEl.textContent = "–";
      uninstallsEl.textContent = "–";
      installsMeta.textContent =
        (installs && installs.error) ||
        "Play install report is not available yet.";
    }

    var payout = payload && payload.payout;
    if (payout && payout.available) {
      payoutEl.textContent = P.formatInr(payout.amount || 0);
      payoutMeta.textContent =
        (payout.note || "Play Console earnings.") +
        " Play Console, not Firestore.";
    } else {
      payoutEl.textContent = "–";
      payoutMeta.textContent =
        (payout && payout.note) ||
        "Play payout report is not available.";
    }
  }

  function loadPlayMetrics() {
    if (!PLAY_URL) {
      paintPlayMetrics({
        installs: { windowDays: 0, error: "Play metrics URL is not configured." },
        payout: { available: false, note: "Play metrics URL is not configured." }
      });
      return Promise.resolve();
    }
    return fetch(PLAY_URL).then(function (res) {
      if (!res.ok) throw new Error("status " + res.status);
      return res.json();
    }).then(function (json) {
      paintPlayMetrics(json);
    }).catch(function (error) {
      paintPlayMetrics({
        installs: {
          windowDays: 0,
          error: "Could not load Play installs (" + (error && error.message) + ")."
        },
        payout: {
          available: false,
          note: "Could not load Play payout (" + (error && error.message) + ")."
        }
      });
    });
  }

  function setChip(id) {
    ["d7", "d30", "dall"].forEach(function (key) {
      document.getElementById(key).classList.toggle("on", key === id);
    });
  }

  function anchorMinute() {
    var basis = mode === "live" || !data
      ? Date.now()
      : new Date(data.generatedAt).getTime();
    return P.fromInputValue(P.toInputValue(basis));
  }

  function rangeFor(days) {
    if (days == null) {
      if (mode !== "snapshot" || !data) {
        return { from: "2026-01-01T00:00", to: P.toInputValue(anchorMinute()), chip: "dall" };
      }
      var first = data.purchases[0].timestamp;
      var last = data.purchases[data.purchases.length - 1].timestamp;
      return { from: P.toInputValue(first), to: P.toInputValue(last), chip: "dall" };
    }
    var end = anchorMinute();
    return {
      from: P.toInputValue(end - days * 24 * 60 * 60 * 1000),
      to: P.toInputValue(end),
      chip: days === 7 ? "d7" : "d30"
    };
  }

  function usersRoles() {
    if (mode === "live" && live && live.currentUsers && live.currentUsers.roles) {
      return live.currentUsers.roles;
    }
    if (data && data.currentUsers && data.currentUsers.roles) return data.currentUsers.roles;
    return {};
  }

  function aggFromLive(payload) {
    var by = {};
    var extras = {};
    var i;
    for (i = 0; i < P.ROLES.length; i++) by[P.ROLES[i].id] = { count: 0, sum: 0 };
    var roles = (payload && payload.byRole) || {};
    Object.keys(roles).forEach(function (id) {
      var key = id === "no_role" ? "legacy" : id;
      var stat = roles[id] || {};
      var count = stat.count || 0;
      var sum = stat.sum || 0;
      if (by[key]) {
        by[key].count += count;
        by[key].sum += sum;
      } else if (!extras[key]) {
        extras[key] = { count: count, sum: sum };
      } else {
        extras[key].count += count;
        extras[key].sum += sum;
      }
    });
    var total = (payload && payload.total) || { count: 0, sum: 0 };
    return { by: by, extras: extras, total: { count: total.count || 0, sum: total.sum || 0 } };
  }

  function render() {
    if (mode !== "live" && !data) return;
    var ms = P.rangeMs(fromEl.value, toEl.value);
    var bad = !(ms.from <= ms.to);
    var agg = bad
      ? { by: {}, extras: {}, total: { count: 0, sum: 0 } }
      : (mode === "live" ? aggFromLive(live) : P.aggregate(data.purchases, ms.from, ms.to));
    document.getElementById("count").textContent = bad ? "–" : P.formatCount(agg.total.count);
    document.getElementById("sum").textContent = bad ? "–" : P.formatInr(agg.total.sum);
    document.getElementById("window").textContent = bad
      ? "From has to be earlier than To. Both times are India time (IST)."
      : (mode === "live"
        ? "Both times are India time (IST). Figures come from live purchases."
        : "Both times are India time (IST). The whole end minute counts.");
    var box = document.getElementById("rows");
    box.replaceChildren();
    var users = usersRoles();

    function addRow(label, stat, userCount) {
      var art = document.createElement("article");
      art.className = "row";
      var h = document.createElement("h2");
      h.textContent = label;
      var amt = document.createElement("p");
      amt.className = "amt";
      amt.textContent = P.formatInr(stat.sum || 0);
      var meta = document.createElement("p");
      meta.className = "meta";
      var n = stat.count || 0;
      meta.textContent = P.formatCount(n) + (n === 1 ? " purchase" : " purchases");
      art.appendChild(h);
      art.appendChild(amt);
      art.appendChild(meta);
      if (userCount != null) {
        var now = document.createElement("p");
        now.className = "now";
        now.textContent = P.formatCount(userCount) + " current users";
        art.appendChild(now);
      }
      box.appendChild(art);
    }

    P.ROLES.forEach(function (role) {
      var stat = agg.by[role.id] || { count: 0, sum: 0 };
      var userCount = Object.prototype.hasOwnProperty.call(users, role.id) ? users[role.id] : null;
      addRow(role.label, stat, userCount);
    });
    Object.keys(agg.extras).sort().forEach(function (id) {
      addRow(id, agg.extras[id], null);
    });
    document.getElementById("empty").hidden = !bad && agg.total.count !== 0;
  }

  function paintSnapshotChrome() {
    var when = new Date(data.generatedAt).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short"
    });
    document.getElementById("users-line").textContent =
      P.formatCount(data.currentUsers.totalUsers) +
      " current users on the app. The green counts are current, not limited to the dates above.";
    document.getElementById("foot").textContent =
      "Snapshot of " + P.formatCount(data.purchases.length) +
      " purchases, taken " + when + " IST. Amounts are rupees. Old ₹10 plans with no role are their own row.";
  }

  function paintLiveChrome() {
    var users = live && live.currentUsers;
    if (users && users.totalUsers != null) {
      document.getElementById("users-line").textContent =
        P.formatCount(users.totalUsers) +
        " current users on the app. The green counts are current, not limited to the dates above.";
    }
    document.getElementById("foot").textContent =
      "Live purchases. Amounts are rupees. Empty role is shown as no role. Green counts are not filtered by the dates above.";
  }

  function loadLive() {
    var ms = P.rangeMs(fromEl.value, toEl.value);
    if (!(ms.from <= ms.to)) {
      if (live || data) render();
      return Promise.resolve();
    }
    var id = ++requestId;
    var url = LIVE_URL
      + "?from=" + encodeURIComponent(fromEl.value + ":00+05:30")
      + "&to=" + encodeURIComponent(toEl.value + ":59.999+05:30");
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("status " + res.status);
      return res.json();
    }).then(function (json) {
      if (id !== requestId) return;
      if (!json || !json.total || !json.byRole) throw new Error("bad payload");
      live = json;
      mode = "live";
      paintLiveChrome();
      render();
    });
  }

  function loadSnapshot() {
    return fetch("data.json").then(function (res) {
      if (!res.ok) throw new Error("status " + res.status);
      return res.json();
    }).then(function (json) {
      data = json;
      mode = "snapshot";
      paintSnapshotChrome();
      apply(rangeFor(7));
    });
  }

  function apply(range) {
    fromEl.value = range.from;
    toEl.value = range.to;
    setChip(range.chip);
    if (mode === "live" || (LIVE_URL && mode !== "snapshot")) {
      loadLive().catch(function () {
        if (mode === "live" && live) {
          document.getElementById("window").textContent =
            "Could not refresh live purchases. Showing the last figures.";
          return;
        }
        loadSnapshot().catch(function () {
          document.getElementById("window").textContent =
            "Could not load purchases. Serve this folder instead of opening the file directly.";
        });
      });
      return;
    }
    render();
  }

  document.getElementById("d7").addEventListener("click", function () { apply(rangeFor(7)); });
  document.getElementById("d30").addEventListener("click", function () { apply(rangeFor(30)); });
  document.getElementById("dall").addEventListener("click", function () { apply(rangeFor(null)); });
  function onInput() {
    setChip("");
    if (mode === "live") {
      clearTimeout(inputTimer);
      inputTimer = setTimeout(function () { apply({ from: fromEl.value, to: toEl.value, chip: "" }); }, 250);
      return;
    }
    render();
  }
  fromEl.addEventListener("input", onInput);
  toEl.addEventListener("input", onInput);

  loadPlayMetrics();

  if (LIVE_URL) {
    var start = rangeFor(7);
    fromEl.value = start.from;
    toEl.value = start.to;
    setChip("d7");
    loadLive().catch(function () {
      loadSnapshot().catch(function () {
        document.getElementById("window").textContent =
          "Could not load purchases. Serve this folder instead of opening the file directly.";
      });
    });
  } else {
    loadSnapshot().catch(function () {
      document.getElementById("window").textContent =
        "Could not load data.json. Serve this folder (python3 -m http.server) instead of opening the file directly.";
    });
  }
})();
