/**
 * The domain a request's payment links are stored under: the hostname without its `pay.`
 * prefix, so pay.example.com looks up links stored for example.com.
 */
export function linkDomain(hostname: string): string {
	return hostname.replace(/^pay\./i, '') || hostname;
}

/** The part of a D1 database binding the lookup uses. */
export interface Queryable {
	prepare(query: string): {
		bind(...values: unknown[]): { first<T>(): Promise<T | null> };
	};
}

export interface PaymentLink {
	domain: string;
	payeeName: string;
	vpa: string;
	amount: number | null;
	transactionNote: string | null;
}

/** The active payment link for a token on a hostname, or null. */
export async function findPaymentLink(
	db: Queryable,
	token: string,
	hostname: string
): Promise<PaymentLink | null> {
	const domain = linkDomain(hostname);

	const result = await db
		.prepare(
			`SELECT p.amount, p.transaction_note, b.payee_name, b.vpa
			FROM payment_links p
			JOIN beneficiaries b ON p.beneficiary_id = b.id
			WHERE p.token = ? AND p.domain = ? AND p.is_active = 1`
		)
		.bind(token, domain)
		.first<{
			amount: number | null;
			transaction_note: string | null;
			payee_name: string;
			vpa: string;
		}>();

	if (!result) {
		return null;
	}

	return {
		domain,
		payeeName: result.payee_name,
		vpa: result.vpa,
		amount: result.amount,
		transactionNote: result.transaction_note
	};
}
