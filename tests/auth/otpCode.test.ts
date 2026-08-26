import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyOtpFragment,
  normalizeOtpCode,
  normalizeOtpDigits,
  removeOtpDigit,
} from '../../src/features/auth/components/otpCode';

test('normalizes Persian and Arabic-Indic digits to ASCII', () => {
  assert.equal(normalizeOtpDigits('۱۲۳-٤٥٦'), '123456');
});

test('strips non-digits and enforces six digits by default', () => {
  assert.equal(normalizeOtpCode(' 12a34-5678 '), '123456');
});

test('full-code paste replaces the entire current OTP', () => {
  assert.equal(applyOtpFragment('123', 2, '۹۸۷۶۵۴'), '987654');
});

test('partial paste overwrites from the focused position', () => {
  assert.equal(applyOtpFragment('123456', 2, '۹۸'), '129856');
});

test('typing at the next position appends a digit', () => {
  assert.equal(applyOtpFragment('123', 3, '۴'), '1234');
});

test('backspace helper removes the requested digit without adding placeholders', () => {
  assert.equal(removeOtpDigit('123456', 2), '12456');
  assert.equal(removeOtpDigit('12', 5), '12');
});
