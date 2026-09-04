"use strict";

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value) {
  return Math.round((numberOrZero(value) + Number.EPSILON) * 100) / 100;
}

function roundPayableToTenth(amount, minimumPayable = 0) {
  const minimum = Math.max(0, numberOrZero(minimumPayable));
  const nearestTenth = Math.round(numberOrZero(amount) * 10) / 10;

  if (nearestTenth + 0.000001 >= minimum) {
    return round2(nearestTenth);
  }

  return round2(Math.ceil((minimum - 0.000001) * 10) / 10);
}

module.exports = {
  roundPayableToTenth,
};
