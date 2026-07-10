function pad(value) {
  return String(value).padStart(2, "0");
}

function parseLocalDate(value = null) {
  if (!value) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Expected date as YYYY-MM-DD, got: ${value}`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function toDateOnly(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toMeevoDateTime(date) {
  return `${toDateOnly(date)}T00:00:00.000`;
}

function formatClock(isoLike) {
  if (!isoLike) return "";
  const date = new Date(isoLike);
  if (Number.isNaN(date.getTime())) {
    const match = String(isoLike).match(/T(\d{2}):(\d{2})/);
    return match ? `${match[1]}:${match[2]}` : String(isoLike);
  }
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

module.exports = {
  addDays,
  formatClock,
  parseLocalDate,
  toDateOnly,
  toMeevoDateTime
};

