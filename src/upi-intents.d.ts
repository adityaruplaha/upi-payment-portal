declare module 'upi-intents' {
	export function createPaymentUri(
		vpa: string,
		payeeName: string,
		amount?: string,
		note?: string
	): string;
}
