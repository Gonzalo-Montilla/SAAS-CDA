-- Verificación de correo para onboarding de nuevos tenants CDA

CREATE TABLE IF NOT EXISTS onboarding_email_verifications (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    code_hash VARCHAR(128) NOT NULL,
    expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at TIMESTAMP WITHOUT TIME ZONE,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITHOUT TIME ZONE
);

CREATE INDEX IF NOT EXISTS ix_onboarding_email_verifications_expires
ON onboarding_email_verifications(expires_at);
