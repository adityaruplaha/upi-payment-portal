// src/routes/[token]/+page.server.ts
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, platform }) => {
	// Note that we are using env.payments here to match your wrangler.jsonc
	const db = platform?.env?.payments;

	if (!db) {
		throw error(500, 'Database connection is missing.');
	}

	const domain = url.hostname.replace(/^pay\./i, '') || url.hostname;

	const stmt = db.prepare(`
        SELECT p.amount, p.transaction_note, b.payee_name, b.vpa
        FROM payment_links p
        JOIN beneficiaries b ON p.beneficiary_id = b.id
        WHERE p.token = ? AND p.domain = ? AND p.is_active = 1
    `);

	const result = await stmt.bind(params.token, domain).first();

	if (!result) {
		throw error(404, 'Payment link is either inactive or does not exist for this domain.');
	}

	return {
		domain,
		payeeName: result.payee_name,
		vpa: result.vpa,
		amount: result.amount,
		transactionNote: result.transaction_note
	};
};
