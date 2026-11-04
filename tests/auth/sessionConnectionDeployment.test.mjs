import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
test('scoped deployment is atomic, records both migrations and never replays historical upgrades',()=>{
 const dir=mkdtempSync(join(tmpdir(),'spark-session-deploy-'));
 try{
  const file=join(dir,'capture.sql');const docker=join(dir,'docker');writeFileSync(docker,'#!/bin/sh\ncat > "$SQL_CAPTURE"\n');chmodSync(docker,0o700);
  const env={...process.env,PATH:`${dir}:${process.env.PATH}`,SQL_CAPTURE:file};
  const run=(mode)=>spawnSync('bash',['deploy/spark-cli/apply-session-connection-db.sh',mode,'supabase-db'],{encoding:'utf8',env});
  assert.equal(run('--check').status,0);const check=readFileSync(file,'utf8');assert.doesNotMatch(check,/CREATE|ALTER|INSERT|DELETE|UPDATE|DROP/i);
  const applied=run('--apply');assert.equal(applied.status,0,applied.stderr);const sql=readFileSync(file,'utf8');
  assert.ok(sql.startsWith('begin;'));assert.ok(sql.trim().endsWith('commit;'));assert.match(sql,/pg_advisory_xact_lock/);
  assert.ok(sql.indexOf("values('20261104090809'")<sql.indexOf("values('20261104093610'"));
  assert.equal((sql.match(/\\if :applied/g)||[]).length,2);assert.equal((sql.match(/\\endif/g)||[]).length,2);
  assert.doesNotMatch(sql,/DELETE FROM public\.(?:audit_log|security_audit_events)|DROP CONSTRAINT|ADD COLUMN.*remind_at/i);
  assert.match(sql,/success',NULL/); // correction retains the security table's IP privacy rule
  assert.equal(run('--invalid').status,2);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
