const { GoogleAuth, UserRefreshClient } = require("google-auth-library");
const { parse } = require("csv-parse/sync");
const JSZip = require("jszip");
const { defineString } = require("firebase-functions/params");

const BUCKET = "pubsite_prod_6754866166232628173";
const PACKAGE = "com.driver.parivar";
const STORAGE = "https://storage.googleapis.com/storage/v1";
const SCOPES = ["https://www.googleapis.com/auth/devstorage.read_only"];

const playClientId = defineString("PLAY_CLIENT_ID", { default: "" });
const playClientSecret = defineString("PLAY_CLIENT_SECRET", { default: "" });
const playRefreshToken = defineString("PLAY_REFRESH_TOKEN", { default: "" });

let cachedClient = null;

function playOAuthFromConfig() {
  const clientId = playClientId.value() || process.env.PLAY_CLIENT_ID || "";
  const clientSecret = playClientSecret.value() || process.env.PLAY_CLIENT_SECRET || "";
  const refreshToken = playRefreshToken.value() || process.env.PLAY_REFRESH_TOKEN || "";
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

async function getAuthedClient() {
  if (cachedClient) return cachedClient;
  const oauth = playOAuthFromConfig();
  if (oauth) {
    cachedClient = new UserRefreshClient({
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
      refreshToken: oauth.refreshToken,
      scopes: SCOPES,
    });
    return cachedClient;
  }
  const auth = new GoogleAuth({ scopes: SCOPES });
  cachedClient = await auth.getClient();
  return cachedClient;
}

async function authedFetch(path) {
  const client = await getAuthedClient();
  const url = path.startsWith("http") ? path : `${STORAGE}${path}`;
  const res = await client.request({ url, responseType: "arraybuffer" });
  return Buffer.from(res.data);
}

async function listObjects(prefix) {
  const client = await getAuthedClient();
  const items = [];
  let pageToken = "";
  for (;;) {
    const params = new URLSearchParams({ prefix, maxResults: "1000" });
    if (pageToken) params.set("pageToken", pageToken);
    const url = `${STORAGE}/b/${BUCKET}/o?${params.toString()}`;
    const res = await client.request({ url });
    items.push(...(res.data.items || []));
    pageToken = res.data.nextPageToken || "";
    if (!pageToken) break;
  }
  return items;
}

function decodeCsvBuffer(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.toString("utf16le");
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.alloc(buf.length - 2);
    for (let i = 2; i + 1 < buf.length; i += 2) {
      swapped[i - 2] = buf[i + 1];
      swapped[i - 1] = buf[i];
    }
    return swapped.toString("utf16le");
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.toString("utf8").slice(1);
  }
  return buf.toString("utf8");
}

function toNumber(value) {
  if (value == null || value === "") return 0;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function parseCsv(buf) {
  const text = decodeCsvBuffer(buf).replace(/^\uFEFF/, "");
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
}

async function summarizeInstalls() {
  const objects = await listObjects(`stats/installs/installs_${PACKAGE}_`);
  const overview = objects
    .filter((o) => o.name.endsWith("_overview.csv"))
    .sort((a, b) => a.name.localeCompare(b.name));

  const rowsByDate = new Map();
  const files = overview.slice(-8);
  for (const obj of files) {
    const buf = await authedFetch(
      `/b/${BUCKET}/o/${encodeURIComponent(obj.name)}?alt=media`
    );
    const rows = parseCsv(buf);
    for (const row of rows) {
      const d = row.Date || row.date;
      if (d) rowsByDate.set(d, row);
    }
  }

  const dates = Array.from(rowsByDate.keys()).sort();
  const window = dates.slice(-7);
  let installs = 0;
  let uninstalls = 0;
  let activeDeviceInstalls = null;
  let totalUserInstalls = null;

  for (const d of window) {
    const row = rowsByDate.get(d);
    installs += toNumber(row["Daily User Installs"] || row["Daily Device Installs"]);
    uninstalls += toNumber(
      row["Daily User Uninstalls"] || row["Daily Device Uninstalls"] || row["Uninstall events"]
    );
    activeDeviceInstalls = toNumber(
      row["Active Device Installs"] || row["Current User Installs"] || activeDeviceInstalls || 0
    );
    totalUserInstalls = toNumber(row["Total User Installs"] || totalUserInstalls || 0);
  }

  return {
    source: "Play Console",
    bucket: BUCKET,
    packageName: PACKAGE,
    windowDays: window.length,
    fromDate: window[0] || null,
    toDate: window[window.length - 1] || null,
    installs,
    uninstalls,
    activeDeviceInstalls,
    totalUserInstalls,
    files: files.map((f) => f.name),
  };
}

async function summarizePayout() {
  const earningsObjects = (await listObjects("earnings/"))
    .filter((o) => o.name.includes("earnings_"))
    .sort((a, b) => a.name.localeCompare(b.name));

  let netAmount = 0;
  let payoutAmount = 0;
  let payoutRows = 0;
  let netRows = 0;
  let currency = "INR";
  const files = earningsObjects.slice(-6);
  const types = {};

  for (const obj of files) {
    const buf = await authedFetch(
      `/b/${BUCKET}/o/${encodeURIComponent(obj.name)}?alt=media`
    );
    let csvBuffers = [];
    if (obj.name.endsWith(".zip")) {
      const zip = await JSZip.loadAsync(buf);
      for (const name of Object.keys(zip.files)) {
        if (!name.toLowerCase().endsWith(".csv")) continue;
        csvBuffers.push(Buffer.from(await zip.file(name).async("nodebuffer")));
      }
    } else {
      csvBuffers = [buf];
    }

    for (const csvBuf of csvBuffers) {
      const rows = parseCsv(csvBuf);
      for (const row of rows) {
        const pkg = row["Package ID"] || row["Package Name"] || row["Product id"] || "";
        if (pkg && pkg !== PACKAGE && !pkg.includes(PACKAGE)) continue;
        const ttype = String(row["Transaction Type"] || row["Transaction type"] || "").trim();
        const amount = toNumber(
          row["Amount (Merchant Currency)"] ||
            row["Merchant Currency Amount"] ||
            row["Amount"]
        );
        const cur = row["Merchant Currency"];
        if (cur && String(cur).length <= 6) currency = String(cur);
        types[ttype || "(blank)"] = (types[ttype || "(blank)"] || 0) + 1;
        const low = ttype.toLowerCase();
        if (low.includes("payout") || low.includes("withdrawal")) {
          payoutAmount += amount;
          payoutRows += 1;
        }
        if (
          ["charge", "charge refund", "google fee", "google fee refund", "tax", "tax refund"].includes(
            low
          )
        ) {
          netAmount += amount;
          netRows += 1;
        }
      }
    }
  }

  const available = files.length > 0;
  const useExplicitPayout = payoutRows > 0;
  return {
    source: "Play Console",
    bucket: BUCKET,
    packageName: PACKAGE,
    available,
    amount: Math.round((useExplicitPayout ? payoutAmount : netAmount) * 100) / 100,
    currency,
    rows: useExplicitPayout ? payoutRows : netRows,
    mode: useExplicitPayout ? "payout" : "net_earnings",
    note: available
      ? useExplicitPayout
        ? "Sum of Play payout/withdrawal rows from earnings reports."
        : "No payout/withdrawal rows in earnings reports yet. Showing net Play earnings (charges − Google fees − tax) from the latest earnings files."
      : "Play payout/earnings report is not available.",
    files: files.map((f) => f.name),
    transactionTypes: types,
  };
}

async function getPlayMetrics() {
  const [installs, payout] = await Promise.all([summarizeInstalls(), summarizePayout()]);
  return {
    timezone: "Asia/Kolkata",
    packageName: PACKAGE,
    generatedAt: new Date().toISOString(),
    installs,
    payout,
  };
}

module.exports = { getPlayMetrics, BUCKET, PACKAGE };
