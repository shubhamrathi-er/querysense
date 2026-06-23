-- This runs once when MySQL container first starts
-- Creates a read-only user for executing user queries safely
CREATE USER IF NOT EXISTS 'querysense_ro'@'%' IDENTIFIED BY 'readonly_pass';
-- We'll grant per-database permissions dynamically when connections are added

-- Create the querysense app database
CREATE DATABASE IF NOT EXISTS querysense;
GRANT ALL PRIVILEGES ON querysense.* TO 'querysense_user'@'%';
FLUSH PRIVILEGES;
