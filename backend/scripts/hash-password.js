/**
 * Gera hash bcrypt para colocar no .env como ADMIN_PASSWORD.
 * Uso: node scripts/hash-password.js "sua_senha"
 */

const bcrypt = require('bcrypt');

const password = process.argv[2];

if (!password) {
  console.error('Uso: node scripts/hash-password.js "sua_senha"');
  process.exit(1);
}

bcrypt.hash(password, 12).then((hash) => {
  console.log('\nCole no arquivo config/.env:\n');
  console.log(`ADMIN_PASSWORD=${hash}\n`);
});
