import { describe, expect, it } from 'bun:test';
import { buildUpiUri, formatAmount } from '../src/lib/upi';

// These pin the URL exactly, so a change to it is a decision rather than an accident.
describe('buildUpiUri', () => {
	it('builds a link with only the payee', () => {
		expect(buildUpiUri({ vpa: 'someone@okaxis', payeeName: 'Someone' })).toBe(
			'upi://pay?pa=someone%40okaxis&pn=Someone&cu=INR'
		);
	});

	it('adds a whole amount and a note', () => {
		expect(
			buildUpiUri({
				vpa: 'someone@okaxis',
				payeeName: 'Someone',
				amount: 500,
				transactionNote: 'Fee'
			})
		).toBe('upi://pay?pa=someone%40okaxis&pn=Someone&cu=INR&am=500.00&tn=Fee');
	});

	it('sends the amount with two decimals', () => {
		expect(buildUpiUri({ vpa: 'a@b', payeeName: 'A', amount: 250.5 })).toBe(
			'upi://pay?pa=a%40b&pn=A&cu=INR&am=250.50'
		);
		expect(buildUpiUri({ vpa: 'a@b', payeeName: 'A', amount: 99.99 })).toBe(
			'upi://pay?pa=a%40b&pn=A&cu=INR&am=99.99'
		);
	});

	it('leaves out an amount or note that is null or empty', () => {
		expect(buildUpiUri({ vpa: 'a@b', payeeName: 'A', amount: null, transactionNote: null })).toBe(
			'upi://pay?pa=a%40b&pn=A&cu=INR'
		);
		expect(buildUpiUri({ vpa: 'a@b', payeeName: 'A', transactionNote: '' })).toBe(
			'upi://pay?pa=a%40b&pn=A&cu=INR'
		);
	});

	it('encodes spaces as %20, and @, & and + by their codes', () => {
		const uri = buildUpiUri({
			vpa: 'test.payee@okaxis',
			payeeName: 'Test Payee & Co',
			amount: 1200,
			transactionNote: 'Workshop + material'
		});
		expect(uri).toBe(
			'upi://pay?pa=test.payee%40okaxis&pn=Test%20Payee%20%26%20Co&cu=INR&am=1200.00&tn=Workshop%20%2B%20material'
		);
		expect(uri).not.toContain('+');
		const params = new URL(uri).searchParams;
		expect(params.get('pn')).toBe('Test Payee & Co');
		expect(params.get('tn')).toBe('Workshop + material');
	});
});

describe('formatAmount', () => {
	it('prints the stored number with two decimals', () => {
		expect(formatAmount(250.5)).toBe('250.50');
		expect(formatAmount(500)).toBe('500.00');
		expect(formatAmount(99.99)).toBe('99.99');
		expect(formatAmount(null)).toBeUndefined();
		expect(formatAmount(undefined)).toBeUndefined();
	});
});
