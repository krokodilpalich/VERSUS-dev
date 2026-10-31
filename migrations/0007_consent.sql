CREATE TABLE user_consents (user_id text NOT NULL REFERENCES "user"(id), type text NOT NULL, version text NOT NULL, accepted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,type,version));
