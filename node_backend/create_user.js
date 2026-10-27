/**
 * create_user.js
 * --------------
 * Command-line tool to provision or update user accounts (Administrator or Viewer).
 * Passwords are typed securely without displaying plain-text characters on screen.
 * 
 * Usage:
 *   Interactive mode:
 *     node node_backend/create_user.js
 * 
 *   Non-interactive / Flag mode:
 *     node node_backend/create_user.js --email admin@eng.ruh.ac.lk --name "Faculty Admin" --role Administrator --password secretpass
 */

const path = require('path');
const readline = require('readline');
const { Writable } = require('stream');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { connectDB, disconnectDB } = require('./config/db');
const User = require('./models/User');

/**
 * Interactive prompt helper with password masking via mutable stdout.
 */
class Prompter {
  constructor() {
    this.muted = false;
    const self = this;
    const mutableStdout = new Writable({
      write(chunk, encoding, callback) {
        if (!self.muted) {
          process.stdout.write(chunk, encoding);
        }
        callback();
      }
    });

    this.rl = readline.createInterface({
      input: process.stdin,
      output: mutableStdout,
      terminal: true
    });
  }

  ask(question) {
    return new Promise((resolve) => {
      this.muted = false;
      this.rl.question(question, (answer) => {
        resolve((answer || '').trim());
      });
    });
  }

  askHidden(question) {
    return new Promise((resolve) => {
      process.stdout.write(question);
      this.muted = true;
      this.rl.question('', (answer) => {
        this.muted = false;
        process.stdout.write('\n');
        resolve((answer || '').trim());
      });
    });
  }

  close() {
    this.rl.close();
  }
}

/**
 * Securely prompts for password with confirmation and minimum length validation.
 * @param {Prompter} prompter
 * @returns {Promise<string>}
 */
async function promptSecurePassword(prompter) {
  while (true) {
    const password = await prompter.askHidden('Enter Password (hidden): ');
    if (password.length < 6) {
      console.log('[Error] Password must be at least 6 characters long. Please try again.\n');
      continue;
    }
    const confirm = await prompter.askHidden('Confirm Password (hidden): ');
    if (password !== confirm) {
      console.log('[Error] Passwords do not match. Please try again.\n');
      continue;
    }
    return password;
  }
}

/**
 * Creates or updates a user programmatically.
 * @param {Object} userData
 * @param {string} userData.email
 * @param {string} userData.password
 * @param {string} userData.full_name
 * @param {string} [userData.role='Viewer']
 * @returns {Promise<User>}
 */
async function createUserAccount({ email, password, full_name, role = 'Viewer' }) {
  if (!email || !password || !full_name) {
    throw new Error('Email, password, and full name are required');
  }
  if (!['Administrator', 'Viewer'].includes(role)) {
    throw new Error("Role must be either 'Administrator' or 'Viewer'");
  }
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters long');
  }

  const normEmail = email.trim().toLowerCase();
  let user = await User.findOne({ email: normEmail });

  if (user) {
    user.password = password; // Pre-save hook will hash
    user.full_name = full_name.trim();
    user.role = role;
    await user.save();
    return user;
  }

  user = await User.create({
    email: normEmail,
    password, // Pre-save hook will hash
    full_name: full_name.trim(),
    role
  });

  return user;
}

/**
 * CLI parser for flags.
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) parsed.email = args[++i];
    else if (args[i] === '--name' && args[i + 1]) parsed.name = args[++i];
    else if (args[i] === '--full_name' && args[i + 1]) parsed.name = args[++i];
    else if (args[i] === '--role' && args[i + 1]) parsed.role = args[++i];
    else if (args[i] === '--password' && args[i + 1]) parsed.password = args[++i];
  }
  return parsed;
}

/**
 * Main entry point.
 */
async function main() {
  const flags = parseArgs();
  const prompter = new Prompter();

  try {
    await connectDB();

    if (flags.email && flags.name) {
      let password = flags.password;
      const role = flags.role || 'Administrator';

      if (!password) {
        console.log(`Setting password for ${flags.email} (${role})...`);
        password = await promptSecurePassword(prompter);
      }

      const existing = await User.findOne({ email: flags.email.toLowerCase() });
      const user = await createUserAccount({
        email: flags.email,
        password,
        full_name: flags.name,
        role
      });

      console.log('\n' + '-'.repeat(65));
      if (existing) {
        console.log(` User account password updated for: ${user.email}`);
      } else {
        console.log(' User created successfully!');
      }
      console.log(` ID:        ${user._id}`);
      console.log(` Full Name: ${user.full_name}`);
      console.log(` Email:     ${user.email}`);
      console.log(` Role:      ${user.role}`);
      console.log('-'.repeat(65));
    } else {
      console.log('='.repeat(65));
      console.log(' University of Ruhuna - Faculty of Engineering');
      console.log(' Smart Energy System : User Account Provisioning');
      console.log('='.repeat(65));

      // 1. Full Name
      const defaultName = 'Faculty Administrator';
      const nameInput = await prompter.ask(`Enter Full Name [${defaultName}]: `);
      const fullName = nameInput || defaultName;

      // 2. Email Address
      const defaultEmail = 'admin@eng.ruh.ac.lk';
      let email = defaultEmail;
      while (true) {
        const emailInput = await prompter.ask(`Enter University Email [${defaultEmail}]: `);
        email = emailInput || defaultEmail;
        if (!email.includes('@') || !email.includes('.')) {
          console.log("[Error] Invalid email address format. Must include '@' and domain.");
          continue;
        }
        break;
      }

      // Check if user already exists
      const existing = await User.findOne({ email: email.toLowerCase() });
      if (existing) {
        console.log(`\n[Notice] Account '${email}' already exists (${existing.role}: ${existing.full_name}).`);
        const choice = (await prompter.ask('Do you wish to reset/update the password for this account? (y/n) [y]: ')).toLowerCase();
        if (choice === '' || choice === 'y' || choice === 'yes') {
          console.log('\nSet new password:');
          const password = await promptSecurePassword(prompter);
          existing.password = password;
          await existing.save();

          console.log('\n' + '-'.repeat(65));
          console.log(` Password successfully updated for '${email}'!`);
          console.log(` Role:      ${existing.role}`);
          console.log(` Full Name: ${existing.full_name}`);
          console.log('-'.repeat(65));
        } else {
          console.log('Operation aborted. No changes made.');
        }
        prompter.close();
        return;
      }

      // 3. Role
      console.log('\nSelect Role:');
      console.log('  1. Administrator (Full access)');
      console.log('  2. Viewer (Read-only access)');
      const roleChoice = await prompter.ask('Enter choice [1]: ');
      const role = roleChoice === '2' ? 'Viewer' : 'Administrator';

      // 4. Password (Masked/Hidden)
      console.log('');
      const password = await promptSecurePassword(prompter);

      const user = await createUserAccount({
        email,
        password,
        full_name: fullName,
        role
      });

      console.log('\n' + '-'.repeat(65));
      console.log(' User created successfully!');
      console.log(` ID:        ${user._id}`);
      console.log(` Full Name: ${user.full_name}`);
      console.log(` Email:     ${user.email}`);
      console.log(` Role:      ${user.role}`);
      console.log('-'.repeat(65));
    }
  } catch (err) {
    console.error(`\n[Error] ${err.message}`);
    process.exitCode = 1;
  } finally {
    prompter.close();
    await disconnectDB();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  createUserAccount,
  promptSecurePassword,
  Prompter
};
