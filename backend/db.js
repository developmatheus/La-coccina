/**
 * Conexão com MySQL — pool reutilizável e seguro (prepared statements).
 */

const path = require('path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.join(__dirname, 'config', '.env') });

const poolConfig = {
  host: process.env.DB_HOST || 'la-coccina-production.up.railway.app',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'lacoccina',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: 'Z',
  dateStrings: true,
};

if (process.env.DB_SSL === 'true') {
  poolConfig.ssl = { rejectUnauthorized: true };
}

const pool = mysql.createPool(poolConfig);

pool.getConnection()
  .then((connection) => {
    console.log('🔗 Conexão com o banco MySQL ativa');
    connection.release();
  })
  .catch((err) => {
    console.error('❌ Erro na conexão com o banco:', err.message);
  });

module.exports = pool;
