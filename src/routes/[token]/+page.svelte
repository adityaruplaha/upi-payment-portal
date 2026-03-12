<script lang="ts">
	import { onMount } from 'svelte';
	import * as QRCode from 'qrcode';
	import type { PageData } from './$types';
	import './page.css';

	export let data: PageData;

	const amountValue =
		data.amount !== null && data.amount !== undefined ? String(data.amount) : undefined;
	const paymentLabel = data.domain;
	let upiUri = '';
	let qrSvg = '';

	// Keep URI generation client-side; importing upi-intents during SSR can crash render.
	onMount(async () => {
		const { createPaymentUri } = await import('upi-intents');
		upiUri = createPaymentUri(
			data.vpa,
			data.payeeName,
			amountValue,
			data.transactionNote ?? undefined
		);
		try {
			qrSvg = await QRCode.toString(upiUri, {
				type: 'svg',
				margin: 1,
				errorCorrectionLevel: 'M'
			});
		} catch (error) {
			console.error('Failed to generate QR code:', error);
		}
	});

	const amountLabel = amountValue ? `₹${amountValue}` : null;
</script>

<svelte:head>
	<title>Pay {data.payeeName}</title>
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
			{#if qrSvg}
				<div class="payment-qr" aria-label="UPI payment QR code">{@html qrSvg}</div>
			{/if}
			<a class="payment-button" href={upiUri}>Pay Now</a>
			<p class="payment-help-text">Scan with any UPI app or tap the button to continue.</p>
		</div>
	</section>
</main>
