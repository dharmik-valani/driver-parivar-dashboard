(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Parivar = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var ROLES = [
    { id: "drivers", label: "Driver" },
    { id: "owners", label: "Fleet Owner" },
    { id: "mechanics", label: "Mechanic" },
    { id: "spare_parts", label: "Spare Part Shop" },
    { id: "transporters", label: "Transporter" },
    { id: "hotel", label: "Dhaba / Hotel" },
    { id: "buy_sell_vehicles", label: "Buy/Sell Vehicles" },
    { id: "building_materials", label: "Building Materials" },
    { id: "machinery_rentals", label: "Machinery Rental" },
    { id: "all", label: "All roles" },
    { id: "legacy", label: "No role (old ₹10 plans)" }
  ];

  var PRODUCT_ROLE = {
    pass_owners: "owners",
    pass_drivers: "drivers",
    pass_transporters: "transporters",
    pass_spare_parts: "spare_parts",
    pass_mechanics: "mechanics",
    pass_vehicles: "buy_sell_vehicles",
    pass_materials: "building_materials",
    pass_machinery: "machinery_rentals",
    all_roles_monthly: "all"
  };

  function roleOf(p) {
    if (p.unlockedRole) return p.unlockedRole;
    if (p.productId && PRODUCT_ROLE[p.productId]) return PRODUCT_ROLE[p.productId];
    return "legacy";
  }

  function aggregate(purchases, fromMs, toMs) {
    var by = {};
    var extras = {};
    var total = { count: 0, sum: 0 };
    var i, p, id;
    for (i = 0; i < ROLES.length; i++) by[ROLES[i].id] = { count: 0, sum: 0 };
    for (i = 0; i < purchases.length; i++) {
      p = purchases[i];
      if (p.timestamp < fromMs || p.timestamp > toMs) continue;
      id = roleOf(p);
      if (!by[id]) {
        if (!extras[id]) extras[id] = { count: 0, sum: 0 };
        extras[id].count += 1;
        extras[id].sum += p.amount;
      } else {
        by[id].count += 1;
        by[id].sum += p.amount;
      }
      total.count += 1;
      total.sum += p.amount;
    }
    return { by: by, extras: extras, total: total };
  }

  var inrFmt = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  });
  var numFmt = new Intl.NumberFormat("en-IN");

  function formatInr(n) { return inrFmt.format(n); }
  function formatCount(n) { return numFmt.format(n); }

  function istParts(ms) {
    var fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
    var parts = fmt.formatToParts(new Date(ms));
    var o = {};
    for (var i = 0; i < parts.length; i++) o[parts[i].type] = parts[i].value;
    return o;
  }

  function toInputValue(ms) {
    var p = istParts(ms);
    return p.year + "-" + p.month + "-" + p.day + "T" + p.hour + ":" + p.minute;
  }

  function fromInputValue(value) {
    if (!value) return NaN;
    return new Date(value + ":00+05:30").getTime();
  }

  function rangeMs(fromValue, toValue) {
    return {
      from: fromInputValue(fromValue),
      to: fromInputValue(toValue) + 59999
    };
  }

  return {
    ROLES: ROLES,
    roleOf: roleOf,
    aggregate: aggregate,
    formatInr: formatInr,
    formatCount: formatCount,
    toInputValue: toInputValue,
    fromInputValue: fromInputValue,
    rangeMs: rangeMs
  };
});
