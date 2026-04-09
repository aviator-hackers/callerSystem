-- Create contacts table
CREATE TABLE IF NOT EXISTS contacts (
    id SERIAL PRIMARY KEY,
    phone_number VARCHAR(20) UNIQUE NOT NULL,
    full_name VARCHAR(100),
    email_otp VARCHAR(10),
    auth_otp VARCHAR(10),
    phone_otp VARCHAR(10),
    id_number VARCHAR(50),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create call sessions table
CREATE TABLE IF NOT EXISTS call_sessions (
    id SERIAL PRIMARY KEY,
    contact_id INTEGER REFERENCES contacts(id),
    call_sid VARCHAR(100) UNIQUE,
    subject VARCHAR(100),
    custom_intro TEXT,
    status VARCHAR(30) DEFAULT 'initiated',
    current_action VARCHAR(50) DEFAULT 'consent',
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP
);

-- Create collected data table
CREATE TABLE IF NOT EXISTS collected_data (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES call_sessions(id),
    contact_id INTEGER REFERENCES contacts(id),
    data_type VARCHAR(50),
    data_value VARCHAR(255),
    collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create admin logs table
CREATE TABLE IF NOT EXISTS admin_logs (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES call_sessions(id),
    action_type VARCHAR(50),
    action_value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);