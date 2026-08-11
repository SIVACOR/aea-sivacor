// Orphaned-upload recovery: files left in the user's Uploads folder by a
// session that never submitted.
//
// The premise this guards: an upload lands in the user's own Uploads folder and
// stays there, charged to their quota, until the worker's prepare_submission
// *moves* the item into the Submissions collection. Refresh the page before
// submitting and the item is stranded -- the pre-fix UI held its id only in
// FileUploader's memory, so nothing could ever list or delete it again.
//
// Seeds real orphans through the API (which is exactly what a refreshed session
// leaves behind), then drives the UI to delete one and adopt the other, and
// cross-checks against Girder rather than the DOM -- the whole point is what
// survives on the server.

import fs from 'fs';
import {
    API,
    apiGet,
    bodyText,
    getToken,
    makePackage,
    open,
    resetToRunner,
    sleep,
    waitTerminal,
} from './lib.mjs';

const fails = [];
const ok = (cond, msg) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
    if (!cond) fails.push(msg);
};

async function uploadsFolderId(token) {
    const me = await apiGet('/user/me', token);
    const f = await apiGet(`/folder?parentType=user&parentId=${me._id}&name=Uploads&limit=1`, token);
    if (!f.length) throw new Error('admin has no Uploads folder');
    return f[0]._id;
}

const listItems = (token, folderId) => apiGet(`/item?folderId=${folderId}&limit=100`, token);

/** Upload a file straight into Uploads -- i.e. manufacture an orphan. */
async function seedOrphan(token, folderId, name, filePath) {
    const body = fs.readFileSync(filePath);
    const init = await fetch(
        `${API}/file?parentType=folder&parentId=${folderId}` +
            `&name=${encodeURIComponent(name)}&size=${body.length}&mimeType=application/zip`,
        { method: 'POST', headers: { 'Girder-Token': token } }
    );
    if (!init.ok) throw new Error(`init upload -> ${init.status}`);
    const uploadId = (await init.json())._id;
    const chunk = await fetch(`${API}/file/chunk?offset=0&uploadId=${uploadId}`, {
        method: 'POST',
        headers: { 'Girder-Token': token, 'Content-Type': 'application/octet-stream' },
        body,
    });
    if (!chunk.ok) throw new Error(`chunk -> ${chunk.status}`);
    const file = await chunk.json();
    return { itemId: file.itemId, fileId: file._id, name };
}

async function main() {
    const token = await getToken();
    const folderId = await uploadsFolderId(token);

    // Start from a known-empty Uploads folder so counts mean something.
    for (const item of await listItems(token, folderId)) {
        await fetch(`${API}/item/${item._id}`, {
            method: 'DELETE',
            headers: { 'Girder-Token': token },
        });
    }

    const zip = makePackage();
    const keep = await seedOrphan(token, folderId, 'orphan-keep.zip', zip);
    const drop = await seedOrphan(token, folderId, 'orphan-drop.zip', zip);
    console.log(`seeded: keep=${keep.itemId} drop=${drop.itemId}\n`);

    const { page, close } = await open();
    try {
        // The panel lives in JobRunner, which JobMonitor only mounts when no
        // job is being watched. A completed submission left over from an
        // earlier run shows the monitor instead, so the form has to be
        // reclaimed before any of this means anything.
        ok(await resetToRunner(page), 'runner form is showing (not the monitor)');

        const panel = page.locator('.pending-uploads');
        await page.waitForSelector('.pending-uploads', { timeout: 15000 }).catch(() => {});

        ok(await panel.isVisible().catch(() => false), 'panel appears on load with orphans present');
        const text = await panel.innerText().catch(() => '');
        ok(/2 unsubmitted uploads/.test(text), 'panel reports both orphans');
        ok(text.includes('orphan-keep.zip'), 'lists orphan-keep.zip');
        ok(text.includes('orphan-drop.zip'), 'lists orphan-drop.zip');
        ok(/quota/i.test(text), 'explains the quota consequence');

        // --- delete the one we do not want -------------------------------
        const dropRow = page.locator('.pending-row', { hasText: 'orphan-drop.zip' });
        await dropRow.locator('.pending-delete-button').click();
        await sleep(2500);

        const afterDelete = await listItems(token, folderId);
        ok(
            !afterDelete.some((i) => i._id === drop.itemId),
            'delete removes the item from Girder, not just the DOM'
        );
        ok(
            afterDelete.some((i) => i._id === keep.itemId),
            'delete leaves the other orphan alone'
        );
        ok(
            !(await panel.innerText()).includes('orphan-drop.zip'),
            'deleted orphan disappears from the panel'
        );

        // --- adopt the one we do want ------------------------------------
        await page.locator('.pending-row', { hasText: 'orphan-keep.zip' })
            .locator('.pending-use-button')
            .click();
        await sleep(1500);

        ok(
            await page.locator('.upload-success').isVisible().catch(() => false),
            'adopting an orphan puts the form in the uploaded state'
        );
        ok(
            !(await panel.isVisible().catch(() => false)),
            'panel closes once the last orphan is adopted'
        );

        // The real proof the adopted file id is usable: submit with it and let
        // the server accept it. A wrong id 403s or 400s here.
        //
        // The step fields have to be filled explicitly -- runJob() validates
        // completeness before it posts, so relying on the seeded defaults just
        // trips validation and no request is ever made.
        await page.selectOption('select[id^="image-select-"]', 'rocker/r-ver');
        await page.waitForTimeout(400);
        await page.selectOption(
            'select[id^="image-tag-"], select:not([id^="image-select-"]):not(.disabled-select)',
            '4.6.1'
        );
        await page.fill('input[id^="execution-file-"]', 'main.R');

        const submitResp = page.waitForResponse(
            (r) => r.url().includes('/sivacor/submit_job') && r.request().method() === 'POST',
            { timeout: 60000 }
        );
        await page.locator('button.run-button').first().click();
        const resp = await submitResp.catch(() => null);
        if (!resp) console.log('   status banner said:', (await bodyText(page)).slice(0, 400));
        ok(
            resp !== null && resp.status() < 300,
            `submit_job accepts the adopted file id (${resp ? resp.status() : 'no response'})`
        );

        // ...and the item leaves Uploads, which is what frees the quota.
        let moved = false;
        for (let i = 0; i < 40 && !moved; i++) {
            await sleep(3000);
            moved = !(await listItems(token, folderId)).some((it) => it._id === keep.itemId);
        }
        ok(moved, 'submitted item moves out of Uploads (quota released)');

        // --- clean folder means no panel ---------------------------------
        // Reclaim the form first: the submit above put the monitor on screen,
        // and "no panel" is vacuously true there whether or not the listing
        // works. The reset control only exists once the job is terminal --
        // the item leaving Uploads happens early in prepare_submission, so
        // that is nowhere near a good enough signal to reset on.
        const finalStatus = await waitTerminal(page);
        console.log(`   job reached ${finalStatus}`);
        const backOnRunner = await resetToRunner(page);
        await sleep(3000);
        ok(backOnRunner, 'runner form reclaimed for the empty-folder check');
        ok(
            (await page.locator('.pending-uploads').count()) === 0,
            'no panel when the Uploads folder is empty'
        );
    } finally {
        await close();
    }

    console.log(`\n${fails.length ? `${fails.length} FAILED` : 'all passed'}`);
    process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
