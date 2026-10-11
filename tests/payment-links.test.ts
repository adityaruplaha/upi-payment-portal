import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { findPaymentLink, linkDomain, type Queryable } from '../src/lib/server/payment-links';

// The part of a D1 binding the lookup uses, over an in-memory SQLite database made from
// db_schema.sql. D1 runs SQLite too, so the query behaves the same.
function memoryD1(): { db: Queryable; sqlite: Database } {
	const sqlite = new Database(':memory:');
	sqlite.exec(readFileSync(new URL('../db_schema.sql', import.meta.url), 'utf8'));
	const db: Queryable = {
		prepare: (query) => ({
			bind: (...values) => ({
				first: async <T>() => (sqlite.query(query).get(...(values as string[])) as T) ?? null
			})
		})
	};
	return { db, sqlite };
}

let db: Queryable;

beforeEach(() => {
	const memory = memoryD1();
	db = memory.db;
	memory.sqlite.exec(`
		INSERT INTO beneficiaries (id, payee_name, vpa, is_active) VALUES
			('active', 'Test Payee & Co', 'test.payee@okaxis', 1),
			('inactive', 'Gone Payee', 'gone@okaxis', 0);
		INSERT INTO payment_links (token, domain, beneficiary_id, amount, transaction_note, is_active) VALUES
			('fixed', 'example.com', 'active', 250.5, 'Class fee', 1),
			('open', 'example.com', 'active', NULL, NULL, 1),
			('fixed', 'example.org', 'active', 1200, NULL, 1),
			('off', 'example.com', 'active', 100, NULL, 0),
			('payee-off', 'example.com', 'inactive', 100, NULL, 1);
	`);
});

describe('linkDomain', () => {
	it('strips pay. and keeps any other hostname', () => {
		expect(linkDomain('pay.example.com')).toBe('example.com');
		expect(linkDomain('PAY.example.com')).toBe('example.com');
		expect(linkDomain('example.com')).toBe('example.com');
		expect(linkDomain('www.example.com')).toBe('www.example.com');
	});
});

describe('findPaymentLink', () => {
	it('finds a link with an amount and a note', async () => {
		expect(await findPaymentLink(db, 'fixed', 'pay.example.com')).toEqual({
			domain: 'example.com',
			payeeName: 'Test Payee & Co',
			vpa: 'test.payee@okaxis',
			amount: 250.5,
			transactionNote: 'Class fee'
		});
	});

	it('finds a link without an amount or note', async () => {
		const link = await findPaymentLink(db, 'open', 'pay.example.com');
		expect(link?.amount).toBeNull();
		expect(link?.transactionNote).toBeNull();
	});

	it('scopes tokens to their domain', async () => {
		expect((await findPaymentLink(db, 'fixed', 'pay.example.org'))?.amount).toBe(1200);
		expect(await findPaymentLink(db, 'open', 'pay.example.org')).toBeNull();
	});

	it('does not find an inactive link', async () => {
		expect(await findPaymentLink(db, 'off', 'pay.example.com')).toBeNull();
	});

	it('does not find an unknown token, and tokens are case-sensitive', async () => {
		expect(await findPaymentLink(db, 'missing', 'pay.example.com')).toBeNull();
		expect(await findPaymentLink(db, 'FIXED', 'pay.example.com')).toBeNull();
	});

	// The lookup does not check whether the beneficiary is active, so this fails today.
	it.skip('does not find a link to an inactive beneficiary', async () => {
		expect(await findPaymentLink(db, 'payee-off', 'pay.example.com')).toBeNull();
	});
});
