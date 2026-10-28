import assert from 'node:assert/strict';
import test from 'node:test';
import { TEMPLATE_EVENTS, PLACEHOLDER_KEYS, validateTemplateForEvent } from '../../src/config/templateCatalog';

for(const key of ['series_invite','series_change','series_cancel','series_reminder']) {
 test(`${key} supports editable SMS and in-app templates with series fields`,()=>{
  const event=TEMPLATE_EVENTS.find(e=>e.key===key)!;
  assert.ok(event.supportedChannels.includes('sms'));
  assert.ok(event.supportedChannels.includes('notification'));
  assert.equal(validateTemplateForEvent('{{meeting_subject}} {{recipient_greeting}} {{series_start_date}} تا {{series_end_date}}، {{occurrence_count}} نوبت {{meeting_time}}{{location_part}}',event,PLACEHOLDER_KEYS).valid,true);
  assert.equal(validateTemplateForEvent('{{summary}}',event,PLACEHOLDER_KEYS).valid,true);
  assert.equal(validateTemplateForEvent('{{unknown_series_field}}',event,PLACEHOLDER_KEYS).valid,false);
 });
}
