#!/usr/bin/env node
/**
 * Generates a VAPID key pair and writes (or updates) the three VAPID variables
 * in the project's .env file using the shared envManager utility.
 *
 * Usage:
 *   npm run vapid:generate
 *   npm run vapid:generate -- --subject mailto:ops@yoursite.com
 *   npm run vapid:generate -- --force
 */

'use strict';

// envManager is a TypeScript module; use the compiled output.
const { updateEnvVariables, readEnvVariable } = require('../../dist/src/utils/envManager');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const forceRegen = args.includes('--force');
const subjectArg = getArg('--subject');

// ---------------------------------------------------------------------------
// Guard: skip if keys already exist (unless --force)
// ---------------------------------------------------------------------------
const existingPublic  = readEnvVariable('VAPID_PUBLIC_KEY');
const existingPrivate = readEnvVariable('VAPID_PRIVATE_KEY');

if (existingPublic && existingPrivate && !forceRegen) {
  console.log('VAPID keys already present in .env. Use --force to regenerate.\n');
  console.log(`  VAPID_PUBLIC_KEY  = ${existingPublic.slice(0, 20)}...`);
  console.log(`  VAPID_PRIVATE_KEY = ${existingPrivate.slice(0, 10)}...`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Generate keys
// ---------------------------------------------------------------------------
let webPush;
try {
  webPush = require('web-push');
} catch {
  console.error('web-push is not installed. Run: npm install web-push');
  process.exit(1);
}

const { publicKey, privateKey } = webPush.generateVAPIDKeys();
const subject = subjectArg ?? readEnvVariable('VAPID_SUBJECT') ?? 'mailto:admin@example.com';

console.log('\nGenerated VAPID key pair:');
console.log(`  Public key  : ${publicKey}`);
console.log(`  Private key : ${privateKey}`);
console.log(`  Subject     : ${subject}\n`);

// ---------------------------------------------------------------------------
// Persist to .env
// ---------------------------------------------------------------------------
updateEnvVariables({
  VAPID_PUBLIC_KEY:  publicKey,
  VAPID_PRIVATE_KEY: privateKey,
  VAPID_SUBJECT:     subject,
});

console.log('✔ .env updated');
if (forceRegen && existingPublic) {
  console.log('  ⚠ Existing keys were overwritten. Re-subscribe all browsers.');
}
console.log('\nNext steps:');
console.log('  1. npm run migrate   (creates push subscription tables)');
console.log('  2. npm run build:all && npm start');
