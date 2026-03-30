-- Seguridad onboarding: rate limit por IP y email

CREATE TABLE IF NOT EXISTS onboarding_registration_attempts (
    id SERIAL PRIMARY KEY,
    ip_address VARCHAR(64) NOT NULL,
    admin_email VARCHAR(255) NOT NULL,
    tenant_nombre VARCHAR(200),
    successful BOOLEAN NOT NULL DEFAULT FALSE,
    failure_reason VARCHAR(120),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_onboarding_attempts_ip_created
ON onboarding_registration_attempts(ip_address, created_at);

CREATE INDEX IF NOT EXISTS ix_onboarding_attempts_email_created
ON onboarding_registration_attempts(admin_email, created_at);
