<script lang="ts">
	import * as QRCode from 'qrcode';
	import { buildUpiUri, formatAmount } from '#lib/upi.js';
	import type { PageProps } from './$types';
	import './page.css';

	let { data }: PageProps = $props();

	const amountValue = $derived(formatAmount(data.amount));
	const paymentLabel = $derived(data.domain);
	const upiUri = $derived(buildUpiUri(data));

	const qrSvgPromise = $derived(
		QRCode.toString(upiUri, {
			type: 'svg',
			margin: 1,
			errorCorrectionLevel: 'M'
		}).catch((error) => {
			console.error('Failed to generate QR code:', error);
			return '';
		})
	);

	const amountLabel = $derived(amountValue ? `₹${amountValue}` : null);
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
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- the SVG is made by the qrcode library -->
					<div class="payment-qr" aria-label="UPI payment QR code">{@html qrSvg}</div>
				{/if}
			{/await}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a upi:// link, not a route -->
			<a class="payment-button" href={upiUri}>Pay by any UPI app</a>
			<p class="payment-help-text payment-help-touch">
				Scan with any UPI app or tap the button to continue.
			</p>
			<p class="payment-help-text payment-help-desktop">Scan with any UPI app on your phone.</p>
		</div>
	</section>
</main>
