import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
    if (!/^pay\./i.test(url.hostname)) {
        return {};
    }

    const targetUrl = new URL(url);
    targetUrl.hostname = url.hostname.replace(/^pay\./i, '');

    throw redirect(307, targetUrl.toString());
};
