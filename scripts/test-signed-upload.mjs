import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';

dotenv.config();

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Use service role to set up test data, then anon+auth for the actual flow.
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const TEST_EMAIL = `test-signed-${Date.now()}@example.com`;
const TEST_PASS = 'TestPass123!';

const { data: signUp, error: signUpErr } = await admin.auth.admin.createUser({
  email: TEST_EMAIL,
  password: TEST_PASS,
  email_confirm: true,
});
if (signUpErr) { console.error('createUser failed', signUpErr); process.exit(1); }
const userId = signUp.user.id;
console.log('created user', userId);

// Make the user an admin (for setup only) - actually we need them to own the minute.
// Create meeting + minute as admin, set created_by/secretary/chair to this user.
const { data: meeting, error: mErr } = await admin.from('meetings').insert({
  subject: 'signed-upload-test', request_date: '1403/05/01', duration: '1h',
  location: 'x', representative: 'x', phone: '0', priority: 'medium', user_id: userId,
}).select().single();
if (mErr) { console.error('meeting insert failed', mErr); process.exit(1); }

const { data: minute, error: minErr } = await admin.from('minutes').insert({
  meeting_id: meeting.id, meeting_title_snapshot: 'su-test',
  meeting_date_snapshot: '1403/05/01', secretary_name_snapshot: 's',
  chair_name_snapshot: 'c', confidentiality: 'organizational', status: 'draft',
  created_by_user_id: userId, secretary_user_id: userId, chair_user_id: userId,
  revision_number: 1,
}).select().single();
if (minErr) { console.error('minute insert failed', minErr); process.exit(1); }
console.log('created minute', minute.id);

// Now sign in as the user
const userClient = createClient(url, anonKey, { auth: { persistSession: false } });
const { data: signIn, error: signInErr } = await userClient.auth.signInWithPassword({
  email: TEST_EMAIL, password: TEST_PASS,
});
if (signInErr) { console.error('signIn failed', signInErr); process.exit(1); }
console.log('signed in as', signIn.user.id);

// 1. begin upload
const fileContent = 'Hello signed upload test ' + Date.now();
const file = new File([fileContent], 'test.txt', { type: 'text/plain' });
console.log('file size', file.size);

const { data: beginData, error: beginErr } = await userClient.rpc('begin_minutes_attachment_upload', {
  p_minute_id: minute.id, p_agenda_result_id: null, p_decision_id: null,
  p_original_filename: 'test.txt', p_mime_type: 'text/plain',
  p_size_bytes: file.size, p_description: null,
});
if (beginErr) { console.error('begin failed', beginErr); process.exit(1); }
console.log('begin ok', beginData);
const { attachment_id, storage_path } = beginData;

// 2. create signed upload URL
const { data: sUp, error: upErr } = await userClient.storage.from('minutes-attachments').createSignedUploadUrl(storage_path);
if (upErr) { console.error('createSignedUploadUrl failed', upErr); process.exit(1); }
console.log('signed upload url created', sUp.path);

// 3. PUT real file
const putRes = await fetch(sUp.signedUrl, {
  method: 'PUT',
  body: fileContent,
  headers: { 'Content-Type': 'text/plain' },
});
console.log('PUT status', putRes.status);
if (!putRes.ok) { console.error('PUT failed', await putRes.text()); process.exit(1); }

// 4. finalize
const { error: finErr } = await userClient.rpc('finalize_minutes_attachment', { p_attachment_id: attachment_id });
if (finErr) { console.error('finalize failed', finErr); process.exit(1); }
console.log('finalize ok');

// 5. check attachment is ready
const { data: att, error: attErr } = await userClient.from('minutes_attachments').select('upload_status,original_filename,size_bytes').eq('id', attachment_id).single();
if (attErr) { console.error('att select failed', attErr); process.exit(1); }
console.log('attachment ready?', att);

// 6. signed download
const { data: dl, error: dlErr } = await userClient.storage.from('minutes-attachments').createSignedUrl(storage_path, 60);
if (dlErr) { console.error('download signed url failed', dlErr); process.exit(1); }
console.log('download signed url created', dl.signedUrl ? 'yes' : 'no');

// 7. real delete: storage first, then RPC
const { error: rmErr } = await userClient.storage.from('minutes-attachments').remove([storage_path]);
if (rmErr) { console.error('storage remove failed', rmErr); process.exit(1); }
console.log('storage removed');

const { error: delErr } = await userClient.rpc('delete_minutes_attachment', { p_attachment_id: attachment_id });
if (delErr) { console.error('rpc delete failed', delErr); process.exit(1); }
console.log('rpc delete ok');

// verify audit
const { data: audit, error: auditErr } = await admin.from('minutes_audit_log').select('action').eq('minute_id', minute.id).order('created_at');
if (auditErr) { console.error('audit select failed', auditErr); process.exit(1); }
console.log('audit actions:', audit.map(a => a.action).join(', '));

// cleanup
await admin.from('minutes').delete().eq('id', minute.id);
await admin.from('meetings').delete().eq('id', meeting.id);
await admin.auth.admin.deleteUser(userId);
console.log('cleanup done');

console.log('ALL_SIGNED_UPLOAD_TESTS_PASSED');
