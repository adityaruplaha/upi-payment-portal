CREATE TABLE beneficiaries (
    id TEXT PRIMARY KEY,
    payee_name TEXT NOT NULL,
    vpa TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE payment_links (
    token TEXT NOT NULL,
    domain TEXT NOT NULL,
    beneficiary_id TEXT NOT NULL,
    amount REAL,
    transaction_note TEXT,
    is_active INTEGER DEFAULT 1,
    PRIMARY KEY (token, domain),
    FOREIGN KEY(beneficiary_id) REFERENCES beneficiaries(id) ON DELETE RESTRICT
);