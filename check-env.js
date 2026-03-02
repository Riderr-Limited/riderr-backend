// ============================================================================
// DIAGNOSTIC: Check if environment variables are loading
// ============================================================================
// Run this file directly: node check-env.js

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env explicitly
const result = dotenv.config({ path: join(__dirname, '.env') });

console.log('\n' + '='.repeat(80));
console.log('🔍 ENVIRONMENT VARIABLE DIAGNOSTIC');
console.log('='.repeat(80));

if (result.error) {
  console.log('❌ Error loading .env file:', result.error.message);
} else {
  console.log('✅ .env file loaded successfully');
}

console.log('\n📋 CHECKING CRITICAL VARIABLES:\n');

const criticalVars = [
  'NODE_ENV',
  'PORT',
  'MONGODB_URL',
  'JWT_SECRET',
  'RESEND_API_KEY',
  'EMAIL_FROM_NAME',
  'PAYSTACK_SECRET_KEY',
];

let allFound = true;

criticalVars.forEach(varName => {
  const value = process.env[varName];
  if (value) {
    // Show first and last few characters only
    const display = value.length > 20 
      ? `${value.substring(0, 10)}...${value.substring(value.length - 6)}`
      : value;
    console.log(`✅ ${varName.padEnd(25)} = ${display}`);
  } else {
    console.log(`❌ ${varName.padEnd(25)} = NOT FOUND`);
    allFound = false;
  }
});

console.log('\n' + '='.repeat(80));

if (allFound) {
  console.log('✅ ALL CRITICAL VARIABLES FOUND');
} else {
  console.log('❌ SOME VARIABLES ARE MISSING');
  console.log('\n💡 TROUBLESHOOTING STEPS:');
  console.log('1. Check if .env file exists in project root');
  console.log('2. Check for spaces before variable names');
  console.log('3. Make sure there are no special characters in values');
  console.log('4. Restart your server after changing .env');
}

console.log('='.repeat(80) + '\n');

// Show all environment variables that start with common prefixes
console.log('📋 ALL ENVIRONMENT VARIABLES (filtered):\n');
const filtered = Object.keys(process.env)
  .filter(key => 
    key.startsWith('RESEND') || 
    key.startsWith('EMAIL') || 
    key.startsWith('NODE') ||
    key.startsWith('MONGODB') ||
    key.startsWith('JWT') ||
    key.startsWith('PAYSTACK')
  )
  .sort();

if (filtered.length > 0) {
  filtered.forEach(key => {
    const value = process.env[key];
    const display = value && value.length > 30
      ? `${value.substring(0, 15)}...${value.substring(value.length - 10)}`
      : value;
    console.log(`  ${key.padEnd(30)} = ${display}`);
  });
} else {
  console.log('  ⚠️ No relevant environment variables found!');
}

console.log('\n' + '='.repeat(80));
console.log('🔍 .env FILE LOCATION:', join(__dirname, '.env'));
console.log('🔍 CURRENT DIRECTORY:', __dirname);
console.log('='.repeat(80) + '\n');