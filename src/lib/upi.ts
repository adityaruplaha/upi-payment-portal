export interface UpiPayment {
	vpa: string;
	payeeName: string;
	amount?: number | null;
	transactionNote?: string | null;
}

/** The `upi://pay` URL that the QR code and the Pay Now button carry. */
export function buildUpiUri(payment: UpiPayment): string {
	const uri = new URL('upi://pay');
	uri.searchParams.set('pa', payment.vpa);
	uri.searchParams.set('pn', payment.payeeName);
	uri.searchParams.set('cu', 'INR');

	const amount = formatAmount(payment.amount);
	if (amount) {
		uri.searchParams.set('am', amount);
	}

	if (payment.transactionNote) {
		uri.searchParams.set('tn', payment.transactionNote);
	}

	return uri.toString().replace(/\+/g, '%20');
}

/** The amount as it is shown and sent, or undefined when there is none. */
export function formatAmount(amount: number | null | undefined): string | undefined {
	return amount !== null && amount !== undefined ? String(amount) : undefined;
}
