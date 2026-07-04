// Netlify serverless function: fetches the family iCloud calendars server-side
// (avoids the browser CORS block). Returns merged events for the next 7 days as JSON.

const CALENDARS = [
  { who: "Chad & Christina", color: "#C9A400", url: "https://p140-caldav.icloud.com/published/2/MTEwNjQ4OTUwODUxMTA2NMW5X9yBOY4LYxXvAMJSxM1IcpZquJpZTogal6qpMDJa4cOtAqwAsWmmsyhHcCnjyLXW-R0dOahhN_rbzXPhVBY" },
  { who: "Ollie", color: "#E08A2B", url: "https://p140-caldav.icloud.com/published/2/MTEwNjQ4OTUwODUxMTA2NMW5X9yBOY4LYxXvAMJSxM2bcAERbD1kp9mwPME5ZaaZBscb8aLiRgNqG5kLwUnJLbOT6Zb9FoKC94jx-UhXIhE" },
  { who: "Mia", color: "#D4537E", url: "https://p140-caldav.icloud.com/published/2/MTEwNjQ4OTUwODUxMTA2NMW5X9yBOY4LYxXvAMJSxM31IINMJQNqjrNR5ynTslSoXW04m0Sz1FbavdpC3XDU7IwPtM4qZ9gQmP2HtI38EwU" },
  { who: "Lincoln", color: "#1D9E75", url: "https://p140-caldav.icloud.com/published/2/MTEwNjQ4OTUwODUxMTA2NMW5X9yBOY4LYxXvAMJSxM3qPTIWRycLbFtSbd_xjTT26XvJy5c36FN-biiSMB4_m0wjsj7vMWdOO39aNlpzxII" },
  { who: "Christina school", color: "#378ADD", url: "https://p140-caldav.icloud.com/published/2/MTEwNjQ4OTUwODUxMTA2NMW5X9yBOY4LYxXvAMJSxM3tU8_0T-9-sSWhw5bWaT6afBGfYVjdT_DiZ6KR2JwdufAK6l_wPLd9XNT_qb0minI" },
  { who: "Alex", color: "#7F4FD4", url: "https://p140-caldav.icloud.com/published/2/MTEwNjQ4OTUwODUxMTA2NMW5X9yBOY4LYxXvAMJSxM2kBKv7hPmGXWuJnH8cF-s3N627hHQM366vEdPciE3MhrvTempEKtlWYRSJSFKbgGk" }
];

function unfold(text) {
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

// Converts a wall-clock time in `timeZone` to the correct UTC instant.
function zonedTimeToUtc(y, mo, d, h, mi, s, timeZone) {
  const guess = new Date(Date.UTC(y, mo, d, h, mi, s));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).formatToParts(guess).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const asIfUtc = Date.UTC(
    +parts.year, +parts.month - 1, +parts.day,
    parts.hour === "24" ? 0 : +parts.hour, +parts.minute, +parts.second
  );
  return new Date(guess.getTime() - (asIfUtc - guess.getTime()));
}

function parseDate(value, params) {
  const m = value.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const allDay = !m[4];
  const y = +m[1], mo = +m[2] - 1, d = +m[3];
  if (allDay) return { date: new Date(Date.UTC(y, mo, d)), allDay: true };
  const h = +m[4], mi = +m[5], s = +m[6] || 0;
  if (m[7]) return { date: new Date(Date.UTC(y, mo, d, h, mi, s)), allDay: false };
  const tzMatch = params.match(/TZID=([^;:]+)/);
  const tz = tzMatch ? tzMatch[1] : "America/New_York";
  return { date: zonedTimeToUtc(y, mo, d, h, mi, s, tz), allDay: false };
}
function parseICS(text) {
  text = unfold(text);
  const events = [];
  const blocks = text.split("BEGIN:VEVENT");
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    const sum = (b.match(/SUMMARY[^:]*:(.*)/) || [])[1];
    const dtMatch = b.match(/DTSTART([^:\r\n]*):([0-9TZ]+)/);
    if (!sum || !dtMatch) continue;
    const pd = parseDate(dtMatch[2], dtMatch[1]);
    if (!pd) continue;
    events.push({ title: sum.trim(), date: pd.date.toISOString(), allDay: pd.allDay });
  }
  return events;
}

exports.handler = async function () {
  const now = new Date();
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 8);

  const all = [];
  await Promise.all(
    CALENDARS.map(async (cal) => {
      try {
        const r = await fetch(cal.url);
        if (!r.ok) return;
        const txt = await r.text();
        parseICS(txt).forEach((e) => {
          const d = new Date(e.date);
          if (d >= weekStart && d < weekEnd) {
            all.push({ title: e.title, date: e.date, allDay: e.allDay, who: cal.who, color: cal.color });
          }
        });
      } catch (e) {
        // skip a failed feed
      }
    })
  );
  all.sort((a, b) => new Date(a.date) - new Date(b.date));

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "max-age=300" },
    body: JSON.stringify({ events: all, calendars: CALENDARS.map((c) => ({ who: c.who, color: c.color })) })
  };
};
