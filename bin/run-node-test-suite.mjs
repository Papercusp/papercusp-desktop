#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '..');
const runnerArgs = process.argv.slice(2);

let nodeLedgerModule = null;
let ledger = null;
let ledgerOutcome = null;
let ledgerReason = null;
if (runnerArgs.some((arg) => arg.startsWith('--test-reporter'))) {
  ledgerReason = 'caller supplied --test-reporter';
} else {
  try {
    const { tsImport } = await import('tsx/esm/api');
    nodeLedgerModule = await tsImport('../../libs/test-config/src/node-test-ledger.ts', import.meta.url);
    ledger = await nodeLedgerModule.beginNodeTestLedger({ repoRoot });
  } catch (error) {
    ledgerReason = 'ledger unavailable: ' + (error instanceof Error ? error.message : String(error));
  }
}

const child = spawn(process.execPath, [
  '--test',
  ...(ledger?.reporterArgs ?? []),
  ...runnerArgs,
], {
  cwd: packageRoot,
  env: process.env,
  stdio: 'inherit',
});

const result = await new Promise((resolveResult) => {
  child.once('error', (error) => resolveResult({ code: null, signal: null, error }));
  child.once('close', (code, signal) => resolveResult({ code, signal, error: null }));
});

if (ledger) {
  try {
    ledgerOutcome = await ledger.record();
    const reason = ledgerOutcome.reason ? ' reason=' + JSON.stringify(ledgerOutcome.reason) : '';
    console.log('TEST_FILE_LEDGER runner=node:test rows=' + ledgerOutcome.recorded + reason);
  } catch (error) {
    ledgerReason = 'recording failed: ' + (error instanceof Error ? error.message : String(error));
  }
}
if (ledgerReason) {
  console.error('TEST_FILE_LEDGER runner=node:test rows=0 reason=' + JSON.stringify(ledgerReason));
}

if (result.error) {
  console.error('[run-node-test-suite] could not launch Node:test: ' + result.error.message);
  process.exitCode = 1;
} else if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  const exitCode = nodeLedgerModule
    ? nodeLedgerModule.nodeTestRunnerExitCode(result.code, ledgerOutcome)
    : (result.code === 0 ? 1 : result.code ?? 1);
  if (result.code === 0 && exitCode !== 0) {
    console.error('[run-node-test-suite] refusing a green exit without complete ledger acknowledgement');
  }
  process.exitCode = exitCode;
}
