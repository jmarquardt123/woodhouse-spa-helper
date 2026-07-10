const crypto = require("crypto");
const { ENUMS } = require("./constants");
const { addDays, parseLocalDate, toMeevoDateTime } = require("./date");

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function resolveGenderPreference(value) {
  if (value == null || value === "") return ENUMS.genderPreference.noPreference;
  if (typeof value === "number") return value;

  const normalized = String(value).trim().toLowerCase();
  if (["any", "either", "none", "no-preference", "no preference", "nopreference"].includes(normalized)) {
    return ENUMS.genderPreference.noPreference;
  }
  if (["male", "man", "m", "male-only", "male only"].includes(normalized)) {
    return ENUMS.genderPreference.maleOnly;
  }
  if (["female", "woman", "f", "female-only", "female only"].includes(normalized)) {
    return ENUMS.genderPreference.femaleOnly;
  }

  throw new Error(`Unknown provider gender preference: ${value}`);
}

function buildScanPayload({ config, service, session, options }) {
  const settings = session.locationSettings.onlineBookingSettings;
  const start = parseLocalDate(options.startDate);
  const end = addDays(start, options.days);
  const people = (options.people || config.people || []).slice(0, 2);
  const providerGenderPreferences = options.providerGenderPreferences || options.genderPreferences || [];
  if (people.length < 1) {
    throw new Error("Availability scan requires at least one person.");
  }

  const scanServices = people.map((person, index) => ({
    clientId: crypto.randomUUID(),
    serviceId: service.id,
    employeeId: null,
    genderPreferenceEnum: resolveGenderPreference(
      providerGenderPreferences[index] || person.providerGenderPreference
    ),
    clientFirstName: person.firstName || "Guest",
    clientLastName: person.lastName || "",
    clientEmailAddress: person.email || "",
    clientPhoneNumber: digitsOnly(person.phone),
    clientCountryCode: String(person.countryCode || "1"),
    clientOptInTextNotifications: Boolean(person.optInTextNotifications),
    isGuest: true,
    customServiceStepTimings: null,
    isMinor: false
  }));

  const sameRoom = Boolean(options.sameRoom);
  const isMultiGuest = people.length > 1;
  return {
    scanServices,
    payingClientId: null,
    isRescan: false,
    scanOrigin: 1,
    maxOpeningsPerDay: options.maxOpeningsPerDay || settings.maximumAppointmentOpeningsShownPerDay || 20,
    appointmentBufferMinutes: 60 * (settings.preventAppointmentsFromBeingBookedForMinimumThresholdHours || 0),
    maxStartTimeWait: settings.maximumWaitTimeBetweenServicesInMinutes || 0,
    maxWaitTimeBetweenServices: settings.maximumWaitTimeBetweenServicesInMinutes || 0,
    requireSameStartTime: isMultiGuest && options.sameStart !== false,
    requireSameResource: isMultiGuest && sameRoom,
    scanDateType: ENUMS.scanDateType.firstAvailable,
    scanTimeType: ENUMS.scanTimeType.anytime,
    startDate: toMeevoDateTime(start),
    endDate: toMeevoDateTime(end),
    startTime: null,
    endTime: null,
    excludeRanges: null,
    isCouplesScan: isMultiGuest && sameRoom,
    isRestrictedToBookableOnline: true
  };
}

module.exports = { buildScanPayload, resolveGenderPreference };
