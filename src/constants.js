const ENUMS = {
  application: {
    onlineBooking: 2
  },
  genderPreference: {
    noPreference: 105,
    maleOnly: 108,
    femaleOnly: 109
  },
  employeeGender: {
    male: 92,
    female: 93
  },
  scanDateType: {
    firstAvailable: 2090,
    today: 2091,
    tomorrow: 2092,
    thisWeek: 2093,
    specific: 2094,
    nextWeek: 2154,
    thisWeekend: 2155,
    nextWeekend: 2156
  },
  scanTimeType: {
    anytime: 2095,
    morning: 2096,
    afternoon: 2097,
    evening: 2098,
    custom: 2099
  }
};

module.exports = { ENUMS };
