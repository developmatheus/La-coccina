const path = require('path');
const mysql = require('mysql2/promise');

require('dotenv').config({
  path: path.join(__dirname, 'config', '.env')
});

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'acela.proxy.rlwy.net',
  port: Number(process.env.DB_PORT) || 22799,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'railway',

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  ssl: {
    rejectUnauthorized: false
  }
});

pool.getConnection()
  .then((connection) => {
    console.log('✅ MySQL conectado');
    connection.release();
  })
  .catch((err) => {
    console.error('❌ Erro na conexão com o banco:', err.message);
  });

module.exports = pool;