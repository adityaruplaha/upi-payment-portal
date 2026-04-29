<script lang="ts">
	import * as QRCode from 'qrcode';
	import type { PageData } from './$types';
	import './page.css';

	export let data: PageData;

	const amountValue =
		data.amount !== null && data.amount !== undefined ? String(data.amount) : undefined;
	const paymentLabel = data.domain;
	const upiUri = buildUpiUri();

	function buildUpiUri() {
		const uri = new URL('upi://pay');
		uri.searchParams.set('pa', data.vpa);
		uri.searchParams.set('pn', data.payeeName);
		uri.searchParams.set('cu', 'INR');

		if (amountValue) {
			uri.searchParams.set('am', amountValue);
		}

		if (data.transactionNote) {
			uri.searchParams.set('tn', data.transactionNote);
		}

		return uri.toString().replace(/\+/g, '%20');
	}

	const qrSvgPromise = QRCode.toString(upiUri, {
		type: 'svg',
		margin: 1,
		errorCorrectionLevel: 'M'
	}).catch((error) => {
		console.error('Failed to generate QR code:', error);
		return '';
	});

	const amountLabel = amountValue ? `₹${amountValue}` : null;
</script>

<svelte:head>
	<title>Pay {data.payeeName}{data.transactionNote ? ` for ${data.transactionNote}` : ''}</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700;800&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<main>
	<section class="payment-panel">
		<p class="payment-label">{paymentLabel}</p>
		<h1 class="payment-title">Pay via UPI</h1>

		<div class="payer-summary">
			<p class="payer-name">Paying <strong>{data.payeeName}</strong></p>
			<p class="payer-vpa">{data.vpa}</p>
			{#if amountLabel}
				<p class="payment-amount">{amountLabel}</p>
			{/if}
			{#if data.transactionNote}
				<p class="payment-note">{data.transactionNote}</p>
			{/if}
		</div>

		<div class="payment-actions">
			{#await qrSvgPromise then qrSvg}
				{#if qrSvg}
					<div class="payment-qr" aria-label="UPI payment QR code">{@html qrSvg}</div>
				{/if}
			{/await}
			<a class="payment-button" href={upiUri}>Pay Now</a>
			<p class="payment-help-text">Scan with any UPI app or tap the button to continue.</p>
		</div>
	</section>
</main>
