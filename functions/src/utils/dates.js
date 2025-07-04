// 📁 functions/utils/dates.js - 날짜 유틸리티
/**
 * @param {number} years
 * @return {Date}
 */
function getDateAfterYears(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d;
}

/**
 * @param {number} months
 * @return {Date}
 */
function getDateAfterMonths(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * @param {number} days
 * @return {Date}
 */
function getDateAfterDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * @param {number} days
 * @return {Date}
 */
function getDateBeforeDays(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

module.exports = {
  getDateAfterYears,
  getDateAfterMonths,
  getDateAfterDays,
  getDateBeforeDays,
};
