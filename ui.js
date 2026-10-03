(function () {
  var P = window.Parivar;
  var fromEl = document.getElementById("from");
  var toEl = document.getElementById("to");
  var data = null;

  function setChip(id) {
    ["d7", "d30", "dall"].forEach(function (key) {
      document.getElementById(key).classList.toggle("on", key === id);
    });
  }

  function anchorMinute() {
    return P.fromInputValue(P.toInputValue(new Date(data.generatedAt).getTime()));
  }

  function rangeFor(days) {
    if (days == null) {
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

  function apply(range) {
    fromEl.value = range.from;
    toEl.value = range.to;
    setChip(range.chip);
    render();
  }

  function render() {
    var ms = P.rangeMs(fromEl.value, toEl.value);
    var bad = !(ms.from <= ms.to);
    var agg = bad
      ? { by: {}, extras: {}, total: { count: 0, sum: 0 } }
      : P.aggregate(data.purchases, ms.from, ms.to);
    document.getElementById("count").textContent = bad ? "–" : P.formatCount(agg.total.count);
    document.getElementById("sum").textContent = bad ? "–" : P.formatInr(agg.total.sum);
    document.getElementById("window").textContent = bad
      ? "From has to be earlier than To. Both times are India time (IST)."
      : "Both times are India time (IST). The whole end minute counts.";
    var box = document.getElementById("rows");
    box.replaceChildren();
    var users = data.currentUsers.roles;

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

  document.getElementById("d7").addEventListener("click", function () { apply(rangeFor(7)); });
  document.getElementById("d30").addEventListener("click", function () { apply(rangeFor(30)); });
  document.getElementById("dall").addEventListener("click", function () { apply(rangeFor(null)); });
  fromEl.addEventListener("input", function () { setChip(""); render(); });
  toEl.addEventListener("input", function () { setChip(""); render(); });

  fetch("data.json")
    .then(function (res) {
      if (!res.ok) throw new Error("status " + res.status);
      return res.json();
    })
    .then(function (json) {
      data = json;
      var when = new Date(json.generatedAt).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short"
      });
      document.getElementById("users-line").textContent =
        P.formatCount(json.currentUsers.totalUsers) +
        " current users on the app. The green counts are current, not limited to the dates above.";
      document.getElementById("foot").innerHTML =
        "<p>Snapshot of " + P.formatCount(json.purchases.length) +
        " purchases, taken " + when + " IST. Amounts are rupees.</p>" +
        "<p>Old ₹10 plans with no role are their own row. This file does not update itself.</p>";
      apply(rangeFor(7));
    })
    .catch(function () {
      document.getElementById("window").textContent =
        "Could not load data.json. Serve this folder (python3 -m http.server) instead of opening the file directly.";
    });
})();
