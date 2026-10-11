// src/routes/[token]/+page.server.ts
import { error } from '@sveltejs/kit';
import { findPaymentLink } from '$lib/server/payment-links';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, platform }) => {
	// Note that we are using env.payments here to match your wrangler.jsonc
	const db = platform?.env?.payments;

	if (!db) {
		throw error(500, 'Database connection is missing.');
	}

	const link = await findPaymentLink(db, params.token, url.hostname);

	if (!link) {
		throw error(404, 'Payment link is either inactive or does not exist for this domain.');
	}

	return link;
};
