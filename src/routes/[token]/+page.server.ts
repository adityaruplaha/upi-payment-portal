import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { findPaymentLink } from '#lib/server/payment-links.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const link = await findPaymentLink(env.payments, params.token, url.hostname);

	if (!link) {
		error(404, 'Payment link is either inactive or does not exist for this domain.');
	}

	return link;
};
