import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

const cleanupSrc = readFileSync(join(root, 'supabase', 'functions', 'minutes-attachment-cleanup', 'index.ts'), 'utf8');
const baleSrc = readFileSync(join(root, 'supabase', 'functions', 'send-bale-message', 'index.ts'), 'utf8');
const checkResetSrc = readFileSync(join(root, 'supabase', 'functions', 'check-phone-password-reset-runtime', 'index.ts'), 'utf8');
const rahyabSrc = readFileSync(join(root, 'supabase', 'functions', 'rahyab-sms', 'index.ts'), 'utf8');
const dailySrc = readFileSync(join(root, 'supabase', 'functions', 'send-daily-meetings', 'index.ts'), 'utf8');

describe('Phase 5B-3 — Edge Gate Coverage', () => {

  describe('minutes-attachment-cleanup', () => {
    it('imports requireFullAuthAccess and deniedResponse', () => {
      assert.ok(cleanupSrc.includes('requireFullAuthAccess'), 'must import requireFullAuthAccess');
      assert.ok(cleanupSrc.includes('deniedResponse'), 'must import deniedResponse');
    });

    it('does not call auth.getUser directly', () => {
      assert.ok(!cleanupSrc.includes('auth.getUser'), 'must not call auth.getUser directly');
    });

    it('does not call is_current_user_admin', () => {
      assert.ok(!cleanupSrc.includes('is_current_user_admin'), 'must not use is_current_user_admin');
    });

    it('gate runs before req.json() body read', () => {
      const gateIdx = cleanupSrc.indexOf('requireFullAuthAccess');
      const jsonIdx = cleanupSrc.indexOf('req.json()');
      assert.ok(gateIdx > -1 && jsonIdx > -1, 'both must exist');
      assert.ok(gateIdx < jsonIdx, 'gate must run before body read');
    });

    it('gate runs before service role client creation', () => {
      const gateIdx = cleanupSrc.indexOf('requireFullAuthAccess');
      const serviceIdx = cleanupSrc.indexOf('SUPABASE_SERVICE_ROLE_KEY');
      assert.ok(gateIdx < serviceIdx, 'gate must run before service role access');
    });

    it('gate runs before storage deletion', () => {
      const gateIdx = cleanupSrc.indexOf('requireFullAuthAccess');
      const storageIdx = cleanupSrc.indexOf('.remove(');
      assert.ok(gateIdx < storageIdx, 'gate must run before storage deletion');
    });

    it('gate runs before DB delete', () => {
      const gateIdx = cleanupSrc.indexOf('requireFullAuthAccess');
      const deleteIdx = cleanupSrc.indexOf('.delete()');
      assert.ok(gateIdx < deleteIdx, 'gate must run before DB delete');
    });

    it('checks callerUserId profile for is_active and is_admin', () => {
      assert.ok(cleanupSrc.includes('callerUserId'), 'must use callerUserId');
      assert.ok(cleanupSrc.includes('is_admin'), 'must check is_admin');
      assert.ok(cleanupSrc.includes('is_active'), 'must check is_active');
    });

    it('returns ADMIN_REQUIRED when not admin', () => {
      assert.ok(cleanupSrc.includes('ADMIN_REQUIRED'), 'must return ADMIN_REQUIRED');
    });
  });

  describe('send-bale-message', () => {
    it('imports requireFullAuthAccess and deniedResponse', () => {
      assert.ok(baleSrc.includes('requireFullAuthAccess'), 'must import requireFullAuthAccess');
      assert.ok(baleSrc.includes('deniedResponse'), 'must import deniedResponse');
    });

    it('does not call auth.getUser directly', () => {
      assert.ok(!baleSrc.includes('auth.getUser'), 'must not call auth.getUser directly');
    });

    it('caller ID comes from authResult.userId', () => {
      assert.ok(baleSrc.includes('authResult.userId'), 'must get caller ID from authResult.userId');
      assert.ok(baleSrc.includes('callerUserId'), 'must use callerUserId');
    });

    it('gate runs before req.json() body read', () => {
      const gateIdx = baleSrc.indexOf('requireFullAuthAccess');
      const jsonIdx = baleSrc.indexOf('req.json()');
      assert.ok(gateIdx > -1 && jsonIdx > -1);
      assert.ok(gateIdx < jsonIdx, 'gate must run before body read');
    });

    it('gate runs before service role client creation', () => {
      const gateIdx = baleSrc.indexOf('requireFullAuthAccess');
      const serviceIdx = baleSrc.indexOf('SUPABASE_SERVICE_ROLE_KEY');
      assert.ok(gateIdx < serviceIdx, 'gate must run before service role access');
    });

    it('gate runs before external Bale fetch', () => {
      const gateIdx = baleSrc.indexOf('requireFullAuthAccess');
      const fetchIdx = baleSrc.indexOf('tapi.bale.ai');
      assert.ok(gateIdx < fetchIdx, 'gate must run before external Bale request');
    });

    it('preserves same-organization check', () => {
      assert.ok(baleSrc.includes('organization'), 'must preserve organization check');
      assert.ok(baleSrc.includes('callerOrg'), 'must check caller org');
      assert.ok(baleSrc.includes('targetOrg'), 'must check target org');
    });

    it('preserves is_active check for caller', () => {
      assert.ok(baleSrc.includes('is_active'), 'must check caller is_active');
    });

    it('preserves admin check for caller', () => {
      assert.ok(baleSrc.includes('is_admin'), 'must check caller is_admin');
    });
  });

  describe('check-phone-password-reset-runtime', () => {
    it('imports requireFullAuthAccess and deniedResponse', () => {
      assert.ok(checkResetSrc.includes('requireFullAuthAccess'), 'must import requireFullAuthAccess');
      assert.ok(checkResetSrc.includes('deniedResponse'), 'must import deniedResponse');
    });

    it('does not call auth.getUser directly', () => {
      assert.ok(!checkResetSrc.includes('auth.getUser'), 'must not call auth.getUser directly');
    });

    it('origin gate runs before auth gate', () => {
      const originIdx = checkResetSrc.indexOf('ORIGIN_NOT_ALLOWED');
      const authIdx = checkResetSrc.indexOf('requireFullAuthAccess(req)');
      assert.ok(originIdx > -1 && authIdx > -1);
      assert.ok(originIdx < authIdx, 'origin gate must run before auth gate');
    });

    it('auth gate runs before secret read', () => {
      const authIdx = checkResetSrc.indexOf('requireFullAuthAccess(req)');
      const secretIdx = checkResetSrc.indexOf('PHONE_PASSWORD_RESET_SECRET');
      assert.ok(authIdx < secretIdx, 'auth gate must run before secret read');
    });

    it('auth gate runs before config update', () => {
      const authIdx = checkResetSrc.indexOf('requireFullAuthAccess(req)');
      const updateIdx = checkResetSrc.indexOf('system_config');
      assert.ok(authIdx < updateIdx, 'auth gate must run before config update');
    });

    it('uses callerUserId for profile check', () => {
      assert.ok(checkResetSrc.includes('callerUserId'), 'must use callerUserId');
    });

    it('checks is_admin and is_active via service role', () => {
      assert.ok(checkResetSrc.includes('is_admin'), 'must check is_admin');
      assert.ok(checkResetSrc.includes('is_active'), 'must check is_active');
    });
  });

  describe('rahyab-sms', () => {
    it('imports requireFullAuthAccess and deniedResponse', () => {
      assert.ok(rahyabSrc.includes('requireFullAuthAccess'), 'must import requireFullAuthAccess');
      assert.ok(rahyabSrc.includes('deniedResponse'), 'must import deniedResponse');
    });

    it('does not call auth.getUser directly', () => {
      assert.ok(!rahyabSrc.includes('auth.getUser'), 'must not call auth.getUser directly');
    });

    it('preserves service role constant-time comparison', () => {
      assert.ok(rahyabSrc.includes('SUPABASE_SERVICE_ROLE_KEY'), 'must keep service role check');
      assert.ok(rahyabSrc.includes('diff |= a[i] ^ b[i]'), 'must keep constant-time compare');
    });

    it('service role path returns before requireFullAuthAccess', () => {
      const serviceIdx = rahyabSrc.indexOf('return "service"');
      const authIdx = rahyabSrc.indexOf('requireFullAuthAccess(req)');
      assert.ok(serviceIdx > -1 && authIdx > -1);
      assert.ok(serviceIdx < authIdx, 'service role must return before auth gate');
    });

    it('user JWT path uses requireFullAuthAccess', () => {
      assert.ok(rahyabSrc.includes('requireFullAuthAccess(req)'), 'must call requireFullAuthAccess with req');
    });

    it('admin path checks is_active and is_admin after gate', () => {
      const authIdx = rahyabSrc.indexOf('requireFullAuthAccess(req)');
      const adminIdx = rahyabSrc.indexOf('is_admin', authIdx);
      const activeIdx = rahyabSrc.indexOf('is_active', authIdx);
      assert.ok(adminIdx > -1, 'must check is_admin after gate');
      assert.ok(activeIdx > -1, 'must check is_active after gate');
    });

    it('does not accept anon key', () => {
      assert.ok(!rahyabSrc.includes('SUPABASE_ANON_KEY'), 'must not accept anon key');
    });

    it('gate runs before req.json() body read', () => {
      const gateIdx = rahyabSrc.indexOf('requireFullAuthAccess(req)');
      const jsonIdx = rahyabSrc.indexOf('req.json()');
      assert.ok(gateIdx < jsonIdx, 'gate must run before body read');
    });

    it('gate runs before external SOAP fetch', () => {
      const gateIdx = rahyabSrc.indexOf('requireFullAuthAccess(req)');
      const soapIdx = rahyabSrc.indexOf('await callSoap(');
      assert.ok(gateIdx > -1 && soapIdx > -1);
      assert.ok(gateIdx < soapIdx, 'gate must run before SOAP request');
    });
  });

  describe('send-daily-meetings', () => {
    it('imports requireFullAuthAccess and deniedResponse', () => {
      assert.ok(dailySrc.includes('requireFullAuthAccess'), 'must import requireFullAuthAccess');
      assert.ok(dailySrc.includes('deniedResponse'), 'must import deniedResponse');
    });

    it('does not call auth.getUser directly', () => {
      assert.ok(!dailySrc.includes('auth.getUser'), 'must not call auth.getUser directly');
    });

    it('does not accept SUPABASE_ANON_KEY as cron credential', () => {
      assert.ok(!dailySrc.includes('SUPABASE_ANON_KEY'), 'must not use anon key as cron credential');
    });

    it('preserves X-Cron-Secret check', () => {
      assert.ok(dailySrc.includes('DAILY_REPORT_CRON_SECRET'), 'must keep X-Cron-Secret check');
      assert.ok(dailySrc.includes('cronSecretHeader'), 'must keep cron secret header');
    });

    it('preserves verify_cron_secret RPC', () => {
      assert.ok(dailySrc.includes('verify_cron_secret'), 'must keep verify_cron_secret RPC');
    });

    it('preserves service role key as cron credential', () => {
      assert.ok(dailySrc.includes('SUPABASE_SERVICE_ROLE_KEY'), 'must keep service role as cron credential');
    });

    it('preserves legacy CRON_SECRET', () => {
      assert.ok(dailySrc.includes('CRON_SECRET'), 'must keep legacy CRON_SECRET');
    });

    it('admin JWT path uses requireFullAuthAccess', () => {
      assert.ok(dailySrc.includes('requireFullAuthAccess(req)'), 'must call requireFullAuthAccess with req');
    });

    it('admin path checks is_active and is_admin after gate', () => {
      const authIdx = dailySrc.indexOf('requireFullAuthAccess');
      const adminIdx = dailySrc.indexOf('is_admin', authIdx);
      const activeIdx = dailySrc.indexOf('is_active', authIdx);
      assert.ok(adminIdx > -1, 'must check is_admin after gate');
      assert.ok(activeIdx > -1, 'must check is_active after gate');
    });

    it('preserves dry_run flow', () => {
      assert.ok(dailySrc.includes('dryRun'), 'must preserve dry_run');
      assert.ok(dailySrc.includes('dry_run'), 'must preserve dry_run body parse');
    });

    it('preserves scheduled flow', () => {
      assert.ok(dailySrc.includes('scheduled'), 'must preserve scheduled flow');
      assert.ok(dailySrc.includes('trigger_type'), 'must preserve trigger_type');
    });

    it('preserves idempotency check', () => {
      assert.ok(dailySrc.includes('daily_report_runs'), 'must preserve daily_report_runs');
      assert.ok(dailySrc.includes('run_key'), 'must preserve run_key idempotency');
    });

    it('preserves notification, SMS, and Bale sending', () => {
      assert.ok(dailySrc.includes('send_via_notification'), 'must preserve notification sending');
      assert.ok(dailySrc.includes('send_via_sms'), 'must preserve SMS sending');
      assert.ok(dailySrc.includes('send_via_bale'), 'must preserve Bale sending');
    });

    it('gate runs before req.json() body read', () => {
      const gateIdx = dailySrc.indexOf('requireFullAuthAccess(req)');
      const jsonIdx = dailySrc.indexOf('req.json()');
      assert.ok(gateIdx < jsonIdx, 'gate must run before body read');
    });

    it('no-recipients branch uses meeting_count: 0 not meetingCount', () => {
      assert.ok(
        dailySrc.includes('meeting_count: 0'),
        'no-recipients branch must set meeting_count: 0',
      );
      assert.ok(
        !dailySrc.includes('meeting_count: meetingCount'),
        'must not reference undefined meetingCount variable',
      );
    });
  });

  describe('no formal tests', () => {
    it('this file has no assert.ok(true) formal tests', () => {
      const testFile = readFileSync(join(root, 'tests', 'phase5', 'phase5EdgeGateCoverage.test.ts'), 'utf8');
      const lines = testFile.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        if (/^assert\.ok\(\s*true\s*\)\s*;?\s*$/.test(trimmed)) {
          assert.fail('must not contain formal assert.ok(true) test');
        }
      }
    });
  });
});
