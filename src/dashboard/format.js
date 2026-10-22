// Formatting helpers for the dashboard. Pure functions: dates are shown in the
// browser's time zone, which is the zone D2L renders them in for the student.
(function initDashboardFormat(global) {
  const dash = global.D2LDashboard ||= {};

  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MON_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const DAY_MS = 24 * 60 * 60 * 1000;

  function toDate(value) {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
    const time = Date.parse(value || "");
    return Number.isFinite(time) ? new Date(time) : null;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function dayKey(value) {
    const date = toDate(value);
    if (!date) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function dateParts(value) {
    const date = toDate(value);
    if (!date) return { mon: "", day: "", dow: "" };
    return { mon: MON[date.getMonth()].toUpperCase(), day: String(date.getDate()), dow: DOW[date.getDay()] };
  }

  function fmtTime(value) {
    const date = toDate(value);
    if (!date) return "";
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours % 12 || 12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
  }

  // "Thu, Oct 2" (with the year when it isn't the current one).
  function fmtDate(value, now = new Date()) {
    const date = toDate(value);
    if (!date) return "";
    const year = date.getFullYear() !== (toDate(now) || new Date()).getFullYear() ? `, ${date.getFullYear()}` : "";
    return `${DOW[date.getDay()]}, ${MON[date.getMonth()]} ${date.getDate()}${year}`;
  }

  // "Wednesday, October 21st" (with the year when it isn't the current one).
  function fmtLongDate(value, now = new Date()) {
    const date = toDate(value);
    if (!date) return "";
    const day = date.getDate();
    const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][day % 10] || "th";
    const year = date.getFullYear() !== (toDate(now) || new Date()).getFullYear() ? `, ${date.getFullYear()}` : "";
    return `${DOW_LONG[date.getDay()]}, ${MON_LONG[date.getMonth()]} ${day}${suffix}${year}`;
  }

  // "Thu, Oct 2 · 11:59 PM"
  function fmtDateTime(value, now = new Date()) {
    const date = toDate(value);
    return date ? `${fmtDate(date, now)} · ${fmtTime(date)}` : "";
  }

  // "Oct 2" / "Oct 2, 2025"
  function fmtShortDate(value, now = new Date()) {
    const date = toDate(value);
    if (!date) return "";
    const year = date.getFullYear() !== (toDate(now) || new Date()).getFullYear() ? `, ${date.getFullYear()}` : "";
    return `${MON[date.getMonth()]} ${date.getDate()}${year}`;
  }

  function monthLabel(year, monthIndex) {
    return `${MON_LONG[monthIndex]} ${year}`;
  }

  function startOfDay(value) {
    const date = toDate(value);
    return date ? new Date(date.getFullYear(), date.getMonth(), date.getDate()) : null;
  }

  // "Today", "Tomorrow", "in 3 days", "Yesterday", "2 days ago"
  function relativeDay(value, now = new Date()) {
    const target = startOfDay(value);
    const today = startOfDay(now);
    if (!target || !today) return "";
    const days = Math.round((target - today) / DAY_MS);
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    if (days === -1) return "Yesterday";
    if (days > 1) return days < 14 ? `in ${days} days` : `in ${Math.round(days / 7)} weeks`;
    return -days < 14 ? `${-days} days ago` : `${Math.round(-days / 7)} weeks ago`;
  }

  // How long until a deadline, for a date box: calendar days ("in 2 days"),
  // hours on the last day ("in 11 hrs"), minutes in the last hour ("in 40 min"),
  // and the same spans once it's past due ("late 2 days").
  function countdown(value, now = new Date()) {
    const due = toDate(value);
    const at = toDate(now);
    if (!due || !at) return null;
    const late = due < at;
    const ms = Math.abs(due - at);
    const make = (n, one, many) => ({ late, n, unit: n === 1 ? one : many, letter: one[0], at: due.toISOString() });
    if (ms < 60 * 60 * 1000) return make(Math.max(1, Math.floor(ms / 60000)), "min", "min");
    if (ms < DAY_MS) return make(Math.floor(ms / (60 * 60 * 1000)), "hr", "hrs");
    return make(Math.max(1, Math.round(Math.abs(startOfDay(due) - startOfDay(at)) / DAY_MS)), "day", "days");
  }

  // "just now", "40 min ago", "2 h ago", "3 days ago", then the date.
  function ago(value, now = new Date()) {
    const date = toDate(value);
    const current = toDate(now);
    if (!date || !current) return "";
    const minutes = Math.round((current - date) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
    return fmtShortDate(date, current);
  }

  // D2L prints scores with at most two decimals and no trailing zeros.
  function fmtNumber(value) {
    const number = Number(value);
    if (value === null || value === undefined || value === "" || !Number.isFinite(number)) return "";
    return String(Math.round(number * 100) / 100);
  }

  function fmtPoints(earned, possible) {
    const left = fmtNumber(earned);
    const right = fmtNumber(possible);
    if (!left && !right) return "";
    return `${left || "-"} / ${right || "-"}`;
  }

  // D2L counts KB as 1024 bytes ("16183" → "15.8 KB").
  function fmtBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
    return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`;
  }

  // "CO.000.POLS9003.84214.20272" → "POLS 9003"
  function courseCode(code) {
    const match = String(code || "").match(/(?:^|\.)([A-Z]{2,5})(\d{4}[A-Z]?)(?:\.|$)/);
    return match ? `${match[1]} ${match[2]}` : "";
  }

  // "Civic Studies Section A Term 2024" → "Civic Studies"
  function courseName(title) {
    const text = String(title || "").trim();
    const cut = text.search(/\s+Section\s+\S+/i);
    return cut > 0 ? text.slice(0, cut) : text.replace(/\s+(?:Fall|Spring|Summer|Winter)\s+Semester\s+\d{4}.*$/i, "");
  }

  function sectionOf(title) {
    return String(title || "").match(/\bSection\s+(\S+)/i)?.[0] || "";
  }

  // "Fall Semester 2026" → "Fall 2026"
  function termOf(title) {
    const match = String(title || "").match(/\b(Fall|Spring|Summer|Winter)\s+Semester\s+(\d{4})/i);
    return match ? `${match[1]} ${match[2]}` : "";
  }

  // D2L rich text sometimes arrives as HTML even in its "Text" field.
  function plainText(value) {
    const text = String(value ?? "");
    if (!/[<&]/.test(text)) return text.trim();
    return text
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&amp;/g, "&")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function plural(count, word, pluralWord = `${word}s`) {
    return `${count} ${count === 1 ? word : pluralWord}`;
  }

  function percent(part, whole) {
    const a = Number(part);
    const b = Number(whole);
    return Number.isFinite(a) && Number.isFinite(b) && b > 0 ? Math.round((a / b) * 100) : null;
  }

  Object.assign(dash, {
    MON, MON_LONG, DOW, DAY_MS,
    toDate, escapeHtml, dayKey, dateParts, fmtTime, fmtDate, fmtLongDate, fmtDateTime, fmtShortDate, monthLabel,
    startOfDay, relativeDay, countdown, ago, fmtNumber, fmtPoints, fmtBytes, courseCode, courseName, sectionOf, termOf,
    plural, percent, plainText
  });
})(globalThis);
