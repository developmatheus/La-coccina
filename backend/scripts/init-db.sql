-- ============================================================================
-- LA COCCINA — Inicialização do banco de dados
-- Execute uma vez para criar as tabelas necessárias.
-- Seguro para re-executar (CREATE TABLE IF NOT EXISTS).
-- ============================================================================

CREATE DATABASE IF NOT EXISTS lacoccina
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE lacoccina;

CREATE TABLE IF NOT EXISTS products (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(120)   NOT NULL,
  price         DECIMAL(8, 2)  NOT NULL,
  `desc`        VARCHAR(500)   DEFAULT '',
  image         VARCHAR(255)   DEFAULT '',
  category      ENUM('marmita', 'bebida') NOT NULL DEFAULT 'marmita',
  active        TINYINT(1)     NOT NULL DEFAULT 1,
  isDailySpecial TINYINT(1)   NOT NULL DEFAULT 0,
  created_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer   VARCHAR(120)  NOT NULL,
  address    VARCHAR(300)  DEFAULT '',
  phone      VARCHAR(20)   NOT NULL,
  payment    VARCHAR(30)   DEFAULT '',
  total      DECIMAL(8, 2) NOT NULL DEFAULT 0,
  items      JSON          NOT NULL,
  obs        VARCHAR(500)  DEFAULT '',
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS config (
  `key`   VARCHAR(50)  NOT NULL PRIMARY KEY,
  `value` VARCHAR(255) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Valor inicial: restaurante fechado
INSERT INTO config (`key`, `value`) VALUES ('isOpen', 'false')
  ON DUPLICATE KEY UPDATE `key` = `key`;
