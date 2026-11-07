// Scenario: the Stata images moved from dataeditors/ to sscng/
// (SIVACOR/sivacor-repo-choice#7). A workflow exported before the move, or a
// selection saved in this browser, names an image the allow-list no longer has:
// the import panel must carry it across *and say so*, and the saved form must
// not silently drop it.
//
//   node e2e/image-move.mjs
//
// Read-only: /sivacor/image_tags is intercepted to stand in for the allow-list
// after the move, and the runner is reached with GETs only (reachRunner), so
// nothing is submitted or deleted and it is safe to run at any time.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { open, reachRunner, sleep } from './lib.mjs';

const checks = [];
const check = (name, ok, detail) => {
    checks.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
};

const AFTER_MOVE = {
    'sscng/stata18_5-mp': ['2025-02-26', '2024-12-18'],
    'rocker/r-ver': ['4.6.1'],
};
const BOTH = { ...AFTER_MOVE, 'dataeditors/stata18_5-mp': ['2025-02-26'] };

let allowList = AFTER_MOVE;
const { ctx, page, close } = await open();
await ctx.route('**/sivacor/image_tags*', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(allowList) }),
);

const write = (name, body) => {
    const file = path.join(os.tmpdir(), name);
    fs.writeFileSync(file, body);
    return file;
};

async function importFile(file) {
    await page.locator('span.import-title').click();
    await sleep(500);
    await page.setInputFiles('#workflow-import-input', file);
    await page.waitForFunction(
        () => /Imported \d+ steps?|could not be imported/.test(document.body.innerText),
        null,
        { timeout: 60000 },
    );
    return page.evaluate(() => document.body.innerText);
}

const selected = (kind) =>
    page.locator(`select[id^="${kind}-select-"]`).evaluateAll((els) => els.map((e) => e.value));

// -- 1. an old export imports, renamed, with a notice ---------------------
check('runner reachable read-only', await reachRunner(page));
let text = await importFile(
    write(
        'sivacor-e2e-old-stata.yaml',
        `stages:
  - image_name: dataeditors/stata18_5-mp
    image_tag: "2025-02-26"
    main_file: main.do
  - image_name: rocker/r-ver
    image_tag: "4.6.1"
    main_file: main.R
`,
    ),
);
check('old dataeditors workflow imports', /Imported 2 steps/.test(text));
check('the rename is announced', /Renamed images:/.test(text));
check('the notice names the old and new image',
    text.includes('"dataeditors/stata18_5-mp" has moved to "sscng/stata18_5-mp"'));
check('the notice says the image is not identical', /not byte-identical/.test(text));
check('only the moved stage is named', /Step 1:/.test(text) && !/Step 2:/.test(text));
let images = await selected('image');
check('form shows the new image, other stage untouched',
    JSON.stringify(images) === JSON.stringify(['sscng/stata18_5-mp', 'rocker/r-ver']),
    JSON.stringify(images));
const tags = await selected('tag');
check('the tag is kept', tags[0] === '2025-02-26', JSON.stringify(tags));

// -- 2. renamed, but the tag did not survive: refused, still announced ----
await reachRunner(page);
text = await importFile(
    write(
        'sivacor-e2e-old-stata-badtag.yaml',
        `stages:
  - image_name: dataeditors/stata18_5-mp
    image_tag: "1999-01-01"
    main_file: main.do
`,
    ),
);
check('a missing tag is still refused', /could not be imported/.test(text));
check('the refusal names the new image',
    /image "sscng\/stata18_5-mp" has no tag "1999-01-01"/.test(text));
check('the rename is announced on a refusal too', /Renamed images:/.test(text));

// -- 3. while the old name is still listed, nothing is touched ------------
allowList = BOTH;
await reachRunner(page);
text = await importFile(
    write(
        'sivacor-e2e-old-stata-listed.yaml',
        `stages:
  - image_name: dataeditors/stata18_5-mp
    image_tag: "2025-02-26"
    main_file: main.do
`,
    ),
);
check('imports unchanged while dataeditors is listed', /Imported 1 step/.test(text));
check('no rename notice then', !/Renamed images:/.test(text));
images = await selected('image');
check('form keeps the old image', images[0] === 'dataeditors/stata18_5-mp', JSON.stringify(images));

// -- 4. a selection saved before the move survives it ---------------------
allowList = AFTER_MOVE;
await page.evaluate(() =>
    localStorage.setItem(
        'sivacor_config_entries',
        JSON.stringify([
            {
                selectedImage: 'dataeditors/stata18_5-mp',
                selectedTag: '2024-12-18',
                executionFileName: 'analysis.do',
                networkIsolation: true,
            },
        ]),
    ),
);
await reachRunner(page);
images = await selected('image');
check('saved dataeditors selection restores as sscng',
    images[0] === 'sscng/stata18_5-mp', JSON.stringify(images));
const savedTags = await selected('tag');
check('saved tag restored with it', savedTags[0] === '2024-12-18', JSON.stringify(savedTags));

await close();
const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
