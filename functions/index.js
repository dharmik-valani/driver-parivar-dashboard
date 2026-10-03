const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

admin.initializeApp();

const FLOW_COUNTS_URL =
  "https://us-central1-all-india-truck-driver-5b112.cloudfunctions.net/getFlowCounts";

const ROLE_FROM_FLOW = {
  drivers: "drivers",
  fleetOwners: "owners",
  mechanics: "mechanics",
  sparePartShops: "spare_parts",
  transporters: "transporters",
  dhabaHotels: "hotel",
  buySellVehicles: "buy_sell_vehicles",
  buildingMaterials: "building_materials",
  machineryRentals: "machinery_rentals",
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function setCorsHeaders(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

function parseBound(value) {
  if (value == null || String(value).trim() === "") return undefined;
  const raw = String(value).trim();
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
  const parsed = new Date(hasZone ? raw : raw + "+05:30");
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function roleKey(value) {
  if (value == null) return "no_role";
  const text = String(value).trim();
  if (!text) return "no_role";
  return text;
}

function toAmount(value) {
  if (value == null || value === "") return 0;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function sortedRoles(byRole) {
  const out = {};
  Object.keys(byRole).sort().forEach((key) => {
    out[key] = byRole[key];
  });
  return out;
}

async function aggregatePayments(from, to) {
  const db = admin.firestore();
  const byRole = {};
  let totalCount = 0;
  let totalSum = 0;
  let last = null;

  for (;;) {
    let query = db
      .collection("vip_transactions")
      .where("timestamp", ">=", from)
      .where("timestamp", "<=", to)
      .orderBy("timestamp")
      .select("timestamp", "amount", "unlockedRole", "productId", "planType", "status")
      .limit(500);
    if (last) query = query.startAfter(last);
    const snap = await query.get();
    if (snap.empty) break;

    snap.forEach((doc) => {
      const data = doc.data() || {};
      const status = data.status == null ? "SUCCESS" : String(data.status);
      if (status !== "SUCCESS") return;
      const role = roleKey(data.unlockedRole);
      const amount = toAmount(data.amount);
      if (!byRole[role]) byRole[role] = { count: 0, sum: 0 };
      byRole[role].count += 1;
      byRole[role].sum += amount;
      totalCount += 1;
      totalSum += amount;
    });

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 500) break;
  }

  return {
    byRole: sortedRoles(byRole),
    total: { count: totalCount, sum: totalSum, currency: "INR" },
  };
}

async function currentUsers() {
  const response = await fetch(FLOW_COUNTS_URL, { method: "GET" });
  if (!response.ok) {
    throw new Error("getFlowCounts status " + response.status);
  }
  const payload = await response.json();
  const flowCounts = payload.flowCounts || {};
  const roles = {};
  Object.keys(ROLE_FROM_FLOW).forEach((key) => {
    roles[ROLE_FROM_FLOW[key]] = Number(flowCounts[key] || 0);
  });
  return {
    asOf: payload.timestamp || new Date().toISOString(),
    totalUsers: payload.totalUsers,
    note: "Current accounts on the app. Not filtered by the date range.",
    roles: roles,
    flowCounts: flowCounts,
    flows: payload.flows || [],
    listings: payload.listings || {},
  };
}

exports.getPaymentAggregates = functions
  .runWith({ memory: "256MB", timeoutSeconds: 60 })
  .region("us-central1")
  .https.onRequest(async (req, res) => {
    setCorsHeaders(res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Use GET" });
    }

    const now = new Date();
    const from = parseBound(req.query.from);
    const to = parseBound(req.query.to);
    if (from === null || to === null) {
      return res.status(400).json({ error: "from and to must be ISO datetimes" });
    }
    const rangeFrom = from || new Date(now.getTime() - WEEK_MS);
    const rangeTo = to || now;
    if (rangeFrom.getTime() > rangeTo.getTime()) {
      return res.status(400).json({ error: "from must be earlier than to" });
    }

    try {
      const payments = await aggregatePayments(rangeFrom, rangeTo);
      let users = null;
      let usersError = null;
      try {
        users = await currentUsers();
      } catch (error) {
        usersError = "current user counts unavailable";
        console.error("getPaymentAggregates currentUsers", error && error.message);
      }
      return res.status(200).json({
        timezone: "Asia/Kolkata",
        currency: "INR",
        from: rangeFrom.toISOString(),
        to: rangeTo.toISOString(),
        byRole: payments.byRole,
        total: payments.total,
        currentUsers: users,
        currentUsersError: usersError,
      });
    } catch (error) {
      console.error("getPaymentAggregates", error && error.message);
      return res.status(500).json({ error: "Could not load payment aggregates" });
    }
  });
